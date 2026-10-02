// 문의하기: 사용자가 운영자에게 문의를 남기고, 운영자(PICKGO_ADMIN_USER_IDS)가 답변·종료
const CATEGORIES = ['bug', 'feature', 'account', 'other'];
const STATUSES = ['open', 'answered', 'closed'];
const HOURLY_LIMIT = 5;

// 요청마다 환경변수를 읽어 판단 (쉼표로 구분한 사용자 id)
function adminIds() {
  return new Set(String(process.env.PICKGO_ADMIN_USER_IDS || '').split(',').map(id => Number(id.trim())).filter(id => Number.isInteger(id) && id > 0));
}
const isAdmin = userId => adminIds().has(Number(userId));

function registerInquiries(app, { db, auth }) {
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const handle = handler => (req, res) => {
    try { res.json(handler(req)); }
    catch (error) {
      if (!error.status) throw error;
      res.status(error.status).json({ error: error.message });
    }
  };
  const adminOnly = (req, res, next) => isAdmin(req.user.id) ? next() : res.status(403).json({ error: '운영자만 사용할 수 있어요.' });
  const text = (value, min, max, message) => {
    const clean = typeof value === 'string' ? value.trim() : '';
    if (clean.length < min || clean.length > max) throw fail(message);
    return clean;
  };
  const view = row => ({
    id: row.id, category: row.category, message: row.message, status: row.status,
    reply: row.reply, repliedAt: row.replied_at, createdAt: row.created_at,
    ...(row.author !== undefined ? { author: row.author || '탈퇴한 회원' } : {}),
  });
  const inquiryOr404 = id => {
    const row = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Number(id));
    if (!row) throw fail('문의를 찾을 수 없어요.', 404);
    return row;
  };

  app.post('/api/inquiries', auth, handle(req => {
    const category = String(req.body?.category || '');
    if (!CATEGORIES.includes(category)) throw fail('문의 분류를 선택해주세요.');
    const message = text(req.body?.message, 5, 2000, '문의 내용을 5~2000자로 입력해주세요.');
    const recent = db.prepare("SELECT count(*) AS n FROM inquiries WHERE user_id = ? AND created_at > datetime('now', '-1 hour')").get(req.user.id).n;
    if (recent >= HOURLY_LIMIT) throw fail(`문의는 1시간에 ${HOURLY_LIMIT}건까지 보낼 수 있어요. 잠시 후 다시 시도해주세요.`, 429);
    const id = db.prepare('INSERT INTO inquiries(user_id,category,message) VALUES (?,?,?)').run(req.user.id, category, message).lastInsertRowid;
    return { ok: true, id };
  }));

  app.get('/api/inquiries/mine', auth, handle(req => ({
    inquiries: db.prepare('SELECT * FROM inquiries WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id).map(view),
  })));

  app.get('/api/admin/inquiries', auth, adminOnly, handle(req => {
    const status = String(req.query.status || 'all');
    if (status !== 'all' && !STATUSES.includes(status)) throw fail('문의 상태를 확인해주세요.');
    const rows = db.prepare(`SELECT i.*, u.nickname AS author FROM inquiries i LEFT JOIN users u ON u.id = i.user_id
      WHERE ? = 'all' OR i.status = ? ORDER BY i.id DESC LIMIT 200`).all(status, status);
    const counts = Object.fromEntries(STATUSES.map(key => [key, 0]));
    for (const row of db.prepare('SELECT status, count(*) AS n FROM inquiries GROUP BY status').all()) counts[row.status] = row.n;
    return { inquiries: rows.map(view), counts };
  }));

  app.post('/api/admin/inquiries/:id/reply', auth, adminOnly, handle(req => {
    const inquiry = inquiryOr404(req.params.id);
    const reply = text(req.body?.reply, 1, 2000, '답변을 1~2000자로 입력해주세요.');
    db.prepare("UPDATE inquiries SET reply = ?, status = 'answered', replied_by = ?, replied_at = datetime('now') WHERE id = ?").run(reply, req.user.id, inquiry.id);
    return { ok: true };
  }));

  app.post('/api/admin/inquiries/:id/close', auth, adminOnly, handle(req => {
    const inquiry = inquiryOr404(req.params.id);
    db.prepare("UPDATE inquiries SET status = 'closed' WHERE id = ?").run(inquiry.id);
    return { ok: true };
  }));
}

module.exports = { registerInquiries, isAdmin, CATEGORIES };
