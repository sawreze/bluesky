// 서버 API 전체 흐름 테스트 (진짜 Postgres, 테스트 전용 shim)
//  실행: TESTDB=pureun_app node test/api.test.cjs
process.env.DATABASE_URL = 'postgres://test';
const db = require('../api/_db.cjs');
db._makeSql = require('./pgshim.cjs');
const core = require('../api-core.cjs');
const data = require('../api/data.js');
require('../api/_data.cjs').TRIP_LIMITS.off = true; // 이 테스트는 보상·흐름 확인용이라 큰 가짜 이동을 써요 (부정 적립 상한은 security.test.cjs 에서)
const login = require('../api/auth/login.js');
const signup = require('../api/auth/signup.js');
const kakao = require('../api/auth/kakao.js');
const sql = () => db.sql();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log(`${cond ? '  ✓' : '  ✗'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : ''}`); };

function call(handler, { method = 'GET', query = {}, body, cookie } = {}) {
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
    const req = { method, query, body, headers: { host: 'test.local', 'x-forwarded-proto': 'https', cookie: cookie || '' } };
    handler(req, res);
  });
}
call = require('./auth-auto.cjs')(call).call; // 가입·로그인 인증 코드는 자동으로
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
// 보상 배수 · 이달의 절약왕 보너스 · 포인트 상점 테스트
//  실행: TESTDB=pureun_shop node test/shop-award.test.cjs  (빈 DB)
(async () => {
  const join = async (name, email) => cookieFrom(await call(signup, { method: 'POST', body: { name, email, pw: 'password1' } }));
  const r0 = await kakaoLogin('5117762656', '관리자');
  const admin = cookieFrom(r0);
  await sql()`UPDATE users SET role = 'admin' WHERE provider = 'kakao'`;
  const maker = await join('만든이', 'maker@t.kr');
  const a = await join('가람', 'a@t.kr');
  const b2 = await join('나래', 'b@t.kr');
  const c3 = await join('다온', 'c@t.kr');
  const d4 = await join('라온', 'd@t.kr');

  console.log('1) 캠페인 보상 배수 (최종 달성률)');
  const mk = async (goal, title) => {
    const r = await post('camp-save', maker, { tag: 'transit', mode: 'bus', title, sub: '', body: '버스를 타고 출근해서 탄소를 줄여 보아요. 함께해요!', goalKg: goal });
    await post('camp-review', admin, { id: r.body.id, decision: 'approved' });
    return r.body.id;
  };
  const cases = [[100, 125000, 3, 12], [100, 160000, 4, 15], [100, 210000, 5, 20], [100, 100000, 2, 10]];
  const ids = [];
  for (const [i, [goal, g]] of cases.entries()) {
    const id = await mk(goal, `배수 테스트 ${i}`);
    ids.push(id);
    for (let k = 0, left = g; left > 0; k++, left -= 100000) await post('trip', a, trip(300, Math.min(100000, left), { key: `t${i}-${k}`, campaignId: id })); // 이동 1번에 인정되는 양에 상한이 있어서 나눠요
  }
  const small = await mk(50, '작은 목표');
  await post('trip', a, trip(300, 80000, { key: 'small', campaignId: small }));
  await sql()`UPDATE trips SET arrived_at = arrived_at - interval '8 days' WHERE campaign_id IS NOT NULL`;
  await api('sync', a);
  for (const [i, [goal, g, cm, pm]] of cases.entries()) {
    const rows = await sql()`SELECT reason, amount FROM point_transactions WHERE campaign_id = ${Number(ids[i])} ORDER BY reason`;
    const mkr = rows.find((x) => x.reason === 'campaign_reward'); const mem = rows.find((x) => x.reason === 'campaign_bonus');
    ok(`달성률 ${g / goal / 10}% → 만든 사람 ×${cm} = ${goal * cm}P, 참여자 ×${pm} = ${Math.round(g / 1000 * pm)}P`,
      mkr && n(mkr.amount) === goal * cm && mem && n(mem.amount) === Math.round(g / 1000 * pm), rows);
  }
  ok('목표 100kg 미만 캠페인은 보상 없음', n((await sql()`SELECT COUNT(*) AS n FROM point_transactions WHERE campaign_id = ${Number(small)}`)[0].n) === 0);
  const end = await sql()`SELECT (p.created_at - x.arrived_at) AS d FROM point_transactions p, (SELECT MAX(arrived_at) AS arrived_at FROM trips WHERE campaign_id = ${Number(ids[3])}) x WHERE p.campaign_id = ${Number(ids[3])} LIMIT 1`;
  ok('지급 시각 = 목표 달성 + 7일', /^7 days/.test(String(end[0].d)), end);
  await api('sync', a);
  ok('두 번 들어와도 한 번만 정산', n((await sql()`SELECT COUNT(*) AS n FROM point_transactions WHERE reason IN ('campaign_reward','campaign_bonus')`)[0].n) === 8);

  console.log('2) 이달의 절약왕 보너스 (지난달 1·2·3등)');
  const last = `date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '10 days'`;
  await sql()`DELETE FROM point_transactions WHERE reason = 'monthly_award'`; // 위에서 들어올 때 이미 처리된 지난달 보너스는 지우고 다시
  for (const [email, pts] of [['b@t.kr', 900], ['c@t.kr', 700], ['d@t.kr', 500], ['maker@t.kr', 100]]) {
    await sql().query(`INSERT INTO point_transactions (user_id, amount, reason, created_at) SELECT id, ${pts}, 'admin_grant', (${last}) AT TIME ZONE 'Asia/Seoul' FROM users WHERE email = '${email}'`);
  }
  // 정산 중 지난달 보상(가람의 캠페인 보상 등)이 들어갔을 수 있어서 지난달 순위를 직접 계산해 비교해요
  const want = await sql()`SELECT u.name, SUM(p.amount) AS s FROM point_transactions p JOIN users u ON u.id = p.user_id
    WHERE to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = to_char((now() AT TIME ZONE 'Asia/Seoul') - interval '1 month', 'YYYY-MM')
      AND p.reason NOT IN ('monthly_award', 'shop') GROUP BY u.name ORDER BY s DESC, u.name LIMIT 3`;
  let s = (await api('sync', b2)).body;
  const aw = await sql()`SELECT u.name, p.amount FROM point_transactions p JOIN users u ON u.id = p.user_id WHERE p.reason = 'monthly_award' ORDER BY p.amount DESC`;
  ok('지난달 1·2·3등에게 1000 · 500 · 300P', aw.length === 3 && aw.map((x) => x.name).join() === want.map((x) => x.name).join() && aw.map((x) => n(x.amount)).join() === '1000,500,300', { aw, want });
  ok('랭킹 화면용 지난달 절약왕 목록', s.lastAwards.length === 3 && s.lastAwards[0].points === 1000, s.lastAwards);
  await api('sync', c3); await api('sync', admin);
  ok('여러 번 들어와도 한 번만 지급', n((await sql()`SELECT COUNT(*) AS n FROM point_transactions WHERE reason = 'monthly_award'`)[0].n) === 3);
  ok('보너스는 이번 달 순위 포인트에 안 들어가요 (이번 달 활동 없는 나래는 순위에 없음)', !s.rank.users.some((u) => u.name === '나래'), s.rank.users);

  console.log('3) 포인트 상점');
  await post('admin-points', admin, { amount: 5000, name: '나래' });
  s = (await api('sync', b2)).body;
  ok('상품 12개(푸름이 굿즈 포함, 예전 텀블러 제외), 모두 1만 원 이하', s.shop.items.length === 12 && !s.shop.items.some((i) => i.code === 'tumbler') && s.shop.items.every((i) => i.price > 0 && i.price <= 10000), s.shop.items);
  ok('처음엔 교환 내역 없음', s.shop.orders.length === 0);
  const bal0 = s.points; const month0 = JSON.stringify(s.monthPoints); const rank0 = s.rank.users.map((u) => `${u.name}:${u.points}`).join();
  let r = await post('shop-buy', b2, { code: 'coffee' });
  ok('아메리카노 4,500P 교환', r.statusCode === 200 && r.body.order.price === 4500 && r.body.points === bal0 - 4500 && /^\d{12}$/.test(r.body.order.coupon), r.body);
  r = await post('shop-buy', b2, { code: 'tree-donate' });
  ok(`잔액 부족이면 거부 (${(bal0 - 4500).toLocaleString()}P < 10,000P)`, bal0 - 4500 < 10000 ? r.statusCode === 409 : r.statusCode === 200, r.body);
  r = await post('shop-buy', b2, { code: 'nope' });
  ok('없는 상품 404', r.statusCode === 404);
  s = (await api('sync', b2)).body;
  ok('교환 내역에 남음 + 잔액 줄어듦', s.shop.orders.length === 1 && s.shop.orders[0].name === '아메리카노 교환권' && s.points === bal0 - 4500, s.shop.orders);
  ok('상점 사용은 이번 달 순위 포인트에 영향 없음', JSON.stringify(s.monthPoints) === month0 && s.rank.users.map((u) => `${u.name}:${u.points}`).join() === rank0, { m: s.monthPoints, month0 });
  r = await post('shop-buy', d4, { code: 'bike-day' });
  ok('포인트 없는 회원(라온, 보너스 300P)은 1,000P 상품 못 바꿈', r.statusCode === 409, r.body);
  ok('음수 잔액 없음', n((await sql()`SELECT COUNT(*) AS n FROM v_user_stats WHERE points < 0`)[0].n) === 0);
  await post('admin-points', admin, { amount: 20000, name: '나래' });
  r = await post('shop-buy', b2, { code: 'cloud-cushion' });
  ok('푸름이 쿠션: 굿즈샵 쿠폰 코드 PUREUM-XXXX-XXXX', r.statusCode === 200 && /^PUREUM-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.body.order.coupon) && r.body.order.voucher === 'code', r.body);
  r = await post('shop-buy', b2, { code: 'tumbler' });
  ok('예전 푸른하늘 텀블러는 판매 중지', r.statusCode === 404, r.body);
  r = await post('shop-buy', '', { code: 'coffee' });
  ok('로그인 안 하면 401', r.statusCode === 401);

  console.log('4) 관리자 포인트 삭제: 상점에서 다 써서 보유 0P여도 이번 달 탄소 포인트에서 빼요');
  const e5 = await join('마루', 'e@t.kr');
  await post('admin-points', admin, { amount: 5000, name: '마루' });
  for (let i = 0; i < 5; i++) await post('shop-buy', e5, { code: 'bike-day' });
  const mk5 = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  let s5 = (await api('sync', e5)).body;
  ok('준비: 보유 0P · 이번 달 5,000P', s5.points === 0 && s5.monthPoints[mk5()] === 5000, { p: s5.points, m: s5.monthPoints });
  r = await post('admin-points', admin, { amount: 2000, name: '마루', mode: 'deduct' });
  ok('보유 0P여도 삭제 됨 (이번 달 5,000 → 3,000P)', r.statusCode === 200 && r.body.amount === 2000 && r.body.total === 0 && r.body.month === 3000, r.body);
  r = await post('admin-points', admin, { amount: 99999, name: '마루', mode: 'deduct' });
  ok('남은 것보다 많이 빼면 남은 만큼만 (3,000P)', r.statusCode === 200 && r.body.amount === 3000 && r.body.month === 0 && r.body.total === 0, r.body);
  r = await post('admin-points', admin, { amount: 100, name: '마루', mode: 'deduct' });
  ok('둘 다 0P면 뺄 포인트 없음', r.statusCode === 400 && /뺄 포인트가 없어요/.test(r.body.error), r.body);
  s5 = (await api('sync', e5)).body;
  ok('순위에서도 줄어듦 · 보유 포인트는 음수 안 됨', s5.points === 0 && n(s5.monthPoints[mk5()]) === 0, { p: s5.points, m: s5.monthPoints });
  await post('admin-points', admin, { amount: 1000, name: '마루' });
  r = await post('admin-points', admin, { amount: 400, name: '마루', mode: 'deduct' });
  ok('보유 포인트가 있으면 보유에서 먼저 (1,000 → 600P, 이번 달도 600P)', r.statusCode === 200 && r.body.total === 600 && r.body.month === 600, r.body);
  r = await post('shop-buy', e5, { code: 'bike-day' });
  ok('순위에서만 뺀 포인트는 상점 잔액에 영향 없음 (600P로 1,000P 상품 못 삼)', r.statusCode === 409, r.body);
  ok('음수 잔액 없음 (마지막 확인)', n((await sql()`SELECT COUNT(*) AS n FROM v_user_stats WHERE points < 0`)[0].n) === 0);

  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(1); });
