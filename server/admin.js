const express = require("express");
const { client } = require("./db");
const { authMiddleware } = require("./auth");

const router = express.Router();

function requireGod(req, res, next) {
  if (!req.isGod) return res.status(403).json({ error: "THE GOD 전용 기능입니다." });
  next();
}

router.get("/admin/lookup/:username", authMiddleware, requireGod, async (req, res) => {
  const result = await client.execute({
    sql: "SELECT id, username, level, rank FROM users WHERE username = ?",
    args: [req.params.username],
  });
  if (result.rows.length === 0) return res.status(404).json({ error: "존재하지 않는 아이디입니다." });
  res.json(result.rows[0]);
});

let combatServerRef = null;
function attachCombatServer(server) { combatServerRef = server; }

router.delete("/admin/users/:username", authMiddleware, requireGod, async (req, res) => {
  const username = req.params.username;
  if (username.toUpperCase() === (process.env.GOD_USERNAME || "GOD").toUpperCase()) {
    return res.status(400).json({ error: "THE GOD 계정은 삭제할 수 없습니다." });
  }

  const result = await client.execute({ sql: "SELECT id FROM users WHERE username = ?", args: [username] });
  if (result.rows.length === 0) return res.status(404).json({ error: "존재하지 않는 아이디입니다." });
  const targetId = result.rows[0].id;

  await client.execute({ sql: "DELETE FROM users WHERE id = ?", args: [targetId] });
  if (combatServerRef) combatServerRef.forceDisconnectUser(targetId);

  console.log(`[관리자 조치] THE GOD가 계정 '${username}'을(를) 완전히 삭제했습니다.`);
  res.json({ ok: true, deleted: username });
});

module.exports = { router, attachCombatServer };
