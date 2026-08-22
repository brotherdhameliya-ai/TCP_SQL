/**
 * Pre-start production validation (sql.js edition).
 * Verifies the .env file exists and the SQLite database has all required tables.
 */

const path = require("path");
const fs   = require("fs");

const rootDir = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(rootDir, ".env") });

const DB_PATH = path.resolve(rootDir, process.env.DB_PATH || "tcp_logs.db");

const requiredTables = [
  "camera_configs", "tcp_logs", "app_settings",
  "companies", "users", "permissions", "user_permissions",
  "audit_logs", "email_schedules", "email_recipients",
  "smtp_settings", "email_logs", "system_notifications",
  "tcp_messages", "user_tcp_configs",
];

async function run() {
  console.log("============================================================");
  console.log("             PRE-START PRODUCTION VALIDATION                ");
  console.log("============================================================");

  // 1. Check .env
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    console.error("[ERROR] .env file is missing in root directory!");
    console.error("Please create a .env file or run setup.bat.");
    process.exit(1);
  }
  console.log("✓ Environment file (.env) found.");

  // 2. Check database file
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[ERROR] SQLite database not found at: ${DB_PATH}`);
    console.error("Please run setup.bat or call GET /api/migrate?key=<MIGRATE_API_KEY> first.");
    process.exit(1);
  }
  console.log(`✓ SQLite database found: ${DB_PATH}`);

  // 3. Open and verify tables using sql.js (pure JS, no native build)
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(DB_PATH);
  const sqlite = new SQL.Database(fileBuffer);

  const tableResult = sqlite.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const existingTables = tableResult.length
    ? tableResult[0].values.map(r => r[0].toLowerCase())
    : [];
  sqlite.close();

  const missingTables = requiredTables.filter(t => !existingTables.includes(t.toLowerCase()));

  if (missingTables.length > 0) {
    console.error("[ERROR] Validation failed. The database is missing required tables:");
    missingTables.forEach(t => console.error(`  - ${t}`));
    console.error("\nPlease run setup.bat to install dependencies and run migrations first.");
    process.exit(1);
  }

  console.log(`✓ All ${requiredTables.length} required tables verified successfully.`);
  console.log("✓ Database is fully migrated and ready.");
  console.log("============================================================");
  console.log("               PRODUCTION READY TO START                    ");
  console.log("============================================================");
  process.exit(0);
}

run().catch(err => {
  console.error("Unhandled error during startup check:", err);
  process.exit(1);
});
