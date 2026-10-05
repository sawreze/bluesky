// 화면 테스트: 자주 묻는 질문 · 의견 보내기 · 관리자 받은 의견 · 포인트 부족 시 우는 푸름이
//  실행: TESTDB=pureun_e2e2 PORT=5199 node test/devserver.cjs &  →  SHOTS=폴더 node test/e2e-help.cjs
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const URL = 'http://localhost:5199/';
const SHOTS = process.env.SHOTS || '/tmp';
const DB = process.env.TESTDB || 'pureun_e2e2';
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', DB, '-tA', '-c', q], { env: { ...process.env, PGPASSWORD: 'test' }, encoding: 'utf8' }).trim();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log(`${cond ? '  ✓' : '  ✗'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function newUser(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors.push(e.message); console.log(`  [${label} 페이지 오류]`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/naver|kakao|Failed to load resource|ERR_/i.test(m.text())) { errors.push(m.text()); console.log(`  [${label} 콘솔]`, m.text()); } });
  await page.goto(URL);
  return { ctx, page };
}
const waitSync = (page) => page.waitForResponse((r) => r.url().includes('/api/data?a=sync') && r.status() === 200, { timeout: 8000 });
async function signup(page, name, email) {
  await page.click('[data-act="to-signup"]');
  await page.fill('#signup-form [name="name"]', name);
  await page.fill('#signup-form [name="email"]', email);
  await page.fill('#signup-form [name="pw"]', 'password1');
  await page.fill('#signup-form [name="pw2"]', 'password1');
  await page.click('#signup-form [type="submit"]');
  await page.waitForSelector('#verify-form', { timeout: 8000 });
  const code = await page.textContent('.vf-demo b');
  const s = waitSync(page);
  await page.click('.vf-box');
  await page.keyboard.type(code.trim(), { delay: 30 });
  await s; await sleep(400);
}
const lineCount = (page, sel) => page.$$eval(sel, (els) => els.map((e) => { const lh = parseFloat(getComputedStyle(e).lineHeight); const pad = parseFloat(getComputedStyle(e).paddingTop) + parseFloat(getComputedStyle(e).paddingBottom); return Math.round((e.getBoundingClientRect().height - pad) / lh); }));

(async () => {
  const browser = await chromium.launch();
  console.log('1) 자주 묻는 질문');
  const A = await newUser(browser, '사용자');
  await signup(A.page, '김하늘', 'sky@test.kr');
  await sleep(900);
  ok('처음엔 말풍선 없음', !(await A.page.$eval('#mascot-say', (e) => e.classList.contains('show'))));
  await A.page.click('.mascot');
  await sleep(500);
  ok('푸름이를 누르면 "안녕, 난 푸름이야!" 말풍선', (await A.page.textContent('#mascot-say')) === '안녕, 난 푸름이야!' && await A.page.$eval('#mascot-say', (e) => getComputedStyle(e).opacity === '1'));
  await A.page.screenshot({ path: `${SHOTS}/h0-say.png`, clip: { x: 0, y: 60, width: 390, height: 280 } });
  await sleep(2600);
  ok('잠시 뒤 사라짐', await A.page.$eval('#mascot-say', (e) => !e.classList.contains('show')));
  await A.page.click('[data-act="open-account"]');
  ok('계정정보에 "자주 묻는 질문 · 의견 보내기" 줄', (await A.page.textContent('#app')).includes('자주 묻는 질문 · 의견 보내기'));
  console.log('0) 라이트 · 다크 스위치');
  ok('처음은 라이트', await A.page.evaluate(() => document.documentElement.dataset.theme) === 'light');
  ok('계정정보 오른쪽 위에 스위치', !!(await A.page.$('.m-top .thm-sw [data-id="dark"]')));
  await A.page.click('.thm-sw [data-id="dark"]');
  await sleep(600);
  ok('다크를 누르면 다크로 + 기억', await A.page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('pureun-theme'), document.querySelector('.thm-sw').dataset.on].join()) === 'dark,dark,dark');
  ok('배경이 어두워짐', await A.page.evaluate(() => { const m = getComputedStyle(document.body).backgroundImage.match(/rgb\((\d+), (\d+), (\d+)\)/); return m && (+m[1] + +m[2] + +m[3]) < 150; }));
  await A.page.screenshot({ path: `${SHOTS}/h-dark-account.png` });
  let s0 = waitSync(A.page); await A.page.reload(); await s0; await sleep(500);
  ok('새로 열어도 다크 유지', await A.page.evaluate(() => document.documentElement.dataset.theme) === 'dark');
  await A.page.click('[data-act="open-account"]'); await sleep(300);
  await A.page.click('.thm-sw [data-id="light"]');
  await sleep(600);
  ok('라이트를 누르면 라이트로', await A.page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('pureun-theme')].join()) === 'light,light');
  await A.page.click('[data-act="open-help"]');
  await sleep(500);
  ok('도움말 화면', await A.page.evaluate(() => state.screen) === 'help');
  ok('질문 5개', (await A.page.$$('.faq-item')).length === 5);
  ok('계산 방식 답에 배출계수 표와 출처', (await A.page.textContent('.faq-item:nth-child(2) .faq-a')).replace(/\s/g, '').includes('승용차210g버스27.7g지하철1.53g걷기·자전거0g') && (await A.page.textContent('.faq-item:nth-child(2) .faq-src')).includes('그린피스'));
  ok('첫 질문은 펼쳐져 있음', await A.page.$eval('.faq-item', (e) => e.classList.contains('open')));
  // 질문·답 줄 수 (390px 폭 휴대폰): 모두 펼쳐서 재요
  await A.page.evaluate(() => document.querySelectorAll('.faq-item').forEach((n) => n.classList.add('open')));
  await sleep(450);
  const aLines = await lineCount(A.page, '.faq-a p');
  const qLines = await lineCount(A.page, '.faq-q span');
  ok('짧은 답은 2줄 이하 (3~5번)', aLines.slice(2).every((n) => n <= 2), aLines);
  ok('질문은 모두 1줄', qLines.every((n) => n === 1), qLines);
  await A.page.screenshot({ path: `${SHOTS}/h1-faq-all.png` });
  await A.page.evaluate(() => document.querySelectorAll('.faq-item').forEach((n, i) => n.classList.toggle('open', i === 0)));
  await A.page.click('.faq-item:nth-child(2) .faq-q');
  await sleep(400);
  ok('두 번째를 누르면 그것만 펼쳐짐', await A.page.$$eval('.faq-item', (els) => els.map((e) => e.classList.contains('open')).join()) === 'false,true,false,false,false');
  await A.page.click('.faq-item:nth-child(2) .faq-q');
  await sleep(400);
  ok('다시 누르면 접힘', await A.page.$$eval('.faq-item.open', (els) => els.length) === 0);

  console.log('2) 의견 보내기');
  await A.page.click('.fb-kind[data-id="idea"]');
  ok('종류를 고르면 안내 문구가 바뀜', (await A.page.getAttribute('#fb-text', 'placeholder')).includes('바뀌면 좋겠다'));
  await A.page.click('#fb-send');
  await sleep(300);
  ok('빈칸으로 보내면 안내', (await A.page.textContent('body')).includes('5자 이상'));
  await A.page.fill('#fb-text', '랭킹 화면에서 내 순위를 바로 찾을 수 있게\n내 줄을 위쪽에 고정해 주세요.');
  ok('글자 수 표시', (await A.page.textContent('#fb-count')).startsWith('39/500') || /^\d+\/500$/.test(await A.page.textContent('#fb-count')));
  await A.page.screenshot({ path: `${SHOTS}/h2-write.png` });
  const sent = A.page.waitForResponse((r) => r.url().includes('a=feedback-mine'));
  await A.page.click('#fb-send');
  await sent; await sleep(300);
  ok('DB에 저장됨 (고칠 점)', psql("SELECT kind || '|' || (read_at IS NULL) FROM feedback") === 'idea|true');
  ok('입력칸이 비워짐', await A.page.inputValue('#fb-text') === '');
  ok('"내가 보낸 의견"에 확인 전으로 보임', (await A.page.textContent('#fb-mine')).includes('확인 전'));
  await A.page.click('.fb-kind[data-id="bug"]');
  await A.page.fill('#fb-text', '캘린더에서 지난달로 넘기면 가끔 빈 화면이 나와요.');
  const sent2 = A.page.waitForResponse((r) => r.url().includes('a=feedback-mine'));
  await A.page.click('#fb-send');
  await sent2; await sleep(500);
  await A.page.evaluate(() => window.scrollTo(0, 0));
  await A.page.screenshot({ path: `${SHOTS}/h3-sent.png`, fullPage: true });

  console.log('3) 관리자 받은 의견');
  const B = await newUser(browser, '관리자');
  await signup(B.page, '관리자', 'boss@test.kr');
  psql("UPDATE users SET role = 'admin' WHERE email = 'boss@test.kr'");
  let s = waitSync(B.page); await B.page.reload(); await s; await sleep(400);
  await B.page.click('[data-act="open-account"]');
  ok('계정정보에 받은 의견 + 빨간 숫자 2', (await B.page.textContent('[data-act="admin-feedback"]')).replace(/\s/g, '').includes('받은의견관리자2'), await B.page.textContent('[data-act="admin-feedback"]'));
  await B.page.screenshot({ path: `${SHOTS}/h4-admin-account.png` });
  const ld = B.page.waitForResponse((r) => r.url().includes('a=feedback-list'));
  await B.page.click('[data-act="admin-feedback"]');
  await ld; await sleep(400);
  ok('안 읽음 2개 · 보낸 사람 이메일 보임', (await B.page.$$('.fb-item')).length === 2 && (await B.page.textContent('#fba-out')).includes('sky@test.kr'));
  await B.page.screenshot({ path: `${SHOTS}/h5-inbox.png` });
  let ld2 = B.page.waitForResponse((r) => r.url().includes('a=feedback-list'));
  await B.page.click('.fb-item:nth-child(1) [data-to="done"]');
  await ld2; await sleep(300);
  ok('처리 완료 → 안 읽음 목록에서 빠짐', (await B.page.$$('.fb-item')).length === 1);
  ld2 = B.page.waitForResponse((r) => r.url().includes('a=feedback-list'));
  await B.page.click('[data-act="fb-tab"][data-id="all"]');
  await ld2; await sleep(300);
  ok('전체 탭에 2개, 처리 완료 표시', (await B.page.$$('.fb-item')).length === 2 && (await B.page.textContent('#fba-out')).includes('처리 완료'));
  await B.page.screenshot({ path: `${SHOTS}/h6-inbox-all.png` });
  await B.page.click('[data-act="back"]');
  await sleep(400);
  ok('계정정보 빨간 숫자 1로 줄어듦', (await B.page.textContent('[data-act="admin-feedback"]')).replace(/\s/g, '').endsWith('관리자1'), await B.page.textContent('[data-act="admin-feedback"]'));

  console.log('4) 보낸 사람 화면에 상태 반영');
  await A.page.click('[data-act="back"]');
  await sleep(300);
  const m = A.page.waitForResponse((r) => r.url().includes('a=feedback-mine'));
  await A.page.click('[data-act="open-help"]');
  await m; await sleep(300);
  ok('"처리 완료"가 보임', (await A.page.textContent('#fb-mine')).includes('처리 완료'));

  console.log('5) 포인트가 모자랄 때 우는 푸름이');
  await A.page.click('[data-act="back"]');
  await sleep(300);
  await A.page.click('[data-act="open-shop"]');
  await sleep(400);
  await A.page.click('.shop-item[data-id="bike-day"]');
  await sleep(500);
  ok('처음엔 신난 푸름이', !!(await A.page.$('.shop-sheet .ss-mascot .mj')));
  await A.page.click('.shop-sheet [data-yes]');
  await sleep(700);
  ok('구매하기 → 우는 푸름이로 바뀜', !!(await A.page.$('.shop-sheet .ss-mascot.sad .cry')) && !(await A.page.$('.shop-sheet .ss-mascot .mj')));
  const short = await A.page.textContent('#ss-short');
  ok('"포인트가 1,000P 부족해요" 문구 (보유 0P)', short.includes('포인트가 1,000P 부족해요'), short);
  ok('구매 창은 그대로 (따로 팝업 없음)', (await A.page.$$('.sheet-wrap')).length === 1);
  ok('주문이 생기지 않음', psql('SELECT count(*) FROM shop_orders') === '0');
  await sleep(500);
  await A.page.screenshot({ path: `${SHOTS}/h7-sad.png` });
  await A.page.click('.shop-sheet [data-yes]');
  await sleep(200);
  ok('다시 누르면 다시 흔들림', await A.page.$eval('#ss-short', (e) => e.classList.contains('shake')));
  await sleep(900);
  { const bx = await A.page.$eval('.shop-sheet .ss-hero', (e) => { const r = e.getBoundingClientRect(); return { x: r.left - 10, y: r.top - 20, width: r.width + 150, height: r.height + 40 }; }); await A.page.screenshot({ path: `${SHOTS}/h8-sad-zoom.png`, clip: bx }); }

  ok('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(1); });
