const { createClient } = require("@libsql/client");
const path = require("path");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

// TURSO_DATABASE_URL이 설정돼있지 않으면 로컬 파일(data/world.db)을 사용합니다.
// 배포할 때는 .env에 Turso에서 발급받은 URL/토큰만 넣으면 코드 수정 없이 그대로 동작합니다.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, "..", "data", "world.db")}`,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

async function initDb() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_base64 TEXT,
      level INTEGER NOT NULL,
      rank TEXT NOT NULL,
      money INTEGER NOT NULL,
      skills TEXT NOT NULL,
      items TEXT NOT NULL,
      is_god INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS match_history (
      id TEXT PRIMARY KEY,
      winner_id TEXT NOT NULL,
      loser_id TEXT NOT NULL,
      forfeited INTEGER NOT NULL DEFAULT 0,
      ended_at INTEGER NOT NULL
    )
  `);
  await seedGodAccount();
  await syncGodLoadout();
  await addColumnIfMissing("users", "wins", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("users", "losses", "INTEGER NOT NULL DEFAULT 0");
}

// 이미 만들어진 DB에도 안전하게 새 컬럼을 추가하기 위한 헬퍼 (컬럼이 이미 있으면 조용히 무시)
async function addColumnIfMissing(table, column, definition) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[DB 마이그레이션] ${table}.${column} 컬럼 추가 완료`);
  } catch (e) {
    // 이미 컬럼이 있으면 "duplicate column name" 류의 에러가 나는데, 정상 상황이므로 무시
  }
}

async function seedGodAccount() {
  const { startingLoadout } = require("./gameLogic");
  const { STARTING_MONEY, GOD_LEVEL } = require("./gameConfig");
  const godUsername = process.env.GOD_USERNAME || "DwinaRayst";

  const existing = await client.execute({ sql: "SELECT id FROM users WHERE username = ?", args: [godUsername] });
  if (existing.rows.length > 0) return;

  const godPassword = process.env.GOD_PASSWORD || require("crypto").randomBytes(6).toString("hex");
  const hash = bcrypt.hashSync(godPassword, 10);
  const loadout = startingLoadout("THE GOD");

  await client.execute({
    sql: `INSERT INTO users (id, username, password_hash, avatar_base64, level, rank, money, skills, items, is_god, created_at)
          VALUES (?, ?, ?, NULL, ?, 'THE GOD', ?, ?, ?, 1, ?)`,
    args: [uuidv4(), godUsername, hash, GOD_LEVEL, STARTING_MONEY["THE GOD"], JSON.stringify(loadout.skills), JSON.stringify(loadout.items), Date.now()],
  });

  console.log("========================================");
  console.log(`THE GOD 계정이 생성되었습니다. 아이디: ${godUsername}`);
  console.log("초기 비밀번호(최초 1회만 출력됨, 즉시 기록/변경하세요):", godPassword);
  console.log("환경변수 GOD_PASSWORD를 지정하면 이 값을 대신 사용합니다.");
  console.log("========================================");
}

// 서버가 켜질 때마다 THE GOD 계정을 현재 gameConfig.js 기준으로 다시 보정합니다.
// - gameConfig.js에 새로 추가한 스킬/아이템이 있으면 자동으로 GOD 보유 목록에 합쳐짐 (기존 보유분은 그대로 유지)
// - 돈은 STARTING_MONEY["THE GOD"] 밑으로는 절대 안 내려가도록 보정 (그 이상 갖고 있으면 그대로 유지)
async function syncGodLoadout() {
  const { SKILL_POOL, ITEM_POOL, STARTING_MONEY } = require("./gameConfig");
  const godUsername = process.env.GOD_USERNAME || "DwinaRayst";

  const result = await client.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [godUsername] });
  const row = result.rows[0];
  if (!row) return;

  const allSkillIds = SKILL_POOL.map((s) => s.id);
  const allItemIds = ITEM_POOL.map((i) => i.id);
  const mergedSkills = Array.from(new Set([...JSON.parse(row.skills), ...allSkillIds]));
  const mergedItems = Array.from(new Set([...JSON.parse(row.items), ...allItemIds]));
  const correctedMoney = Math.max(row.money, STARTING_MONEY["THE GOD"]);

  await client.execute({
    sql: "UPDATE users SET skills = ?, items = ?, money = ? WHERE id = ?",
    args: [JSON.stringify(mergedSkills), JSON.stringify(mergedItems), correctedMoney, row.id],
  });
  console.log(`[THE GOD 자동 보정] 스킬 ${mergedSkills.length}개, 아이템 ${mergedItems.length}개, 최소 보유금 ${STARTING_MONEY["THE GOD"]}G 로 동기화 완료`);
}

module.exports = { client, initDb };
