const express = require("express");
const { client } = require("./db");
const { authMiddleware, rowToPublicUser } = require("./auth");
const { rollGachaSkill } = require("./gameLogic");
const { GACHA_COST } = require("./gameConfig");

const router = express.Router();

router.post("/gacha/roll", authMiddleware, async (req, res) => {
  try {
    const row = req.userRow;
    if (row.money < GACHA_COST) return res.status(400).json({ error: "돈이 부족합니다." });

    const skill = rollGachaSkill();
    const skills = JSON.parse(row.skills);
    const duplicated = skills.includes(skill.id);
    if (!duplicated) skills.push(skill.id);

    await client.execute({
      sql: "UPDATE users SET money = ?, skills = ? WHERE id = ?",
      args: [row.money - GACHA_COST, JSON.stringify(skills), row.id],
    });

    const updated = (await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [row.id] })).rows[0];
    res.json({ result: skill, duplicated, user: rowToPublicUser(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
