// 이메일 인증 코드 테스트: 가입 · 로그인 · 로그인 유지(기기 기억) · 보내기 제한 · 메일 보내기
//  실행: TESTDB=pureun_code node test/auth-code.test.cjs  (빈 DB)
process.env.DATABASE_URL = 'postgres://test';
const db = require('../api/_db.cjs');
db._makeSql = require('./pgshim.cjs');
const core = require('../api-core.cjs');
const data = require('../api/data.js');
const code = require('../api/auth/code.js');
const mail = require('../api/_mail.cjs');
const net = require('net');
const outbox = [];
mail._send = async (to, c, purpose) => { outbox.push({ to, code: c, purpose }); };
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
  const cookies = (r) => [].concat(r.headers['set-cookie'] || []);
  const ck = (r, name) => (cookies(r).find((c) => c.startsWith(`${name}=`)) || '');
  const pair = (c) => c.split(';')[0];
  const lastCode = () => outbox[outbox.length - 1].code;
  const verify = (ticket, c, remember = true, cookie = '') => call(code, { method: 'POST', body: { a: 'verify', ticket, code: c, remember }, cookie });
  const users = async () => n((await sql()`SELECT COUNT(*) AS n FROM users`)[0].n);

  console.log('1) 회원가입: 인증해야 가입 완료');
  let r = await call(signup, { method: 'POST', body: { name: '하늘', email: 'Sky.Blue@gmail.com', pw: 'password1' } });
  ok('가입 신청하면 "인증 코드 필요" + 티켓', r.statusCode === 200 && r.body.needCode && r.body.ticket && !r.body.user, r.body);
  ok('메일로 6자리 코드를 보냄', outbox.length === 1 && outbox[0].to === 'sky.blue@gmail.com' && /^\d{6}$/.test(outbox[0].code) && outbox[0].purpose === 'signup', outbox);
  ok('메일 설정이 있으면 화면에 코드를 안 보여 줌', !('demoCode' in r.body));
  ok('인증 전에는 회원이 아님', (await users()) === 0);
  const [row] = await sql()`SELECT code_hash FROM email_codes`;
  ok('코드는 그대로 저장 안 함 (서명만)', row.code_hash !== lastCode() && row.code_hash.length === 64);
  const t1 = r.body.ticket;
  const wrong = lastCode() === '000000' ? '111111' : '000000';
  r = await verify(t1, wrong);
  ok('틀린 코드 → 거절 + 남은 횟수', r.statusCode === 400 && /4번 남음/.test(r.body.error), r.body);
  r = await verify(t1, lastCode());
  ok('맞는 코드 → 가입 완료 + 로그인', r.statusCode === 200 && r.body.user && r.body.user.name === '하늘' && (await users()) === 1, r.body);
  const dev = ck(r, 'pureun_dev'), sid = ck(r, 'pureun_sid');
  ok('로그인 유지: 기기 기억 쿠키 (인증 화면 경로에만, 60일, HttpOnly)', /Path=\/api\/auth/.test(dev) && /Max-Age=5184000/.test(dev) && /HttpOnly/.test(dev) && /Secure/.test(dev), cookies(r));
  ok('출입증 쿠키도 같이', /Max-Age=/.test(sid));
  r = await verify(t1, outbox[0].code);
  ok('같은 코드 두 번 못 씀', r.statusCode === 400 && r.body.restart === true, r.body);
  r = await call(signup, { method: 'POST', body: { name: '복제', email: 's.k.y.b.l.u.e+2@gmail.com', pw: 'password1' } });
  ok('지메일 점(.)·+ 별칭으로 같은 메일함 또 가입 → 거절', r.statusCode === 409 && /같은 메일함/.test(r.body.error), r.body);
  r = await call(signup, { method: 'POST', body: { name: '복제2', email: 'SKY.BLUE@gmail.com', pw: 'password1' } });
  ok('대소문자만 바꿔도 거절', r.statusCode === 409, r.body);

  console.log('2) 로그인: 새 기기는 코드, 로그인 유지한 기기는 바로');
  r = await call(login, { method: 'POST', body: { email: 'sky.blue@gmail.com', pw: 'password1' } });
  ok('기기 기억 없으면 → 인증 코드', r.statusCode === 200 && r.body.needCode && outbox[outbox.length - 1].purpose === 'login', r.body);
  r = await call(login, { method: 'POST', body: { email: 'sky.blue@gmail.com', pw: 'password1' }, cookie: pair(dev) });
  ok('로그인 유지로 인증한 기기 → 코드 없이 바로', r.statusCode === 200 && r.body.user && r.body.trusted === true, r.body);
  r = await call(login, { method: 'POST', body: { email: 'sky.blue@gmail.com', pw: 'wrong-pass' }, cookie: pair(dev) });
  ok('기억된 기기라도 비밀번호가 틀리면 거절', r.statusCode === 401, r.body);
  const sync = await call(data, { query: { a: 'sync' }, cookie: `pureun_sid=${pair(dev).split('=')[1]}` });
  ok('기기 기억 쿠키로는 로그인 출입증을 대신 못 함', sync.statusCode === 401, sync.statusCode);
  r = await call(signup, { method: 'POST', body: { name: '다른사람', email: 'other@naver.com', pw: 'password1' } });
  r = await verify(r.body.ticket, lastCode(), false);
  ok('로그인 유지 끄면 기기 기억 쿠키 없음 + 출입증은 창 닫으면 사라짐', r.statusCode === 200 && !ck(r, 'pureun_dev') && !/Max-Age/.test(ck(r, 'pureun_sid')), cookies(r));
  r = await call(login, { method: 'POST', body: { email: 'other@naver.com', pw: 'password1' }, cookie: pair(dev) });
  ok('다른 사람이 기억한 기기 쿠키로는 코드 생략 안 됨', r.statusCode === 200 && r.body.needCode, r.body);

  console.log('3) 틀림 · 시간 초과 · 다시 받기 제한');
  await sql()`UPDATE email_codes SET created_at = created_at - interval '61 seconds'`; // 바로 앞에서 보낸 코드의 60초 대기 지나게
  r = await call(login, { method: 'POST', body: { email: 'other@naver.com', pw: 'password1' } });
  const t2 = r.body.ticket, c2 = lastCode();
  for (let i = 0; i < 5; i++) await verify(t2, c2 === '123456' ? '654321' : '123456');
  r = await verify(t2, c2);
  ok('5번 틀리면 맞는 코드도 거절 (다시 받아야 함)', r.statusCode === 429 && r.body.expired, r.body);
  r = await call(code, { method: 'POST', body: { a: 'resend', ticket: t2 } });
  ok('방금 보냈으면 60초 동안 다시 받기 안 됨', r.statusCode === 429 && r.body.wait > 0 && r.body.wait <= 60, r.body);
  await sql()`UPDATE email_codes SET created_at = created_at - interval '61 seconds'`;
  r = await call(code, { method: 'POST', body: { a: 'resend', ticket: t2 } });
  ok('60초 지나면 새 코드 + 새 티켓', r.statusCode === 200 && r.body.ticket && r.body.ticket !== t2, r.body);
  const t3 = r.body.ticket, c3 = lastCode();
  r = await verify(t2, c3);
  ok('다시 받으면 예전 티켓은 못 씀', r.statusCode === 400 && r.body.restart, r.body);
  await sql()`UPDATE email_codes SET expires_at = now() - interval '1 second' WHERE token = ${t3}`;
  r = await verify(t3, c3);
  ok('10분 지나면 시간 초과', r.statusCode === 400 && /유효 시간/.test(r.body.error) && r.body.expired, r.body);
  await sql()`DELETE FROM email_codes`;
  for (let i = 0; i < 5; i++) {
    await call(signup, { method: 'POST', body: { name: '많이', email: 'spam@test.kr', pw: 'password1' } });
    await sql()`UPDATE email_codes SET created_at = created_at - interval '61 seconds'`;
  }
  r = await call(signup, { method: 'POST', body: { name: '많이', email: 'spam@test.kr', pw: 'password1' } });
  ok('같은 메일로 1시간에 5번 넘게 요청 → 거절', r.statusCode === 429 && /1시간/.test(r.body.error), r.body);
  const [bk] = await sql()`SELECT COUNT(*) AS n FROM users WHERE provider = 'email' AND trim(role) <> 'user'`;
  ok('가입·인증으로 관리자가 생기지 않음', n(bk.n) === 0);

  console.log('4) 메일 설정 전 = 시연 모드');
  mail._send = null;
  r = await call(signup, { method: 'POST', body: { name: '시연', email: 'demo@test.kr', pw: 'password1' } });
  ok('메일 설정 없으면 화면에 코드를 보여 줌 (demoCode)', r.statusCode === 200 && /^\d{6}$/.test(r.body.demoCode), r.body);
  r = await verify(r.body.ticket, r.body.demoCode);
  ok('시연 코드로도 가입 완료', r.statusCode === 200 && r.body.user, r.body);

  console.log('5) Gmail 보내기 (가짜 메일 서버로 대화 확인)');
  const got = { lines: [], data: '' };
  const srv = net.createServer((s) => {
    s.setEncoding('utf8');
    let inData = false, buf = '';
    s.write('220 fake ESMTP\r\n');
    s.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; s.write('250 ok queued\r\n'); } else got.data += `${line}\n`; continue; }
        got.lines.push(line);
        if (/^EHLO/.test(line)) s.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') s.write('334 VXNlcm5hbWU6\r\n');
        else if (got.lines.length === 3) s.write('334 UGFzc3dvcmQ6\r\n');
        else if (got.lines.length === 4) s.write('235 ok\r\n');
        else if (/^MAIL FROM|^RCPT TO/.test(line)) s.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; s.write('354 go\r\n'); }
        else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
      }
    });
  });
  await new Promise((res) => srv.listen(0, res));
  Object.assign(process.env, { GMAIL_USER: 'bluesky.app@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(srv.address().port), SMTP_PLAIN: '1' });
  ok('GMAIL_USER · GMAIL_APP_PASSWORD 가 있으면 설정됨', mail.configured());
  const sent = await mail.sendCode('friend@naver.com', '482915', 'login');
  srv.close();
  const b64d = (s) => Buffer.from(s, 'base64').toString('utf8');
  ok('보내기 성공', sent.sent === true, sent);
  ok('앱 비밀번호로 로그인 (띄어쓰기는 빼고)', b64d(got.lines[2]) === 'bluesky.app@gmail.com' && b64d(got.lines[3]) === 'abcdefghijklmnop', got.lines.slice(0, 4));
  ok('받는 사람', got.lines.includes('RCPT TO:<friend@naver.com>'), got.lines);
  const subj = (got.data.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m) || [])[1];
  ok('제목에 코드 (한글 제목 인코딩)', subj && b64d(subj) === '[푸른하늘] 로그인 인증 코드 482915', subj && b64d(subj));
  const parts = got.data.split(/--pureun-[a-z0-9]+/);
  const plain = parts.find((p) => p.includes('text/plain'));
  ok('본문에 코드', plain && b64d(plain.split('\n\n').slice(1).join('').replace(/\s+/g, '')).includes('482915'));

  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(1); });
