const express = require("express");
const { client } = require("./db");
const { authMiddleware, rowToPublicUser } = require("./auth");
const { getSellPrice } = require("./gameLogic");

const router = express.Router();

router.post("/sell", authMiddleware, async (req, res) => {
  try {
    const { kind, id } = req.body; // kind: "skill" | "item"
    if (kind !== "skill" && kind !== "item") return res.status(400).json({ error: "잘못된 요청입니다." });

    const row = req.userRow;
    const columnName = kind === "skill" ? "skills" : "items";
    const list = JSON.parse(row[columnName]);
    if (!list.includes(id)) return res.status(400).json({ error: "보유하고 있지 않습니다." });

    const price = getSellPrice(kind, id);
    const updatedList = list.filter((x) => x !== id);

    await client.execute({
      sql: `UPDATE users SET ${columnName} = ?, money = ? WHERE id = ?`,
      args: [JSON.stringify(updatedList), row.money + price, row.id],
    });

    const updated = (await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [row.id] })).rows[0];
    res.json({ sold: id, price, user: rowToPublicUser(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;