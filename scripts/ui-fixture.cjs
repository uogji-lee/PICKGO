// Disposable UI simulation. Never reads/writes the real database.
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'ui-fixture-only-not-production';
process.env.PICKGO_PUBLIC_URL = 'http://127.0.0.1:3002';
for (const key of ['KAKAO_REST_API_KEY','KAKAO_CLIENT_SECRET','NAVER_CLIENT_ID','NAVER_CLIENT_SECRET','GOOGLE_PLACES_API_KEY','TOUR_API_SERVICE_KEY']) process.env[key] = '';
const app = require('../server');
const db = require('../db');
const bcrypt = require('bcryptjs');
for (const nickname of ['시뮬방장','시뮬친구']) db.prepare('INSERT INTO users(nickname,password_hash) VALUES (?,?)').run(nickname,bcrypt.hashSync('demo-pass',10));
app.listen(3002,'127.0.0.1',()=>console.log('Disposable UI: http://127.0.0.1:3002 — 시뮬방장 / demo-pass'));
