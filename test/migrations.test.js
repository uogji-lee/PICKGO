const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const migrate = require('../services/migrations');
test('기존 회원·지출·반환·총무를 보존하며 반복 실행해도 여행을 중복 생성하지 않는다', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1),(2);
    CREATE TABLE rooms(id INTEGER PRIMARY KEY,host_user_id INTEGER,selected_date TEXT,dues_amount INTEGER);
    INSERT INTO rooms VALUES (1,1,'2026-09-19',10000);
    CREATE TABLE room_members(room_id INTEGER,user_id INTEGER,role TEXT,active INTEGER);
    INSERT INTO room_members VALUES (1,1,'member',1),(1,2,'treasurer',1);
    CREATE TABLE trip_payments(id INTEGER PRIMARY KEY,room_id INTEGER,amount INTEGER);
    INSERT INTO trip_payments VALUES (1,1,20000);
    CREATE TABLE trip_expenses(id INTEGER PRIMARY KEY,room_id INTEGER,amount INTEGER);
    INSERT INTO trip_expenses VALUES (1,1,9000);
    CREATE TABLE trip_refunds(id INTEGER PRIMARY KEY,room_id INTEGER,amount INTEGER);
    INSERT INTO trip_refunds VALUES (1,1,1000);
  `);
  migrate(db); migrate(db);
  const journeys = db.prepare('SELECT * FROM journeys').all();
  assert.equal(journeys.length, 1);
  assert.deepEqual(JSON.parse(journeys[0].participant_ids), [1, 2]);
  assert.equal(JSON.parse(journeys[0].plan_json).selected_date, '2026-09-19');
  assert.equal(db.prepare('SELECT treasurer_user_id FROM rooms').get().treasurer_user_id, 2);
  assert.equal(db.prepare('SELECT amount FROM trip_payments').get().amount, 20000);
  assert.deepEqual(db.prepare('SELECT amount,trip_id FROM trip_expenses').get(), { amount: 9000, trip_id: journeys[0].id });
  assert.deepEqual(db.prepare('SELECT amount,trip_id FROM trip_refunds').get(), { amount: 1000, trip_id: journeys[0].id });
  db.close();
});

test('대소문자만 다른 기존 닉네임이 없을 때만 users_nickname_ci 유니크 인덱스를 만든다', t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const setup = nicknames => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY, nickname TEXT UNIQUE NOT NULL);
      CREATE TABLE rooms(id INTEGER PRIMARY KEY, host_user_id INTEGER);
      CREATE TABLE room_members(room_id INTEGER, user_id INTEGER, role TEXT, active INTEGER);
      CREATE TABLE trip_payments(id INTEGER PRIMARY KEY, room_id INTEGER);
      CREATE TABLE trip_expenses(id INTEGER PRIMARY KEY, room_id INTEGER);
      CREATE TABLE trip_refunds(id INTEGER PRIMARY KEY, room_id INTEGER);
    `);
    for (const nickname of nicknames) db.prepare('INSERT INTO users(nickname) VALUES (?)').run(nickname);
    migrate(db);
    return db;
  };
  const hasIndex = db => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'users_nickname_ci'").get());
  const clean = setup(['Minji', '민지']);
  assert.equal(hasIndex(clean), true);
  assert.throws(() => clean.prepare('INSERT INTO users(nickname) VALUES (?)').run('MINJI'), /UNIQUE/);
  migrate(clean);
  assert.equal(warn.mock.callCount(), 0);
  const legacy = setup(['Minji', 'minji', '민지']);
  assert.equal(hasIndex(legacy), false);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(legacy.prepare('SELECT count(*) AS n FROM users').get().n, 3);
  clean.close(); legacy.close();
});
