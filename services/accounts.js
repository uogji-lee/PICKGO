const bcrypt = require('bcryptjs');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const NICKNAME_TAKEN = '이미 사용 중인 닉네임입니다.';

// 아이디 = 닉네임: NFC 정규화 + 앞뒤 공백 제거 + 연속 공백 하나로
function normalizeNickname(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
}

function nicknameFormatError(nickname) {
  if (nickname.length < 2 || nickname.length > 12) return '닉네임은 2~12자로 입력해주세요.';
  // 보이지 않는 문자로 같은 이름을 흉내 내지 못하게 막음
  if (/[\p{Cc}\u200B\u200C\u2060\uFEFF]/u.test(nickname)) return '닉네임에 쓸 수 없는 문자가 있어요.';
  return '';
}

// 대소문자만 다른 닉네임도 같은 이름으로 본다 (SQLite lower()는 라틴 문자만 바꿈)
function nicknameTaken(db, nickname, exceptUserId = 0) {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE lower(nickname) = lower(?) AND id != ?').get(nickname, exceptUserId));
}

function validateNickname(db, value, exceptUserId = 0) {
  const nickname = normalizeNickname(value);
  const message = nicknameFormatError(nickname);
  if (message) throw fail(message);
  if (nicknameTaken(db, nickname, exceptUserId)) throw fail(NICKNAME_TAKEN, 409);
  return nickname;
}

// 동시 가입 경쟁으로 UNIQUE 제약(users.nickname 또는 users_nickname_ci)에 걸린 경우
const isNicknameConflict = error => String(error?.code || '').startsWith('SQLITE_CONSTRAINT')
  && /users\.nickname|users_nickname_ci/.test(error.message);

// 로그인용: 저장된 그대로 먼저 찾고, 없으면 대소문자 무시로 한 명만 일치할 때 그 계정
function findUserByNickname(db, value) {
  const raw = String(value ?? '').trim();
  const nickname = normalizeNickname(String(value ?? ''));
  const exact = db.prepare('SELECT * FROM users WHERE nickname IN (?, ?) ORDER BY nickname = ? DESC LIMIT 1').get(raw, nickname, raw);
  if (exact) return exact;
  const matches = db.prepare('SELECT * FROM users WHERE lower(nickname) = lower(?) LIMIT 2').all(nickname);
  return matches.length === 1 ? matches[0] : null;
}

function hashPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value, 'utf8') > 72) {
    throw fail('비밀번호는 8자 이상, UTF-8 기준 72바이트 이내로 입력해주세요.');
  }
  return bcrypt.hashSync(value, 10);
}

module.exports = {
  NICKNAME_TAKEN, fail, findUserByNickname, hashPassword, isNicknameConflict,
  nicknameFormatError, nicknameTaken, normalizeNickname, validateNickname,
};
