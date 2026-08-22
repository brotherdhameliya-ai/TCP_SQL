const db = require("../config/db");

const Camera = {
  getAll: () =>
    db.execute("SELECT * FROM camera_configs ORDER BY ip_address, port"),

  getActive: () =>
    db.execute(
      "SELECT * FROM camera_configs WHERE is_active = 1 ORDER BY ip_address, port"
    ),

  getById: (id) =>
    db.execute("SELECT * FROM camera_configs WHERE id = ?", [id]),

  create: ({ camera_name, ip_address, port, is_active = 1 }) =>
    db.execute(
      "INSERT INTO camera_configs (camera_name, ip_address, port, is_active) VALUES (?, ?, ?, ?)",
      [camera_name, ip_address, port, is_active]
    ),

  update: (id, { camera_name, ip_address, port, is_active }) =>
    db.execute(
      // SQLite has no ON UPDATE CURRENT_TIMESTAMP — set updated_at manually
      "UPDATE camera_configs SET camera_name=?, ip_address=?, port=?, is_active=?, updated_at=datetime('now') WHERE id=?",
      [camera_name, ip_address, port, is_active, id]
    ),

  delete: (id) =>
    db.execute("DELETE FROM camera_configs WHERE id=?", [id]),

  saveLog: ({ camera_id, ip_address, port, message }) =>
    db.execute(
      "INSERT INTO tcp_logs (camera_id, ip_address, port, message) VALUES (?, ?, ?, ?)",
      [camera_id || null, ip_address, port, message]
    ),

  getLogs: (limit = 100) =>
    db.execute(
      `SELECT l.*, c.camera_name
       FROM tcp_logs l
       LEFT JOIN camera_configs c ON c.id = l.camera_id
       ORDER BY l.received_at DESC LIMIT ?`,
      [limit]
    ),
};

module.exports = Camera;
