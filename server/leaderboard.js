const express = require("express");
const { client } = require("./db");
const { authMiddleware } = require("./auth");

const router = express.Router();

router.get("/leaderboard", authMiddleware, async (req, res) => {
  const result = await client.execute("SELECT username, level, rank FROM users WHERE is_god = 0 ORDER BY level DESC LIMIT 20");
  res.json(result.rows);
});

module.exports = router;
