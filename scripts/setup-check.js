/**
 * System health & migration check (SQLite edition).
 *
 * 1. Runs initSchema() to create/migrate the SQLite database
 * 2. Verifies all required tables exist
 * 3. Runs basic health queries
 * 4. Spawns temporary API servers and verifies all routes respond
 */

const path   = require("path");
const fs     = require("fs");
const fs     = require("fs");
const http   = require("http");
const net    = require("net");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(rootDir, ".env") });

const API_PORT   = Number(process.env.API_PORT)   || 4000;
const EMAIL_PORT = Number(process.env.EMAIL_PORT) || 4001;
const DB_PATH    = path.resolve(rootDir, process.env.DB_PATH || "tcp_logs.db");

const requiredTables = [
  "camera_configs", "tcp_logs", "app_settings",
  "companies", "users", "permissions", "user_permissions",
  "audit_logs", "email_schedules", "email_recipients",
  "smtp_settings", "email_logs", "system_notifications",
  "tcp_messages", "user_tcp_configs",
];

// ── Helpers ────────────────────────────────────────────

function makeRequest(url, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port,
      path:     parsedUrl.pathname + parsedUrl.search,
      method,
      headers:  { "Content-Type": "application/json" },
    };
    if (body) options.headers["Content-Length"] = Buffer.byteLength(JSON.stringify(body));
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end",  () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on("connect", () => { socket.destroy(); resolve(true);  });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error",   () => { socket.destroy(); resolve(false); });
    socket.connect(port, "localhost");
  });
}

// ── Main ───────────────────────────────────────────────

async function run() {
  console.log("============================================================");
  console.log("               SYSTEM HEALTH & MIGRATION CHECK              ");
  console.log("============================================================");
  console.log(`[Config] SQLite DB: ${DB_PATH}`);
  console.log(`[Config] API Port:   ${API_PORT}`);
  console.log(`[Config] Email Port: ${EMAIL_PORT}`);
  console.log("------------------------------------------------------------");

  // 1. Run migrations
  console.log("1. Running Schema Migrations (SQLite)...");
  try {
    const initSchema = require("../TCP-Email/src/models/schema");
    await initSchema();
    console.log("   ✓ Migrations completed successfully.");
  } catch (err) {
    console.error("   [ERROR] Migration failed:", err.message);
    process.exit(1);
  }

  // 2. Verify tables
  console.log("2. Verifying Required Database Tables...");
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(DB_PATH);
  const sqlite = new SQL.Database(fileBuffer);

  const tableResult = sqlite.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const existingTables = tableResult.length
    ? tableResult[0].values.map(r => r[0].toLowerCase())
    : [];
  sqlite.close();

  let missingCount = 0;
  requiredTables.forEach(t => {
    if (existingTables.includes(t.toLowerCase())) {
      console.log(`   ✓ Table [${t}] exists`);
    } else {
      console.error(`   [MISSING] Table [${t}]`);
      missingCount++;
    }
  });
  sqlite.close();

  if (missingCount > 0) {
    console.error(`   [ERROR] ${missingCount} required table(s) are missing!`);
    process.exit(1);
  }
  console.log(`   ✓ All ${requiredTables.length} required tables verified.`);

  // 3. Health checks
  console.log("3. Running Database Health Checks...");
  const db = require("../TCP-Email/src/config/db");
  try {
    const [[{ count: userCount }]]    = await db.query("SELECT COUNT(*) as count FROM users");
    const [[{ count: companyCount }]] = await db.query("SELECT COUNT(*) as count FROM companies");
    const [[{ count: permCount }]]    = await db.query("SELECT COUNT(*) as count FROM permissions");

    console.log(`   ✓ Companies: ${companyCount}`);
    console.log(`   ✓ Permissions: ${permCount}`);
    console.log(`   ✓ Users: ${userCount}`);

    if (userCount === 0) {
      console.warn("   [WARNING] No users found!");
    } else {
      const [admins] = await db.query("SELECT email, role FROM users WHERE role = 'Super Admin' LIMIT 1");
      if (admins.length > 0) {
        console.log(`   ✓ Super Admin: ${admins[0].email}`);
      } else {
        console.warn("   [WARNING] Super Admin not found!");
      }
    }
  } catch (err) {
    console.error("   [ERROR] Health check failed:", err.message);
    process.exit(1);
  }

  // 4. Route verification
  console.log("4. Verifying API Routes...");

  if (await isPortOpen(API_PORT)) {
    console.error(`   [ERROR] Port ${API_PORT} already in use.`);
    process.exit(1);
  }
  if (await isPortOpen(EMAIL_PORT)) {
    console.error(`   [ERROR] Port ${EMAIL_PORT} already in use.`);
    process.exit(1);
  }

  const apiProc   = spawn("node", ["app.js"],       { cwd: rootDir,                          env: { ...process.env } });
  const emailProc = spawn("node", ["src/app.js"],   { cwd: path.join(rootDir, "TCP-Email"), env: { ...process.env } });

  let processError = false;
  apiProc.on("error",   err => { console.error(`   [ERROR] Main API: ${err.message}`);   processError = true; });
  emailProc.on("error", err => { console.error(`   [ERROR] TCP-Email: ${err.message}`);  processError = true; });

  let apiStarted = false, emailStarted = false;
  for (let i = 0; i < 40; i++) {
    if (!apiStarted)   apiStarted   = await isPortOpen(API_PORT);
    if (!emailStarted) emailStarted = await isPortOpen(EMAIL_PORT);
    if (apiStarted && emailStarted) break;
    if (processError) break;
    await new Promise(r => setTimeout(r, 500));
  }

  if (!apiStarted || !emailStarted) {
    console.error(`   [ERROR] Servers did not start. API:${apiStarted} Email:${emailStarted}`);
    apiProc.kill(); emailProc.kill();
    process.exit(1);
  }

  const mainRoutes = [
    { method: "GET",    path: "/api/cameras" },
    { method: "GET",    path: "/api/statuses" },
    { method: "GET",    path: "/api/migrate" },
    { method: "POST",   path: "/api/migrate" },
    { method: "GET",    path: "/api/tcp-client-config" },
    { method: "PUT",    path: "/api/tcp-client-config" },
    { method: "POST",   path: "/api/tcp-client-config/disconnect" },
    { method: "POST",   path: "/api/tcp-client-config/reconnect" },
  ];

  const emailRoutes = [
    { method: "POST",   path: "/api/auth/login",                       body: {} },
    { method: "GET",    path: "/api/auth/me" },
    { method: "GET",    path: "/api/companies" },
    { method: "POST",   path: "/api/companies",                        body: {} },
    { method: "GET",    path: "/api/users" },
    { method: "GET",    path: "/api/schedules" },
    { method: "GET",    path: "/api/emails" },
    { method: "GET",    path: "/api/email-logs" },
    { method: "GET",    path: "/api/dashboard/stats" },
    { method: "GET",    path: "/api/dashboard/charts/messages-trend" },
    { method: "GET",    path: "/api/dashboard/charts/email-status" },
    { method: "GET",    path: "/api/notifications" },
    { method: "GET",    path: "/api/notifications/unread-count" },
    { method: "GET",    path: "/api/settings/smtp" },
  ];

  let routeFailures = 0;

  async function testRoutes(routes, port, label) {
    for (const r of routes) {
      try {
        const res = await makeRequest(`http://localhost:${port}${r.path}`, r.method, r.body);
        if (res.statusCode === 404 && res.body.includes(`Cannot ${r.method}`)) {
          console.error(`     [FAIL] [${label}] ${r.method} ${r.path} → not registered`);
          routeFailures++;
        } else {
          console.log(`     ✓ [${label}] ${r.method} ${r.path} → HTTP ${res.statusCode}`);
        }
      } catch (err) {
        console.error(`     [FAIL] [${label}] ${r.method} ${r.path} → ${err.message}`);
        routeFailures++;
      }
    }
  }

  await testRoutes(mainRoutes,  API_PORT,   "Main API");
  await testRoutes(emailRoutes, EMAIL_PORT, "Email API");

  apiProc.kill("SIGINT");
  emailProc.kill("SIGINT");

  console.log("------------------------------------------------------------");
  if (routeFailures > 0) {
    console.error(`[ERROR] ${routeFailures} route failure(s) detected.`);
    process.exit(1);
  }

  console.log("============================================================");
  console.log("              ALL CHECKS & VERIFICATION PASSED              ");
  console.log("============================================================");
  process.exit(0);
}

run().catch(err => {
  console.error("Unhandled exception:", err);
  process.exit(1);
});
