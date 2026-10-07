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
// 사진 있는 추천 캠페인 5개도 배포할 때 같이 넣어요 (예시 회원이 있을 때만, 이미 있으면 건너뜀)
const { FEATURED_SQL } = require('./_seed.cjs');
const SCHEMA_HASH = crypto.createHash('sha256').update(JSON.stringify([SCHEMA, FEATURED_SQL])).digest('hex').slice(0, 16);
function init() {
  if (!ready) {
    ready = (async () => {
      const db = sql();
      const [chk] = await db.query("SELECT obj_description(to_regclass('public.v_user_stats'), 'pg_class') AS v");
      if (chk && chk.v === SCHEMA_HASH) return;
      // 한 문장이 실패해도 앱 전체가 멈추지 않게 나머지는 계속 실행하고, 실패한 문장은 기록해 둬요
      //  (관리자에게는 동기화 응답의 schemaErrors 로 보여 줘요. 다 성공해야 지문을 적어서, 다음 실행 때 다시 시도해요)
      const failed = [];
      for (const [i, stmt] of SCHEMA.entries()) {
        try { await db.query(stmt); } catch (e) {
          failed.push({ i, sql: stmt.replace(/\s+/g, ' ').slice(0, 140), error: String(e && e.message).slice(0, 300) });
          console.error('[스키마 오류]', i, stmt.replace(/\s+/g, ' ').slice(0, 140), e && e.message);
        }
      }
      try { await db.query(FEATURED_SQL); } catch (e) {
        failed.push({ i: 'featured', sql: '추천 캠페인 5개', error: String(e && e.message).slice(0, 300) });
        console.error('[추천 캠페인 오류]', e && e.message);
      }
      module.exports.schemaErrors = failed;
      if (!failed.length) await db.query(`COMMENT ON VIEW v_user_stats IS '${SCHEMA_HASH}'`);
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
    return p && !p.k && Number.isInteger(p.u) && p.e > Date.now() ? p.u : null; // k 가 있는 건 다른 용도(기기 기억) 토큰
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
// 쿠키 여러 개를 같이 줄 수 있게 (출입증 + 기기 기억)
function addCookie(res, c) {
  const prev = res.getHeader ? res.getHeader('Set-Cookie') : (res.headers && res.headers['set-cookie']);
  const list = prev ? [].concat(prev).filter((x) => !x.startsWith(`${c.split('=')[0]}=`)) : [];
  res.setHeader('Set-Cookie', list.concat(c).length === 1 ? c : list.concat(c));
}
function setSession(res, uid, remember = true) {
  const parts = [`${COOKIE}=${makeToken(uid)}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${LONG_DAYS * 86400}`);
  addCookie(res, parts.join('; '));
}
// ── 기기 기억 (로그인 유지): 인증 코드로 한 번 로그인한 브라우저는 다음부터 코드 없이 ──
//  /api/auth 에만 가는 쿠키라 다른 곳에서는 안 보내요. 내용은 회원 번호 + 만료, 서명은 출입증과 같은 방식
const DEVICE_COOKIE = 'pureun_dev';
function setDevice(res, uid) {
  const body = b64(JSON.stringify({ k: 'dev', u: Number(uid), e: Date.now() + LONG_DAYS * 86400000 }));
  addCookie(res, `${DEVICE_COOKIE}=${body}.${sign(body)}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${LONG_DAYS * 86400}`);
}
function deviceUid(req) {
  const [body, sig] = String(cookieOf(req, DEVICE_COOKIE) || '').split('.');
  if (!body || !sig) return null;
  const want = sign(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p && p.k === 'dev' && Number.isInteger(p.u) && p.e > Date.now() ? p.u : null;
  } catch (e) { return null; }
}
function clearSession(res) {
  addCookie(res, `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
const sessionUid = (req) => readToken(cookieOf(req));

const pub = (r) => ({ uid: r.id, provider: r.provider, email: r.email || undefined, name: r.name, role: String(r.role || 'user').trim() });

// 인증 코드는 그대로 저장하지 않고 서명만 (티켓마다 달라요)
const codeHash = (token, code) => crypto.createHmac('sha256', secret()).update(`code:${token}:${code}`).digest('hex');

// ── 로그인 시도 제한 ──
const LOGIN_LIMIT = { perEmail: 5, perIp: 20, minutes: 15 };
const CODE_LIMIT = { minutes: 10, tries: 5, resendSec: 60, perEmailHour: 5, perIpHour: 20 };
// 접속 IP 는 그대로 저장하지 않고 해시로 (같은 곳인지 비교만 해요)
function ipKey(req) {
  const h = (req && req.headers) || {};
  const ip = String(h['x-forwarded-for'] || '').split(',')[0].trim() || String(h['x-real-ip'] || '') || String((req && req.socket && req.socket.remoteAddress) || '');
  return crypto.createHash('sha256').update(`pureun-ip:${secret()}:${ip}`).digest('hex').slice(0, 32);
}

const store = {
  // 막혀 있으면 남은 분, 아니면 0
  async loginWait(email, ip) {
    await init();
    const L = LOGIN_LIMIT;
    const [r] = await sql()`SELECT
        (SELECT COUNT(*) FROM login_attempts WHERE email = ${email} AND at > now() - make_interval(mins => ${L.minutes})) AS fe,
        (SELECT EXTRACT(EPOCH FROM (MAX(at) + make_interval(mins => ${L.minutes}) - now())) FROM login_attempts WHERE email = ${email}) AS we,
        (SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ${ip} AND at > now() - make_interval(mins => ${L.minutes})) AS fi,
        (SELECT EXTRACT(EPOCH FROM (MAX(at) + make_interval(mins => ${L.minutes}) - now())) FROM login_attempts WHERE ip_hash = ${ip}) AS wi`;
    const sec = Math.max(Number(r.fe) >= L.perEmail ? Number(r.we) || 0 : 0, Number(r.fi) >= L.perIp ? Number(r.wi) || 0 : 0);
    return sec > 0 ? Math.max(1, Math.ceil(sec / 60)) : 0;
  },
  // 틀린 기록을 남기고, 이 이메일로 앞으로 몇 번 더 틀릴 수 있는지 알려 줘요
  async loginFail(email, ip) {
    await init();
    await sql()`INSERT INTO login_attempts (email, ip_hash) VALUES (${email}, ${ip})`;
    await sql()`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`;
    const [r] = await sql()`SELECT COUNT(*) AS n FROM login_attempts WHERE email = ${email} AND at > now() - make_interval(mins => ${LOGIN_LIMIT.minutes})`;
    return Math.max(0, LOGIN_LIMIT.perEmail - Number(r.n));
  },
  // ── 이메일 인증 코드 ──
  async codeCreate(row) {
    await init();
    const [r] = await sql()`INSERT INTO email_codes (token, purpose, email, name, pw_hash, user_id, code_hash, ip_hash, expires_at)
      VALUES (${row.token}, ${row.purpose}, ${row.email}, ${row.name || null}, ${row.pw_hash || null}, ${row.user_id || null}, ${row.code_hash}, ${row.ip_hash},
              now() + make_interval(mins => ${CODE_LIMIT.minutes})) RETURNING id`;
    await sql()`DELETE FROM email_codes WHERE created_at < now() - interval '1 day'`;
    return r;
  },
  async codeByToken(token) {
    await init();
    const [r] = await sql()`SELECT *, (expires_at < now()) AS expired, EXTRACT(EPOCH FROM (now() - created_at)) AS age FROM email_codes WHERE token = ${token}`;
    return r || null;
  },
  // 보내기 제한: 아직 안 쓴 코드가 있으면 60초에 1번 · 같은 메일 1시간 5번 · 같은 접속지 1시간 20번
  async codeWait(email, ip) {
    await init();
    const L = CODE_LIMIT;
    const [r] = await sql()`SELECT
        (SELECT EXTRACT(EPOCH FROM (now() - MAX(created_at))) FROM email_codes WHERE email = ${email} AND used_at IS NULL) AS last, -- 이미 인증에 쓴 코드는 빼고
        (SELECT COUNT(*) FROM email_codes WHERE email = ${email} AND created_at > now() - interval '1 hour') AS he,
        (SELECT COUNT(*) FROM email_codes WHERE ip_hash = ${ip} AND created_at > now() - interval '1 hour') AS hi`;
    if (r.last != null && Number(r.last) < L.resendSec) return { sec: Math.ceil(L.resendSec - Number(r.last)) };
    if (Number(r.he) >= L.perEmailHour || Number(r.hi) >= L.perIpHour) return { hour: true };
    return null;
  },
  async codeFail(id) { await sql()`UPDATE email_codes SET attempts = attempts + 1 WHERE id = ${id}`; },
  async codeUse(id) {
    const rows = await sql()`UPDATE email_codes SET used_at = now() WHERE id = ${id} AND used_at IS NULL RETURNING id`;
    return rows.length > 0; // 동시에 두 번 눌러도 한 번만
  },
  async emailTaken(email) {
    await init();
    const [r] = await sql()`SELECT 1 AS x FROM users WHERE provider = 'email' AND (lower(email) = lower(${email}) OR email_canon(email) = email_canon(${email})) LIMIT 1`;
    return !!r;
  },
  async createEmailHashed(name, email, pwHash) {
    await init();
    const rows = await sql()`INSERT INTO users (provider, email, name, pw_hash) VALUES ('email', ${email}, ${name}, ${pwHash}) RETURNING *`;
    return rows[0];
  },
  async loginOk(email) {
    await sql()`DELETE FROM login_attempts WHERE email = ${email}`;
  },
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
      DO UPDATE SET name = CASE WHEN users.name = '카카오 사용자' THEN EXCLUDED.name ELSE users.name END RETURNING *, (xmax = 0) AS inserted`; // inserted: 이번에 처음 만든 계정
    return rows[0];
  },
  async byId(uid) {
    await init();
    const rows = await sql()`SELECT * FROM users WHERE id = ${uid}`;
    return rows[0] || null;
  },
};

module.exports = { hasDb, sql, init, store, checkPw, hashPw, pub, setSession, clearSession, sessionUid, makeToken, readToken, ipKey, LOGIN_LIMIT, CODE_LIMIT, setDevice, deviceUid, codeHash };
