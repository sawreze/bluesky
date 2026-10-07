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

const crypto = require('crypto');
const mail = require('./_mail.cjs');

// ── 이메일 인증 코드 보내기 (가입 · 새 기기 로그인 공통) ──
//  돌려주는 것: { needCode, ticket, email, purpose, expiresIn, resendIn, demoCode? }
//  demoCode 는 메일 설정(GMAIL_USER · GMAIL_APP_PASSWORD) 전에만 — 화면에 보여 주는 시연 모드
async function issueCode(db, req, res, row) {
  const ip = db.ipKey(req);
  const wait = await db.store.codeWait(row.email, ip);
  if (wait && wait.sec) return res.status(429).json({ error: `인증 코드를 방금 보냈어요. ${wait.sec}초 뒤에 다시 받을 수 있어요.`, wait: wait.sec });
  if (wait) return res.status(429).json({ error: '인증 코드를 너무 많이 요청했어요. 1시간 뒤에 다시 시도해 주세요.' });
  const token = crypto.randomBytes(24).toString('base64url');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.store.codeCreate({ ...row, token, ip_hash: ip, code_hash: db.codeHash(token, code) });
  let sent;
  try { sent = await mail.sendCode(row.email, code, row.purpose); } catch (e) {
    console.log('[메일 오류]', e && e.message);
    return res.status(502).json({ error: '인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
  const L = db.CODE_LIMIT;
  return res.status(200).json({ needCode: true, ticket: token, email: row.email, purpose: row.purpose,
    expiresIn: L.minutes * 60, resendIn: L.resendSec, ...(sent.demo ? { demoCode: code } : {}) });
}

const signup = async (b, res, db, req) => {
  const name = str(b.name, 40), email = str(b.email, 120).toLowerCase(), pw = String(b.pw || '');
  if (!name) return res.status(400).json({ error: '이름(닉네임)을 적어 주세요.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: '이메일 주소를 확인해 주세요.' });
  if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: '비밀번호는 8자 이상으로 만들어 주세요.' });
  if (await db.store.findEmail(email)) return res.status(409).json({ error: '이미 가입된 이메일이에요. 로그인해 주세요.' });
  // 지메일 점(.)·+ 별칭으로 같은 메일함에 계정을 여러 개 만드는 것 막기
  if (await db.store.emailTaken(email)) return res.status(409).json({ error: '같은 메일함으로 이미 가입된 계정이 있어요. (지메일은 점(.)이나 +를 붙여도 같은 주소예요)' });
  // 가입은 메일 인증이 끝나야 완료돼요 — 그때까지 이름·비밀번호(해시)는 인증 코드와 함께 기다려요
  return issueCode(db, req, res, { purpose: 'signup', email, name, pw_hash: db.hashPw(pw) });
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
  // 로그인 유지로 인증해 둔 기기면 코드 없이 바로
  if (db.deviceUid(req) === Number(u.id)) {
    db.setSession(res, u.id, b.remember !== false);
    if (b.remember !== false) db.setDevice(res, u.id); // 기억 기간 연장
    return res.status(200).json({ user: db.pub(u), trusted: true });
  }
  return issueCode(db, req, res, { purpose: 'login', email, user_id: u.id });
};

// ── 인증 코드 확인 · 다시 받기 (POST /api/auth/code  { a: 'verify' | 'resend', ticket, code, remember }) ──
const code = async (b, res, db, req) => {
  const row = await db.store.codeByToken(str(b.ticket, 100));
  const gone = () => res.status(400).json({ error: '인증 정보가 없어요. 처음부터 다시 해 주세요.', restart: true });
  if (!row || row.used_at) return gone();
  const L = db.CODE_LIMIT;
  if (b.a === 'resend') {
    // 새 코드를 만들면 예전 코드는 못 써요
    const out = await issueCode(db, req, { status: (n) => ({ json: (o) => ({ n, o }) }) },
      { purpose: row.purpose, email: row.email, name: row.name, pw_hash: row.pw_hash, user_id: row.user_id });
    if (out.n === 200) await db.store.codeUse(row.id);
    return res.status(out.n).json(out.o);
  }
  if (b.a !== 'verify') return res.status(400).json({ error: '잘못된 요청이에요.' });
  if (row.expired) return res.status(400).json({ error: `인증 코드 유효 시간(${L.minutes}분)이 지났어요. 코드를 다시 받아 주세요.`, expired: true });
  if (row.attempts >= L.tries) return res.status(429).json({ error: `코드를 ${L.tries}번 틀렸어요. 코드를 다시 받아 주세요.`, expired: true });
  const given = String(b.code || '').replace(/\D/g, '');
  const want = Buffer.from(row.code_hash), got = Buffer.from(db.codeHash(row.token, given));
  if (given.length !== 6 || want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    await db.store.codeFail(row.id);
    const left = L.tries - row.attempts - 1;
    return res.status(400).json({ error: left > 0 ? `인증 코드가 맞지 않아요. (${left}번 남음)` : `코드를 ${L.tries}번 틀렸어요. 코드를 다시 받아 주세요.`, expired: left <= 0 });
  }
  if (!(await db.store.codeUse(row.id))) return gone();
  let u;
  if (row.purpose === 'signup') {
    if (await db.store.emailTaken(row.email)) return res.status(409).json({ error: '이미 가입된 이메일이에요. 로그인해 주세요.', restart: true });
    try { u = await db.store.createEmailHashed(row.name, row.email, row.pw_hash); } catch (e) {
      if (e && e.code === '23505') return res.status(409).json({ error: '이미 가입된 이메일이에요. 로그인해 주세요.', restart: true });
      throw e;
    }
  } else {
    u = await db.store.byId(row.user_id);
    if (!u) return gone();
    if (u.blocked_at) return res.status(403).json({ error: '관리자가 이용을 제한한 계정이에요.' });
  }
  const remember = b.remember !== false;
  db.setSession(res, u.id, remember);
  if (remember) db.setDevice(res, u.id); // 로그인 유지: 이 기기는 다음부터 코드 없이
  return res.status(200).json({ user: db.pub(u), ...(row.purpose === 'signup' ? { isNew: true } : {}) }); // isNew: 방금 가입 → 튜토리얼
};

module.exports = { wrap, signup, login, code };
