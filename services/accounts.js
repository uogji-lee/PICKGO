const bcrypt = require('bcryptjs');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function validateNickname(db, value, exceptUserId = 0) {
  const nickname = typeof value === 'string' ? value.trim() : '';
  if (nickname.length < 2 || nickname.length > 12) throw fail('닉네임은 2~12자로 입력해주세요.');
  if (db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(nickname, exceptUserId)) throw fail('이미 사용 중인 닉네임입니다.', 409);
  return nickname;
}

function hashPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value, 'utf8') > 72) {
    throw fail('비밀번호는 8자 이상, UTF-8 기준 72바이트 이내로 입력해주세요.');
  }
  return bcrypt.hashSync(value, 10);
}

module.exports = { fail, hashPassword, validateNickname };
