// 관리자: 회원 닉네임 바꾸기 테스트
//  실행: TESTDB=pureun_rn node test/admin-rename.test.cjs  (빈 DB)
process.env.DATABASE_URL = 'postgres://test';
const db = require('../api/_db.cjs');
db._makeSql = require('./pgshim.cjs');
const data = require('../api/data.js');
const signup = require('../api/auth/signup.js');
const sql = () => db.sql();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log(`${cond ? '  ✓' : '  ✗'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : ''}`); };

function call(handler, { method = 'GET', query = {}, body, cookie, headers: extra = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {}, body: undefined,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(n) { this.statusCode = n; return this; },
      json(o) { this.body = o; resolve(this); },
      send(b) { this.body = b; resolve(this); },
      writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); },
      end() { resolve(this); },
    };
    const req = { method, query, body, headers: { host: 'test.local', 'x-forwarded-proto': 'https', cookie: cookie || '', ...extra } };
    handler(req, res);
  });
}
call = require('./auth-auto.cjs')(call).call; // 가입 인증 코드는 자동으로
const cookieFrom = (r) => String(r.headers['set-cookie'] || '').split(';')[0];
const api = (a, cookie, opt = {}) => call(data, { ...opt, query: { a, ...(opt.query || {}) }, cookie });
const post = (a, cookie, body) => api(a, cookie, { method: 'POST', body });

(async () => {
  const join = async (name, email) => cookieFrom(await call(signup, { method: 'POST', body: { name, email, pw: 'password1' } }));
  const kim = await join('김하늘', 'kim@t.kr');
  const boss = await join('관리자', 'boss@t.kr');
  await sql()`UPDATE users SET role = 'admin' WHERE email = 'boss@t.kr'`;
  const kid = String((await sql()`SELECT id FROM users WHERE email = 'kim@t.kr'`)[0].id);
  const bid = String((await sql()`SELECT id FROM users WHERE email = 'boss@t.kr'`)[0].id);

  let r = await post('admin-rename', kim, { id: kid, name: '해커' });
  ok('일반 회원은 바꿀 수 없음 (403)', r.statusCode === 403, r.body);
  r = await post('admin-rename', boss, { id: kid, name: '  푸른바다  ' });
  ok('관리자가 닉네임 바꾸기 (앞뒤 공백 정리)', r.statusCode === 200 && r.body.old === '김하늘' && r.body.name === '푸른바다', r.body);
  ok('DB에 반영', (await sql()`SELECT name FROM users WHERE id = ${kid}`)[0].name === '푸른바다');
  r = await api('sync', kim);
  ok('본인 화면(sync)에도 새 닉네임', r.statusCode === 200 && r.body.user.name === '푸른바다', r.body.user);
  r = await api('admin-users', boss, { query: { q: '푸른' } });
  ok('회원 검색에서 새 닉네임으로 찾힘', r.body.users.some((u) => u.id === kid && u.name === '푸른바다'), r.body.users);
  r = await post('admin-rename', boss, { id: kid, name: '가' });
  ok('1자는 거절', r.statusCode === 400 && /2~12자/.test(r.body.error), r.body);
  r = await post('admin-rename', boss, { id: kid, name: '가나다라마바사아자차카타파' });
  ok('13자는 거절', r.statusCode === 400, r.body);
  r = await post('admin-rename', boss, { id: kid, name: '푸른바다' });
  ok('같은 닉네임은 거절', r.statusCode === 400 && /같은/.test(r.body.error), r.body);
  r = await post('admin-rename', boss, { id: 99999, name: '없는사람' });
  ok('없는 회원은 404', r.statusCode === 404, r.body);
  r = await post('admin-rename', boss, { id: bid, name: '운영자' });
  ok('관리자 자기 닉네임도 바꿀 수 있음 (me 표시)', r.statusCode === 200 && r.body.me === true, r.body);
  r = await post('admin-rename', boss, { id: kid, name: '<b>굵게</b>' });
  ok('태그 글자도 그대로 저장 (화면에서는 글자로만 보여요)', r.statusCode === 200 && (await sql()`SELECT name FROM users WHERE id = ${kid}`)[0].name === '<b>굵게</b>', r.body);

  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(1); });
