// 앱 화면 테스트 (진짜 브라우저 + 테스트 서버 + 진짜 Postgres)
//  실행: node test/devserver.cjs & node test/e2e.cjs
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const URL = 'http://localhost:5199/';
const SHOTS = process.env.SHOTS || '/tmp';
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'pureun_e2e', '-tA', '-c', q], { env: { ...process.env, PGPASSWORD: 'test' }, encoding: 'utf8' }).trim();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log(`${cond ? '  ✓' : '  ✗'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newUser(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label} 페이지 오류]`, e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/naver|kakao|Failed to load resource|ERR_/i.test(m.text())) console.log(`  [${label} 콘솔]`, m.text()); });
  await page.goto(URL);
  return { ctx, page };
}
const ls = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
const waitSync = (page) => page.waitForResponse((r) => r.url().includes('/api/data?a=sync') && r.status() === 200, { timeout: 8000 });
async function signup(page, name, email) {
  await page.click('[data-act="to-signup"]');
  await page.fill('#signup-form [name="name"]', name);
  await page.fill('#signup-form [name="email"]', email);
  await page.fill('#signup-form [name="pw"]', 'password1');
  await page.fill('#signup-form [name="pw2"]', 'password1');
  const s = waitSync(page);
  await page.click('#signup-form [type="submit"]');
  await s;
  await sleep(400);
}

(async () => {
  const browser = await chromium.launch();
  console.log('1) 가입 → 서버 기록 받아 오기');
  const A = await newUser(browser, '지민');
  await A.page.screenshot({ path: `${SHOTS}/e2e-1-login.png` });
  await signup(A.page, '김지민', 'jimin@test.kr');
  ok('가입하면 메인 화면', await A.page.evaluate(() => state.screen) === 'main');
  ok('서버 DB 모드 켜짐', await ls(A.page, 'pureun-db') === '1');
  ok('예시(가짜) 캠페인 없이 진짜 캠페인만', await ls(A.page, 'pureun-campaigns') === '[]');
  const uidA = await A.page.evaluate(() => state.user.uid);
  ok('서버 회원 번호 받음', Number.isInteger(uidA), uidA);
  ok('출입증 쿠키는 앱 코드에서 못 읽음 (HttpOnly)', !(await A.page.evaluate(() => document.cookie)).includes('pureun_sid'));
  ok('쿠키 자체는 브라우저에 있음', (await A.ctx.cookies()).some((c) => c.name === 'pureun_sid' && c.httpOnly));

  console.log('2) 닉네임 → 서버 저장');
  await A.page.click('[data-act="open-account"]');
  await A.page.fill('#acc-name', 'DB지민');
  let s = waitSync(A.page);
  await A.page.click('#name-form [type="submit"]');
  await s;
  ok('닉네임이 DB에 저장됨', psql(`SELECT name FROM users WHERE id=${uidA}`) === 'DB지민');

  console.log('3) 캠페인 만들기 → 서버 저장');
  await A.page.click('[data-act="camp-new"]');
  await A.page.fill('#camp-form [name="title"]', '버스로 출근하기');
  await A.page.fill('#camp-form [name="body"]', '일주일에 하루만 자동차 대신 버스로 출근해 봐요. 같이 하면 더 오래 할 수 있어요.');
  await A.page.fill('#camp-form [name="goalKg"]', '100');
  s = waitSync(A.page);
  await A.page.click('#camp-form [type="submit"]');
  await s;
  await sleep(500);
  const campId = psql('SELECT id FROM campaigns ORDER BY id DESC LIMIT 1');
  ok('캠페인이 DB에 저장됨', !!campId && psql(`SELECT title FROM campaigns WHERE id=${campId}`) === '버스로 출근하기');
  ok('올린 캠페인 화면으로 이동 (서버 번호)', await A.page.evaluate(() => [state.screen, state.campId]).then(([sc, id]) => sc === 'campaign' && id === String(campId)), await A.page.evaluate(() => [state.screen, state.campId]));
  ok('검토 중 표시', (await A.page.textContent('#app')).includes('관리자가 검토하고 있어요'));
  await A.page.screenshot({ path: `${SHOTS}/e2e-2-pending.png` });

  console.log('4) 관리자 승인');
  const B = await newUser(browser, '관리자');
  await signup(B.page, '관리자', 'admin2@test.kr');
  const uidB = await B.page.evaluate(() => state.user.uid);
  psql(`UPDATE users SET role = 'admin' WHERE id=${uidB}`);
  s = waitSync(B.page);
  await B.page.reload();
  await s; await sleep(400);
  ok('DB role=admin → 앱이 관리자로 인식', await B.page.evaluate(() => isAdmin()));
  await B.page.click('[data-act="open-account"]');
  ok('계정정보에 캠페인 검토 메뉴', (await B.page.textContent('#app')).includes('캠페인 검토'));
  await B.page.click('[data-act="open-admin"]');
  ok('검토 대기에 지민의 캠페인', (await B.page.textContent('#app')).includes('버스로 출근하기'));
  await B.page.screenshot({ path: `${SHOTS}/e2e-3-admin.png` });
  s = waitSync(B.page);
  await B.page.click(`[data-act="camp-approve"][data-id="${campId}"]`);
  await s;
  ok('승인이 DB에 기록됨', psql(`SELECT status FROM v_campaign_status WHERE campaign_id=${campId}`) === 'approved');

  console.log('5) 만든 사람에게 승인 알림');
  s = waitSync(A.page);
  await A.page.reload();
  await s; await sleep(1200);
  ok('승인 알림 창', (await A.page.textContent('body')).includes('캠페인이 승인됐어요'));
  await A.page.screenshot({ path: `${SHOTS}/e2e-4-notice.png` });
  await sleep(300);
  ok('알림 확인이 DB에 기록됨 (다시 안 뜸)', psql(`SELECT count(*) FROM campaign_reviews WHERE campaign_id=${campId} AND seen_at IS NOT NULL`) === '1');
  await A.page.click('.sheet-wrap [data-no]');
  await sleep(300);

  console.log('6) 다른 사람이 좋아요 · 캠페인 이동');
  s = waitSync(B.page);
  await B.page.reload(); await s; await sleep(300);
  await B.page.evaluate(() => goTab('campaigns'));
  await sleep(300);
  await B.page.click(`[data-act="open-camp"][data-id="${campId}"]`);
  await sleep(300);
  const like = B.page.locator(`[data-act="camp-like"][data-id="${campId}"]`).first();
  const lr = B.page.waitForResponse((r) => r.url().includes('a=camp-like'));
  await like.click();
  await lr; await sleep(200);
  ok('좋아요가 DB에 저장됨', psql(`SELECT count(*) FROM campaign_likes WHERE campaign_id=${campId}`) === '1');
  // 도착 처리: 길찾기 대신 이동 결과를 직접 넣고 앱의 저장 함수를 그대로 불러요
  const tr = B.page.waitForResponse((r) => r.url().includes('a=trip'));
  await B.page.evaluate((id) => {
    state.from = { name: '안양역', lat: 37.401, lng: 126.922 };
    state.to = { name: '평촌역', lat: 37.394, lng: 126.963 };
    state.campTrip = { campId: id, mode: 'bus' };
    queueTrip({ minutes: 20, saving: 1200, segments: [{ mode: 'walk', km: 0.4 }, { mode: 'bus', km: 5.6 }] });
    state.campTrip = null;
    return syncFromServer({ quiet: true });
  }, String(campId));
  const trRes = await tr;
  ok('이동이 서버에 저장됨', trRes.status() === 200 && (await trRes.json()).points === 18);
  await sleep(500);
  ok('보낸 이동은 대기 목록에서 빠짐', (await ls(B.page, 'pureun-pending-trips')) === '[]');
  ok('DB: 이동 1번 + 구간 2개 + 포인트 18P', psql(`SELECT trip_count||'/'||points FROM v_user_stats WHERE user_id=${uidB}`) === '1/18' && psql('SELECT count(*) FROM trip_segments') === '2');
  ok('앱 저장 공간도 서버 기록으로 맞춰짐', await B.page.evaluate(() => loadPoints() === 18 && loadLog().trips === 1));
  ok('캠페인 진행 1.2kg, 참여 2명', psql(`SELECT progress_g||'/'||participants FROM v_campaign_stats WHERE campaign_id=${campId}`) === '1200.0/2');

  console.log('7) 인터넷이 끊겼을 때');
  await B.ctx.setOffline(true);
  await B.page.evaluate(() => {
    state.from = { name: '집', lat: 37.39, lng: 126.94 }; state.to = { name: '학교', lat: 37.398, lng: 126.946 };
    queueTrip({ minutes: 12, saving: 300, segments: [{ mode: 'walk', km: 1.1 }] });
    return syncFromServer({ quiet: true });
  });
  ok('끊긴 동안은 휴대폰에 모아 둠', JSON.parse(await ls(B.page, 'pureun-pending-trips')).length === 1);
  await B.ctx.setOffline(false);
  await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await sleep(1200);
  ok('다시 연결되면 자동으로 보냄', JSON.parse(await ls(B.page, 'pureun-pending-trips')).length === 0 && psql(`SELECT trip_count FROM v_user_stats WHERE user_id=${uidB}`) === '2');

  console.log('8) 랭킹 · 캠페인 기여 랭킹');
  await B.page.evaluate(() => goTab('rank'));
  await sleep(300);
  const rankText = await B.page.textContent('#app');
  ok('이달의 랭킹에 진짜 회원 (관리자 18P+4P=22P 1위)', rankText.includes('22P') && !/초록버스|산책하는해달/.test(rankText), rankText.slice(0, 200));
  await B.page.screenshot({ path: `${SHOTS}/e2e-5-rank.png` });
  s = waitSync(A.page);
  await A.page.reload(); await s; await sleep(300);
  await A.page.evaluate(() => goTab('campaigns')); await sleep(200);
  await A.page.click(`[data-act="open-camp"][data-id="${campId}"]`);
  await A.page.waitForResponse((r) => r.url().includes('a=camp-rank'));
  await sleep(400);
  const campText = await A.page.textContent('#app');
  ok('캠페인 기여 랭킹에 진짜 참여자 (관리자 1.2kg)', campText.includes('관리자') && campText.includes('1.2kg'), campText.slice(0, 300));
  await A.page.locator('#camp-rank').scrollIntoViewIfNeeded();
  await A.page.screenshot({ path: `${SHOTS}/e2e-6-camprank.png` });

  console.log('9) 다른 기기에서 로그인해도 기록 그대로');
  const A2 = await newUser(browser, '지민-다른기기');
  await A2.page.fill('#login-form [name="email"]', 'jimin@test.kr');
  await A2.page.fill('#login-form [name="pw"]', 'password1');
  s = waitSync(A2.page);
  await A2.page.click('#login-form [type="submit"]');
  await s; await sleep(500);
  ok('다른 기기: 같은 닉네임 · 같은 캠페인', await A2.page.evaluate((id) => state.user.name === 'DB지민' && campStore.load().some((c) => c.id === id && isMine(c)), String(campId)));

  console.log('10) 예전에 로그인해 둔 사람 (출입증 없음)');
  const C = await newUser(browser, '예전로그인');
  await C.page.evaluate(() => localStorage.setItem('pureun-user', JSON.stringify({ provider: 'kakao', id: '5117762656', name: '카카오 사용자' })));
  await C.page.reload();
  await sleep(1200);
  ok('로그인 화면으로 + 안내 문구', await C.page.evaluate(() => state.screen) === 'login' && (await C.page.textContent('#app')).includes('한 번만 다시 로그인'));
  await C.page.screenshot({ path: `${SHOTS}/e2e-7-relogin.png` });

  console.log('11) 로그아웃');
  await A.page.evaluate(() => goTab('account')); await sleep(300);
  await A.page.click('[data-act="logout"]'); await sleep(300);
  ok('확인 창', (await A.page.textContent('body')).includes('정말로 로그아웃 하시겠습니까?'));
  const lo = A.page.waitForResponse((r) => r.url().includes('a=logout'));
  await A.page.click('.sheet-wrap [data-yes]');
  await lo; await sleep(300);
  ok('로그인 화면 + 이 휴대폰의 기록 지움 + 쿠키 지움', await A.page.evaluate(() => state.screen === 'login' && !localStorage.getItem('pureun-campaigns') && !localStorage.getItem('pureun-points')) && !(await A.ctx.cookies()).some((c) => c.name === 'pureun_sid'));

  await browser.close();
  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 중단:', e.message); process.exit(1); });
