const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { client } = require("./db");
const { randomLevel, levelToRank, startingLoadout, MAX_LEVEL } = require("./gameLogic");
const { STARTING_MONEY } = require("./gameConfig");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me-in-.env";

function rowToPublicUser(row) {
  return {
    id: row.id, username: row.username, avatarBase64: row.avatar_base64,
    level: row.level, rank: row.rank, money: row.money,
    skills: JSON.parse(row.skills), items: JSON.parse(row.items),
    isGod: !!row.is_god,
  };
}

router.post("/signup", async (req, res) => {
  try {
    const { username, password, avatarBase64 } = req.body;
    if (!username || !password) return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });
    if (username.length < 3) return res.status(400).json({ error: "아이디는 3자 이상이어야 합니다." });
    if (password.length < 8) return res.status(400).json({ error: "비밀번호는 8자 이상이어야 합니다." });
    if (username.toUpperCase() === (process.env.GOD_USERNAME || "GOD").toUpperCase()) {
      return res.status(400).json({ error: "사용할 수 없는 아이디입니다." });
    }
    // 클라이언트에서 이미 축소한 이미지지만, 혹시 모를 과도한 payload는 서버에서도 한 번 더 방어
    if (avatarBase64 && avatarBase64.length > 500000) return res.status(400).json({ error: "프로필 사진이 너무 큽니다." });

    const exists = await client.execute({ sql: "SELECT id FROM users WHERE username = ?", args: [username] });
    if (exists.rows.length > 0) return res.status(409).json({ error: "이미 존재하는 아이디입니다." });

    const passwordHash = bcrypt.hashSync(password, 10);
    const level = randomLevel();
    const rank = levelToRank(level);
    const loadout = startingLoadout(rank);
    const id = uuidv4();

    await client.execute({
      sql: `INSERT INTO users (id, username, password_hash, avatar_base64, level, rank, money, skills, items, is_god, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      args: [id, username, passwordHash, avatarBase64 || null, level, rank, STARTING_MONEY[rank],
        JSON.stringify(loadout.skills), JSON.stringify(loadout.items), Date.now()],
    });

    const row = (await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] })).rows[0];
    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: rowToPublicUser(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await client.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [username] });
    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    if (!bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    const token = jwt.sign({ id: row.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: rowToPublicUser(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "로그인이 필요합니다." });
  try {
    const payload = jwt.verify(header.replace("Bearer ", ""), JWT_SECRET);
    const result = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [payload.id] });
    let row = result.rows[0];
    if (!row) return res.status(401).json({ error: "존재하지 않는 계정입니다." });

    if (row.is_god) {
      // THE GOD 계정은 항상 최고 레벨 + gameConfig.js에 있는 모든 스킬/아이템을 자동으로 보유하도록 보정
      const { SKILL_POOL, ITEM_POOL } = require("./gameConfig");
      const allSkills = JSON.stringify(SKILL_POOL.map((s) => s.id));
      const allItems = JSON.stringify(ITEM_POOL.map((i) => i.id));
      const needsUpdate = row.level !== MAX_LEVEL + 1 || row.skills !== allSkills || row.items !== allItems;
      if (needsUpdate) {
        await client.execute({
          sql: "UPDATE users SET level = ?, rank = 'THE GOD', skills = ?, items = ? WHERE id = ?",
          args: [MAX_LEVEL + 1, allSkills, allItems, row.id],
        });
        row = { ...row, level: MAX_LEVEL + 1, rank: "THE GOD", skills: allSkills, items: allItems };
      }
    }

    req.userId = row.id;
    req.isGod = !!row.is_god;
    req.userRow = row;
    next();
  } catch (e) {
    res.status(401).json({ error: "유효하지 않은 토큰입니다." });
  }
}

router.get("/me", authMiddleware, (req, res) => {
  res.json({ user: rowToPublicUser(req.userRow) });
});

// 본인 아이디 변경 - THE GOD을 포함해 누구나 자기 아이디를 바꿀 수 있음 (DB를 직접 만지지 않아도 됨)
router.post("/account/rename", authMiddleware, async (req, res) => {
  try {
    const newUsername = (req.body.newUsername || "").trim();
    if (newUsername.length < 3) return res.status(400).json({ error: "아이디는 3자 이상이어야 합니다." });

    const godUsername = process.env.GOD_USERNAME || "GOD";
    const isRenamingToGodName = newUsername.toUpperCase() === godUsername.toUpperCase();
    if (isRenamingToGodName && !req.isGod) {
      return res.status(400).json({ error: "사용할 수 없는 아이디입니다." });
    }

    const exists = await client.execute({ sql: "SELECT id FROM users WHERE username = ? AND id != ?", args: [newUsername, req.userId] });
    if (exists.rows.length > 0) return res.status(409).json({ error: "이미 존재하는 아이디입니다." });

    await client.execute({ sql: "UPDATE users SET username = ? WHERE id = ?", args: [newUsername, req.userId] });
    const row = (await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId] })).rows[0];
    res.json({ user: rowToPublicUser(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = { router, authMiddleware, rowToPublicUser, JWT_SECRET };
