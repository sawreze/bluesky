// =====================================================================
//  회원·기록 DB (Vercel Postgres = Neon). 연결 주소는 환경변수 DATABASE_URL (없으면 POSTGRES_URL)
//  - 비밀번호는 절대 그대로 저장하지 않고 scrypt 로 암호화(해시)해서 저장해요.
//  - 로그인하면 서버가 서명한 "출입증" 쿠키(pureun_sid)를 줘요. 앱이 기록을 저장할 때마다
//    서버는 이 쿠키로 누구인지 확인해요 (앱이 보내는 회원 번호는 믿지 않아요).
// =====================================================================
const crypto = require('crypto');

function dbUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || '';
}
const hasDb = () => dbUrl().length > 0;

let sqlClient = null;
let ready = null;
function sql() {
  if (!sqlClient) sqlClient = module.exports._makeSql ? module.exports._makeSql() : require('@neondatabase/serverless').neon(dbUrl());
  return sqlClient;
}

// 표·뷰 만들기 (db/schema.sql → api/_schema.cjs)
//  실행이 끝나면 v_user_stats 뷰에 설계 지문(해시)을 적어 둬요.
//  지문이 지금 코드와 같으면 건너뛰고, schema.sql 을 고쳐서 배포하면 지문이 달라져서 다시 실행해요.
const SCHEMA = require('./_schema.cjs');
const SCHEMA_HASH = crypto.createHash('sha256').update(JSON.stringify(SCHEMA)).digest('hex').slice(0, 16);
function init() {
  if (!ready) {
    ready = (async () => {
      const db = sql();
      const [chk] = await db.query("SELECT obj_description(to_regclass('public.v_user_stats'), 'pg_class') AS v");
      if (chk && chk.v === SCHEMA_HASH) return;
      for (const stmt of SCHEMA) await db.query(stmt);
      await db.query(`COMMENT ON VIEW v_user_stats IS '${SCHEMA_HASH}'`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ── 비밀번호 ──
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPw(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── 출입증 쿠키 ──
//  내용: 회원 번호 + 만료 시각, 서명: HMAC-SHA256 (비밀값은 SESSION_SECRET, 없으면 DB 주소에서 만들어요)
const COOKIE = 'pureun_sid';
const LONG_DAYS = 60;
function secret() {
  return process.env.SESSION_SECRET || crypto.createHash('sha256').update(`pureun-session:${dbUrl()}`).digest('hex');
}
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');
function makeToken(uid, days = LONG_DAYS) {
  const body = b64(JSON.stringify({ u: Number(uid), e: Date.now() + days * 86400000 }));
  return `${body}.${sign(body)}`;
}
function readToken(tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig) return null;
  const want = sign(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p && Number.isInteger(p.u) && p.e > Date.now() ? p.u : null;
  } catch (e) { return null; }
}
function cookieOf(req, name = COOKIE) {
  const raw = String((req.headers && req.headers.cookie) || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
// remember=false 면 브라우저를 닫을 때 사라지는 쿠키
function setSession(res, uid, remember = true) {
  const parts = [`${COOKIE}=${makeToken(uid)}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${LONG_DAYS * 86400}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
const sessionUid = (req) => readToken(cookieOf(req));

const pub = (r) => ({ uid: r.id, provider: r.provider, email: r.email || undefined, name: r.name, role: String(r.role || 'user').trim() });

const store = {
  async findEmail(email) {
    await init();
    const rows = await sql()`SELECT * FROM users WHERE provider = 'email' AND lower(email) = lower(${email}) LIMIT 1`;
    return rows[0] || null;
  },
  async createEmail(name, email, pw) {
    await init();
    const rows = await sql()`INSERT INTO users (provider, email, name, pw_hash) VALUES ('email', ${email}, ${name}, ${hashPw(pw)}) RETURNING *`;
    return rows[0];
  },
  // 카카오: 처음이면 새로 만들고, 이미 있으면 그대로.
  //  앱에서 바꾼 닉네임은 덮어쓰지 않고, 기본 이름("카카오 사용자")일 때만 카카오 닉네임으로 바꿔요.
  async upsertSocial(provider, providerId, name) {
    await init();
    const rows = await sql()`INSERT INTO users (provider, provider_id, name) VALUES (${provider}, ${providerId}, ${name})
      ON CONFLICT (provider, provider_id) WHERE provider_id IS NOT NULL
      DO UPDATE SET name = CASE WHEN users.name = '카카오 사용자' THEN EXCLUDED.name ELSE users.name END RETURNING *`;
    return rows[0];
  },
  async byId(uid) {
    await init();
    const rows = await sql()`SELECT * FROM users WHERE id = ${uid}`;
    return rows[0] || null;
  },
};

module.exports = { hasDb, sql, init, store, checkPw, pub, setSession, clearSession, sessionUid, makeToken, readToken };
