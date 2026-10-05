// 보안 테스트: 이동 부정 적립 상한 · 로그인 시도 제한 · 보안 헤더 설정
//  실행: TESTDB=pureun_sec node test/security.test.cjs  (빈 DB)
process.env.DATABASE_URL = 'postgres://test';
const db = require('../api/_db.cjs');
db._makeSql = require('./pgshim.cjs');
const core = require('../api-core.cjs');
const data = require('../api/data.js');
const LIM = require('../api/_data.cjs').TRIP_LIMITS;
const login = require('../api/auth/login.js');
const signup = require('../api/auth/signup.js');
const kakao = require('../api/auth/kakao.js');
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
const cookieFrom = (r) => String(r.headers['set-cookie'] || '').split(';')[0];
const api = (a, cookie, opt = {}) => call(data, { ...opt, query: { a, ...(opt.query || {}) }, cookie });
const post = (a, cookie, body) => api(a, cookie, { method: 'POST', body });
// 카카오 콜백: 카카오 서버 대신 api-core 가 성공 결과를 돌려준 것처럼
async function kakaoLogin(id, name, state = 'st1') {
  const real = core.handle;
  core.handle = async () => ({ status: 302, redirect: `/#kakao=${encodeURIComponent(JSON.stringify({ ok: true, provider: 'kakao', id, name, state }))}` });
  const r = await call(kakao, { query: { code: 'x', state } });
  core.handle = real;
  return r;
}
const hashData = (r) => JSON.parse(decodeURIComponent(r.headers.location.replace('/#kakao=', '')));
const trip = (km, savedG, extra = {}) => ({
  from: { name: '안양역', lat: 37.401, lng: 126.922 }, to: { name: '평촌역', lat: 37.394, lng: 126.963 },
  minutes: 20, savedG, segments: [{ mode: 'bus', km }], ...extra,
});
const n = (v) => Number(v) || 0;
(async () => {
  const fs = require('fs');
  const path = require('path');
  const join = async (name, email) => cookieFrom(await call(signup, { method: 'POST', body: { name, email, pw: 'password1' } }));
  const u = await join('보안테스트', 'sec@t.kr');
  const at = (lat, lng, name = '곳') => ({ name, lat, lng });
  const A = at(37.4016, 126.9227, '안양역'), B = at(37.3943, 126.9636, '평촌역'); // 직선 약 3.7km
  const go = (from, to, segs, minutes, savedG, key) => post('trip', u, { from, to, segments: segs, minutes, savedG, key });

  console.log('1) 이동 기록 부정 적립 막기');
  let r = await go(A, B, [{ mode: 'bus', km: 300 }], 400, 1000, 'far');
  ok('직선 3.7km 구간을 300km 탔다고 하면 거절', r.statusCode === 400 && /거리/.test(r.body.error), r.body);
  r = await go(A, B, [{ mode: 'walk', km: 4.5 }], 5, 900, 'fast');
  ok('4.5km를 5분에 걸었다고 하면 거절 (너무 빠름)', r.statusCode === 400 && /시간/.test(r.body.error), r.body);
  r = await go(A, B, [{ mode: 'walk', km: 0.4 }, { mode: 'bus', km: 4.6 }], 22, 900, 'ok1');
  ok('정상 이동(도보 + 버스 5km, 22분)은 저장', r.statusCode === 200 && r.body.tripId > 0, r.body);
  r = await go(A, B, [{ mode: 'walk', km: 0.4 }, { mode: 'bus', km: 4.6 }], 22, 900, 'ok1');
  ok('같은 기록을 다시 보내면(재전송) 거절 없이 중복 처리', r.statusCode === 200 && r.body.duplicate === true, r.body);
  r = await go(A, B, [{ mode: 'bus', km: 4.6 }], 20, 800, 'again');
  ok('같은 출발·도착을 10분 안에 또 보내면 거절', r.statusCode === 429 && /분 안에/.test(r.body.error), r.body);
  r = await go(B, A, [{ mode: 'bus', km: 4.6 }], 20, 800, 'back');
  ok('돌아오는 길(반대 방향)은 저장', r.statusCode === 200, r.body);

  LIM.perDay = 4;
  r = await go(at(37.48, 126.98), at(37.49, 126.99), [{ mode: 'subway', km: 2 }], 8, 300, 'd3');
  ok('하루 상한 전까지는 저장 (3번째)', r.statusCode === 200, r.body);
  r = await go(at(37.50, 127.00), at(37.51, 127.01), [{ mode: 'subway', km: 2 }], 8, 300, 'd4');
  ok('4번째도 저장', r.statusCode === 200, r.body);
  r = await go(at(37.52, 127.02), at(37.53, 127.03), [{ mode: 'subway', km: 2 }], 8, 300, 'd5');
  ok('하루 상한(4번)을 넘으면 거절', r.statusCode === 429 && /하루/.test(r.body.error), r.body);
  LIM.perDay = 20; LIM.kmPerDay = 20;
  r = await go(at(37.40, 127.10), at(37.40, 127.20), [{ mode: 'subway', km: 9 }], 20, 1800, 'km1');
  ok('하루 거리 상한(20km)을 넘으면 거절 (오늘 13.6km + 9km)', r.statusCode === 429 && /km/.test(r.body.error), r.body);
  LIM.kmPerDay = 150;
  const [cnt] = await sql()`SELECT COUNT(*) AS n FROM trips`;
  ok('거절된 기록은 DB에 안 들어감 (저장된 건 4개)', n(cnt.n) === 4, cnt);

  console.log('2) 로그인 시도 제한');
  const tryLogin = (email, pw, ip = '1.1.1.1') => call(login, { method: 'POST', body: { email, pw }, headers: { 'x-forwarded-for': ip } });
  let last;
  for (let i = 1; i <= 3; i++) last = await tryLogin('sec@t.kr', 'wrong-pass');
  ok('3번 틀리면 "2번 더 틀리면 막혀요" 안내', last.statusCode === 401 && /2번 더/.test(last.body.error), last.body);
  await tryLogin('sec@t.kr', 'wrong-pass');
  last = await tryLogin('sec@t.kr', 'wrong-pass');
  ok('5번째 틀리면 15분 동안 막힘', last.statusCode === 429, last.body);
  last = await tryLogin('sec@t.kr', 'password1');
  ok('막힌 동안은 맞는 비밀번호도 거절', last.statusCode === 429 && /분 뒤/.test(last.body.error), last.body);
  last = await tryLogin('nobody@t.kr', 'x', '1.1.1.1');
  ok('없는 이메일도 똑같이 "맞지 않아요" (가입 여부 안 알려 줌)', last.statusCode === 401 && /맞지 않아요/.test(last.body.error), last.body);
  const [ipRow] = await sql()`SELECT ip_hash FROM login_attempts LIMIT 1`;
  ok('접속 IP는 원래 값 대신 해시로 저장', ipRow && !/1\.1\.1\.1/.test(ipRow.ip_hash) && ipRow.ip_hash.length === 32, ipRow);
  await sql()`UPDATE login_attempts SET at = at - interval '16 minutes'`;
  last = await tryLogin('sec@t.kr', 'password1');
  ok('15분 지나면 다시 로그인 됨', last.statusCode === 200, last.body);
  const [left] = await sql()`SELECT COUNT(*) AS n FROM login_attempts WHERE email = 'sec@t.kr'`;
  ok('로그인 성공하면 그 이메일의 실패 기록 지움', n(left.n) === 0, left);
  for (let i = 0; i < 20; i++) await tryLogin(`ghost${i}@t.kr`, 'x', '9.9.9.9');
  last = await tryLogin('sec@t.kr', 'password1', '9.9.9.9');
  ok('한 접속지에서 20번 틀리면 그 접속지는 잠시 막힘', last.statusCode === 429, last.body);
  last = await tryLogin('sec@t.kr', 'password1', '8.8.8.8');
  ok('다른 접속지는 그대로 로그인 됨', last.statusCode === 200, last.body);

  console.log('3) 보안 헤더 (vercel.json)');
  const vj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const hs = Object.fromEntries(((vj.headers.find((h) => h.source === '/(.*)') || {}).headers || []).map((h) => [h.key, h.value]));
  const csp = hs['Content-Security-Policy'] || '';
  const scriptSrc = (csp.split(';').find((d) => d.trim().startsWith('script-src')) || '');
  ok('CSP: 스크립트는 우리 사이트 + 지도(네이버·카카오)만, 인라인·eval 금지', scriptSrc.includes("'self'") && !/unsafe-inline|unsafe-eval|\*\s|\s\*$|https:\s/.test(scriptSrc + ' '), scriptSrc);
  ok('CSP: 다른 사이트가 우리 앱을 몰래 띄우지 못함 (frame-ancestors none)', /frame-ancestors 'none'/.test(csp) && hs['X-Frame-Options'] === 'DENY');
  ok('nosniff · HSTS · Referrer-Policy · Permissions-Policy', hs['X-Content-Type-Options'] === 'nosniff' && /max-age=\d+/.test(hs['Strict-Transport-Security'] || '') && !!hs['Referrer-Policy'] && /geolocation=\(self\)/.test(hs['Permissions-Policy'] || ''));
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok('앱에 인라인 스크립트·onclick 같은 속성 없음 (CSP 와 충돌 없음)', !/<script>(?!<)|\son(click|load|error)=/.test(appSrc));

  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(1); });
