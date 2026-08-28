const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.PICKGO_DB_PATH || path.join(__dirname, 'data', 'pickgo.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  host_user_id INTEGER NOT NULL,
  selected_date TEXT,
  selected_region_id TEXT,
  selected_dresscode TEXT,
  status TEXT NOT NULL DEFAULT 'planning',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (host_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  availability_json TEXT NOT NULL DEFAULT '[]',
  dresscode TEXT,
  preferences_json TEXT NOT NULL DEFAULT '[]',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

// 기존 DB에도 새 컬럼을 안전하게 추가하는 간단한 마이그레이션
const memberColumns = db.prepare('PRAGMA table_info(room_members)').all();
if (!memberColumns.some(column => column.name === 'preferences_json')) {
  db.exec("ALTER TABLE room_members ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '[]'");
}

module.exports = db;
