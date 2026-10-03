// =====================================================================
//  회원 DB (Vercel Postgres = Neon). 연결 주소는 환경변수 DATABASE_URL (없으면 POSTGRES_URL)
//  비밀번호는 절대 그대로 저장하지 않고 scrypt 로 암호화(해시)해서 저장해요.
// =====================================================================
const crypto = require('crypto');

function dbUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || '';
}
const hasDb = () => dbUrl().length > 0;

let sqlClient = null;
let ready = null;
function sql() {
  if (!sqlClient) sqlClient = require('@neondatabase/serverless').neon(dbUrl());
  return sqlClient;
}
// 표·뷰가 없으면 db/schema.sql 대로 만들어요 (서버가 켜질 때 한 번만 확인).
//  마지막 뷰(v_user_stats)가 이미 있으면 이미 만들어진 것으로 보고 건너뛰어요.
const SCHEMA = require('./_schema.cjs');
function init() {
  if (!ready) {
    ready = (async () => {
      const db = sql();
      const [chk] = await db.query("SELECT to_regclass('public.v_user_stats') IS NOT NULL AS ok");
      if (chk && chk.ok) return;
      for (const stmt of SCHEMA) await db.query(stmt);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

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

const pub = (r) => ({ id: r.id, provider: r.provider, email: r.email || undefined, name: r.name, role: r.role || 'user' });

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
  async upsertSocial(provider, providerId, name) {
    await init();
    const rows = await sql()`INSERT INTO users (provider, provider_id, name) VALUES (${provider}, ${providerId}, ${name})
      ON CONFLICT (provider, provider_id) WHERE provider_id IS NOT NULL DO UPDATE SET name = EXCLUDED.name RETURNING *`;
    return rows[0];
  },
};

module.exports = { hasDb, store, checkPw, pub };
