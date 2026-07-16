const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { client } = require("./db");
const { JWT_SECRET, rowToPublicUser } = require("./auth");
const {
  RANK_ORDER, getSkillDefinition, getItemPassives, ownsSkill, startingLoadout,
  levelToRank, MAX_LEVEL,
} = require("./gameLogic");
const { STARTING_MONEY, LEVEL_GAIN_PER_WIN, LEVEL_GAIN_RANK_BONUS, RANKUP_BONUS_MONEY_RATIO } = require("./gameConfig");

const BASE_HP = 100;
const DISCONNECT_GRACE_MS = 900000; // 접속이 끊겨도 이 시간 안에 재접속하면 전투 계속 진행

async function getUserRow(userId) {
  const result = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [userId] });
  return result.rows[0] || null;
}

class CombatServer {
  constructor(io) {
    this.io = io;
    this.queue = [];
    this.matches = new Map();
    this.socketsByUser = new Map();
    this.disconnectTimers = new Map();

    io.on("connection", (socket) => this.handleConnection(socket));
  }

  handleConnection(socket) {
    socket.on("auth", async (token) => {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const row = await getUserRow(payload.id);
        if (!row) return socket.emit("auth:error", "존재하지 않는 계정입니다.");
        socket.userId = row.id;
        socket.isGod = !!row.is_god;
        this.socketsByUser.set(row.id, socket);

        const pendingTimer = this.disconnectTimers.get(row.id);
        if (pendingTimer) { clearTimeout(pendingTimer); this.disconnectTimers.delete(row.id); }

        const activeMatch = [...this.matches.values()].find((m) => m.status === "active" && m.players[row.id]);
        if (activeMatch) {
          socket.matchId = activeMatch.id;
          socket.join(activeMatch.id);
          socket.emit("match:start", this.publicMatchState(activeMatch));
          socket.to(activeMatch.id).emit("opponent:reconnected");
        }
        socket.emit("auth:ok");
      } catch (e) {
        socket.emit("auth:error", "토큰이 유효하지 않습니다.");
      }
    });

    socket.on("queue:join", () => this.joinQueue(socket));
    socket.on("queue:leave", () => this.leaveQueue(socket));
    socket.on("skill:cast", (skillId) => this.castSkill(socket, skillId));
    socket.on("surrender", () => this.surrender(socket));
    socket.on("disconnect", () => this.handleDisconnect(socket));
  }

  forceDisconnectUser(userId) {
    const socket = this.socketsByUser.get(userId);
    if (socket) { socket.emit("account:deleted"); socket.disconnect(true); }
    this.socketsByUser.delete(userId);
    this.leaveQueueByUserId(userId);
  }

  joinQueue(socket) {
    if (!socket.userId) return socket.emit("error:msg", "먼저 로그인하세요.");
    if (this.queue.find((q) => q.userId === socket.userId)) return;
    this.queue.push({ socket, userId: socket.userId });
    if (this.queue.length >= 2) {
      const a = this.queue.shift();
      const b = this.queue.shift();
      this.startMatch(a, b);
    } else {
      socket.emit("queue:waiting");
    }
  }
  leaveQueue(socket) { this.queue = this.queue.filter((q) => q.socket.id !== socket.id); }
  leaveQueueByUserId(userId) { this.queue = this.queue.filter((q) => q.userId !== userId); }

  async buildPlayerState(userId) {
    const row = await getUserRow(userId);
    const items = JSON.parse(row.items);
    const passives = getItemPassives(items);
    const maxHp = BASE_HP + passives.maxHpBonus;
    return {
      userId, username: row.username, rank: row.rank, isGod: !!row.is_god,
      skills: JSON.parse(row.skills), items,
      maxHp, hp: maxHp,
      damageReduction: passives.damageReduction,
      immuneElements: passives.immuneElements,
      cooldowns: {}, usesThisMatch: {},
    };
  }

  async startMatch(a, b) {
    const matchId = `${a.userId}-${b.userId}-${Date.now()}`;
    const [stateA, stateB] = await Promise.all([this.buildPlayerState(a.userId), this.buildPlayerState(b.userId)]);
    const state = { id: matchId, status: "active", players: { [a.userId]: stateA, [b.userId]: stateB }, log: [] };
    this.matches.set(matchId, state);
    [a, b].forEach(({ socket, userId }) => { socket.join(matchId); socket.matchId = matchId; });
    this.io.to(matchId).emit("match:start", this.publicMatchState(state));
  }

  publicMatchState(state) {
    const players = {};
    Object.values(state.players).forEach((p) => {
      players[p.userId] = {
        userId: p.userId, username: p.username, rank: p.rank, isGod: p.isGod,
        hp: p.hp, maxHp: p.maxHp, skills: p.skills, items: p.items,
      };
    });
    return { id: state.id, status: state.status, players, log: state.log.slice(-40) };
  }

  checkConditions(player, skillDef, now) {
    for (const cond of skillDef.conditions) {
      if (cond.type === "cooldown") {
        const readyAt = player.cooldowns[skillDef.id] || 0;
        if (now < readyAt) return `쿨타임이 ${((readyAt - now) / 1000).toFixed(1)}초 남았습니다.`;
      } else if (cond.type === "hpFull") {
        if (player.hp < player.maxHp) return "HP가 최대일 때만 사용할 수 있습니다.";
      } else if (cond.type === "hpBelow") {
        if (player.hp > player.maxHp * (cond.percent / 100)) return `HP가 ${cond.percent}% 이하일 때만 사용할 수 있습니다.`;
      } else if (cond.type === "hpAtLeast") {
        if (player.hp < player.maxHp * (cond.percent / 100)) return `HP가 ${cond.percent}% 이상일 때만 사용할 수 있습니다.`;
      } else if (cond.type === "rankAtLeast") {
        if (RANK_ORDER.indexOf(player.rank) < RANK_ORDER.indexOf(cond.rank)) return `계급 ${cond.rank} 이상만 사용할 수 있습니다.`;
      } else if (cond.type === "usesPerMatch") {
        const used = player.usesThisMatch[skillDef.id] || 0;
        if (used >= cond.max) return `이번 전투에서 이미 ${cond.max}회 사용했습니다.`;
      }
    }
    return null;
  }

  // 스킬 발동 자체는 전부 메모리 상에서 동기적으로 처리됩니다 (DB 접근 없음) -> 경쟁상태 걱정 없음.
  // 전투가 끝날 때(endMatch)만 비동기로 DB에 결과를 씁니다.
  castSkill(socket, skillId) {
    const state = this.matches.get(socket.matchId);
    if (!state || state.status !== "active") return;
    const player = state.players[socket.userId];
    const opponentId = Object.keys(state.players).find((id) => id !== socket.userId);
    const opponent = state.players[opponentId];
    if (!player || !opponent) return;

    if (!ownsSkill(player.skills, player.items, skillId)) return socket.emit("error:msg", "보유하지 않은 스킬입니다.");
    const skillDef = getSkillDefinition(skillId);
    if (!skillDef) return socket.emit("error:msg", "존재하지 않는 스킬입니다.");

    const now = Date.now();
    const failReason = this.checkConditions(player, skillDef, now);
    if (failReason) return socket.emit("skill:fail", { skillId, reason: failReason });

    const cdCond = skillDef.conditions.find((c) => c.type === "cooldown");
    if (cdCond) player.cooldowns[skillDef.id] = now + cdCond.ms;
    const usesCond = skillDef.conditions.find((c) => c.type === "usesPerMatch");
    if (usesCond) player.usesThisMatch[skillDef.id] = (player.usesThisMatch[skillDef.id] || 0) + 1;

    const element = skillDef.element || "none";
    const immune = opponent.immuneElements.includes(element);
    const damage = opponent.isGod || immune ? 0 : Math.round(skillDef.power * (1 - opponent.damageReduction));
    opponent.hp = Math.max(0, opponent.hp - damage);

    state.log.push({ t: now, actor: player.userId, skillId: skillDef.id, skillName: skillDef.name, damage, targetId: opponent.userId, targetHpAfter: opponent.hp });
    this.io.to(state.id).emit("match:update", this.publicMatchState(state));

    if (opponent.hp <= 0 && !opponent.isGod) this.endMatch(state, player.userId, opponent.userId, false);
  }

  surrender(socket) {
    const state = this.matches.get(socket.matchId);
    if (!state || state.status !== "active") return;
    const opponentId = Object.keys(state.players).find((id) => id !== socket.userId);
    this.endMatch(state, opponentId, socket.userId, false);
  }

  async endMatch(state, winnerId, loserId, forfeitedByTimeout) {
    if (state.status === "ended") return; // 중복 호출 방지
    state.status = "ended";

    const wRow = await getUserRow(winnerId);
    const lRow = await getUserRow(loserId);
    if (!wRow || !lRow) { this.matches.delete(state.id); return; }

    const wSkills = JSON.parse(wRow.skills), lSkills = JSON.parse(lRow.skills);
    const wItems = JSON.parse(wRow.items), lItems = JSON.parse(lRow.items);
    let finalSkills = Array.from(new Set([...wSkills, ...lSkills]));
    let finalItems = Array.from(new Set([...wItems, ...lItems]));
    let finalMoney = wRow.money + lRow.money;

    const winnerRankIdx = RANK_ORDER.indexOf(wRow.rank);
    const loserRankIdx = RANK_ORDER.indexOf(lRow.rank);
    const upsetBonus = loserRankIdx > winnerRankIdx ? (loserRankIdx - winnerRankIdx) * LEVEL_GAIN_RANK_BONUS : 0;
    const newLevel = Math.min(MAX_LEVEL, wRow.level + LEVEL_GAIN_PER_WIN + upsetBonus);
    const newRank = wRow.is_god ? "THE GOD" : levelToRank(newLevel);
    const rankedUp = newRank !== wRow.rank;
    if (rankedUp) {
      const bonus = startingLoadout(newRank);
      finalSkills = Array.from(new Set([...finalSkills, ...bonus.skills]));
      finalItems = Array.from(new Set([...finalItems, ...bonus.items]));
      finalMoney += Math.round((STARTING_MONEY[newRank] || 0) * RANKUP_BONUS_MONEY_RATIO);
    }

    await client.execute({
      sql: "UPDATE users SET skills=?, items=?, money=?, level=?, rank=? WHERE id=?",
      args: [JSON.stringify(finalSkills), JSON.stringify(finalItems), finalMoney, newLevel, newRank, winnerId],
    });
    await client.execute({ sql: "UPDATE users SET skills='[]', items='[]', money=0 WHERE id=?", args: [loserId] });
    await client.execute({
      sql: "INSERT INTO match_history (id, winner_id, loser_id, forfeited, ended_at) VALUES (?, ?, ?, ?, ?)",
      args: [uuidv4(), winnerId, loserId, forfeitedByTimeout ? 1 : 0, Date.now()],
    });

    const winnerRow = await getUserRow(winnerId);
    const loserRow = await getUserRow(loserId);

    this.io.to(state.id).emit("match:end", {
      winnerId, loserId, forfeitedByTimeout, rankedUp, newRank: rankedUp ? newRank : null,
      winner: rowToPublicUser(winnerRow), loser: rowToPublicUser(loserRow),
    });

    this.matches.delete(state.id);
    [winnerId, loserId].forEach((uid) => {
      const s = this.socketsByUser.get(uid);
      if (s) s.matchId = null;
    });
  }

  handleDisconnect(socket) {
    this.leaveQueue(socket);
    if (this.socketsByUser.get(socket.userId) === socket) this.socketsByUser.delete(socket.userId);
    const matchId = socket.matchId;
    if (!matchId) return;
    const state = this.matches.get(matchId);
    if (!state || state.status !== "active") return;
    const opponentId = Object.keys(state.players).find((id) => id !== socket.userId);

    socket.to(matchId).emit("opponent:disconnected", { graceMs: DISCONNECT_GRACE_MS });
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(socket.userId);
      const stillState = this.matches.get(matchId);
      if (stillState && stillState.status === "active") {
        this.endMatch(stillState, opponentId, socket.userId, true);
      }
    }, DISCONNECT_GRACE_MS);
    this.disconnectTimers.set(socket.userId, timer);
  }
}

module.exports = CombatServer;
