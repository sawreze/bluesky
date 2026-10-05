// 회원가입·로그인 처리 로직 (DB 부분은 _db.cjs 를 받아서 써요)
//  성공하면 출입증 쿠키를 같이 줘요.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const body = (req) => {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
};
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function wrap(fn, db) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: '잘못된 요청이에요.' });
    if (!db.hasDb()) return res.status(503).json({ error: '회원 DB가 아직 연결되지 않았어요.', demo: true });
    try { return await fn(body(req), res, db, req); } catch (e) {
      console.log('[회원 DB 오류]', e && e.message);
      return res.status(500).json({ error: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
    }
  };
}

const signup = async (b, res, db) => {
  const name = str(b.name, 40), email = str(b.email, 120).toLowerCase(), pw = String(b.pw || '');
  if (!name) return res.status(400).json({ error: '이름(닉네임)을 적어 주세요.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: '이메일 주소를 확인해 주세요.' });
  if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: '비밀번호는 8자 이상으로 만들어 주세요.' });
  if (await db.store.findEmail(email)) return res.status(409).json({ error: '이미 가입된 이메일이에요. 로그인해 주세요.' });
  let u;
  try {
    u = await db.store.createEmail(name, email, pw);
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: '이미 가입된 이메일이에요. 로그인해 주세요.' });
    throw e;
  }
  db.setSession(res, u.id, b.remember !== false);
  return res.status(200).json({ user: db.pub(u) });
};
const login = async (b, res, db, req) => {
  const email = str(b.email, 120).toLowerCase(), pw = String(b.pw || '');
  const bad = (left) => res.status(401).json({ error: `이메일 또는 비밀번호가 맞지 않아요.${left > 0 && left <= 2 ? ` (${left}번 더 틀리면 ${db.LOGIN_LIMIT.minutes}분 동안 로그인이 막혀요)` : ''}` });
  if (!EMAIL_RE.test(email) || !pw) return bad();
  // 비밀번호 무작정 대입 막기: 여러 번 틀리면 잠시 막아요 (계정이 없는 이메일도 똑같이 — 가입 여부를 알려 주지 않으려고)
  const ip = db.ipKey(req);
  const wait = await db.store.loginWait(email, ip);
  if (wait) return res.status(429).json({ error: `로그인을 여러 번 틀려서 잠시 막았어요. ${wait}분 뒤에 다시 시도해 주세요.` });
  const u = await db.store.findEmail(email);
  if (!u || !db.checkPw(pw, u.pw_hash)) {
    const left = await db.store.loginFail(email, ip);
    if (left <= 0) return res.status(429).json({ error: `로그인을 ${db.LOGIN_LIMIT.perEmail}번 틀려서 ${db.LOGIN_LIMIT.minutes}분 동안 막았어요. 잠시 뒤에 다시 시도해 주세요.` });
    return bad(left);
  }
  await db.store.loginOk(email);
  if (u.blocked_at) return res.status(403).json({ error: '관리자가 이용을 제한한 계정이에요.' });
  db.setSession(res, u.id, b.remember !== false);
  return res.status(200).json({ user: db.pub(u) });
};

module.exports = { wrap, signup, login };
