const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function getSecret() {
  if (process.env.PICKGO_JWT_SECRET) return process.env.PICKGO_JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('운영 환경에는 PICKGO_JWT_SECRET이 필요합니다.');
  const file = path.join(__dirname, '..', 'data', '.session-secret');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return fs.readFileSync(file, 'utf8').trim();
}
const secret = getSecret();
const appOrigin = process.env.PICKGO_PUBLIC_URL || 'http://localhost:3000';
const origin = new URL(appOrigin).origin;
if (process.env.NODE_ENV === 'production' && (!process.env.PICKGO_PUBLIC_URL || !origin.startsWith('https://') || secret.length < 32)) {
  throw new Error('운영 환경에는 HTTPS PICKGO_PUBLIC_URL과 32자 이상의 세션 비밀키가 필요합니다.');
}
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https://'), path: '/' };
const encryptionKey = crypto.createHash('sha256').update('pickgo-kakao-tokens:' + secret).digest();
function encrypt(value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(buffer => buffer.toString('base64url')).join('.');
}
function decrypt(value) {
  const [iv, tag, encrypted] = value.split('.').map(item => Buffer.from(item, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}
function securityMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  if (cookieOptions.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) return res.status(403).json({ error: '다른 사이트에서 보낸 요청은 허용하지 않습니다.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON 요청이 필요합니다.' });
  }
  next();
}
module.exports = { secret, origin, cookieOptions, encrypt, decrypt, securityMiddleware };
