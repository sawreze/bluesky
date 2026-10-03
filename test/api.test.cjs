// 서버 API 전체 흐름 테스트 (진짜 Postgres, 테스트 전용 shim)
//  실행: TESTDB=pureun_app node test/api.test.cjs
process.env.DATABASE_URL = 'postgres://test';
const db = require('../api/_db.cjs');
db._makeSql = require('./pgshim.cjs');
const core = require('../api-core.cjs');
const data = require('../api/data.js');
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
  minutes: 20, savedG, segments: [{ mode: 'walk', km: 0.5 }, { mode: 'bus', km }], ...extra,
});

(async () => {
  console.log('1) 로그인 · 출입증');
  let r = await api('sync', '');
  ok('출입증 없으면 401 + 다시 로그인', r.statusCode === 401 && r.body.relogin, r.body);

  r = await kakaoLogin('5117762656', '임해인');
  const admin = cookieFrom(r);
  let d = hashData(r);
  ok('카카오 로그인 → 기존 1번 회원 + 출입증', d.ok && d.uid === 1 && admin.startsWith('pureun_sid='), d);
  ok('관리자 role 줄바꿈이 있어도 admin', d.role === 'admin', d);
  ok('기본 이름이면 카카오 닉네임으로 바뀜', d.name === '임해인', d);
  ok('로그인 유지 → 60일 쿠키', /Max-Age=5184000/.test(r.headers['set-cookie']) && /HttpOnly/.test(r.headers['set-cookie']));
  const [cnt] = await sql()`SELECT COUNT(*) AS n FROM users`;
  ok('다시 로그인해도 회원이 늘지 않음', Number(cnt.n) === 2, cnt);
  ok('설계 지문이 기록됨 (다음부터 건너뜀)', (await sql()`SELECT obj_description(to_regclass('public.v_user_stats'),'pg_class') AS v`)[0].v.length === 16);
  ok('새 칸 client_key 생김 (설계 변경 자동 반영)', (await sql()`SELECT 1 FROM information_schema.columns WHERE table_name='trips' AND column_name='client_key'`).length === 1);

  r = await kakaoLogin('5119116494', '하늘', 'st2.r0');
  ok('로그인 유지 안 함 → 브라우저 닫으면 사라지는 쿠키', !/Max-Age/.test(r.headers['set-cookie']), r.headers['set-cookie']);
  const sky = cookieFrom(r);

  r = await call(signup, { method: 'POST', body: { name: '김지민', email: 'Jimin@Test.kr', pw: 'password1' } });
  ok('이메일 가입 → 출입증', r.statusCode === 200 && cookieFrom(r).startsWith('pureun_sid='), r.body);
  r = await call(signup, { method: 'POST', body: { name: '가짜', email: 'jimin@test.kr', pw: 'password1' } });
  ok('같은 이메일 다시 가입 → 409', r.statusCode === 409, r.body);
  r = await call(login, { method: 'POST', body: { email: 'jimin@test.kr', pw: 'wrongpass1' } });
  ok('비밀번호 틀림 → 401, 쿠키 없음', r.statusCode === 401 && !r.headers['set-cookie']);
  r = await call(login, { method: 'POST', body: { email: 'JIMIN@test.kr', pw: 'password1' } });
  const jimin = cookieFrom(r);
  ok('이메일 로그인 → 출입증', r.statusCode === 200 && jimin.startsWith('pureun_sid='), r.body);

  r = await api('sync', jimin.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')));
  ok('출입증을 조금이라도 고치면 401', r.statusCode === 401);
  r = await api('sync', `pureun_sid=${db.makeToken(1).split('.')[0]}.fakesig`);
  ok('남의 번호로 출입증을 흉내 내면 401', r.statusCode === 401);

  console.log('2) 캠페인 만들기 → 검토');
  const body = '주말에 공원이나 한강 갈 때 버스 타고 가 봐요. 근교는 대부분 버스로 충분해요.';
  r = await post('camp-save', jimin, { tag: 'transit', mode: 'bus', title: '버스로 출근하기', sub: '부제', body, goalKg: 100, cover: 'data:image/jpeg;base64,/9j/AAAA' });
  ok('캠페인 만들기', r.statusCode === 200 && r.body.id, r.body);
  const campId = r.body.id;
  r = await post('camp-save', jimin, { tag: 'transit', mode: 'car', title: 'x', body, goalKg: 100 });
  ok('자동차 캠페인은 거부', r.statusCode === 400, r.body);
  r = await post('camp-save', jimin, { tag: 'transit', mode: 'bus', title: 'x', body: '짧아요', goalKg: 100 });
  ok('글 20자 미만 거부', r.statusCode === 400, r.body);

  r = await api('sync', sky);
  ok('검토 전 캠페인은 다른 사람에게 안 보임', !r.body.camps.some((c) => c.id === campId), r.body.camps);
  r = await api('sync', jimin);
  let c = r.body.camps.find((x) => x.id === campId);
  ok('만든 사람에게는 검토 중으로 보임 + 자동 참여', c && c.status === 'pending' && c.mine && c.ownerId === '@me' && c.joined && c.participants === 1, c);
  ok('표지 사진 주소', c && /^\/api\/data\?a=img&k=c&id=\d+&v=\d+$/.test(c.cover), c && c.cover);
  r = await api('img', '', { query: { k: 'c', id: campId } });
  ok('표지 사진 받기 (로그인 없이, 오래 캐시)', r.statusCode === 200 && r.headers['content-type'] === 'image/jpeg' && /immutable/.test(r.headers['cache-control']), r.headers);

  r = await post('camp-review', sky, { id: campId, decision: 'approved' });
  ok('관리자 아니면 검토 불가 (403)', r.statusCode === 403, r.body);
  r = await post('camp-review', admin, { id: campId, decision: 'rejected' });
  ok('반려는 사유 필수', r.statusCode === 400, r.body);
  r = await api('sync', admin);
  ok('관리자에게는 검토 중 캠페인도 보임', r.body.camps.some((x) => x.id === campId && x.status === 'pending'));
  r = await post('camp-review', admin, { id: campId, decision: 'rejected', reason: '설명이 짧아요' });
  ok('반려', r.statusCode === 200, r.body);
  c = (await api('sync', jimin)).body.camps.find((x) => x.id === campId);
  ok('만든 사람: 반려 + 사유 + 알림', c.status === 'rejected' && c.rejectReason === '설명이 짧아요' && c.notice && c.notice.type === 'rejected', c);
  await post('camp-seen', jimin, { id: campId });
  c = (await api('sync', jimin)).body.camps.find((x) => x.id === campId);
  ok('알림 확인하면 다시 안 뜸', c.notice === null, c);
  r = await post('camp-save', sky, { id: campId, tag: 'transit', mode: 'bus', title: '남의 것', body, goalKg: 100, cover: c.cover });
  ok('남의 캠페인은 못 고침 (403)', r.statusCode === 403, r.body);
  r = await post('camp-save', jimin, { id: campId, tag: 'transit', mode: 'bus', title: '버스로 출근하기 (수정)', body, goalKg: 100, cover: c.cover });
  c = (await api('sync', jimin)).body.camps.find((x) => x.id === campId);
  ok('고쳐서 다시 신청 → 검토 중, 예전 사유 안 보임, 사진 유지', c.status === 'pending' && c.rejectReason === '' && c.title.endsWith('(수정)') && c.cover, c);
  await post('camp-review', admin, { id: campId, decision: 'approved' });
  c = (await api('sync', sky)).body.camps.find((x) => x.id === campId);
  ok('승인되면 모두에게 보임', c && c.status === 'approved' && c.ownerId !== '@me' && c.creator === '김지민', c);
  r = await call(signup, { method: 'POST', body: { name: '참여테스트', email: 'joiner@test.kr', pw: 'password1' } });
  const newbieJ = cookieFrom(r);
  r = await post('camp-join', newbieJ, { id: '999999' });
  ok('없는 캠페인 참여 불가', r.statusCode === 400, r.body);

  console.log('2-1) 참여하기 버튼');
  r = await post('camp-join', newbieJ, { id: campId });
  ok('참여하기 누르면 바로 참여자 (이동 전)', r.statusCode === 200 && r.body.participants === 2, r.body);
  c = (await api('sync', newbieJ)).body.camps.find((x) => x.id === campId);
  ok('내 목록에 참여 중으로 보임', c && c.joined === true && c.myG === 0, c);
  r = await post('camp-join', newbieJ, { id: campId });
  ok('두 번 눌러도 한 번만', r.body.participants === 2, r.body);
  await sql()`DELETE FROM campaign_participants WHERE campaign_id = ${Number(campId)} AND user_id <> (SELECT creator_id FROM campaigns WHERE id = ${Number(campId)})`;

  console.log('3) 이동 저장 · 포인트 · 캠페인 기여');
  r = await post('trip', sky, trip(4, 600, { key: 'k1', campaignId: campId }));
  ok('캠페인 이동 저장 + 포인트 서버 계산 (0.6kg→6P + 4.5km→5P = 11P)', r.statusCode === 200 && r.body.points === 11, r.body);
  ok('캠페인 진행 전후', r.body.campaign && r.body.campaign.beforeG === 0 && r.body.campaign.afterG === 600, r.body);
  r = await post('trip', sky, trip(4, 600, { key: 'k1', campaignId: campId }));
  ok('같은 이동을 다시 보내도 한 번만 저장', r.body.duplicate === true, r.body);
  r = await post('trip', sky, trip(4, 999999));
  ok('말도 안 되게 큰 절약량은 잘라냄 (4.5km×210×2 = 1890g)', r.body.savedG === 1890, r.body);
  r = await post('trip', sky, { ...trip(4, 100), segments: [{ mode: 'rocket', km: 3 }] });
  ok('이상한 이동 수단만 있으면 거부', r.statusCode === 400, r.body);
  r = await post('trip', sky, { ...trip(4, 100), to: { name: 'x', lat: 999, lng: 1 } });
  ok('이상한 좌표 거부', r.statusCode === 400, r.body);
  let s = (await api('sync', sky)).body;
  ok('하늘 요약: 이동 2번, 2490g, 포인트 11+(19+5)=35', s.log.trips === 2 && s.log.g === 2490 && s.points === 35, { log: s.log, points: s.points });
  const today = Object.keys(s.log.daily)[0];
  ok('달력용 날짜별 기록', s.log.days.length === 1 && s.log.daily[today].n === 2, s.log);
  ok('이번 달 포인트', Object.values(s.monthPoints)[0] === 35, s.monthPoints);
  ok('최근 출발지·도착지: 이동한 장소 2곳, 중복 없이', s.recentPlaces.length === 2 && s.recentPlaces.map((x) => x.name).sort().join() === '안양역,평촌역' && s.recentPlaces[0].at > 0, s.recentPlaces);
  c = s.camps.find((x) => x.id === campId);
  ok('캠페인: 자동 참여, 내 기여 600g, 참여 2명', c.joined && c.myG === 600 && c.participants === 2 && c.progressG === 600, c);

  console.log('4) 인기 캠페인 보상');
  r = await post('trip', sky, trip(300, 100000, { key: 'k2', campaignId: campId }));
  ok('목표 100kg 달성 이동 (보상은 만든 사람에게, 나에겐 알림 없음)', r.statusCode === 200 && !r.body.reward && r.body.campaign.afterG >= 100000, r.body);
  s = (await api('sync', jimin)).body;
  ok('만든 사람(지민)에게 1000P 보상', s.points === 1000, s.points);
  ok('보상 받음 표시', s.camps.find((x) => x.id === campId).rewarded === true);
  await post('trip', sky, trip(10, 1000, { key: 'k3', campaignId: campId }));
  ok('보상은 한 번만', (await api('sync', jimin)).body.points === 1000);

  console.log('5) 좋아요 · 랭킹 · 프로필');
  r = await post('camp-like', jimin, { id: campId, on: true });
  r = await post('camp-like', jimin, { id: campId, on: true });
  ok('좋아요 두 번 눌러도 1개', r.body.likes === 1, r.body);
  r = await post('camp-like', sky, { id: campId, on: true });
  ok('다른 사람 좋아요 → 2개', r.body.likes === 2);
  r = await post('camp-like', sky, { id: campId, on: false });
  ok('좋아요 취소 → 1개', r.body.likes === 1);
  r = await api('camp-rank', sky, { query: { id: campId } });
  ok('캠페인 기여 랭킹: 하늘 1위, 지민 2위(0g)', r.body.users[0].name === '하늘' && r.body.users[0].me && r.body.users[1].name === '김지민' && r.body.me.rank === 1, r.body);
  s = (await api('sync', admin)).body;
  ok('이달의 랭킹: 하늘 1위(이동 포인트 1357P), 지민 2위(보상 1000P), 관리자 0P 3위', s.rank.users[0].name === '하늘' && s.rank.users[0].points === 1357 && s.rank.users[1].name === '김지민' && s.rank.users[1].points === 1000 && s.rank.myPoints === 0 && s.rank.myRank === 3, s.rank);
  r = await post('profile', sky, { name: '푸른하늘이', avatar: 'data:image/jpeg;base64,/9j/BBBB' });
  ok('닉네임 + 프로필 사진 저장', r.statusCode === 200 && r.body.user.name === '푸른하늘이' && /k=a/.test(r.body.user.avatar), r.body);
  r = await post('profile', sky, { name: 'x' });
  ok('닉네임 1글자 거부', r.statusCode === 400);
  r = await post('profile', sky, { avatar: 'javascript:alert(1)' });
  ok('사진이 아닌 값 거부', r.statusCode === 400);
  r = await kakaoLogin('5119116494', '카카오닉');
  ok('앱에서 바꾼 닉네임은 카카오로 다시 로그인해도 유지', hashData(r).name === '푸른하늘이', hashData(r));
  s = (await api('sync', admin)).body;
  ok('랭킹에 바뀐 이름과 사진', s.rank.users.some((u) => u.name === '푸른하늘이' && u.photo));

  console.log('5-1) 목표 달성 후 7일 지나면 종료');
  c = (await api('sync', sky)).body.camps.find((x) => x.id === campId);
  ok('목표 달성 직후: 아직 게시 중 + 달성 시각 기록', c && !c.ended && c.reachedAt > 0, c);
  r = await call(signup, { method: 'POST', body: { name: '새회원', email: 'new@test.kr', pw: 'password1' } });
  const newbie = cookieFrom(r);
  ok('처음 보는 회원에게도 보임 (7일 전)', (await api('sync', newbie)).body.camps.some((x) => x.id === campId));
  await sql()`UPDATE trips SET arrived_at = arrived_at - interval '8 days' WHERE campaign_id = ${Number(campId)}`;
  ok('8일 지남 → 처음 보는 회원 목록에서 내려감', !(await api('sync', newbie)).body.camps.some((x) => x.id === campId));
  c = (await api('sync', sky)).body.camps.find((x) => x.id === campId);
  ok('참여했던 사람에게는 "종료"로 남음', c && c.ended === true, c);
  c = (await api('sync', jimin)).body.camps.find((x) => x.id === campId);
  ok('만든 사람에게도 "종료"로 남음 + 보상은 그대로', c && c.ended && c.rewarded, c);
  ok('관리자는 계속 봄', (await api('sync', admin)).body.camps.some((x) => x.id === campId && x.ended));
  r = await post('trip', sky, trip(3, 500, { key: 'k-end', campaignId: campId }));
  ok('종료된 캠페인으로 이동해도 캠페인에 안 더해짐 (이동은 저장)', r.statusCode === 200 && !r.body.campaign && r.body.points > 0, r.body);
  r = await post('camp-like', newbie, { id: campId, on: true });
  ok('종료된 캠페인 좋아요 불가', r.statusCode === 400, r.body);

  console.log('6) 삭제 · 로그아웃');
  r = await post('camp-del', sky, { id: campId });
  ok('남의 캠페인 삭제 불가 (403)', r.statusCode === 403);
  r = await post('camp-del', jimin, { id: campId });
  ok('내 캠페인 삭제', r.statusCode === 200);
  s = (await api('sync', sky)).body;
  ok('삭제해도 하늘의 이동 기록은 남음 (캠페인 연결만 풀림)', s.log.trips === 5 && !s.camps.length, s.log);
  r = await post('logout', sky, {});
  ok('로그아웃하면 쿠키 지움', /Max-Age=0/.test(r.headers['set-cookie']));
  r = await post('unknown', sky, {});
  ok('없는 기능 404', r.statusCode === 404);

  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(1); });
