const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { client } = require("./db");
const { JWT_SECRET, rowToPublicUser } = require("./auth");
const {
  RANK_ORDER, getSkillDefinition, getItemPassives, ownsSkill, startingLoadout,
  levelToRank, MAX_LEVEL, getSkillElements, usableSkillIds,
} = require("./gameLogic");
const {
  STARTING_MONEY, LEVEL_GAIN_PER_WIN, LEVEL_GAIN_RANK_BONUS, RANKUP_BONUS_MONEY_RATIO,
  CPU_MATCH_WAIT_MS, CPU_ACTION_INTERVAL_MS,
} = require("./gameConfig");

const BASE_HP = 100;
const DISCONNECT_GRACE_MS = 15000; // 접속이 끊겨도 이 시간 안에 재접속하면 전투 계속 진행

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
    this.cpuWaitTimers = new Map(); // userId -> Timeout (대기열에서 CPU로 넘어가기까지 대기)
    this.cpuAiTimers = new Map();   // matchId -> Timeout (CPU의 다음 행동 타이머)

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

  // ===================== 매칭(대기열) =====================
  joinQueue(socket) {
    if (!socket.userId) return socket.emit("error:msg", "먼저 로그인하세요.");
    if (this.queue.find((q) => q.userId === socket.userId)) return;
    const entry = { socket, userId: socket.userId };
    this.queue.push(entry);

    if (this.queue.length >= 2) {
      const a = this.queue.shift();
      const b = this.queue.shift();
      this.clearCpuWaitTimer(a.userId);
      this.clearCpuWaitTimer(b.userId);
      this.startMatch(a, b);
      return;
    }

    socket.emit("queue:waiting");
    // 일정 시간 안에 사람 상대를 못 찾으면 비슷한 계급의 CPU와 매칭
    const timer = setTimeout(() => {
      this.cpuWaitTimers.delete(socket.userId);
      if (!this.queue.find((q) => q.userId === socket.userId)) return; // 이미 매칭됐거나 취소함
      this.queue = this.queue.filter((q) => q.userId !== socket.userId);
      this.startCpuMatch(entry);
    }, CPU_MATCH_WAIT_MS);
    this.cpuWaitTimers.set(socket.userId, timer);
  }

  leaveQueue(socket) {
    this.queue = this.queue.filter((q) => q.socket.id !== socket.id);
    this.clearCpuWaitTimer(socket.userId);
  }
  leaveQueueByUserId(userId) {
    this.queue = this.queue.filter((q) => q.userId !== userId);
    this.clearCpuWaitTimer(userId);
  }
  clearCpuWaitTimer(userId) {
    const t = this.cpuWaitTimers.get(userId);
    if (t) { clearTimeout(t); this.cpuWaitTimers.delete(userId); }
  }

  // ===================== 전투 상태 생성 =====================
  async buildPlayerState(userId) {
    const row = await getUserRow(userId);
    const items = JSON.parse(row.items);
    const passives = getItemPassives(items);
    const maxHp = BASE_HP + passives.maxHpBonus;
    return {
      userId, username: row.username, rank: row.rank, isGod: !!row.is_god, isCpu: false,
      skills: JSON.parse(row.skills), items,
      maxHp, hp: maxHp,
      damageReduction: passives.damageReduction,
      immuneElements: passives.immuneElements,
      cooldowns: {}, usesThisMatch: {},
    };
  }

  buildCpuPlayerState(rank) {
    const loadout = startingLoadout(rank);
    const passives = getItemPassives(loadout.items);
    const maxHp = BASE_HP + passives.maxHpBonus;
    return {
      userId: "CPU", username: `IAMME`, rank, isGod: false, isCpu: true,
      skills: loadout.skills, items: loadout.items,
      maxHp, hp: maxHp,
      damageReduction: passives.damageReduction,
      immuneElements: passives.immuneElements,
      cooldowns: {}, usesThisMatch: {},
    };
  }

  async startMatch(a, b) {
    const matchId = `${a.userId}-${b.userId}-${Date.now()}`;
    const [stateA, stateB] = await Promise.all([this.buildPlayerState(a.userId), this.buildPlayerState(b.userId)]);
    const state = { id: matchId, status: "active", isCpuMatch: false, players: { [a.userId]: stateA, [b.userId]: stateB }, log: [] };
    this.matches.set(matchId, state);
    [a, b].forEach(({ socket, userId }) => { socket.join(matchId); socket.matchId = matchId; });
    this.io.to(matchId).emit("match:start", this.publicMatchState(state));
  }

  async startCpuMatch(entry) {
    const humanState = await this.buildPlayerState(entry.userId);
    const cpuState = this.buildCpuPlayerState(humanState.rank); // 사람과 같은 계급의 CPU와 매칭
    const matchId = `${entry.userId}-CPU-${Date.now()}`;
    const state = { id: matchId, status: "active", isCpuMatch: true, players: { [entry.userId]: humanState, CPU: cpuState }, log: [] };
    this.matches.set(matchId, state);
    entry.socket.join(matchId);
    entry.socket.matchId = matchId;
    this.io.to(matchId).emit("match:start", this.publicMatchState(state));
    this.startCpuAi(matchId);
  }

  publicMatchState(state) {
    const players = {};
    Object.values(state.players).forEach((p) => {
      players[p.userId] = {
        userId: p.userId, username: p.username, rank: p.rank, isGod: p.isGod, isCpu: !!p.isCpu,
        hp: p.hp, maxHp: p.maxHp, skills: p.skills, items: p.items,
      };
    });
    return { id: state.id, status: state.status, isCpuMatch: !!state.isCpuMatch, players, log: state.log.slice(-40) };
  }

  // ===================== CPU AI =====================
  startCpuAi(matchId) {
    const scheduleNext = () => {
      const [min, max] = CPU_ACTION_INTERVAL_MS;
      const delay = min + Math.random() * (max - min);
      const timer = setTimeout(() => {
        const state = this.matches.get(matchId);
        if (!state || state.status !== "active") { this.cpuAiTimers.delete(matchId); return; }
        this.performCpuAction(state);
        scheduleNext();
      }, delay);
      this.cpuAiTimers.set(matchId, timer);
    };
    scheduleNext();
  }

  stopCpuAi(matchId) {
    const t = this.cpuAiTimers.get(matchId);
    if (t) { clearTimeout(t); this.cpuAiTimers.delete(matchId); }
  }

  performCpuAction(state) {
    const cpu = state.players.CPU;
    if (!cpu) return;
    const now = Date.now();
    const usable = usableSkillIds(cpu.skills, cpu.items);
    const castable = usable.filter((id) => {
      const def = getSkillDefinition(id);
      return def && !this.checkConditions(cpu, def, now);
    });
    if (castable.length === 0) return; // 지금 쓸 수 있는 스킬이 없으면 이번 차례는 넘어감
    const pick = castable[Math.floor(Math.random() * castable.length)];
    this.attemptCast(state, "CPU", pick);
  }

  // ===================== 스킬 발동 조건 검증 =====================
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

  // ===================== 스킬 발동 (사람/CPU 공용 핵심 로직) =====================
  // 전부 메모리 상에서 동기적으로 처리됩니다 (DB 접근 없음) -> 경쟁상태 걱정 없음.
  attemptCast(state, casterId, skillId) {
    const player = state.players[casterId];
    const opponentId = Object.keys(state.players).find((id) => id !== casterId);
    const opponent = state.players[opponentId];
    if (!player || !opponent) return { ok: false, reason: "대상이 없습니다." };

    if (!ownsSkill(player.skills, player.items, skillId)) return { ok: false, reason: "보유하지 않은 스킬입니다." };
    const skillDef = getSkillDefinition(skillId);
    if (!skillDef) return { ok: false, reason: "존재하지 않는 스킬입니다." };

    const now = Date.now();
    const failReason = this.checkConditions(player, skillDef, now);
    if (failReason) return { ok: false, reason: failReason };

    const cdCond = skillDef.conditions.find((c) => c.type === "cooldown");
    if (cdCond) player.cooldowns[skillDef.id] = now + cdCond.ms;
    const usesCond = skillDef.conditions.find((c) => c.type === "usesPerMatch");
    if (usesCond) player.usesThisMatch[skillDef.id] = (player.usesThisMatch[skillDef.id] || 0) + 1;

    // 속성이 여러 개인 스킬은, 상대 패시브로 무효화된 속성 개수만큼 비율로 데미지가 깎인다.
    // 예: a,b,c,d,e 5개 속성에 데미지 15인 스킬 → 상대가 b,e에 면역이면 15/5*3 = 9
    const elements = getSkillElements(skillDef);
    const survivingCount = elements.filter((el) => !opponent.immuneElements.includes(el)).length;
    const elementRatio = survivingCount / elements.length;
    const damage = opponent.isGod ? 0 : Math.round(skillDef.power * elementRatio * (1 - opponent.damageReduction));
    opponent.hp = Math.max(0, opponent.hp - damage);

    state.log.push({ t: now, actor: casterId, skillId: skillDef.id, skillName: skillDef.name, damage, targetId: opponent.userId, targetHpAfter: opponent.hp });
    this.io.to(state.id).emit("match:update", this.publicMatchState(state));

    if (opponent.hp <= 0 && !opponent.isGod) this.endMatch(state, casterId, opponent.userId, false);
    return { ok: true };
  }

  castSkill(socket, skillId) {
    const state = this.matches.get(socket.matchId);
    if (!state || state.status !== "active") return;
    const result = this.attemptCast(state, socket.userId, skillId);
    if (!result.ok) socket.emit("skill:fail", { skillId, reason: result.reason });
  }

  surrender(socket) {
    const state = this.matches.get(socket.matchId);
    if (!state || state.status !== "active") return;
    const opponentId = Object.keys(state.players).find((id) => id !== socket.userId);
    this.endMatch(state, opponentId, socket.userId, false);
  }

  // ===================== 전투 종료 =====================
  async endMatch(state, winnerId, loserId, forfeitedByTimeout) {
    if (state.status === "ended") return; // 중복 호출 방지
    state.status = "ended";
    this.stopCpuAi(state.id);

    if (state.isCpuMatch) {
      await this.endCpuMatch(state, winnerId, loserId, forfeitedByTimeout);
      return;
    }

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
      sql: "UPDATE users SET skills=?, items=?, money=?, level=?, rank=?, wins=wins+1 WHERE id=?",
      args: [JSON.stringify(finalSkills), JSON.stringify(finalItems), finalMoney, newLevel, newRank, winnerId],
    });
    await client.execute({
      sql: "UPDATE users SET skills='[]', items='[]', money=0, losses=losses+1 WHERE id=?",
      args: [loserId],
    });
    await client.execute({
      sql: "INSERT INTO match_history (id, winner_id, loser_id, forfeited, ended_at) VALUES (?, ?, ?, ?, ?)",
      args: [uuidv4(), winnerId, loserId, forfeitedByTimeout ? 1 : 0, Date.now()],
    });

    const winnerRow = await getUserRow(winnerId);
    const loserRow = await getUserRow(loserId);

    this.io.to(state.id).emit("match:end", {
      winnerId, loserId, forfeitedByTimeout, isCpuMatch: false, rankedUp, newRank: rankedUp ? newRank : null,
      winner: rowToPublicUser(winnerRow), loser: rowToPublicUser(loserRow),
    });

    this.matches.delete(state.id);
    [winnerId, loserId].forEach((uid) => {
      const s = this.socketsByUser.get(uid);
      if (s) s.matchId = null;
    });
  }

  // CPU와의 전투는 실제 계정이 아닌 상대이므로 전리품 강탈은 하지 않습니다.
  // 이기면 레벨/계급 성장(+승급 보상)은 그대로 적용, 지면 아무것도 잃지 않습니다 (승패 기록만 남음).
  async endCpuMatch(state, winnerId, loserId, forfeitedByTimeout) {
    const humanId = winnerId === "CPU" ? loserId : winnerId;
    const humanWon = winnerId !== "CPU";
    const humanRow = await getUserRow(humanId);
    if (!humanRow) { this.matches.delete(state.id); return; }

    let rankedUp = false, newRank = null;
    if (humanWon) {
      const newLevel = Math.min(MAX_LEVEL, humanRow.level + LEVEL_GAIN_PER_WIN);
      newRank = humanRow.is_god ? "THE GOD" : levelToRank(newLevel);
      rankedUp = newRank !== humanRow.rank;
      let finalSkills = JSON.parse(humanRow.skills), finalItems = JSON.parse(humanRow.items), finalMoney = humanRow.money;
      if (rankedUp) {
        const bonus = startingLoadout(newRank);
        finalSkills = Array.from(new Set([...finalSkills, ...bonus.skills]));
        finalItems = Array.from(new Set([...finalItems, ...bonus.items]));
        finalMoney += Math.round((STARTING_MONEY[newRank] || 0) * RANKUP_BONUS_MONEY_RATIO);
      }
      await client.execute({
        sql: "UPDATE users SET skills=?, items=?, money=?, level=?, rank=?, wins=wins+1 WHERE id=?",
        args: [JSON.stringify(finalSkills), JSON.stringify(finalItems), finalMoney, newLevel, newRank, humanId],
      });
    } else {
      await client.execute({ sql: "UPDATE users SET losses=losses+1 WHERE id=?", args: [humanId] });
    }

    const humanFreshRow = await getUserRow(humanId);
    const cpuPublic = { id: "CPU", username: state.players.CPU.username, isCpu: true };

    this.io.to(state.id).emit("match:end", {
      winnerId: humanWon ? humanId : "CPU",
      loserId: humanWon ? "CPU" : humanId,
      forfeitedByTimeout, isCpuMatch: true, rankedUp, newRank,
      winner: humanWon ? rowToPublicUser(humanFreshRow) : cpuPublic,
      loser: humanWon ? cpuPublic : rowToPublicUser(humanFreshRow),
    });

    this.matches.delete(state.id);
    const s = this.socketsByUser.get(humanId);
    if (s) s.matchId = null;
  }

  // ===================== 접속 끊김 =====================
  handleDisconnect(socket) {
    this.leaveQueue(socket);
    if (this.socketsByUser.get(socket.userId) === socket) this.socketsByUser.delete(socket.userId);

    const matchId = socket.matchId;
    if (!matchId) return;
    const state = this.matches.get(matchId);
    if (!state || state.status !== "active") return;

    if (state.isCpuMatch) {
      // CPU 상대는 실제 계정이 없으므로 승패 기록 없이 그냥 정리 (페널티 없음)
      this.stopCpuAi(matchId);
      this.matches.delete(matchId);
      return;
    }

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
