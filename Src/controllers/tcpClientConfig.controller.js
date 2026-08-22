const db     = require("../config/db");
const client = require("../client/client");

// user_tcp_configs is created in schema init (TCP-Email/src/models/schema.js).
// ensureTable is kept as a lightweight no-op guard for safety.
async function ensureTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_tcp_configs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      host       TEXT    NOT NULL,
      port       INTEGER NOT NULL,
      folder_path TEXT   NULL,
      is_active  INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    DEFAULT (datetime('now')),
      UNIQUE(user_id, host, port)
    )
  `);
}

// GET /api/tcp-client-config
async function getConfig(req, res) {
  try {
    await ensureTable();
    const userId = req.user.id;
    const [rows] = await db.execute(
      "SELECT id, host, port, folder_path, is_active FROM user_tcp_configs WHERE user_id = ? ORDER BY id",
      [userId]
    );
    const configured = rows.some(r => r.is_active);
    res.json({ configured, entries: rows, folder_path: rows[0]?.folder_path || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/tcp-client-config  body: { host, ports: [3030, 8080], folder_path? }
async function updateConfig(req, res) {
  const { host, ports, folder_path } = req.body;

  if (!host || !host.trim())
    return res.status(400).json({ error: "host is required" });
  if (!Array.isArray(ports) || ports.length === 0)
    return res.status(400).json({ error: "ports[] is required" });

  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(host.trim()))
    return res.status(400).json({ error: "Invalid IP address format" });

  for (const p of ports) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 65535)
      return res.status(400).json({ error: `Invalid port: ${p}` });
  }

  try {
    await ensureTable();
    const userId   = req.user.id;
    const hostTrim = host.trim();

    // Check for duplicate host:port used by OTHER users
    for (const p of ports) {
      const [existing] = await db.execute(
        "SELECT user_id FROM user_tcp_configs WHERE host = ? AND port = ? AND user_id != ?",
        [hostTrim, Number(p), userId]
      );
      if (existing.length > 0)
        return res.status(409).json({ error: `Port ${p} on ${hostTrim} is already registered by another user.`, port: String(p) });
    }

    // Disconnect all existing connections for this user
    client.disconnectAllForUser(userId);

    // Delete old entries for this user
    await db.execute("DELETE FROM user_tcp_configs WHERE user_id = ?", [userId]);

    // Insert new entries
    for (const port of ports) {
      await db.execute(
        "INSERT INTO user_tcp_configs (user_id, host, port, folder_path, is_active) VALUES (?, ?, ?, ?, 1)",
        [userId, hostTrim, Number(port), folder_path?.trim() || null]
      );
    }

    // Connect to each port
    ports.forEach(port => client.connectOne(userId, hostTrim, Number(port)));

    const [rows] = await db.execute(
      "SELECT id, host, port, is_active FROM user_tcp_configs WHERE user_id = ?",
      [userId]
    );
    res.json({ success: true, entries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/tcp-client-config/disconnect
async function disconnect(req, res) {
  try {
    const userId = req.user.id;
    await db.execute("UPDATE user_tcp_configs SET is_active = 0 WHERE user_id = ?", [userId]);
    client.logoutUser(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/tcp-client-config/reconnect
async function reconnect(req, res) {
  try {
    const userId = req.user.id;
    await db.execute("UPDATE user_tcp_configs SET is_active = 1 WHERE user_id = ?", [userId]);
    const rows = await client.loadAndConnectUser(userId);
    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getConfig, updateConfig, disconnect, reconnect };
