/**
 * Pre-start production validation.
 * Verifies the .env file exists and the SQLite database has all required tables.
 *
 * Uses the app's own db adapter (sql.js) for table queries.
 * Does NOT call process.exit() — sets process.exitCode instead and returns,
 * so Node.js can clean up sql.js WASM handles naturally (avoids the
 * libuv UV_HANDLE_CLOSING assertion crash on Windows).
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
  if (!fs.existsSync(path.join(rootDir, ".env"))) {
    console.error("[ERROR] .env file is missing. Please create it or run setup.bat.");
    process.exitCode = 1;
    return;
  }
  console.log("✓ Environment file (.env) found.");

  // 2. Check database file exists
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[ERROR] SQLite database not found at: ${DB_PATH}`);
    console.error("Please run setup.bat first.");
    process.exitCode = 1;
    return;
  }
  console.log(`✓ SQLite database found: ${DB_PATH}`);

  // 3. Query tables via the app's db adapter
  // process.exitCode (not process.exit) is used throughout so Node exits
  // naturally and sql.js WASM handles are released without crashing libuv.
  try {
    const db = require("../TCP-Email/src/config/db");

    const [tables] = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const existingTables = tables.map(r => r.name.toLowerCase());

    const missingTables = requiredTables.filter(
      t => !existingTables.includes(t.toLowerCase())
    );

    if (missingTables.length > 0) {
      console.error("[ERROR] Validation failed. Missing required tables:");
      missingTables.forEach(t => console.error(`  - ${t}`));
      console.error("\nPlease run setup.bat to install and migrate first.");
      process.exitCode = 1;
      return;
    }

    console.log(`✓ All ${requiredTables.length} required tables verified successfully.`);
    console.log("✓ Database is fully migrated and ready.");
    console.log("============================================================");
    console.log("               PRODUCTION READY TO START                    ");
    console.log("============================================================");
    // No process.exit() — let Node exit naturally once WASM handles are released
  } catch (err) {
    console.error("[ERROR] Database check failed:", err.message);
    process.exitCode = 1;
  }
}

run().catch(err => {
  console.error("Unhandled error during startup check:", err);
  process.exitCode = 1;
});
