require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");

const { initDb } = require("./db");
const { router: authRouter } = require("./auth");
const gachaRouter = require("./gacha");
const reportRouter = require("./report");
const { router: adminRouter, attachCombatServer } = require("./admin");
const leaderboardRouter = require("./leaderboard");
const CombatServer = require("./combat");
const { SKILL_POOL, ITEM_POOL } = require("./gameConfig");

async function main() {
  await initDb(); // DB(로컬 파일 또는 Turso) 테이블 준비 + THE GOD 계정 시딩이 끝날 때까지 대기

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" })); // 아바타 base64가 JSON으로 들어오므로 넉넉히
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use("/api", authRouter);
  app.use("/api", gachaRouter);
  app.use("/api", reportRouter);
  app.use("/api", adminRouter);
  app.use("/api", leaderboardRouter);
  app.get("/api/gamedata", (req, res) => res.json({ skills: SKILL_POOL, items: ITEM_POOL }));

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });
  const combatServer = new CombatServer(io);
  attachCombatServer(combatServer);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`W.O.R.L.D. 서버 실행 중: http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("서버 시작 실패:", err);
  process.exit(1);
});
