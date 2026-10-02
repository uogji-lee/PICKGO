const { nicknameTaken, normalizeNickname } = require('./accounts');

module.exports = function migrate(db) {
  const add = (table, name, type) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  db.transaction(() => {
    add('rooms', 'deleted_at', 'TEXT');
    add('rooms', 'treasurer_user_id', 'INTEGER REFERENCES users(id)');
    add('rooms', 'active_trip_id', 'INTEGER');
    add('rooms', 'monthly_amount', 'INTEGER NOT NULL DEFAULT 0');
    add('rooms', 'monthly_start', 'TEXT');
    add('rooms', 'membership_locked', 'INTEGER NOT NULL DEFAULT 0');
    add('trip_payments', 'billing_month', 'TEXT');
    add('trip_payments', 'note', "TEXT NOT NULL DEFAULT ''");
    add('trip_expenses', 'trip_id', 'INTEGER');
    add('trip_refunds', 'trip_id', 'INTEGER');
    add('room_members', 'origin_id', 'TEXT');
    add('room_members', 'origin_mode', 'TEXT');
    if (!db.prepare('PRAGMA table_info(rooms)').all().some(column => column.name === 'dresscode_enabled')) {
      add('rooms', 'dresscode_enabled', 'INTEGER NOT NULL DEFAULT 0');
      // 이미 드레스코드를 쓰던 방은 켜진 상태로 유지
      const has = (table, name) => db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name);
      if (has('rooms', 'selected_dresscode') && has('room_members', 'dresscode')) {
        db.exec(`UPDATE rooms SET dresscode_enabled = 1 WHERE selected_dresscode IS NOT NULL
          OR EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = rooms.id AND m.active = 1 AND m.dresscode IS NOT NULL AND m.dresscode != '')`);
      }
    }
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
    add('journeys', 'member_inputs_json', 'TEXT');
    add('rooms', 'accommodation_url', 'TEXT');
    add('room_members', 'origin_lat', 'REAL');
    add('room_members', 'origin_lng', 'REAL');
    add('room_members', 'origin_label', 'TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS lodging_candidates (
      id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), trip_id INTEGER NOT NULL REFERENCES journeys(id),
      name TEXT NOT NULL, url TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS lodging_trip ON lodging_candidates(trip_id);
    CREATE TABLE IF NOT EXISTS lodging_votes (
      trip_id INTEGER NOT NULL REFERENCES journeys(id), user_id INTEGER NOT NULL REFERENCES users(id),
      candidate_id INTEGER NOT NULL REFERENCES lodging_candidates(id), PRIMARY KEY(trip_id, user_id)
    );`);
    add('journeys', 'destination_method', "TEXT NOT NULL DEFAULT 'random'");
    add('journeys', 'draw_limit', 'INTEGER NOT NULL DEFAULT 2');
    add('journeys', 'draw_count', 'INTEGER NOT NULL DEFAULT 0');
    add('rooms', 'selected_region_json', 'TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS destination_candidates (
      id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), trip_id INTEGER NOT NULL REFERENCES journeys(id),
      region_key TEXT NOT NULL, region_json TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS destination_trip ON destination_candidates(trip_id);
    CREATE TABLE IF NOT EXISTS destination_votes (
      trip_id INTEGER NOT NULL REFERENCES journeys(id), user_id INTEGER NOT NULL REFERENCES users(id),
      region_key TEXT NOT NULL, PRIMARY KEY(trip_id, user_id)
    );`);
    add('lodging_candidates', 'image_url', 'TEXT');
    add('lodging_candidates', 'bedrooms', 'INTEGER');
    add('lodging_candidates', 'beds', 'INTEGER');
    add('lodging_candidates', 'bathrooms', 'REAL');
    add('lodging_candidates', 'capacity', 'INTEGER');
    add('journeys', 'notes', "TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE TABLE IF NOT EXISTS kakao_signups (
      token_hash TEXT PRIMARY KEY, kakao_id TEXT NOT NULL, tokens TEXT NOT NULL,
      token_expires_at INTEGER NOT NULL, nickname_hint TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS journey_edits (
      id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES journeys(id),
      edited_by INTEGER NOT NULL REFERENCES users(id), before_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS packing_items (
      id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES journeys(id), title TEXT NOT NULL,
      category TEXT NOT NULL, owner_id INTEGER REFERENCES users(id), assignee_id INTEGER REFERENCES users(id),
      checked INTEGER NOT NULL DEFAULT 0, checked_by INTEGER REFERENCES users(id), created_by INTEGER NOT NULL REFERENCES users(id),
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS packing_trip ON packing_items(trip_id);
    CREATE TABLE IF NOT EXISTS packing_seeds(trip_id INTEGER NOT NULL REFERENCES journeys(id),user_id INTEGER NOT NULL,PRIMARY KEY(trip_id,user_id));`);
    add('room_members', 'origin_undecided', 'INTEGER NOT NULL DEFAULT 0');
    db.exec(`CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', reply TEXT, replied_by INTEGER REFERENCES users(id), replied_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS inquiries_user ON inquiries(user_id);`);
    const hasNickname = db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'nickname');
    // 정규화(NFC·공백 정리) 도입 전에 저장된 닉네임을 한 번만 정리. 다른 계정과 겹치면 그대로 두고 경고
    if (hasNickname && !db.prepare('SELECT 1 FROM schema_versions WHERE name = ?').get('nickname-normalize-v1')) {
      for (const user of db.prepare('SELECT id, nickname FROM users').all()) {
        const nickname = normalizeNickname(user.nickname);
        if (!nickname || nickname === user.nickname) continue;
        if (nicknameTaken(db, nickname, user.id)) console.warn(`[migrations] 정리한 닉네임이 다른 계정과 겹쳐 user ${user.id}의 닉네임은 그대로 둡니다.`);
        else db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, user.id);
      }
      db.prepare('INSERT INTO schema_versions(name) VALUES (?)').run('nickname-normalize-v1');
    }
    // 대소문자만 다른 닉네임 중복 방지: 기존 데이터에 그런 중복이 없을 때만 인덱스 생성
    if (hasNickname && !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'users_nickname_ci'").get()) {
      const duplicates = db.prepare('SELECT count(*) AS n FROM (SELECT 1 FROM users GROUP BY lower(nickname) HAVING count(*) > 1)').get().n;
      if (duplicates) console.warn(`[migrations] 대소문자만 다른 닉네임이 ${duplicates}건 있어 users_nickname_ci 인덱스를 만들지 않았습니다.`);
      else db.exec('CREATE UNIQUE INDEX users_nickname_ci ON users(lower(nickname))');
    }
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
