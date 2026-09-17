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
  trip_nights INTEGER NOT NULL DEFAULT 1,
  traveler_count INTEGER NOT NULL DEFAULT 1,
  transport_mode TEXT NOT NULL DEFAULT 'public',
  vehicle_count INTEGER NOT NULL DEFAULT 0,
  accommodation_name TEXT,
  accommodation_address TEXT,
  accommodation_map_x TEXT,
  accommodation_map_y TEXT,
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
  custom_preference TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

// 기존 DB에도 새 컬럼을 안전하게 추가하는 간단한 마이그레이션
const memberColumns = db.prepare('PRAGMA table_info(room_members)').all();
if (!memberColumns.some(column => column.name === 'role')) {
  db.exec("ALTER TABLE room_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
}
if (!memberColumns.some(column => column.name === 'active')) {
  db.exec('ALTER TABLE room_members ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
}
if (!memberColumns.some(column => column.name === 'preferences_json')) {
  db.exec("ALTER TABLE room_members ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '[]'");
}
if (!memberColumns.some(column => column.name === 'custom_preference')) {
  db.exec('ALTER TABLE room_members ADD COLUMN custom_preference TEXT');
}

const roomColumns = db.prepare('PRAGMA table_info(rooms)').all();
if (!roomColumns.some(column => column.name === 'trip_nights')) {
  db.exec('ALTER TABLE rooms ADD COLUMN trip_nights INTEGER NOT NULL DEFAULT 1');
}

const roomMigrations = [
  ['dues_amount', 'ALTER TABLE rooms ADD COLUMN dues_amount INTEGER NOT NULL DEFAULT 0'],
  ['finance_phase', "ALTER TABLE rooms ADD COLUMN finance_phase TEXT NOT NULL DEFAULT 'collecting'"],
  ['traveler_count', "ALTER TABLE rooms ADD COLUMN traveler_count INTEGER NOT NULL DEFAULT 1"],
  ['transport_mode', "ALTER TABLE rooms ADD COLUMN transport_mode TEXT NOT NULL DEFAULT 'public'"],
  ['vehicle_count', "ALTER TABLE rooms ADD COLUMN vehicle_count INTEGER NOT NULL DEFAULT 0"],
  ['accommodation_name', 'ALTER TABLE rooms ADD COLUMN accommodation_name TEXT'],
  ['accommodation_address', 'ALTER TABLE rooms ADD COLUMN accommodation_address TEXT'],
  ['accommodation_map_x', 'ALTER TABLE rooms ADD COLUMN accommodation_map_x TEXT'],
  ['accommodation_map_y', 'ALTER TABLE rooms ADD COLUMN accommodation_map_y TEXT'],
];

for (const [columnName, statement] of roomMigrations) {
  if (!roomColumns.some(column => column.name === columnName)) db.exec(statement);
}

db.exec(`
CREATE TABLE IF NOT EXISTS trip_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trip_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  title TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  payer_user_id INTEGER REFERENCES users(id),
  participant_ids TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trip_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS dues_nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS payments_room ON trip_payments(room_id);
CREATE INDEX IF NOT EXISTS expenses_room ON trip_expenses(room_id);
CREATE INDEX IF NOT EXISTS refunds_room ON trip_refunds(room_id);
CREATE INDEX IF NOT EXISTS nudges_room ON dues_nudges(room_id);
`);

module.exports = db;
