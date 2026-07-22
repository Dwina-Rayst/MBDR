const { createClient } = require("@libsql/client");

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

(async () => {
  try {
    const result = await client.execute({
      sql: `
        UPDATE users
        SET money = ?
        WHERE username = ?
      `,
      args: [9007199254740991, "DwinaRayst"],
    });

    console.log("복구 완료!");
    console.log(result);
  } catch (err) {
    console.error(err);
  }
})();
