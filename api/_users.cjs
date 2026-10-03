// 회원가입·로그인 처리 로직 (DB 부분은 _db.cjs 의 store 를 받아서 써요)
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
    try { return await fn(body(req), res, db); } catch (e) {
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
  try {
    return res.status(200).json({ user: db.pub(await db.store.createEmail(name, email, pw)) });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: '이미 가입된 이메일이에요. 로그인해 주세요.' });
    throw e;
  }
};
const login = async (b, res, db) => {
  const email = str(b.email, 120).toLowerCase(), pw = String(b.pw || '');
  const bad = () => res.status(401).json({ error: '이메일 또는 비밀번호가 맞지 않아요.' });
  if (!EMAIL_RE.test(email) || !pw) return bad();
  const u = await db.store.findEmail(email);
  if (!u || !db.checkPw(pw, u.pw_hash)) return bad();
  return res.status(200).json({ user: db.pub(u) });
};
const social = async (b, res, db) => {
  const provider = str(b.provider, 20), pid = str(b.id, 80), name = str(b.name, 40) || '사용자';
  if (provider !== 'kakao' || !pid) return res.status(400).json({ error: '잘못된 요청이에요.' });
  return res.status(200).json({ user: db.pub(await db.store.upsertSocial(provider, pid, name)) });
};

module.exports = { wrap, signup, login, social };
