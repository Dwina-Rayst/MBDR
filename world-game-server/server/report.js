const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { client } = require("./db");
const { authMiddleware } = require("./auth");

const router = express.Router();

const ADMIN_PHONE = process.env.ADMIN_PHONE || "01032919123";
const ALIGO_API_KEY = process.env.ALIGO_API_KEY;
const ALIGO_USER_ID = process.env.ALIGO_USER_ID;
const ALIGO_SENDER = process.env.ALIGO_SENDER;

async function sendSms(message) {
  if (!ALIGO_API_KEY || !ALIGO_USER_ID || !ALIGO_SENDER) {
    console.log("========= [SMS 미설정 - 콘솔로 대체] =========");
    console.log("수신:", ADMIN_PHONE);
    console.log("내용:", message);
    console.log("(.env에 ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER를 채우면 실제로 발송됩니다)");
    console.log("================================================");
    return { simulated: true };
  }
  const body = new URLSearchParams({
    key: ALIGO_API_KEY, user_id: ALIGO_USER_ID, sender: ALIGO_SENDER,
    receiver: ADMIN_PHONE, msg: message,
  });
  const res = await fetch("https://apis.aligo.in/send/", { method: "POST", body });
  return res.json();
}

router.post("/report", authMiddleware, async (req, res) => {
  try {
    const { targetUsername, reason } = req.body;
    if (!targetUsername || !reason) return res.status(400).json({ error: "신고 대상과 사유를 입력하세요." });

    const target = await client.execute({ sql: "SELECT id FROM users WHERE username = ?", args: [targetUsername] });
    if (target.rows.length === 0) return res.status(404).json({ error: "존재하지 않는 아이디입니다." });

    const report = { id: uuidv4(), reporterId: req.userRow.username, targetId: targetUsername, reason, createdAt: Date.now() };
    await client.execute({
      sql: "INSERT INTO reports (id, reporter_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [report.id, report.reporterId, report.targetId, report.reason, report.createdAt],
    });

    const message = `[W.O.R.L.D. 신고 접수]\n피해자: ${report.reporterId}\n가해자: ${report.targetId}\n내용: ${report.reason}`;
    try { await sendSms(message); } catch (e) { console.error("SMS 발송 실패(신고 자체는 정상 접수됨):", e.message); }

    res.json({ ok: true, reportId: report.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.get("/reports", authMiddleware, async (req, res) => {
  if (!req.isGod) return res.status(403).json({ error: "권한이 없습니다." });
  const result = await client.execute("SELECT * FROM reports ORDER BY created_at DESC LIMIT 50");
  res.json(result.rows.map((r) => ({
    id: r.id, reporterId: r.reporter_id, targetId: r.target_id, reason: r.reason, createdAt: r.created_at,
  })));
});

module.exports = router;
