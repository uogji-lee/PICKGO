module.exports = function migrate(db) {
  const add = (table, name, type) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  db.transaction(() => {
    add('rooms', 'treasurer_user_id', 'INTEGER REFERENCES users(id)');
    add('rooms', 'active_trip_id', 'INTEGER');
    add('rooms', 'monthly_amount', 'INTEGER NOT NULL DEFAULT 0');
    add('rooms', 'monthly_start', 'TEXT');
    add('rooms', 'membership_locked', 'INTEGER NOT NULL DEFAULT 0');
    add('trip_payments', 'billing_month', 'TEXT');
    add('trip_payments', 'note', "TEXT NOT NULL DEFAULT ''");
    add('trip_expenses', 'trip_id', 'INTEGER');
    add('trip_refunds', 'trip_id', 'INTEGER');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS journeys (
        id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), title TEXT NOT NULL,
        participant_ids TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planning', plan_json TEXT NOT NULL DEFAULT '{}',
        settlement_json TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS monthly_dues (
        room_id INTEGER NOT NULL REFERENCES rooms(id), user_id INTEGER NOT NULL REFERENCES users(id), month TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount >= 0), PRIMARY KEY(room_id,user_id,month)
      );
      CREATE TABLE IF NOT EXISTS payment_requests (
        id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), trip_id INTEGER REFERENCES journeys(id),
        user_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), superseded INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS kakao_accounts (
        user_id INTEGER PRIMARY KEY REFERENCES users(id), kakao_id TEXT UNIQUE NOT NULL,
        tokens TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), mode TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS friend_links (
        owner_id INTEGER NOT NULL REFERENCES users(id), friend_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(owner_id,friend_id)
      );
      CREATE TABLE IF NOT EXISTS room_invites (
        id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), sender_id INTEGER NOT NULL REFERENCES users(id),
        recipient_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(room_id,recipient_id)
      );
      CREATE INDEX IF NOT EXISTS journeys_room ON journeys(room_id);
      CREATE INDEX IF NOT EXISTS requests_room ON payment_requests(room_id);
    `);
    add('journeys', 'itinerary_json', 'TEXT');
    if (!db.prepare('SELECT 1 FROM schema_versions WHERE name = ?').get('persistent-clubs-v1')) {
      for (const room of db.prepare('SELECT * FROM rooms').all()) {
        const people = db.prepare('SELECT user_id FROM room_members WHERE room_id = ? AND active = 1 ORDER BY user_id').all(room.id);
        const ids = people.map(person => person.user_id);
        const trip = db.prepare('INSERT INTO journeys(room_id,title,participant_ids,plan_json,created_by) VALUES (?,?,?,?,?)')
          .run(room.id, '기존 여행 기록', JSON.stringify(ids), JSON.stringify(room), room.host_user_id);
        const treasurer = db.prepare("SELECT user_id FROM room_members WHERE room_id = ? AND active = 1 AND role = 'treasurer'").get(room.id);
        db.prepare('UPDATE rooms SET active_trip_id = ?, treasurer_user_id = ? WHERE id = ?').run(trip.lastInsertRowid, treasurer?.user_id || null, room.id);
        db.prepare('UPDATE trip_expenses SET trip_id = ? WHERE room_id = ? AND trip_id IS NULL').run(trip.lastInsertRowid, room.id);
        db.prepare('UPDATE trip_refunds SET trip_id = ? WHERE room_id = ? AND trip_id IS NULL').run(trip.lastInsertRowid, room.id);
      }
      db.prepare('INSERT INTO schema_versions(name) VALUES (?)').run('persistent-clubs-v1');
    }
  })();
};
