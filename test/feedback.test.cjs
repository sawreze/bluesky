// 의견 보내기 테스트: 사용자 → 관리자 (보내기 · 도배 막기 · 내 목록 · 관리자 목록 · 확인함/처리 완료 · 삭제)
//  실행: TESTDB=pureun_fb node test/feedback.test.cjs  (빈 DB)
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
  const lee = await join('이바다', 'lee@t.kr');
  const boss = await join('관리자', 'boss@t.kr');
  await sql()`UPDATE users SET role = 'admin' WHERE email = 'boss@t.kr'`;

  console.log('1) 보내기');
  let r = await post('feedback-send', kim, { kind: 'bug', body: '  길찾기에서 도착했는데\n\n\n\n기록이 안 올라가요  ' });
  ok('오류 신고 보내기', r.statusCode === 200 && r.body.ok, r.body);
  const [row] = await sql()`SELECT kind, body, read_at, done_at FROM feedback`;
  ok('앞뒤 공백은 지우고 빈 줄은 한 줄로 줄여 저장', row.body === '길찾기에서 도착했는데\n\n기록이 안 올라가요' && row.kind === 'bug' && !row.read_at && !row.done_at, row);
  r = await post('feedback-send', kim, { kind: 'idea', body: '짧' });
  ok('5자보다 짧으면 거절', r.statusCode === 400 && /5자/.test(r.body.error), r.body);
  r = await post('feedback-send', kim, { kind: 'idea', body: '가'.repeat(501) });
  ok('500자를 넘으면 거절', r.statusCode === 400 && /500자/.test(r.body.error), r.body);
  r = await post('feedback-send', kim, { kind: 'hack', body: '이상한 종류의 의견입니다' });
  ok('정해진 종류(오류·고칠 점·기타)가 아니면 거절', r.statusCode === 400, r.body);
  r = await post('feedback-send', '', { kind: 'idea', body: '로그인 없이 보내 보기' });
  ok('로그인하지 않으면 보낼 수 없음', r.statusCode === 401, r.body);
  r = await post('feedback-send', kim, { kind: 'bug', body: '길찾기에서 도착했는데\n\n기록이 안 올라가요' });
  ok('같은 내용을 또 보내면 거절 (하루 안)', r.statusCode === 400 && /이미 보냈/.test(r.body.error), r.body);
  r = await post('feedback-send', kim, { kind: 'idea', body: '<img src=x onerror=alert(1)> 이런 글자도 그대로 저장돼요' });
  ok('태그 같은 글자도 그대로 저장 (화면에서 안전하게 보여 주는 건 app.js)', r.statusCode === 200, r.body);

  console.log('2) 도배 막기 (한 사람이 1시간에 5개)');
  for (let i = 3; i <= 5; i++) r = await post('feedback-send', kim, { kind: 'etc', body: `의견 번호 ${i}번 입니다` });
  ok('5번째까지는 저장', r.statusCode === 200, r.body);
  r = await post('feedback-send', kim, { kind: 'etc', body: '여섯 번째 의견입니다' });
  ok('6번째는 잠시 뒤에 (429)', r.statusCode === 429 && /자주/.test(r.body.error), r.body);
  r = await post('feedback-send', lee, { kind: 'idea', body: '다른 사람은 따로 세요' });
  ok('다른 사람은 따로 세어서 보낼 수 있음', r.statusCode === 200, r.body);
  await sql()`UPDATE feedback SET created_at = now() - interval '2 hours' WHERE user_id = (SELECT id FROM users WHERE email = 'kim@t.kr')`;
  r = await post('feedback-send', kim, { kind: 'etc', body: '한 시간이 지나면 다시 보낼 수 있어요' });
  ok('1시간이 지나면 다시 보낼 수 있음', r.statusCode === 200, r.body);

  console.log('3) 내가 보낸 의견');
  r = await api('feedback-mine', lee);
  ok('내 의견만 보이고 상태는 "new"', r.statusCode === 200 && r.body.items.length === 1 && r.body.items[0].status === 'new' && r.body.items[0].kind === 'idea', r.body);
  r = await api('feedback-mine', kim);
  ok('최신순으로 최대 10개', r.body.items.length <= 10 && r.body.items.length === 6 && r.body.items[0].body.includes('한 시간이'), r.body.items.map((x) => x.body.slice(0, 8)));

  console.log('4) 관리자 목록');
  r = await api('feedback-list', kim, { query: { f: 'new' } });
  ok('일반 회원은 목록을 볼 수 없음 (403)', r.statusCode === 403, r.body);
  r = await api('feedback-list', boss, { query: { f: 'new' } });
  ok('관리자는 안 읽은 의견 7개 (김하늘 6 + 이바다 1)', r.statusCode === 200 && r.body.items.length === 7 && r.body.newCount === 7 && r.body.total === 7, [r.body.items && r.body.items.length, r.body.newCount, r.body.total]);
  const first = r.body.items[0];
  ok('보낸 사람 닉네임·이메일이 함께 옴', first.name === '김하늘' && first.email === 'kim@t.kr', first);
  r = await api('sync', boss);
  ok('관리자 sync 에 안 읽은 의견 수(feedbackNew)가 들어 있음', r.statusCode === 200 && r.body.feedbackNew === 7, r.body.feedbackNew);
  r = await api('sync', kim);
  ok('일반 회원 sync 에는 없음', r.statusCode === 200 && r.body.feedbackNew === undefined, r.body.feedbackNew);

  console.log('5) 확인함 · 처리 완료 · 삭제');
  r = await post('feedback-set', kim, { id: first.id, to: 'read' });
  ok('일반 회원은 상태를 바꿀 수 없음 (403)', r.statusCode === 403, r.body);
  r = await post('feedback-set', boss, { id: first.id, to: 'read' });
  ok('확인함으로 바꾸기', r.statusCode === 200, r.body);
  r = await api('feedback-list', boss, { query: { f: 'new' } });
  ok('확인한 의견은 "안 읽음" 목록에서 빠짐 (6개)', r.body.items.length === 6 && r.body.newCount === 6 && r.body.total === 7, [r.body.items.length, r.body.newCount]);
  r = await api('feedback-list', boss, { query: { f: 'all' } });
  ok('"전체" 목록에는 그대로 있고 상태가 read', r.body.items.length === 7 && r.body.items.find((x) => x.id === first.id).status === 'read', r.body.items.map((x) => x.status));
  r = await post('feedback-set', boss, { id: first.id, to: 'done' });
  ok('처리 완료로 바꾸기', r.statusCode === 200, r.body);
  r = await api('feedback-mine', kim);
  ok('보낸 사람 화면에서도 상태가 "done" 으로 보임', r.body.items.some((x) => x.id === first.id && x.status === 'done'), r.body.items.map((x) => x.status));
  r = await post('feedback-set', boss, { id: first.id, to: 'new' });
  r = await api('feedback-list', boss, { query: { f: 'new' } });
  ok('다시 "안 읽음"으로 되돌리기', r.body.items.length === 7, r.body.items.length);
  r = await post('feedback-set', boss, { all: true, to: 'read' });
  ok('모두 확인함 처리', r.statusCode === 200 && r.body.count === 7, r.body);
  r = await api('feedback-list', boss, { query: { f: 'new' } });
  ok('안 읽음 0개', r.body.items.length === 0 && r.body.newCount === 0, r.body);
  r = await post('feedback-set', boss, { id: 99999, to: 'read' });
  ok('없는 의견은 404', r.statusCode === 404, r.body);
  r = await post('feedback-set', boss, { id: first.id, to: 'weird' });
  ok('이상한 상태값은 거절', r.statusCode === 400, r.body);
  r = await post('feedback-del', kim, { id: first.id });
  ok('일반 회원은 지울 수 없음 (403)', r.statusCode === 403, r.body);
  r = await post('feedback-del', boss, { id: first.id });
  ok('관리자는 의견 삭제', r.statusCode === 200, r.body);
  const [left] = await sql()`SELECT COUNT(*) AS n FROM feedback`;
  ok('삭제 후 6개 남음', Number(left.n) === 6, left);

  console.log('6) 회원이 지워지면 그 사람 의견도 함께');
  const lid = (await sql()`SELECT id FROM users WHERE email = 'lee@t.kr'`)[0].id;
  r = await post('admin-del-user', boss, { id: lid });
  const [left2] = await sql()`SELECT COUNT(*) AS n FROM feedback WHERE user_id = ${lid}`;
  ok('회원 삭제 시 의견도 같이 지워짐', r.statusCode === 200 && Number(left2.n) === 0, left2);

  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(1); });
