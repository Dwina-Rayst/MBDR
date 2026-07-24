const express = require("express");
const { client } = require("./db");
const { authMiddleware } = require("./auth");
const { getSellPrice } = require("./gameLogic");
const { OVERALL_SCORE_WEIGHTS } = require("./gameConfig");

const router = express.Router();

function computeWealth(row) {
  const skills = JSON.parse(row.skills);
  const items = JSON.parse(row.items);
  const skillsValue = skills.reduce((sum, id) => sum + getSellPrice("skill", id), 0);
  const itemsValue = items.reduce((sum, id) => sum + getSellPrice("item", id), 0);
  return row.money + skillsValue + itemsValue;
}

function computeOverallScore(row, wealth) {
  const w = OVERALL_SCORE_WEIGHTS;
  return row.level * w.level + row.wins * w.wins + row.losses * w.losses + wealth * w.wealth;
}

// scope: rank(내 계급 내) | global(전체 통합), type: overall | winrate | wealth
router.get("/rankings", authMiddleware, async (req, res) => {
  try {
    const scope = req.query.scope === "rank" ? "rank" : "global";
    const type = ["overall", "winrate", "wealth"].includes(req.query.type) ? req.query.type : "overall";

    let rows;
    if (scope === "rank") {
      const result = await client.execute({
        sql: "SELECT username, level, rank, money, skills, items, wins, losses FROM users WHERE is_god = 0 AND rank = ?",
        args: [req.userRow.rank],
      });
      rows = result.rows;
    } else {
      const result = await client.execute(
        "SELECT username, level, rank, money, skills, items, wins, losses FROM users WHERE is_god = 0"
      );
      rows = result.rows;
    }

    const enriched = rows.map((row) => {
      const wealth = computeWealth(row);
      const winRate = row.wins + row.losses > 0 ? row.wins / (row.wins + row.losses) : 0;
      return {
        username: row.username, level: row.level, rank: row.rank,
        wins: row.wins, losses: row.losses, wealth,
        winRate, overallScore: computeOverallScore(row, wealth),
      };
    });

    const sortKey = { overall: "overallScore", winrate: "winRate", wealth: "wealth" }[type];
    enriched.sort((a, b) => b[sortKey] - a[sortKey]);

    res.json({ scope, type, myRank: req.userRow.rank, rows: enriched.slice(0, 20) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
