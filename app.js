// =====================================================================
//  푸른하늘 — 탄소 절약 내비게이션 (HTML · CSS · JS)
//  팀 아우름 · 이원우, 임해인
//
//  파일 구성
//  - index.html : 뼈대
//  - style.css  : 디자인
//  - config.js  : API 키
//  - app.js     : 이 파일 (데이터, 계산, 지도, 화면)
//
//  이 파일의 순서
//   1. 설정·데이터      2. 공통 함수      3. 지도·검색 API 불러오기
//   4. 길찾기 API       5. 경로 후보 만들기 6. 지도 그리기
//   7. 앱 상태          8. 화면(HTML) 만들기 9. 버튼·입력 처리
// =====================================================================
'use strict';
// 앱 버전 — server.js 의 APP_VERSION 과 같아야 해요. (다르면 예전 서버가 켜져 있다는 뜻)
const APP_VERSION = '2026.10.03-db';
console.log('푸른하늘', APP_VERSION);

// ---------------------------------------------------------------------
// 1. 설정·데이터
// ---------------------------------------------------------------------
const CFG = window.PUREUN_CONFIG || {};
const keyOk = (k) => typeof k === 'string' && k.trim().length >= 6 && !k.startsWith('여기에');
const NAVER_KEY_ID = (CFG.NAVER_MAP_KEY_ID || '').trim();
const KAKAO_JS_KEY = (CFG.KAKAO_JS_KEY || '').trim();
const KAKAO_REST_KEY = (CFG.KAKAO_REST_KEY || '').trim();
const ODSAY_KEY = (CFG.ODSAY_KEY || '').trim();
const HAS_NAVER = keyOk(NAVER_KEY_ID);
const HAS_JS = keyOk(KAKAO_JS_KEY);
const HAS_REST = keyOk(KAKAO_REST_KEY);
const HAS_ODSAY = keyOk(ODSAY_KEY);
const MAP_KIND = HAS_NAVER ? 'naver' : HAS_JS ? 'kakao' : null; // 지도 화면에 쓸 엔진

// ── 화면 테마 (라이트 · 다크): 계정정보 오른쪽 위 스위치로 바꾸고, 이 기기에 기억해요 ──
const THEME_KEY = 'pureun-theme';
const THEME_BAR = { light: '#D5E7F6', dark: '#0D1829' }; // 휴대폰 상단 상태 표시줄 색
const loadTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; } };
function applyTheme(t, animate) {
  const root = document.documentElement;
  if (animate) { root.classList.add('theme-anim'); clearTimeout(applyTheme.t); applyTheme.t = setTimeout(() => root.classList.remove('theme-anim'), 500); }
  root.dataset.theme = t;
  const bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', THEME_BAR[t]);
}
applyTheme(loadTheme()); // 첫 화면을 그리기 전에 적용 (깜빡임 없게)
function themeSwitchHTML() {
  const t = loadTheme();
  const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
  const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z"/></svg>';
  return `<div class="thm-sw" role="group" aria-label="화면 테마" data-on="${t}">
    <span class="thm-ind" aria-hidden="true"></span>
    <button type="button" data-act="set-theme" data-id="light" aria-pressed="${t === 'light'}">${sun}라이트</button>
    <button type="button" data-act="set-theme" data-id="dark" aria-pressed="${t === 'dark'}">${moon}다크</button>
  </div>`;
}

// 이동수단별 탄소배출계수 (1인이 1km 이동할 때 CO₂, 단위 g)
// 출처: 서울시 자료(그린피스 코리아 인용) — 승용차 210g, 버스 27.7g, 지하철 1.53g
const FACTORS = { car: 210, bus: 27.7, subway: 1.53, bike: 0, walk: 0 };
const FACTOR_SOURCE = '서울시 자료(그린피스 코리아 인용), 1인 1km 기준: 승용차 210g · 버스 27.7g · 지하철 1.53g';

// ── 탄소량을 "생활 단위"로 바꾸는 기준 ──
// 일반 사용자는 "2.41kg"이 많은지 적은지 몰라요. 그래서 눈에 그려지는 단위로 바꿔 보여줘요.
//  - 소나무: 국립산림과학원(2019) 중부지방소나무 1그루 연간 CO₂ 흡수량 9.8kg → 하루 약 27g
//  - 스마트폰: 1회 완충 약 0.019kWh × 국가 전력배출계수 0.4173kg/kWh(2023) ≈ 8g
//  - 풍선: CO₂ 1g ≈ 0.55L(25℃, 1기압) → 지름 30cm 풍선(약 14L) 하나에 약 25g
const TREE_YEAR_G = 9800;
const EQUIV = { pineDayG: TREE_YEAR_G / 365, phoneG: 8, balloonG: 25 };
const EQUIV_SOURCE = '소나무 흡수량: 국립산림과학원(2019) 중부지방소나무 1그루 연 9.8kg · 전력배출계수: 0.4173kg/kWh(2023) · 풍선: 지름 30cm(약 14L) 기준';

// 평균 속도(km/h) — API가 없는 구간을 추정할 때 사용
const SPEED = { walk: 4.5, bike: 15, bus: 18, subway: 33, car: 25 };

// 이동수단 아이콘 (선 아이콘 · 글자 색을 따라가요)
const MI = {
  walk: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12.6" cy="3.6" r="2.2"/><path d="M12.7 5.8 11.7 13"/><path d="M12.4 7.4 9.6 9.6 9 11.8"/><path d="M12.6 7.7 15.4 11"/><path d="M11.7 13 9.2 16.4 7.4 18.6"/><path d="M11.7 13 14 16.4 13.8 20.8"/></svg>',
  subway: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.2 2.9c3.2-.7 6.4-.7 9.6 0A2.8 2.8 0 0 1 19 5.6v9.4a2.8 2.8 0 0 1-2.8 2.8H7.8A2.8 2.8 0 0 1 5 15V5.6a2.8 2.8 0 0 1 2.2-2.7z"/><path d="M10.8 4.9h2.4"/><rect x="7.6" y="7" width="8.8" height="4.2" rx=".6"/><circle cx="9.2" cy="14.4" r="1"/><circle cx="14.8" cy="14.4" r="1"/><path d="M8.7 17.8 6.9 21.2M15.3 17.8l1.8 3.4M8.1 19.6h7.8"/></svg>',
  bus: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.6" y="2.6" width="12.8" height="15" rx="2.3"/><path d="M10.4 4.7h3.2M5.6 6.8h12.8M5.6 12.4h12.8"/><path d="M5.6 7.8H4.4v3.2h1.2M18.4 7.8h1.2v3.2h-1.2"/><circle cx="8.7" cy="15" r=".85"/><circle cx="15.3" cy="15" r=".85"/><path d="M11.2 15h1.6"/><path d="M7.7 17.6v1.6a.8.8 0 0 0 .8.8h.9a.8.8 0 0 0 .8-.8v-1.6M13.8 17.6v1.6a.8.8 0 0 0 .8.8h.9a.8.8 0 0 0 .8-.8v-1.6"/></svg>',
  car: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 17.2v-5.8c0-.4.1-.8.3-1.1l1.8-4.7a2 2 0 0 1 1.9-1.3h7a2 2 0 0 1 1.9 1.3l1.8 4.7c.2.3.3.7.3 1.1v5.8z"/><path d="M7.3 9.4l1.1-3a.8.8 0 0 1 .8-.6h5.6a.8.8 0 0 1 .8.6l1.1 3z"/><path d="M11.7 8.2l1.5-1.2"/><path d="M4.9 9.4H3.7a.8.8 0 0 1 0-1.6h1.5M19.1 9.4h1.2a.8.8 0 0 0 0-1.6h-1.5"/><circle cx="7.4" cy="13.3" r=".95"/><circle cx="16.6" cy="13.3" r=".95"/><path d="M10.3 13.3h3.4"/><path d="M6.1 17.2v1.5h2.2v-1.5M15.7 17.2v1.5h2.2v-1.5M2.8 20.6h18.4"/></svg>',
};
const MODES = {
  walk: { label: '도보', color: '#8a97a5', icon: MI.walk },
  bike: { label: '자전거', color: '#127a52', icon: '🚲' },
  bus: { label: '버스', color: '#2f7fd0', icon: MI.bus },
  subway: { label: '지하철', color: '#5b4bb7', icon: MI.subway },
  car: { label: '자동차', color: '#a24b3c', icon: MI.car },
};

// 지하철 노선 색 (이름에 포함된 글자로 찾아요. 위에서부터 먼저 맞는 것)
const SUBWAY_COLORS = [
  ['신분당', '#D4003B'], ['수인분당', '#F5A200'], ['분당', '#F5A200'], ['경의중앙', '#77C4A3'], ['공항', '#0090D2'],
  ['경춘', '#0C8E72'], ['경강', '#0054A6'], ['서해', '#81A914'], ['GTX', '#9A6292'], ['신림', '#6789CA'],
  ['우이신설', '#B0CE18'], ['김포', '#A17800'], ['에버라인', '#56AD2D'], ['의정부', '#FDA600'],
  ['인천 1', '#7CA8D5'], ['인천1', '#7CA8D5'], ['인천 2', '#ED8B00'], ['인천2', '#ED8B00'],
  ['1호선', '#0052A4'], ['2호선', '#00A84D'], ['3호선', '#EF7C1C'], ['4호선', '#00A5DE'], ['5호선', '#996CAC'],
  ['6호선', '#CD7C2F'], ['7호선', '#747F00'], ['8호선', '#E6186C'], ['9호선', '#BDB092'],
];
function subwayColor(name) {
  const hit = SUBWAY_COLORS.find(([k]) => String(name).includes(k));
  return hit ? hit[1] : MODES.subway.color;
}
// 버스 색 (ODsay 버스 종류 번호 기준)
function busColor(type) {
  const t = Number(type);
  if ([4, 14, 15, 26].includes(t)) return '#E60012'; // 직행좌석·광역·급행: 빨강
  if ([12, 3].includes(t)) return '#53B332'; // 지선·마을: 초록
  if (t === 13) return '#F2B70A'; // 순환: 노랑
  if ([11, 6].includes(t)) return '#3D5BAB'; // 간선: 파랑
  return '#2f7fd0';
}

// 절약 단계: 혼자 자동차로 갈 때보다 탄소를 몇 % 줄이는지로 나눠요
// sky: "푸른하늘" 이름에 맞춰 절약 정도를 하늘 날씨로 표현 (색 구분이 어려운 사람도 아이콘으로 알 수 있게)
const TIERS = [
  { id: 'low', label: '조금 절약', min: 1, sky: '☁️', skyName: '흐림', desc: '자동차를 쓰되 덜 쓰는 방법' },
  { id: 'mid', label: '중간 절약', min: 70, sky: '⛅', skyName: '구름 조금', desc: '버스를 섞어 크게 줄이는 방법' },
  { id: 'high', label: '많이 절약', min: 97, sky: '☀️', skyName: '맑음', desc: '지하철·도보·자전거로 거의 안 내는 방법' },
];
const TIER_BY_SAVING = TIERS.slice().sort((a, b) => b.min - a.min);

const SORTS = [
  { id: 'fast', label: '빠른 순' },
  { id: 'greenest', label: '탄소 적은 순' },
  { id: 'lessWalk', label: '덜 걷는 순' },
  { id: 'lessTransfer', label: '환승 적은 순' },
];

const ROAD_FACTOR = 1.3; // 직선거리 → 도로 거리 추정 배수
const ARRIVE_M = 30; // 도착지에서 이 거리(m) 안이면 '도착' 버튼 표시 (자동 도착이 안 될 때 대비)
const AUTO_ARRIVE_M = 10; // 도착지에서 이 거리(m) 안이면 자동 도착
// GPS로 확인한 내 위치가 도착지에서 m 미터 안인지 (위치를 모르면 false)
const nearDest = (m = ARRIVE_M) => !!(state.me && state.to && distM(state.me, state.to) <= m);

// ---------------------------------------------------------------------
// 2. 공통 함수
// ---------------------------------------------------------------------
function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function formatM(m) {
  m = Math.round(m);
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}
function formatG(g) {
  return g >= 1000 ? `${(g / 1000).toFixed(2)}kg` : `${Math.round(g)}g`;
}
function formatMin(min) {
  min = Math.round(min);
  return min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60 ? `${min % 60}분` : ''}`.trim() : `${min}분`;
}
// ── 탄소 → 생활 단위 ──
// 소나무 한 그루가 이 양을 흡수하려면 얼마나 걸리는지 (짧게: 카드용 / 길게: 문장용)
// 사람들이 바로 감이 오는 말로: "나무 N그루 심은 효과" (정부·지자체 캠페인에서 흔히 쓰는 표현)
//  나무 1그루 = 소나무 1그루가 1년 동안 흡수하는 CO₂ 9.8kg (국립산림과학원 2019)
function impact(g) {
  const t = Math.max(0, g / TREE_YEAR_G);
  // 10그루 이상은 정수, 그 아래는 소수 첫째 자리(2.0 → 2), 아주 적으면 둘째 자리까지
  let n;
  if (t >= 10) n = Math.round(t).toLocaleString();
  else if (t >= 0.05) n = String(Math.round(t * 10) / 10);
  else n = String(Math.max(0.01, Math.round(t * 100) / 100));
  return { icon: '🌳', short: `나무 ${n}그루 심은 효과`, long: `나무 ${n}그루를 심은 것과 같아요` };
}
// 경로 카드용 생활 비유: 나무 반 그루 이상이면 나무(반 그루 단위), 그보다 적으면 휴대폰 충전 횟수
//  나무 1그루 = 소나무 1그루가 1년에 흡수하는 9.8kg, 휴대폰 충전 1번 = 약 8g (전력배출계수 0.4173kg/kWh)
//  → "CO₂ 1kg은 얼마나 될까요?"(나무 1/10 · 스마트폰 125번)와 같은 기준이에요. hint: 기준을 한 줄로
function saveSense(g) {
  g = Math.max(0, g || 0);
  const t = g / TREE_YEAR_G;
  if (t >= 0.5) {
    const h = t >= 10 ? Math.floor(t) : Math.floor(t * 2) / 2; // 부풀리지 않게 반 그루 단위로 내림
    const n = COUNT_FMT.tree(h);
    return { kind: 'tree', icon: '🌳', num: h, fmt: 'tree', pre: '나무 ', post: ' 심은 효과', text: `나무 ${n} 심은 효과`, html: `나무 <b>${n}</b> 심은 효과`, hint: '나무 1그루 = 1년 동안 CO₂ 9.8kg 흡수' };
  }
  const c = Math.round(g / EQUIV.phoneG);
  if (c < 1) return { kind: 'none', icon: '🚗', text: '자동차와 거의 같아요', html: '자동차와 거의 같아요', hint: '' };
  const n = COUNT_FMT.times(c);
  return { kind: 'phone', icon: '📱', num: c, fmt: 'times', pre: '휴대폰 ', post: ' 충전할 때 나오는 양', text: `휴대폰 ${n} 충전할 때 나오는 양`, html: `휴대폰 <b>${n}</b> 충전할 때 나오는 양`, hint: '휴대폰 1번 충전 = CO₂ 약 8g' };
}
// ── 숫자 카운터: 0부터 목표 숫자까지 올라가요 (경로 카드를 막 골랐을 때) ──
//  숫자가 클수록 조금 더 오래(0.7초 ~ 1.6초), 끝으로 갈수록 천천히 멈춰요. 움직임 줄이기면 바로 최종 숫자.
const COUNT_FMT = {
  tree: (v) => { const h = Math.max(0.5, Math.floor(v * 2) / 2); const w = Math.floor(h); return w === 0 ? '반 그루' : `${w.toLocaleString()}그루${h - w >= 0.5 ? ' 반' : ''}`; },
  times: (v) => `${Math.round(v).toLocaleString()}번`,
  g: (v) => formatG(Math.round(v)),
  int: (v) => Math.round(v).toLocaleString(),
};
const countAttr = (to, fmt) => `data-count="${to}" data-fmt="${fmt}"`;
function runCounters(root = document) {
  const els = [...root.querySelectorAll('[data-count]')];
  if (!els.length) return;
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.forEach((el) => {
    const to = Number(el.dataset.count) || 0;
    const fmt = COUNT_FMT[el.dataset.fmt] || COUNT_FMT.g;
    el.removeAttribute('data-count');
    if (still || to <= 0) { el.textContent = fmt(to); return; }
    const size = el.dataset.fmt === 'tree' ? to * 20 : el.dataset.fmt === 'g' ? to / 25 : to; // 단위마다 "얼마나 큰 숫자인지"를 비슷하게
    const dur = Math.min(1600, Math.max(700, 600 + Math.log10(size + 1) * 330));
    const t0 = performance.now();
    const tick = (now) => {
      if (!el.isConnected) return;
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3); // 처음엔 빠르게, 끝에서 천천히
      el.textContent = fmt(p >= 1 ? to : to * e);
      if (p < 1) requestAnimationFrame(tick);
      else { el.classList.remove('counting'); el.classList.add('counted'); }
    };
    el.classList.add('counting');
    requestAnimationFrame(tick);
  });
}
// 여러 생활 단위 (도착 화면·설명용)
function senseList(g) {
  const n = (x) => (x >= 10 ? Math.round(x).toLocaleString() : x.toFixed(1).replace(/\.0$/, ''));
  return [
    { icon: '🌳', text: `나무 한 그루가 1년 동안 흡수하는 양의 약 1/${Math.max(1, Math.round(TREE_YEAR_G / g))}` },
    { icon: '🎈', text: `풍선 ${n(g / EQUIV.balloonG)}개를 가득 채우는 양` },
    { icon: '📱', text: `스마트폰 ${n(g / EQUIV.phoneG)}번 충전할 때 나오는 양` },
  ];
}
// 자동차와 비교한 말 ("자동차의 1/80", "자동차의 45%")
function vsCarText(em, baseEm) {
  if (em <= 0) return '배출 0';
  if (baseEm <= 0) return formatG(em);
  const r = baseEm / em;
  return r >= 2 ? `자동차의 1/${Math.round(r)}` : `자동차의 ${Math.round((em / baseEm) * 100)}%`;
}

// ── 내 기록 (이 휴대폰에만 저장) ──
const LOG_KEY = 'pureun-log';
function loadLog() {
  try {
    const l = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
    if (l && typeof l.g === 'number') return l;
  } catch (e) { /* 저장소를 못 쓰면 빈 기록 */ }
  return { g: 0, trips: 0 };
}
function dayKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function saveTrip(g) {
  const l = loadLog();
  l.g += Math.max(0, g);
  l.trips += 1;
  const key = dayKey(new Date());
  l.days = (l.days || []).concat(key).slice(-400); // 이동한 날
  l.daily = l.daily || {}; // 날짜별 { g: 아낀 양, n: 이동 횟수 } — 달력 진하기용
  const d = l.daily[key] || { g: 0, n: 0 };
  d.g += Math.max(0, g); d.n += 1;
  l.daily[key] = d;
  try { localStorage.setItem(LOG_KEY, JSON.stringify(l)); } catch (e) { /* 무시 */ }
  return l;
}

function arriveText(min) {
  const d = new Date(Date.now() + min * 60000);
  const h = d.getHours();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} 도착`;
}
function emissionOf(segments, people = 1) {
  return segments.reduce((sum, s) => sum + s.km * FACTORS[s.mode], 0) / people;
}
function kakaoLink(mode, from, to) {
  if (!from || !to) return null;
  const p = (x) => `${encodeURIComponent(x.name)},${x.lat},${x.lng}`;
  return `https://map.kakao.com/link/by/${mode}/${p(from)}/${p(to)}`;
}
// 받침에 맞춰 조사 붙이기 (버스를 / 지하철을, 버스로 / 지하철로)
function lastCode(w) { const c = String(w).trim().slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : -1; }
function eul(w) { return w + (lastCode(w) > 0 ? '을' : '를'); }
function ro(w) { const j = lastCode(w); return w + (j > 0 && j !== 8 ? '으로' : '로'); }
// 화면에 글자를 넣을 때 특수문자 처리 (검색 결과 등)
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// 3. 지도·검색 API 불러오기
// ---------------------------------------------------------------------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// 카카오맵 SDK (autoload=false → kakao.maps.load 로 준비)
function loadKakaoMaps() {
  return loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=services&autoload=false`)
    .catch(() => { throw new Error('카카오맵을 불러오지 못했어요. JavaScript 키와 등록한 도메인을 확인해 주세요.'); })
    .then(() => new Promise((resolve, reject) => {
      if (!window.kakao || !window.kakao.maps) return reject(new Error('카카오맵 SDK를 읽지 못했어요.'));
      window.kakao.maps.load(() => resolve(window.kakao));
    }));
}

// 네이버 지도 인증 실패 때 "무엇을 고치면 되는지" 알려주는 문구
//  네이버 클라우드 Maps → Application → Web 서비스 URL 에는 포트 없이 주소만 등록해요.
//  (예: http://localhost:5173 ✗ → http://localhost ○)
function naverAuthHelp() {
  const { protocol, hostname, origin } = window.location;
  if (protocol === 'file:') return '네이버 지도 인증 실패: index.html 을 직접 열면 지도가 안 떠요. START.bat 을 실행해서 http://localhost:5173 으로 열어 주세요.';
  return `네이버 지도 인증 실패: 지금 주소는 ${origin} 이에요. 네이버 클라우드 콘솔 → Maps → Application → 수정 → Web 서비스 URL 에 포트 없이 "${protocol}//${hostname}" 을 등록하고, Dynamic Map 이 체크돼 있는지 확인해 주세요. (config.js 의 클라이언트 ID가 그 Application 의 것인지도 확인)`;
}

// 네이버 지도 API v3 (ncpKeyId + geocoder 서브모듈, callback 으로 준비 완료)
// ※ 네이버 지도는 주소 검색 모듈(geocoder)을 document.write 로 불러오는데, 스크립트를 나중에 붙이면
//   브라우저가 이를 막아서 "준비 완료" 신호(callback)가 안 올 때가 있어요 (될 때도 있고 안 될 때도 있음).
//   그래서 지도 본체가 준비되면 신호를 기다리지 않고 시작하고, 주소 검색 모듈은 직접 불러와요.
//   ※ 네이버 인증 서버가 가끔 "500 잠시 후 다시" 로 답하면 지도가 영영 안 떠요 → 7초 안에 안 되면 자동으로 다시 불러요 (최대 3번).
function loadNaverMaps() {
  return new Promise((resolve, reject) => {
    let done = false;
    let tries = 0;
    let poll = null;
    let retryTimer = null;
    const stop = () => { clearInterval(poll); clearTimeout(retryTimer); };
    // "준비 완료" 신호가 와도 지도 본체(naver.maps.Map)가 실제로 있을 때만 끝내요.
    //  (새로고침하면 캐시된 스크립트가 신호를 먼저 보내고 window.naver 는 아직 비어 있는 경우가 있어요 → 그때는 계속 기다려요)
    const libReady = () => !!(window.naver && window.naver.maps && window.naver.maps.Map && window.naver.maps.LatLng);
    const finish = () => {
      if (done) return;
      if (!libReady()) { setTimeout(finish, 150); return; }
      done = true; stop(); resolve(window.naver);
    };
    const fail = (msg) => { if (!done) { done = true; stop(); reject(new Error(msg)); } };
    window.navermap_authFailure = () => {
      const err = new Error(naverAuthHelp());
      if (!done) { done = true; stop(); reject(err); return; }
      state.mapError = err.message; state.naver = null; updateReady(); render(); // 시작한 뒤에 인증 실패가 온 경우
    };
    window.__pureunNaverReady = finish;
    const attempt = () => {
      tries += 1;
      // 지난번에 덜 불러온 스크립트는 지우고 새로 (주소 뒤에 시도 번호를 붙여 캐시도 피해요)
      document.querySelectorAll('script[src*="oapi.map.naver.com"]').forEach((el) => el.remove());
      if (tries > 1) { try { window.naver = undefined; } catch (e) { /* 무시 */ } }
      loadScript(`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_KEY_ID}&submodules=geocoder&callback=__pureunNaverReady${tries > 1 ? `&retry=${tries}` : ''}`)
        .catch(() => { if (tries >= 3) fail('네이버 지도를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'); });
      clearInterval(poll);
      poll = setInterval(() => {
        const nm = window.naver && window.naver.maps;
        if (done) { clearInterval(poll); return; }
        if (nm && nm.Map && nm.LatLng) {
          clearInterval(poll);
          if (nm.Service) { finish(); return; }
          // 주소 검색 모듈이 안 왔으면 직접 불러오고, 실패해도 지도는 써요
          loadScript('https://oapi.map.naver.com/openapi/v3/maps-geocoder.js').catch(() => {}).then(() => setTimeout(finish, 200));
          setTimeout(finish, 2500);
          return;
        }
      }, 250);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (done) return;
        if (tries < 3) { console.warn(`[네이버 지도] ${tries}번째 불러오기가 7초 안에 끝나지 않아 다시 시도해요`); attempt(); }
        else fail('네이버 지도 서버가 응답하지 않아요. 잠시 후 아래 버튼으로 다시 시도해 주세요.');
      }, 7000);
    };
    attempt();
  });
}

// 장소 검색·주소 변환 도우미
// - 카카오가 있으면 장소 이름 검색(강남역, ○○중학교 등)
// - 네이버는 서버 중계로 장소 이름 검색 + Geocoding 으로 주소 검색
// - 행정안전부 도로명주소(서버 중계)로 건물명·도로명·지번 검색 (공식 주소 DB)
//   ※ 도로명주소 결과에는 좌표가 없어서, 고를 때 locate() 로 좌표를 찾아요.
// 검색할 때 "가까운 곳 먼저"의 기준: 도착지 검색이면 출발지, 출발지 검색이면 도착지, 둘 다 없으면 내 위치
function searchBiasPoint() {
  const s = state.search;
  return (s.which === 'to' ? state.from : state.to) || state.me || null;
}

function makePlaceService(kakao, naver) {
  // 도로명주소 검색 결과를 앱 형식으로
  const juso = (q) => {
    if (!serverInfo.jusoSearch) return Promise.resolve({ list: [], error: '' });
    return searchJuso(q).catch((err) => ({ list: [], error: err.message }));
  };
  const merge = (lists, jusoRes) => {
    const seen = new Set();
    const out = [];
    lists.flat().concat(jusoRes.list).forEach((p) => {
      const key = `${p.name}|${p.address}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(p);
    });
    // 도로명주소 키 오류 같은 관리자용 메시지는 사용자에게 보여 주지 않고 콘솔에만 남겨요
    if (jusoRes.error) console.warn('[도로명주소 검색]', jusoRes.error);
    // 가게·상호·역 이름을 먼저, 주소만 있는 결과는 맨 뒤로 (각 묶음 안의 순서는 그대로)
    const isAddr = (p) => p.needsCoords || /주소/.test(p.category || '');
    return out.filter((p) => !isAddr(p)).concat(out.filter(isAddr));
  };

  if (kakao) {
    const KS = kakao.maps.services;
    // 장소·건물·가게 이름 검색 (한 글자부터). 카카오맵의 전국 장소 정보를 그대로 써요.
    //  - 전국 결과를 최대 45개(15개 × 3쪽)까지 받아요. "시대인재"처럼 지점이 많은 곳도 다 보이게.
    //  - 기준 위치가 있으면 각 장소까지 거리를 함께 받아 보여줘요.
    const onePage = (q, page, near) => new Promise((resolve, reject) => {
      const opts = { size: 15, page };
      if (near) opts.location = new kakao.maps.LatLng(near.lat, near.lng);
      new KS.Places().keywordSearch(q, (data, status, pagination) => {
        if (status === KS.Status.OK) resolve({ list: data, more: !!(pagination && pagination.hasNextPage) });
        else if (status === KS.Status.ZERO_RESULT) resolve({ list: [], more: false });
        else reject(new Error('검색 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'));
      }, opts);
    });
    const places = async (q) => {
      const near = searchBiasPoint();
      const first = await onePage(q, 1, near);
      let all = first.list;
      if (first.more && q.length >= 2) {
        const rest = await Promise.all([2, 3].map((pg) => onePage(q, pg, near).catch(() => ({ list: [] }))));
        rest.forEach((r) => { all = all.concat(r.list); });
      }
      return all.map((p) => ({
        name: p.place_name, address: p.road_address_name || p.address_name,
        category: p.category_group_name || String(p.category_name || '').split('>').pop().trim(),
        lat: Number(p.y), lng: Number(p.x),
        distM: p.distance ? Number(p.distance) : null,
      }));
    };
    // 네이버 지도가 있으면 주소 검색도 같이 (도로명·지번 주소를 정확히 찾을 때)
    const naverGeo = (q) => {
      if (!naver || q.length < 2) return Promise.resolve([]);
      return new Promise((resolve) => {
        if (!naver.maps.Service) return resolve([]);
        naver.maps.Service.geocode({ query: q }, (status, response) => {
          if (status !== naver.maps.Service.Status.OK) return resolve([]);
          resolve(((response.v2 && response.v2.addresses) || []).map((a) => ({
            name: a.roadAddress || a.jibunAddress, address: a.jibunAddress || '', category: '주소', lat: Number(a.y), lng: Number(a.x),
          })));
        });
      });
    };
    return {
      byName: true,
      search: (q) => Promise.all([places(q).catch(() => []), naverGeo(q), juso(q)]).then(([a, g, j]) => merge([a, g], j)),
      locate: (item) => new Promise((resolve, reject) => {
        new KS.Geocoder().addressSearch(item.geoQuery || item.address, (res, status) => {
          if (status === KS.Status.OK && res[0]) resolve({ lat: Number(res[0].y), lng: Number(res[0].x) });
          else reject(new Error('이 주소의 위치를 찾지 못했어요. 다른 결과를 골라 주세요.'));
        });
      }),
      reverse: (lat, lng) => new Promise((resolve) => {
        new KS.Geocoder().coord2Address(lng, lat, (res, status) => {
          resolve(status === KS.Status.OK && res[0] ? (res[0].road_address || res[0].address).address_name : '');
        });
      }),
    };
  }
  if (naver) {
    const NS = naver.maps.Service || { geocode: (o, cb) => cb('ERROR'), reverseGeocode: (o, cb) => cb('ERROR'), Status: { OK: 'OK' } };
    // 주소 검색 (네이버 Geocoding)
    const geocode = (q) => new Promise((resolve) => {
      NS.geocode({ query: q }, (status, response) => {
        if (status !== NS.Status.OK) return resolve([]);
        const items = (response.v2 && response.v2.addresses) || [];
        resolve(items.map((a) => ({
          name: a.roadAddress || a.jibunAddress, address: a.jibunAddress || '',
          category: '주소', lat: Number(a.y), lng: Number(a.x),
        })));
      });
    });
    // 장소 이름 검색 (서버 중계 → 네이버 검색 API · 지역)
    const local = (q) => (serverInfo.naverSearch ? searchNaverLocal(q).catch(() => []) : Promise.resolve([]));
    return {
      byName: serverInfo.naverSearch || serverInfo.jusoSearch,
      search: (q) => Promise.all([local(q), geocode(q), juso(q)]).then(([a, b, j]) => merge([a, j.list, b], { list: [], error: j.error })),
      locate: (item) => geocode(item.geoQuery || item.address).then((list) => {
        if (!list.length) throw new Error('이 주소의 위치를 찾지 못했어요. 다른 결과를 골라 주세요.');
        return { lat: list[0].lat, lng: list[0].lng };
      }),
      reverse: (lat, lng) => new Promise((resolve) => {
        NS.reverseGeocode({ coords: new naver.maps.LatLng(lat, lng) }, (status, response) => {
          const a = status === NS.Status.OK && response.v2 && response.v2.address;
          resolve(a ? a.roadAddress || a.jibunAddress || '' : '');
        });
      }),
    };
  }
  return null;
}

// ---------------------------------------------------------------------
// 4. 길찾기 API
// ---------------------------------------------------------------------
// 서버 중계 기능 상태 (server.js 의 /api/status)
const serverInfo = { naverDirections: false, naverSearch: false, jusoSearch: false, kakaoLogin: false, checked: false, online: false };
let serverCheck = null; // checkServer() 진행 상태
function checkServer() {
  return fetch('/api/status')
    .then((r) => (r.ok ? r.json() : {}))
    .then((s) => {
      if (s.version && s.version !== APP_VERSION) console.warn(`서버(${s.version || '예전 버전'})와 앱(${APP_VERSION}) 버전이 달라요. 열려 있는 예전 푸른하늘 창(검은 창)을 모두 닫고 START.bat 을 다시 실행해 주세요.`);
      serverInfo.online = !!s.version; // server.js 로 열었는지 (Live Server 면 false)
      serverInfo.kakaoLogin = !!s.kakaoLogin;
      serverInfo.naverDirections = !!s.naverDirections; serverInfo.naverSearch = !!s.naverSearch; serverInfo.jusoSearch = !!s.jusoSearch; })
    .catch(() => {}) // server.js 없이 열었으면 중계 없이 동작
    .then(() => { serverInfo.checked = true; });
}
async function relayJSON(url) {
  const res = await fetch(url);
  let data = null;
  try { data = await res.json(); } catch (e) { /* 무시 */ }
  if (!res.ok) throw new Error((data && data.error) || `서버 응답 오류(${res.status})`);
  return data;
}

// 네이버 자동차 길찾기 (Directions 5, 서버 중계) → 실제 도로 거리·시간·경로선·회전 안내
async function fetchNaverCarRoute(from, to) {
  const data = await relayJSON(`/api/naver/directions?start=${from.lng},${from.lat}&goal=${to.lng},${to.lat}&option=traoptimal`);
  if (data.code !== 0) throw new Error(`네이버 길찾기: ${data.message || '경로를 찾지 못했어요.'}`);
  const key = Object.keys(data.route || {})[0];
  const r = key && data.route[key][0];
  if (!r) throw new Error('네이버 길찾기: 경로가 비어 있어요.');
  const path = (r.path || []).map(([lng, lat]) => ({ lng, lat }));
  const guides = (r.guide || []).map((g) => ({
    text: g.instructions || '계속 가요',
    sub: g.distance ? `${formatM(g.distance)} 앞` : '',
    target: path[g.pointIndex] || null,
  }));
  return { km: r.summary.distance / 1000, minutes: Math.round(r.summary.duration / 60000), path, guides, source: 'naver' };
}

// 네이버 장소 이름 검색 (서버 중계)
async function searchNaverLocal(q) {
  const data = await relayJSON(`/api/naver/local?query=${encodeURIComponent(q)}`);
  const strip = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  return (data.items || []).map((it) => {
    // mapx, mapy: WGS84 경도·위도 × 10,000,000
    const lng = Number(it.mapx) / 1e7;
    const lat = Number(it.mapy) / 1e7;
    return { name: strip(it.title), address: it.roadAddress || it.address || '', category: strip(it.category).split('>').pop(), lat, lng };
  }).filter((p) => p.lat > 33 && p.lat < 39 && p.lng > 124 && p.lng < 132);
}

// 행정안전부 도로명주소 검색 (서버 중계) — 건물명, 도로명, 지번으로 찾기
async function searchJuso(q) {
  const data = await relayJSON(`/api/juso?keyword=${encodeURIComponent(q)}`);
  const list = (data.items || []).map((j) => ({
    name: j.bdNm ? j.bdNm : j.roadAddrPart1 || j.roadAddr,
    address: j.roadAddr,
    category: j.bdNm ? '건물 · 도로명주소' : '도로명주소',
    geoQuery: j.roadAddrPart1 || j.roadAddr, // 좌표 찾기에 쓸 주소 (괄호 속 참고항목 제외)
    needsCoords: true,
  }));
  return { list, error: data.error || '' };
}

// 자동차 길찾기: 네이버(중계) → 카카오모빌리티 → 없으면 추정
function fetchAnyCarRoute(from, to) {
  if (serverInfo.naverDirections) {
    return fetchNaverCarRoute(from, to).catch((err) => (HAS_REST ? fetchCarRoute(from, to) : Promise.reject(err)));
  }
  return HAS_REST ? fetchCarRoute(from, to) : Promise.reject(new Error('nokey'));
}

// 카카오모빌리티 자동차 길찾기 → 실제 도로 거리·시간·경로선·회전 안내
async function fetchCarRoute(from, to) {
  const url = `https://apis-navi.kakaomobility.com/v1/directions?origin=${from.lng},${from.lat}&destination=${to.lng},${to.lat}&priority=RECOMMEND`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } });
  if (!res.ok) throw new Error(`자동차 길찾기 응답 오류(${res.status}). REST API 키를 확인해 주세요.`);
  const data = await res.json();
  const r = data.routes && data.routes[0];
  if (!r || r.result_code !== 0) throw new Error((r && r.result_msg) || '자동차 경로를 찾지 못했어요.');
  const path = [];
  const guides = [];
  r.sections.forEach((sec) => {
    (sec.roads || []).forEach((road) => {
      for (let i = 0; i + 1 < road.vertexes.length; i += 2) path.push({ lng: road.vertexes[i], lat: road.vertexes[i + 1] });
    });
    (sec.guides || []).forEach((g) => {
      if (g.type === 100) return; // 출발 지점 안내는 건너뜀
      guides.push({ text: g.guidance || '계속 가요', sub: g.name || '', target: { lat: g.y, lng: g.x } });
    });
  });
  return { km: r.summary.distance / 1000, minutes: Math.round(r.summary.duration / 60), path, guides };
}

// ODsay 공통 호출
async function odsay(api, params) {
  const qs = new URLSearchParams({ ...params, apiKey: ODSAY_KEY }).toString();
  const res = await fetch(`https://api.odsay.com/v1/api/${api}?${qs}`);
  const data = await res.json();
  if (data.error) {
    const e = Array.isArray(data.error) ? data.error[0] : data.error;
    const err = new Error((e && (e.message || e.msg)) || '대중교통 길찾기 오류');
    err.code = e && String(e.code);
    throw err;
  }
  return data.result;
}

// ODsay 대중교통 길찾기 → 경로 후보 여러 개
// ODsay 무료(Basic)는 하루 호출 수가 적어서, 같은 날 같은 출발·도착은 저장해 둔 결과를 다시 써요.
const ODSAY_CACHE_PREFIX = 'pureun-odsay:';
function odsayCacheGet(key) {
  try {
    const hit = JSON.parse(localStorage.getItem(ODSAY_CACHE_PREFIX + key) || 'null');
    if (hit && hit.day === new Date().toDateString()) return hit.data;
  } catch (e) { /* 저장소를 못 쓰면 그냥 새로 불러요 */ }
  return null;
}
function odsayCacheSet(key, data) {
  try {
    localStorage.setItem(ODSAY_CACHE_PREFIX + key, JSON.stringify({ day: new Date().toDateString(), data }));
  } catch (e) { /* 무시 */ }
}
async function fetchTransit(from, to) {
  const r4 = (n) => Number(n).toFixed(4); // 약 10m 단위로 같은 장소 취급
  const key = `path:${r4(from.lng)},${r4(from.lat)}>${r4(to.lng)},${r4(to.lat)}`;
  const cached = odsayCacheGet(key);
  if (cached) return cached;
  const result = await odsay('searchPubTransPathT', { SX: from.lng, SY: from.lat, EX: to.lng, EY: to.lat });
  const paths = (result && result.path) || [];
  odsayCacheSet(key, paths);
  return paths;
}

// ODsay 노선 모양(실제 선로·도로를 따라가는 좌표) — 고른 경로만 불러와요
async function fetchLaneShape(mapObj) {
  const key = `lane:${mapObj}`;
  const cached = odsayCacheGet(key);
  if (cached) return cached;
  const result = await odsay('loadLane', { mapObject: `0:0@${mapObj}` });
  const shapes = ((result && result.lane) || []).map((lane) =>
    (lane.section || []).flatMap((sec) => (sec.graphPos || []).map((g) => ({ lat: Number(g.y), lng: Number(g.x) })))
  );
  odsayCacheSet(key, shapes);
  return shapes;
}

// ---------------------------------------------------------------------
// 5. 경로 후보 만들기
//    route = {
//      id, name, kind, real,
//      segments: [{ mode, km, min, name, color }]   ← 시간 막대·탄소 계산
//      legs:     [{ mode, name, color, start, end }] ← 카드의 노선 목록
//      steps:    [{ mode, text, sub, target, radius }] ← 단계별 안내
//      lines:    [{ mode, color, path, dashed, legIndex }] ← 지도 경로선
//      marks:    [{ lat, lng, label, color }]        ← 지도 정류장 이름표
//      minutes, walkM, transfers, fare, people, kakaoMode, mapObj
//    }
// ---------------------------------------------------------------------
function straightLine(mode, from, to) {
  return from && to ? [{ mode, color: MODES[mode].color, path: [from, to], dashed: true }] : [];
}

// ODsay subPath 목록(startIdx부터)을 앱 형식의 구간으로 바꾸기
function buildTransitLegs(subs, startIdx, startPoint, to) {
  const out = { segments: [], legs: [], steps: [], lines: [], marks: [], walkM: 0, minutes: 0 };
  let prev = startPoint;
  let legIndex = 0;
  for (let i = startIdx; i < subs.length; i++) {
    const sp = subs[i];
    const km = (sp.distance || 0) / 1000;
    out.minutes += sp.sectionTime || 0;
    if (sp.trafficType === 3) {
      out.walkM += sp.distance || 0;
      const next = subs[i + 1];
      const end = next && next.startY ? { lat: Number(next.startY), lng: Number(next.startX) } : { lat: to.lat, lng: to.lng };
      if (sp.distance > 0) {
        const where = next ? (next.trafficType === 1 ? `${next.startName}역` : `${next.startName} 정류장`) : to.name;
        out.steps.push({ mode: 'walk', text: `${where}까지 걸어가요`, sub: `${formatM(sp.distance)} · 약 ${sp.sectionTime}분`, target: end, radius: 30 });
        out.segments.push({ mode: 'walk', km, min: sp.sectionTime || 0, name: '도보', color: MODES.walk.color });
        out.lines.push({ mode: 'walk', color: MODES.walk.color, path: [prev, end], dashed: true });
      }
      prev = end;
      continue;
    }
    const mode = sp.trafficType === 1 ? 'subway' : 'bus';
    const lane = (sp.lane && sp.lane[0]) || {};
    const fullName = mode === 'subway' ? lane.name || '지하철' : `${lane.busNo || ''}번 버스`;
    const shortName = mode === 'subway' ? fullName.replace('수도권 ', '') : String(lane.busNo || '버스');
    const color = mode === 'subway' ? subwayColor(fullName) : busColor(lane.type);
    const start = { lat: Number(sp.startY), lng: Number(sp.startX) };
    const end = { lat: Number(sp.endY), lng: Number(sp.endX) };
    const startLabel = mode === 'subway' ? `${sp.startName}역` : sp.startName;
    const endLabel = mode === 'subway' ? `${sp.endName}역` : sp.endName;
    const unit = mode === 'subway' ? '개 역' : '개 정류장';

    out.segments.push({ mode, km, min: sp.sectionTime || 0, name: shortName, color });
    out.legs.push({ mode, name: shortName, color, start: startLabel, end: endLabel, way: sp.way || '' });
    out.steps.push({
      mode, color,
      text: `${startLabel}에서 ${eul(fullName)} 타요`,
      sub: `${sp.way ? `${sp.way} 방면 · ` : ''}${sp.stationCount}${unit} · 약 ${sp.sectionTime}분`,
      target: start, radius: 40,
    });
    out.steps.push({ mode, color, text: `${endLabel}에서 내려요`, sub: `${fullName} 타는 중`, target: end, radius: 80 });
    const stations = (sp.passStopList && sp.passStopList.stations) || [];
    const path = stations.length > 1 ? stations.map((s) => ({ lat: Number(s.y), lng: Number(s.x) })) : [start, end];
    out.lines.push({ mode, color, path, legIndex: legIndex++ });
    out.marks.push({ ...start, label: startLabel, color });
    prev = end;
  }
  return out;
}

// ODsay 경로 하나 → 대중교통 경로
function transitFromOdsay(p, idx, from, to) {
  const info = p.info || {};
  const t = buildTransitLegs(p.subPath || [], 0, from, to);
  return {
    id: `transit-${idx}`,
    name: t.legs.map((l) => l.name).join(' → ') || '대중교통',
    kind: 'transit',
    real: true,
    segments: t.segments,
    legs: t.legs,
    steps: t.steps,
    lines: t.lines,
    marks: t.marks,
    km: t.segments.reduce((s, x) => s + x.km, 0) || (info.totalDistance || 0) / 1000,
    minutes: info.totalTime || t.minutes,
    walkM: info.totalWalk != null ? info.totalWalk : t.walkM,
    transfers: Math.max(0, t.legs.length - 1),
    fare: info.payment,
    people: 1,
    kakaoMode: 'traffic',
    mapObj: info.mapObj,
  };
}

// ODsay 경로 하나 → "자동차로 첫 지하철역까지 + 나머지 대중교통" (조금 절약용)
function parkRideFromOdsay(p, idx, from, to) {
  const subs = p.subPath || [];
  const k = subs.findIndex((sp) => sp.trafficType === 1);
  if (k < 0) return null;
  const station = { lat: Number(subs[k].startY), lng: Number(subs[k].startX) };
  const carKm = (distM(from, station) / 1000) * ROAD_FACTOR;
  if (carKm < 1.5) return null; // 역이 너무 가까우면 의미 없음
  const carMin = Math.round((carKm / SPEED.car) * 60 + 5); // 주차 5분 포함
  const t = buildTransitLegs(subs, k, station, to);
  const stName = `${subs[k].startName}역`;
  return {
    id: `parkride-${idx}`,
    name: ['자동차', ...t.legs.map((l) => l.name)].join(' → '),
    kind: 'car',
    real: 'partial',
    segments: [{ mode: 'car', km: carKm, min: carMin, name: '자동차', color: MODES.car.color }, ...t.segments],
    legs: [{ mode: 'car', name: '자동차', color: MODES.car.color, start: from.name, end: stName }, ...t.legs],
    steps: [
      { mode: 'car', text: `${stName} 근처 주차장까지 차로 가요`, sub: `약 ${carKm.toFixed(1)}km · ${carMin}분 (주차 포함, 추정)`, target: station, radius: 80 },
      ...t.steps,
    ],
    lines: [{ mode: 'car', color: MODES.car.color, path: [from, station], dashed: true }, ...t.lines],
    marks: t.marks,
    km: carKm + t.segments.reduce((s, x) => s + x.km, 0),
    minutes: carMin + t.minutes,
    walkM: t.walkM,
    transfers: t.legs.length,
    fare: (p.info && p.info.payment) || undefined,
    people: 1,
    kakaoMode: 'traffic',
    mapObj: null,
  };
}

// API 없이 추정하는 대중교통 경로
function transitEstimates(km, from, to) {
  const list = [
    { id: 'est-subway', parts: [['subway', 1]], walkM: 700, extra: 8, minKm: 1.5 },
    { id: 'est-bus-subway', parts: [['bus', 0.3], ['subway', 0.7]], walkM: 400, extra: 12, minKm: 3 },
    { id: 'est-bus', parts: [['bus', 1]], walkM: 300, extra: 7, minKm: 0.8 },
  ];
  return list.filter((t) => km >= t.minKm).map((t) => {
    const walkMin = Math.round((t.walkM / 1000 / SPEED.walk) * 60);
    const segments = [{ mode: 'walk', km: t.walkM / 2000, min: Math.round(walkMin / 2), name: '도보', color: MODES.walk.color }];
    const steps = [];
    t.parts.forEach(([mode, share], i) => {
      const label = MODES[mode].label;
      segments.push({ mode, km: km * share, min: Math.round(((km * share) / SPEED[mode]) * 60) + (i === 0 ? t.extra : 0), name: label, color: MODES[mode].color });
      steps.push({ mode: 'walk', text: i === 0 ? `가까운 ${mode === 'bus' ? '버스 정류장' : '지하철역'}으로 가요` : `${ro(label)} 갈아타요`, sub: '정확한 정류장은 카카오맵 대중교통 안내에서 확인하세요' });
      steps.push({ mode, text: `${eul(label)} 타고 이동해요`, sub: `약 ${(km * share).toFixed(1)}km` });
    });
    segments.push({ mode: 'walk', km: t.walkM / 2000, min: Math.round(walkMin / 2), name: '도보', color: MODES.walk.color });
    steps.push({ mode: 'walk', text: `내려서 ${to ? to.name : '도착지'}까지 걸어가요`, sub: '', target: to || null, radius: ARRIVE_M });
    const name = t.parts.map(([m]) => MODES[m].label).join(' → ');
    return {
      id: t.id, name: `${name} (추정)`, kind: 'transit', real: false, segments,
      legs: t.parts.map(([mode]) => ({ mode, name: MODES[mode].label, color: MODES[mode].color, start: '가까운 정류장', end: '' })),
      steps, lines: straightLine(t.parts[0][0], from, to), marks: [], km,
      minutes: segments.reduce((s, x) => s + x.min, 0), walkM: t.walkM, transfers: t.parts.length - 1, people: 1, kakaoMode: 'traffic',
    };
  });
}

// 자동차: 기준(혼자 타기)
function carRoutes(car, km, from, to) {
  const base = car
    ? { km: car.km, minutes: car.minutes, lines: [{ mode: 'car', color: MODES.car.color, path: car.path }], steps: car.guides.map((g) => ({ ...g, mode: 'car', radius: 50 })), real: true }
    : {
        km, minutes: Math.round((km / SPEED.car) * 60 + 5), lines: straightLine('car', from, to), real: false,
        steps: [{ mode: 'car', text: `${to ? to.name : '도착지'} 방향으로 운전해요`, sub: '자세한 길은 카카오맵 자동차 안내에서 확인하세요', target: to || null, radius: ARRIVE_M }],
      };
  return {
    baseline: {
      id: 'car', name: '혼자 자동차 타기', kind: 'car', real: base.real,
      segments: [{ mode: 'car', km: base.km, min: base.minutes, name: '자동차', color: MODES.car.color }],
      legs: [{ mode: 'car', name: '자동차', color: MODES.car.color, start: from ? from.name : '출발지', end: to ? to.name : '도착지' }],
      steps: base.steps, lines: base.lines, marks: [], km: base.km,
      minutes: base.minutes, walkM: 0, transfers: 0, people: 1, kakaoMode: 'car',
    },
  };
}

// 도보·자전거 (공개 길찾기 API가 없어 직선거리 × 1.25 로 추정)
function activeRoutes(km, from, to) {
  const walkKm = from && to ? (distM(from, to) / 1000) * 1.25 : km;
  const goal = to ? to.name : '도착지';
  const walkMin = Math.max(1, Math.round((walkKm / SPEED.walk) * 60));
  const bikeMin = Math.max(1, Math.round((walkKm / SPEED.bike) * 60 + 3));
  return [
    {
      id: 'walk', name: '걸어서 가기', kind: 'walk', real: false,
      segments: [{ mode: 'walk', km: walkKm, min: walkMin, name: '도보', color: MODES.walk.color }],
      legs: [{ mode: 'walk', name: '도보', color: MODES.walk.color, start: from ? from.name : '출발지', end: goal }],
      steps: [{ mode: 'walk', text: `${goal} 방향으로 걸어가요`, sub: '골목길 안내는 "카카오맵으로 자세히 안내" 버튼을 눌러 함께 보세요', target: to || null, radius: ARRIVE_M }],
      lines: straightLine('walk', from, to), marks: [], km: walkKm, minutes: walkMin, walkM: walkKm * 1000, transfers: 0, people: 1, kakaoMode: 'walk',
    },
    {
      id: 'bike', name: '자전거 타기', kind: 'bike', real: false,
      segments: [{ mode: 'bike', km: walkKm, min: bikeMin, name: '자전거', color: MODES.bike.color }],
      legs: [{ mode: 'bike', name: '자전거', color: MODES.bike.color, start: from ? from.name : '출발지', end: goal }],
      steps: [
        { mode: 'walk', text: '근처에서 자전거를 준비해요', sub: '공공자전거라면 가까운 대여소로 가요' },
        { mode: 'bike', text: `${goal} 방향으로 자전거를 타요`, sub: '자전거도로 안내는 "카카오맵으로 자세히 안내" 버튼을 눌러 보세요', target: to || null, radius: ARRIVE_M },
      ],
      lines: straightLine('bike', from, to), marks: [], km: walkKm, minutes: bikeMin, walkM: 150, transfers: 0, people: 1, kakaoMode: 'bicycle',
    },
  ];
}

// 이동수단별 시간 합계 (대중교통 / 도보 / 자동차 / 자전거)
function timeByMode(route) {
  const t = { transit: 0, walk: 0, car: 0, bike: 0 };
  route.segments.forEach((s) => {
    if (s.mode === 'bus' || s.mode === 'subway') t.transit += s.min;
    else t[s.mode] += s.min;
  });
  return t;
}

const SORTERS = {
  fast: (a, b) => a.minutes - b.minutes,
  lessWalk: (a, b) => a.walkM - b.walkM || a.minutes - b.minutes,
  lessTransfer: (a, b) => a.transfers - b.transfers || a.minutes - b.minutes,
  greenest: (a, b) => a.emission - b.emission || a.minutes - b.minutes,
};

// 후보 경로에 탄소·절약률·단계·취향 조건을 붙이고 단계별로 나누기
function rankRoutes(raw, prefs) {
  const baseEm = emissionOf(raw.baseline.segments);
  const baseline = { ...raw.baseline, emission: baseEm, saving: 0, savingPct: 0, time: timeByMode(raw.baseline) };
  const all = raw.candidates.map((r) => {
    const emission = emissionOf(r.segments, r.people);
    const saving = baseEm - emission;
    const savingPct = baseEm > 0 ? (saving / baseEm) * 100 : 0;
    let blocked = null;
    if (r.kind === 'bike' && !prefs.canBike) blocked = '자전거 끔';
    else if (r.kind === 'bike' && r.km > 15) blocked = '15km 초과';
    else if (r.kind === 'car' && !prefs.hasCar) blocked = '자동차 끔';
    else if (r.walkM > prefs.maxWalkM) blocked = `도보 ${formatM(prefs.maxWalkM)} 초과`;
    return { ...r, emission, saving, savingPct, time: timeByMode(r), tier: TIER_BY_SAVING.find((t) => savingPct >= t.min) || null, blocked };
  });
  const sorter = SORTERS[prefs.sort] || SORTERS.fast;
  const byTier = {};
  TIERS.forEach((t) => {
    const list = all.filter((r) => !r.blocked && r.tier && r.tier.id === t.id).sort(sorter);
    // 같은 단계 안에서 "최소시간", "최소탄소" 표시
    if (list.length > 1) {
      const fastest = list.reduce((a, b) => (b.minutes < a.minutes ? b : a));
      const greenest = list.reduce((a, b) => (b.emission < a.emission ? b : a));
      list.forEach((r) => { r.badges = []; });
      fastest.badges.push('최소시간');
      if (greenest !== fastest) greenest.badges.push('최소탄소');
    } else list.forEach((r) => { r.badges = []; });
    byTier[t.id] = list;
  });
  return { baseline, all, byTier };
}

// ---------------------------------------------------------------------
// 6. 지도 그리기 — 네이버/카카오 모두 같은 방식(draw, setMe, fit)으로 쓸 수 있게 감쌌어요
// ---------------------------------------------------------------------
const lineColor = (ln) => ln.color || MODES[ln.mode].color;

function createKakaoMap(kakao, el) {
  const map = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(37.5665, 126.978), level: 7 });
  if (kakao.maps.CopyrightPosition) map.setCopyrightPosition(kakao.maps.CopyrightPosition.BOTTOMRIGHT, true); // 로고: 오른쪽 아래
  const LL = (p) => new kakao.maps.LatLng(p.lat, p.lng);
  let drawn = [];
  let meOverlay = null;
  let lastBounds = null;
  const overlay = (pos, html, z, yAnchor) => {
    const ov = new kakao.maps.CustomOverlay({ position: pos, content: html, yAnchor: yAnchor == null ? 0.5 : yAnchor, zIndex: z });
    ov.setMap(map);
    drawn.push(ov);
  };
  return {
    draw(from, to, lines, marks) {
      drawn.forEach((o) => o.setMap(null));
      drawn = [];
      const bounds = new kakao.maps.LatLngBounds();
      let count = 0;
      (lines || []).forEach((ln) => {
        if (!ln.path || ln.path.length < 2) return;
        const path = ln.path.map(LL);
        // 흰 테두리 + 색 선 (네이버 지도처럼 또렷하게)
        if (!ln.dashed) {
          const under = new kakao.maps.Polyline({ path, strokeWeight: 10, strokeColor: '#ffffff', strokeOpacity: 0.9 });
          under.setMap(map);
          drawn.push(under);
        }
        const poly = new kakao.maps.Polyline({
          path, strokeWeight: ln.dashed ? 5 : 7, strokeColor: lineColor(ln), strokeOpacity: 1, strokeStyle: ln.dashed ? 'shortdash' : 'solid',
        });
        poly.setMap(map);
        drawn.push(poly);
        path.forEach((p) => { bounds.extend(p); count++; });
      });
      (marks || []).forEach((m) => overlay(LL(m), `<div class="st-pill" style="--c:${m.color}">${esc(m.label)}</div>`, 4, 1.25));
      [[from, 'from'], [to, 'to']].forEach(([place, kind]) => {
        if (!place) return;
        const pos = LL(place);
        overlay(pos, `<div class="pin pin-${kind}">${kind === 'from' ? '출발' : '도착'}</div>`, 6, 1.4);
        overlay(pos, `<div class="end-dot end-${kind}"></div>`, 5);
        bounds.extend(pos);
        count++;
      });
      lastBounds = count >= 2 ? bounds : null;
      this.fit();
      if (count === 1) { map.setCenter(LL(from || to)); map.setLevel(4); }
    },
    fit() { if (lastBounds) map.setBounds(lastBounds, 70, 40, 50, 40); },
    setMe(me, follow) {
      if (!me) return;
      const pos = LL(me);
      if (!meOverlay) {
        meOverlay = new kakao.maps.CustomOverlay({ position: pos, content: '<div class="me-dot"></div>', zIndex: 7 });
        meOverlay.setMap(map);
      } else meOverlay.setPosition(pos);
      if (follow) { if (map.getLevel() > 4) map.setLevel(3); map.panTo(pos); }
    },
  };
}

function createNaverMap(naver, el) {
  const map = new naver.maps.Map(el, {
    center: new naver.maps.LatLng(37.5665, 126.978), zoom: 13, scaleControl: false, mapDataControl: false,
    logoControlOptions: { position: naver.maps.Position.BOTTOM_RIGHT }, // NAVER 로고: 지도 오른쪽 아래
  });
  const LL = (p) => new naver.maps.LatLng(p.lat, p.lng);
  let drawn = [];
  let meMarker = null;
  let lastBounds = null;
  const marker = (pos, html, z) => {
    drawn.push(new naver.maps.Marker({ map, position: pos, zIndex: z, icon: { content: `<div class="n-anchor">${html}</div>`, anchor: new naver.maps.Point(0, 0) } }));
  };
  return {
    draw(from, to, lines, marks) {
      drawn.forEach((o) => o.setMap(null));
      drawn = [];
      const pts = [];
      (lines || []).forEach((ln) => {
        if (!ln.path || ln.path.length < 2) return;
        const path = ln.path.map(LL);
        if (!ln.dashed) {
          drawn.push(new naver.maps.Polyline({ map, path, strokeColor: '#ffffff', strokeWeight: 10, strokeOpacity: 0.9, strokeLineCap: 'round', strokeLineJoin: 'round' }));
        }
        drawn.push(new naver.maps.Polyline({
          map, path, strokeColor: lineColor(ln), strokeWeight: ln.dashed ? 5 : 7, strokeOpacity: 1,
          strokeStyle: ln.dashed ? 'shortdash' : 'solid', strokeLineCap: 'round', strokeLineJoin: 'round',
        }));
        pts.push(...path);
      });
      (marks || []).forEach((m) => marker(LL(m), `<div class="st-pill n-st" style="--c:${m.color}">${esc(m.label)}</div>`, 4));
      [[from, 'from'], [to, 'to']].forEach(([place, kind]) => {
        if (!place) return;
        const pos = LL(place);
        marker(pos, `<div class="pin pin-${kind} n-pin">${kind === 'from' ? '출발' : '도착'}</div><div class="end-dot end-${kind} n-end"></div>`, 6);
        pts.push(pos);
      });
      if (pts.length >= 2) {
        let bounds = new naver.maps.LatLngBounds(pts[0], pts[0]);
        pts.forEach((p) => { bounds = bounds.extend(p); });
        lastBounds = bounds;
        this.fit();
      } else {
        lastBounds = null;
        if (pts.length === 1) { map.setCenter(pts[0]); map.setZoom(16); }
      }
    },
    fit() { if (lastBounds) map.fitBounds(lastBounds, { top: 70, right: 40, bottom: 50, left: 40 }); },
    setMe(me, follow) {
      if (!me) return;
      const pos = LL(me);
      if (!meMarker) {
        meMarker = new naver.maps.Marker({ map, position: pos, zIndex: 7, icon: { content: '<div class="n-anchor"><div class="me-dot n-me"></div></div>', anchor: new naver.maps.Point(0, 0) } });
      } else meMarker.setPosition(pos);
      if (follow) { if (map.getZoom() < 16) map.setZoom(17); map.panTo(pos); }
    },
  };
}

function createMap(el) {
  if (MAP_KIND === 'naver' && state.naver) return createNaverMap(state.naver, el);
  if (state.kakao) return createKakaoMap(state.kakao, el);
  return null;
}

// ---------------------------------------------------------------------
// 6-1. 로그인
//  처음 켜면 로그인 화면이 나오고, 한 번 로그인하면 이 휴대폰에 기억해요.
//  - 카카오: 진짜 카카오 로그인 (server.js 가 중계, 키는 private/keys.json)
//            키를 넣기 전에는 체험용으로 바로 로그인돼요.
//  - 이메일: 서버 회원 DB(/api/auth/*)에 가입·로그인해요. DB가 없는 곳에서는 체험용이에요.
//    비밀번호는 절대 이 앱(localStorage)에 저장하지 않아요.
//  - 로그인하면 서버가 출입증 쿠키를 주고, 기록은 서버 DB에 저장돼요 (아래 "서버 DB 연결")
// ---------------------------------------------------------------------
const USER_KEY = 'pureun-user';
function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
}
// remember=true: 계속 로그인 / false: 이 브라우저 창을 닫으면 로그아웃
function saveUser(u, remember = true) {
  try {
    localStorage.removeItem(USER_KEY); sessionStorage.removeItem(USER_KEY);
    if (u) (remember ? localStorage : sessionStorage).setItem(USER_KEY, JSON.stringify(u));
  } catch (e) { /* 무시 */ }
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 회원 DB 호출. 서버가 없거나 DB가 연결 안 된 곳(404·503)이면 demo(체험용 사용자)를 돌려줘요.
async function authCall(kind, payload, demo) {
  let res;
  try {
    res = await fetch(`/api/auth/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (e) { return demo; }
  if (res.status === 404 || res.status === 503 || res.status === 405) return demo;
  let data = null;
  try { data = await res.json(); } catch (e) { /* 무시 */ }
  if (res.ok && data && data.needCode) return data; // 메일로 보낸 인증 코드를 입력하는 화면으로
  if (!res.ok || !data || !data.user) throw new Error((data && data.error) || '잠시 후 다시 시도해 주세요.');
  return data.user;
}
const AUTH = {
  // 카카오: server.js 에 키가 있으면 카카오 로그인 화면으로 이동, 없으면 체험용
  kakao: (remember = true) => (serverCheck || Promise.resolve()).then(() => {
    if (!serverInfo.kakaoLogin) return { provider: 'kakao', name: '카카오 사용자', demo: true };
    const st = Math.random().toString(36).slice(2) + Date.now().toString(36) + (remember ? '' : '.r0'); // .r0: 로그인 유지 안 함
    try { sessionStorage.setItem('pureun-kakao-state', st); } catch (e) { /* 무시 */ }
    window.location.href = `/api/kakao/start?state=${encodeURIComponent(st)}`;
    return new Promise(() => {}); // 카카오 화면으로 넘어가는 중
  }),
  // 빈 칸으로 로그인: 관리자 계정으로 바로 (서버가 관리자 계정을 골라요, 서버 없는 곳에선 체험용 관리자)
  quick: (remember = true) => authCall('login', { email: '', pw: '', remember }, { provider: 'email', email: 'admin@bluesky.kr', name: '관리자', role: 'admin', demo: true }),
  // 이메일 로그인·가입: 서버 DB(/api/auth/*)에 저장해요. DB가 없는 곳(내 맥 server.js 등)에서는 체험용으로 동작해요.
  email: (email, pw, remember = true) => {
    if (!EMAIL_RE.test(email)) return Promise.reject(new Error('이메일 주소를 확인해 주세요.'));
    if (pw.length < 8) return Promise.reject(new Error('비밀번호는 8자 이상이에요.'));
    return authCall('login', { email, pw, remember }, { provider: 'email', email, name: email.split('@')[0] });
  },
  signup: (name, email, pw, pw2, remember = true) => {
    if (!name) return Promise.reject(new Error('이름(닉네임)을 적어 주세요.'));
    if (!EMAIL_RE.test(email)) return Promise.reject(new Error('이메일 주소를 확인해 주세요.'));
    if (pw.length < 8) return Promise.reject(new Error('비밀번호는 8자 이상으로 만들어 주세요.'));
    if (pw !== pw2) return Promise.reject(new Error('비밀번호가 서로 달라요.'));
    return authCall('signup', { name, email, pw, remember }, { provider: 'email', email, name });
  },
};

// ---------------------------------------------------------------------
// 7. 앱 상태
// ---------------------------------------------------------------------
const state = {
  rank: null, // 이달의 랭킹 (서버 DB)
  campRanks: {}, // 캠페인 참여자 랭킹 (서버 DB, 캠페인 번호별)
  kakao: null,
  naver: null,
  places: null, // 장소 검색 도우미
  ready: false, // 지도와 검색을 쓸 수 있는지
  mapError: MAP_KIND ? '' : 'nokey',

  user: loadUser(), // 로그인한 사람 (없으면 로그인 화면부터)
  auth: { busy: false, message: '' },
  screen: loadUser() ? 'main' : 'login', // login → main → home(길찾기) → search → result → nav → done
  from: null,
  to: null,
  manualKm: '10', // 지도 키가 없을 때 직접 넣는 거리

  raw: null, // 길찾기 결과(후보)
  loading: false,
  notes: [],
  routeToken: 0,

  level: 'mid',
  prefs: { sort: 'fast', maxWalkM: Infinity, canBike: true, hasCar: true }, // 거르기 없이 정렬만 바꿔요
  chosenId: null,
  openDetail: null, // 상세보기를 펼친 경로
  cmpOpen: false, // "자동차보다 얼마나 아낄까요?" 목록을 펼쳤는지 (탭을 바꿔도 그대로)

  search: { which: 'from', query: '', results: [], message: '', busy: false },

  step: 0,
  me: null,
  gpsMsg: '',
  follow: true,
  watchId: null,
  wakeLock: null,
};
let mapCtl = null; // 지금 화면의 지도

function updateReady() {
  state.places = makePlaceService(state.kakao, state.naver);
  state.ready = (MAP_KIND === 'naver' ? !!state.naver : !!state.kakao) && !!state.places;
}

// 지금 쓸 경로 후보 (지도 키가 없으면 거리만으로 추정)
function currentSource() {
  if (state.ready) return state.raw;
  const km = Number(state.manualKm) || 0;
  if (km <= 0) return null;
  const cars = carRoutes(null, km, null, null);
  return { baseline: cars.baseline, candidates: [...activeRoutes(km, null, null), ...transitEstimates(km, null, null)] };
}
function currentPlan() {
  const source = currentSource();
  const ranked = source ? rankRoutes(source, state.prefs) : null;
  const options = !ranked ? [] : state.campTrip ? campOptions(ranked, state.campTrip.mode) : ranked.byTier[state.level];
  const chosen = options.find((r) => r.id === state.chosenId) || options[0] || null;
  return { source, ranked, options, chosen };
}

// 출발·도착이 정해지면 실제 길찾기 실행
function findRoutes() {
  const { from, to } = state;
  if (!state.ready || !from || !to) { state.raw = null; return; }
  const token = ++state.routeToken;
  state.loading = true;
  state.chosenId = null;
  state.openDetail = null;
  const estKm = (distM(from, to) / 1000) * ROAD_FACTOR;
  Promise.allSettled([
    fetchAnyCarRoute(from, to),
    HAS_ODSAY ? fetchTransit(from, to) : Promise.reject(new Error('nokey')),
  ]).then(([carRes, transitRes]) => {
    if (token !== state.routeToken) return; // 그 사이 출발·도착이 바뀜
    const msgs = [];
    const car = carRes.status === 'fulfilled' ? carRes.value : null;
    if (!car) msgs.push(carRes.reason.message === 'nokey' ? '자동차 길찾기 키가 없어 자동차 경로는 추정값이에요.' : `${carRes.reason.message} (자동차 경로는 추정값으로 계산했어요)`);
    let transit = [];
    if (transitRes.status === 'fulfilled') {
      const paths = transitRes.value.slice(0, 8);
      transit = paths.map((p, i) => transitFromOdsay(p, i, from, to));
      paths.slice(0, 3).forEach((p, i) => { const pr = parkRideFromOdsay(p, i, from, to); if (pr) transit.push(pr); });
      if (!paths.length) msgs.push('대중교통 경로를 찾지 못했어요.');
    } else {
      const r = transitRes.reason;
      if (r.message === 'nokey') { msgs.push('ODsay 키가 없어 대중교통 경로는 추정값이에요.'); transit = transitEstimates(car ? car.km : estKm, from, to); }
      else if (r.code === '-98') msgs.push('출발지와 도착지가 가까워서(700m 이내) 대중교통 경로가 없어요.');
      else { msgs.push(`대중교통 길찾기 오류: ${r.message}`); transit = transitEstimates(car ? car.km : estKm, from, to); }
    }
    const cars = carRoutes(car, estKm, from, to);
    state.raw = { baseline: cars.baseline, candidates: [...activeRoutes(estKm, from, to), ...transit] };
    state.notes = msgs;
    state.loading = false;
    if (state.screen === 'home') render();
    else if (state.screen === 'result') { renderResultSheet(); drawChosen(); }
  });
}

// 고른 대중교통 경로의 실제 노선 모양 불러오기 (한 번 불러오면 기억)
const laneCache = {};
function loadShapeFor(route) {
  if (!route || !route.mapObj || !HAS_ODSAY || laneCache[route.mapObj]) return;
  laneCache[route.mapObj] = 'loading';
  fetchLaneShape(route.mapObj)
    .then((shapes) => {
      laneCache[route.mapObj] = 'done';
      const raw = state.raw && state.raw.candidates.find((r) => r.mapObj === route.mapObj);
      if (!raw) return;
      raw.lines.forEach((ln) => {
        if (ln.legIndex != null && shapes[ln.legIndex] && shapes[ln.legIndex].length > 1) ln.path = shapes[ln.legIndex];
      });
      const { chosen } = currentPlan();
      if (!chosen || chosen.mapObj !== route.mapObj || !mapCtl) return;
      if (state.screen === 'nav') { mapCtl.draw(state.from, state.to, chosen.lines, chosen.marks); mapCtl.setMe(state.me, false); }
      else drawChosen();
    })
    .catch(() => { laneCache[route.mapObj] = 'fail'; });
}

function drawChosen() {
  const { chosen } = currentPlan();
  if (!mapCtl) return;
  if (!chosen) { mapCtl.draw(state.from, state.to, [], []); return; }
  mapCtl.draw(state.from, state.to, chosen.lines, chosen.marks);
  // 노선 실제 모양(loadLane)은 호출 수를 아끼려고 "안내 시작" 때만 불러와요
}

// ---------------------------------------------------------------------
// 8. 화면(HTML) 만들기
// ---------------------------------------------------------------------
function appBar(title, backAct) {
  return `<header class="appbar">
    ${backAct ? `<button type="button" class="icon-btn" data-act="${backAct}" aria-label="뒤로">←</button>` : ''}
    ${title ? `<h1>${esc(title)}</h1>` : '<h1 class="brand"><span class="brand-mark" aria-hidden="true"></span>푸른하늘</h1>'}
  </header>`;
}
function cta(inner) {
  return `<div class="cta" id="cta">${inner}</div>`;
}

// 출발·도착 입력칸 (홈·결과 화면 공통)
function tripBox(compact) {
  const row = (place, act, cls, ph) => `
    <button type="button" class="trip-row" data-act="${act}">
      <span class="dot ${cls}" aria-hidden="true"></span>
      ${place ? `<span class="trip-name">${esc(place.name)}</span>` : `<span class="placeholder">${ph}</span>`}
    </button>`;
  return `<div class="trip-box ${compact ? 'compact' : ''}">
    <div class="trip-rows">
      ${row(state.from, 'open-search-from', '', '출발지 입력')}
      ${row(state.to, 'open-search-to', 'to', '도착지 입력')}
    </div>
    <button type="button" class="swap-btn" data-act="swap" aria-label="출발·도착 바꾸기">⇅</button>
  </div>`;
}

// ── 로그인 ──
// 로그인 화면 문구 (KO / EN)
const LOGIN_I18N = {
  ko: { eyebrow: '푸른하늘', title: '탄소 줄이는 길찾기', chip: '이메일로 로그인', email: '이메일', password: '비밀번호', showPw: '비밀번호 보기', hidePw: '비밀번호 숨기기', login: '로그인', remember: '로그인 유지', forgot: '비밀번호 찾기', or: '또는', kakao: '카카오 로그인', noAccount: '아직 푸른하늘 회원이 아니신가요?', signup: '회원가입',
    errEmailEmpty: '이메일을 입력해 주세요.', errEmailFormat: '올바른 이메일 형식이 아닙니다.', errPwEmpty: '비밀번호를 입력해 주세요.', errPwShort: '비밀번호는 8자 이상이에요.', errKakao: '카카오 로그인에 실패했어요. 다시 시도해 주세요.',
    demoLive: '지금은 체험용 로그인이에요', demoKey: '지금은 체험용 로그인이에요', demoEmail: '지금은 체험용 로그인이에요', soon: '준비 중인 기능이에요' },
  en: { eyebrow: 'Welcome', title: 'Make the sky bluer', chip: 'Log in with email', email: 'Email', password: 'Password', showPw: 'Show password', hidePw: 'Hide password', login: 'Log in', remember: 'Keep me logged in', forgot: 'Forgot password?', or: 'or', kakao: 'Login with Kakao', noAccount: 'New to Blue Sky?', signup: 'Sign up',
    errEmailEmpty: 'Please enter your email.', errEmailFormat: 'Please enter a valid email address.', errPwEmpty: 'Please enter your password.', errPwShort: 'Password must be at least 8 characters.', errKakao: 'Kakao login failed. Please try again.',
    demoLive: 'Opened with Live Server, so Kakao login is a demo', demoKey: 'Kakao key not set yet, so login is a demo', demoEmail: 'No member DB yet, so email login is a demo', soon: 'Coming soon' },
};
function loginLang() {
  if (!state.loginLang) {
    let saved = null;
    try { saved = localStorage.getItem('bluesky_lang'); } catch (e) { /* 무시 */ }
    state.loginLang = saved || (String(navigator.language || 'ko').startsWith('ko') ? 'ko' : 'en');
  }
  return state.loginLang;
}
const LI = (k) => LOGIN_I18N[loginLang()][k] || LOGIN_I18N.ko[k] || k;
const SVG_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
const SVG_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const SVG_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const SVG_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const SVG_KAKAO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M12 3C6.48 3 2 6.48 2 10.78c0 2.78 1.86 5.21 4.66 6.59l-.95 3.48c-.08.3.26.54.52.37l4.14-2.74c.53.07 1.07.11 1.63.11 5.52 0 10-3.48 10-7.81S17.52 3 12 3z"/></svg>';
function loginHTML() {
  const a = state.auth;
  const d = a.draft || {};
  const err = a.errKey ? LI(a.errKey) : a.message || '';
  const bad = (f) => (a.errField === f || a.errField === 'both' ? 'invalid' : '');
  const showPw = !!state.loginShowPw;
  const remember = d.remember !== false;
  const demo = serverInfo.checked && !serverInfo.kakaoLogin ? (serverInfo.online ? LI('demoKey') : LI('demoLive')) : '';
  return `<main class="lg">
    <div class="lg-wrap">
      <header class="lg-head">
        <div class="lg-brand">
          <span class="lg-mark"><span class="brand-mark" aria-hidden="true"></span></span>
          <span><b>${loginLang() === 'en' ? 'Blue Sky' : '푸른하늘'}</b></span>
        </div>
        <div class="lg-lang" role="group" aria-label="Language">
          <button type="button" data-act="login-lang" data-id="ko" aria-pressed="${loginLang() === 'ko'}">KO</button>
          <button type="button" data-act="login-lang" data-id="en" aria-pressed="${loginLang() === 'en'}">EN</button>
        </div>
      </header>

      <section class="lg-hero">
        <p>${LI('eyebrow')}</p>
        <h1>${LI('title')}</h1>
      </section>

      <section class="lg-card">
        <span class="lg-chip">${SVG_MAIL}<span>${LI('chip')}</span></span>
        <form id="login-form" novalidate>
          <label class="lg-field ${bad('email')}">${SVG_MAIL}
            <input name="email" type="email" autocomplete="email" inputmode="email" placeholder="${LI('email')}" value="${esc(d.email || '')}">
          </label>
          <label class="lg-field ${bad('pw')}">${SVG_LOCK}
            <input name="pw" type="${showPw ? 'text' : 'password'}" autocomplete="current-password" placeholder="${LI('password')}">
            <button type="button" class="lg-eye" data-act="toggle-pw" aria-label="${LI(showPw ? 'hidePw' : 'showPw')}">${showPw ? SVG_EYE_OFF : SVG_EYE}</button>
          </label>
          <p class="lg-err" role="alert">${esc(err)}</p>
          <button type="submit" class="lg-btn lg-primary" ${a.busy ? 'disabled' : ''}>${a.busy ? '<span class="lg-spin"></span>' : LI('login')}</button>
          <div class="lg-opts">
            <label><input type="checkbox" name="remember" ${remember ? 'checked' : ''}> <span>${LI('remember')}</span></label>
            <button type="button" class="lg-link" data-act="soon-login">${LI('forgot')}</button>
          </div>
        </form>
        <div class="lg-or">${LI('or')}</div>
        <button type="button" class="lg-btn lg-kakao" data-act="login-kakao" ${a.busy ? 'disabled' : ''}>${SVG_KAKAO}<span>${LI('kakao')}</span></button>
        ${demo ? `<p class="lg-demo">${esc(demo)}</p>` : ''}
      </section>

      <p class="lg-signup">${LI('noAccount')}<button type="button" data-act="to-signup">${LI('signup')}</button></p>
    </div>
    <footer class="lg-foot">© Blue Sky. All Rights Reserved. <span>v${APP_VERSION}</span></footer>
  </main>`;
}
function emailLoginHTML() {
  const { busy, message } = state.auth;
  const d = state.auth.draft || {};
  return `${appBar('이메일로 로그인', 'to-login')}
    <main class="content auth-form">
      <form id="login-form" class="auth-fields" novalidate>
        <label class="field"><span class="label">이메일</span>
          <input class="input" name="email" type="email" autocomplete="email" inputmode="email" placeholder="name@example.com" value="${esc(d.email || '')}" required></label>
        <label class="field"><span class="label">비밀번호</span>
          <input class="input" name="pw" type="password" autocomplete="current-password" placeholder="8자 이상" required></label>
        ${message ? `<p class="login-msg" role="alert">${esc(message)}</p>` : ''}
        <button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>로그인</button>
      </form>
      <button type="button" class="signup-link inline" data-act="to-signup">회원가입하기</button>
    </main>`;
}
function signupHTML() {
  const { busy, message } = state.auth;
  const d = state.auth.draft || {};
  return `${appBar('회원가입', 'to-login')}
    <main class="content auth-form">
      <form id="signup-form" class="auth-fields" novalidate>
        <label class="field"><span class="label">이름(닉네임)</span>
          <input class="input" name="name" type="text" autocomplete="nickname" maxlength="20" value="${esc(d.name || '')}" required></label>
        <label class="field"><span class="label">이메일</span>
          <input class="input" name="email" type="email" autocomplete="email" inputmode="email" placeholder="name@example.com" value="${esc(d.email || '')}" required></label>
        <label class="field"><span class="label">비밀번호</span>
          <input class="input" name="pw" type="password" autocomplete="new-password" placeholder="8자 이상" required></label>
        <label class="field"><span class="label">비밀번호 확인</span>
          <input class="input" name="pw2" type="password" autocomplete="new-password" required></label>
        <label class="su-keep"><input type="checkbox" name="remember" ${d.remember === false ? '' : 'checked'}> <span>로그인 유지 <small>(이 기기는 다음부터 인증 코드 없이)</small></span></label>
        ${message ? `<p class="login-msg" role="alert">${esc(message)}</p>` : ''}
        <button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>인증 코드 받고 가입하기</button>
        <p class="su-note">입력한 이메일로 6자리 인증 코드를 보내요. 인증을 마쳐야 가입이 완료돼요.</p>
      </form>
    </main>`;
}

// ── 메인 (피그마 디자인) ──
// 지금 있는 기능만 동작해요: 빠른 길찾기 → 길찾기 화면, 탄소 절약·이번 주 이동은 내 기록.
// 캠페인·랭킹·계정정보·프로필은 버튼 모양만 있어요 (누르면 "준비 중" 안내).
const ICON = {
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 17c4-1 2-6 5-8.5 1.2-1 2.6-1.4 3.3-1.6"/></svg>',
  rank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M7 20v-7h3v7M10.5 20V8h3v12M14 20v-9.5h3V20"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5C11 5 6 9.5 6 15.5c0 1.4.3 2.6.8 3.5"/><path d="M19 5c0 8-4.5 13-10.5 13"/><path d="M5 20l5-5"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};
// ---------------------------------------------------------------------
// 캠페인
//  - 누구나 커버 이미지 + 글 + 목표(kg)로 캠페인을 올려요.
//  - 참여한 사람이 친환경으로 이동해 아낀 탄소가 캠페인 목표에 쌓여요.
//  - 인기 캠페인: 목표가 크고(100kg 이상) 그 목표를 100% 달성한 캠페인
//  - 캠페인 보상 (목표 100kg 이상인 모든 캠페인): 끝날 때(달성 7일 뒤) 최종 달성률로 한 번 정산
//    100% / 120% / 150% / 200% → 만든 사람 목표kg × 2·3·4·5P, 참여자 내가 아낀 kg × 10·12·15·20P
//  - 메인 화면 TOP 5: 인기 캠페인 먼저 → 좋아요 많은 순 → 달성률 높은 순
//  ※ 서버 DB가 있으면 서버가 진짜 목록을 주고(campStore 는 그걸 받아 둔 것), 없으면 이 휴대폰에만 저장돼요.
// ---------------------------------------------------------------------
const POPULAR_MIN_KG = 100;
const REWARD_TIERS = [{ pct: 100, maker: 2, member: 10 }, { pct: 120, maker: 3, member: 12 }, { pct: 150, maker: 4, member: 15 }, { pct: 200, maker: 5, member: 20 }]; // 서버(_data.cjs)와 같게
const campRatioPct = (c) => (c.goalKg > 0 ? (c.progressG / (c.goalKg * 1000)) * 100 : 0); // 100% 넘어도 그대로
const rewardTier = (c) => [...REWARD_TIERS].reverse().find((t) => campRatioPct(c) >= t.pct) || null;
const CAMP_KEY = 'pureun-campaigns';
const POINT_KEY = 'pureun-points';
const CAMP_TAGS = [
  { id: 'transit', label: '대중교통', tone: 'sky', icon: MI.bus, bg: 'linear-gradient(160deg,#7fb6e8 0%,#a8d4c0 50%,#4f8a5b 100%)' },
  { id: 'walk', label: '걷기', tone: 'sun', icon: MI.walk, bg: 'linear-gradient(160deg,#9cc3e6 0%,#c9d9c4 50%,#6f8f72 100%)' },
  { id: 'bike', label: '자전거', tone: 'mint', icon: '🚲', bg: 'linear-gradient(160deg,#a9c6e0 0%,#b9d3b0 50%,#4d7a57 100%)' },
  { id: 'carfree', label: '차 없는 날', tone: 'violet', icon: '🏙️', bg: 'linear-gradient(160deg,#b5c9dc 0%,#d6d2c4 50%,#6d7f73 100%)' },
  { id: 'together', label: '함께하기', tone: 'sky', icon: '🤝', bg: 'linear-gradient(160deg,#6f9fb8 0%,#5f8f62 55%,#2f5e3c 100%)' },
];
const tagOf = (id) => CAMP_TAGS.find((t) => t.id === id) || CAMP_TAGS[0];
// 캠페인 이동 수단: 참여하면 이 수단으로 가는 길만 찾아요 (버스 · 지하철 · 자전거 · 도보)
const CAMP_MODES = [
  { id: 'bus', label: '버스', icon: MI.bus, ro: '버스로' },
  { id: 'subway', label: '지하철', icon: MI.subway, ro: '지하철로' },
  { id: 'bike', label: '자전거', icon: '🚲', ro: '자전거로' },
  { id: 'walk', label: '도보', icon: MI.walk, ro: '걸어서' },
];
const TAG_MODE = { transit: 'bus', walk: 'walk', bike: 'bike', carfree: 'subway', together: 'bus' };
const campModeOf = (id) => CAMP_MODES.find((m) => m.id === id) || CAMP_MODES[0];
const campMode = (c) => campModeOf((c && c.mode) || TAG_MODE[c && c.tag] || 'bus');
// 이 경로가 캠페인 이동 수단에 맞는지 (strict: 그 수단만, 아니면 그 수단이 들어 있으면)
function campMatch(r, mode, strict) {
  const has = (m) => (r.segments || []).some((sg) => sg.mode === m);
  if (mode === 'walk') return r.kind === 'walk';
  if (mode === 'bike') return r.kind === 'bike';
  if (r.kind !== 'transit' || !has(mode)) return false;
  const other = mode === 'bus' ? 'subway' : 'bus';
  return strict ? !has(other) : true;
}
// 캠페인 길찾기에서 보여줄 경로: 그 수단만 타는 길 → 없으면 그 수단이 들어간 길
function campOptions(ranked, mode) {
  let list = ranked.all.filter((r) => campMatch(r, mode, true));
  if (!list.length) list = ranked.all.filter((r) => campMatch(r, mode, false));
  list = list.map((r) => ({ ...r, badges: [] })).sort(SORTERS[state.prefs.sort] || SORTERS.fast);
  if (list.length > 1) {
    const fastest = list.reduce((a, b) => (b.minutes < a.minutes ? b : a));
    const greenest = list.reduce((a, b) => (b.emission < a.emission ? b : a));
    fastest.badges.push('최소시간');
    if (greenest !== fastest) greenest.badges.push('최소탄소');
  }
  return list;
}
const campTripCamp = () => (state.campTrip ? campStore.load().find((x) => x.id === state.campTrip.campId) || null : null);
// 캠페인 기여량 kg 표시 (0.35kg · 12.3kg · 523kg)
function kgText(g) {
  const kg = Math.max(0, g) / 1000;
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: kg >= 100 ? 0 : kg >= 10 ? 1 : 2 })}kg`;
}
// 캠페인 참여자 기여 랭킹
//  ※ 서버 DB가 있으면 진짜 참여자 순위를 받아 와요.
//    DB가 없는 곳에서는 다른 참여자를 가상 사용자로 만들어 (전체 - 내 몫)을 고정된 비율로 나눠요.
function campRanking(c) {
  if (dbMode()) {
    loadCampRank(c.id);
    const rk = state.campRanks[c.id];
    const all = (rk && rk.users ? rk.users : []).map((u) => ({ ...u, photo: u.me ? loadAvatar() : u.photo, name: u.me ? ((state.user && state.user.name) || u.name) : u.name }));
    let me = all.find((u) => u.me) || null;
    if (!me && rk && rk.me) me = { id: 'me', me: true, name: (state.user && state.user.name) || '나', g: rk.me.g, rank: rk.me.rank, photo: loadAvatar() };
    if (!me && rk && rk.loading && (c.joined || c.myG > 0)) me = { id: 'me', me: true, name: (state.user && state.user.name) || '나', g: c.myG || 0, rank: 1, photo: loadAvatar() };
    return { all, me };
  }
  const myG = Math.max(0, c.myG || 0);
  const meIn = !!(c.joined || myG > 0);
  const othersN = Math.max(0, Math.min(400, (c.participants || 0) - (meIn ? 1 : 0)));
  const othersG = Math.max(0, c.progressG - myG);
  const rnd = seededRand(hashStr(`camp:${c.id}`) + 11);
  const used = new Set([(state.user && state.user.name) || '나']);
  const people = [];
  for (let i = 0; i < othersN; i++) {
    let name; let n = 0;
    do { name = NICK_A[Math.floor(rnd() * NICK_A.length)] + NICK_B[Math.floor(rnd() * NICK_B.length)] + (rnd() < 0.4 || n > 3 ? Math.floor(rnd() * 90 + 10) : ''); n++; } while (used.has(name));
    used.add(name);
    people.push({ id: `p${i}`, name, w: Math.pow(rnd(), 3.4) + 0.02, photo: '', tg: Math.round(Math.pow(rnd(), 2) * 400000) });
  }
  if (people.length && !isMine(c) && c.creator && !used.has(c.creator)) { people[0].name = c.creator; people[0].w += 0.6; } // 만든 사람도 열심히 참여
  const sumW = people.reduce((a, u) => a + u.w, 0) || 1;
  people.forEach((u) => { u.g = Math.round((othersG * u.w) / sumW); });
  if (meIn) people.push({ id: 'me', me: true, name: (state.user && state.user.name) || '나', g: myG, photo: loadAvatar() });
  const all = people.sort((a, b) => (b.g - a.g) || (a.me ? -1 : b.me ? 1 : 0) || a.name.localeCompare(b.name));
  all.forEach((u, i) => { u.rank = i + 1; });
  return { all, me: all.find((u) => u.me) || null };
}
function campRankHTML(c) {
  const { all, me } = campRanking(c);
  const loading = dbMode() && state.campRanks[c.id] && state.campRanks[c.id].loading;
  if (!all.length) return `<section class="m-card cr"><p class="m-label">참여자 기여 랭킹</p><p class="cr-empty">${loading ? '참여자 순위를 불러오는 중이에요…' : '아직 참여한 사람이 없어요. 첫 번째로 참여해 보세요!'}</p></section>`;
  const pod = (u, place) => (u ? `<div class="pod pod-${place}">
      ${place === 1 ? `<span class="crown" aria-hidden="true">${crownSVG()}</span>` : ''}
      <div class="medal m${place}">${tierAvatarHTML(u.name, u.photo, 'av-lg', u.me ? loadLog().g : u.tg, 'badge')}</div>
      <b class="pod-name">${esc(u.name)}${u.me ? ' <em>나</em>' : ''}</b>
      <span class="pod-pt">${kgText(u.g)}</span>
      <div class="step"><span>${place}</span></div>
    </div>` : '<div class="pod"></div>');
  const rest = all.slice(3, 50);
  const meOut = me && me.rank > 50;
  return `<section class="m-card cr" id="camp-rank">
    <div class="cr-head"><p class="m-label">참여자 기여 랭킹</p><small>${(dbMode() && state.campRanks[c.id] && state.campRanks[c.id].total ? state.campRanks[c.id].total : all.length).toLocaleString()}명 · 아낀 탄소 많은 순</small></div>
    ${me ? `<p class="cr-mine">${tierAvatarHTML(me.name, me.photo, '', loadLog().g)}<span>내 기여 <b>${kgText(me.g)}</b></span><em>${me.rank.toLocaleString()}위</em></p>` : ''}
    <div class="podium cr-podium" aria-label="1~3위">${pod(all[1], 2)}${pod(all[0], 1)}${pod(all[2], 3)}</div>
    ${rest.length ? `<ol class="rk-list cr-list">${rest.map((u) => `<li class="${u.me ? 'is-me' : ''}">
      <span class="rk-n">${u.rank}</span>${tierAvatarHTML(u.name, u.photo, '', u.me ? loadLog().g : u.tg)}
      <span class="rk-name">${esc(u.name)}${u.me ? ' <em>나</em>' : ''}</span>
      <span class="rk-pt">${kgText(u.g)}</span></li>`).join('')}
      ${meOut ? `<li class="is-me cr-gap"><span class="rk-n">${me.rank}</span>${tierAvatarHTML(me.name, me.photo, '', loadLog().g)}<span class="rk-name">${esc(me.name)} <em>나</em></span><span class="rk-pt">${kgText(me.g)}</span></li>` : ''}</ol>` : ''}
    ${all.length > 50 || (dbMode() && state.campRanks[c.id] && state.campRanks[c.id].total > 50) ? `<p class="rk-note">50위까지 보여 드려요</p>` : ''}
  </section>`;
}
// 예시 캠페인 11개 (좋아요·참여·달성 정도를 다르게 넣어 순위가 매겨지는지 확인용)
//  맨 앞 5개는 사진 있는 추천 캠페인 — 서버 예시 데이터(api/_seed.cjs FEATURED)와 같은 글이에요
function seedCampaigns() {
  const day = 86400000; const now = Date.now();
  return [
    {"id": "seed-f1", "tag": "walk", "mode": "walk", "title": "주말엔 공원까지 걸어서 가요", "sub": "차로 5분, 걸으면 25분인데 걷는 쪽이 더 좋더라고요", "body": "원래 주말마다 차 끌고 공원 가서 주차 자리 찾느라 빙빙 돌았거든요. 어느 날 그냥 걸어가 봤는데 생각보다 금방이었어요.\n\n요즘 가로수 잎이 물들기 시작해서 공원 가는 길 자체가 나들이 같아요. 커피 하나 들고 천천히 걷다 보면 도착하기 전에 이미 기분이 좋아져 있어요.\n\n왕복 4km만 걸어도 차로 다녀올 때보다 탄소가 1kg 가까이 줄어요. 주말에 걸어서 나들이 간 날 기록해 주세요. 같이 150kg 채워 봐요.", "goalKg": 150, "progressG": 159000, "participants": 212, "likes": 640, "creator": "동네한바퀴", "cover": "assets/camp/walk-park.jpg", "createdAt": now - 16 * day},
    {"id": "seed-f2", "tag": "bike", "mode": "bike", "title": "해 뜰 무렵 자전거로 출근하기", "sub": "7시 전에 나오면 길도 한산하고 하늘이 예뻐요", "body": "출근길 버스에 끼어 타는 게 너무 지쳐서 자전거를 시작했어요. 집에서 회사까지 6km인데 25분이면 가요. 버스 기다리는 시간까지 치면 오히려 더 빨라요.\n\n조금만 일찍 나오면 해 뜨는 거 보면서 달릴 수 있어요. 아침에 땀 한 번 빼고 나면 오전 내내 덜 피곤하더라고요.\n\n왕복 12km를 차 대신 자전거로 다니면 하루에 탄소를 약 2.8kg 줄일 수 있어요. 일주일에 한두 번이라도 괜찮아요. 공공자전거로 참여해도 돼요.", "goalKg": 120, "progressG": 124800, "participants": 168, "likes": 572, "creator": "seoul_biker", "cover": "assets/camp/bike-commute.jpg", "createdAt": now - 12 * day},
    {"id": "seed-f3", "tag": "walk", "mode": "walk", "title": "택시 말고 걸어서 도시 여행", "sub": "골목 사이로 걸어야 보이는 것들이 있어요", "body": "여행 가면 택시나 렌터카로 다니게 되는데, 지난번엔 숙소 근처는 전부 걸어 다녀 봤어요. 하루에 2만 보 넘게 걸었는데 지도에 안 나오는 작은 가게들, 해 질 무렵 하나둘 불 켜지는 빌딩들 구경하는 재미가 쏠쏠했어요.\n\n가까운 곳은 걷고, 멀면 지하철 타고. 이것만 지켜도 여행 중에 나오는 탄소가 꽤 줄어요.\n\n여행지에서 걸어서 이동한 날 기록해 주세요. 목표는 100kg이에요.", "goalKg": 100, "progressG": 102000, "participants": 151, "likes": 515, "creator": "걷다보면", "cover": "assets/camp/city-walk.jpg", "createdAt": now - 9 * day},
    {"id": "seed-f4", "tag": "carfree", "mode": "walk", "title": "꽃 축제는 차 두고 걸어서", "sub": "축제장 앞 주차 대기 한 시간, 이제 그만", "body": "작년 봄 튤립 축제 갔을 때 주차장 들어가는 데만 한 시간 넘게 걸렸어요. 올해는 역에서 내려서 20분 걸어갔더니 차 타고 온 친구들보다 먼저 도착했어요.\n\n축제장 가는 길에도 꽃이 심어져 있어서 걷는 동안 심심하지 않아요. 사진 찍을 곳도 훨씬 많고요.\n\n관광지나 축제 갈 때 가까운 역이나 정류장에서 내려 걸어 들어가 주세요. 걸은 거리만큼 아낀 탄소로 쌓여요.", "goalKg": 130, "progressG": 136500, "participants": 183, "likes": 468, "creator": "노을맛집탐방", "cover": "assets/camp/tulip-walk.jpg", "createdAt": now - 20 * day},
    {"id": "seed-f5", "tag": "together", "mode": "walk", "title": "야경 보러 걸어서 올라가요", "sub": "친구랑 저녁 먹고 뒷산까지 천천히", "body": "서울 야경 명소 중에 걸어서 갈 수 있는 곳이 생각보다 많아요. 저녁 먹고 친구들이랑 수다 떨면서 40분쯤 걸어 올라가면 롯데타워랑 한강이 한눈에 들어와요.\n\n차로 전망대까지 올라가면 편하긴 한데, 걸어서 올라간 날 본 야경이 훨씬 오래 기억에 남더라고요.\n\n친구나 가족이랑 같이 걸어서 다녀온 날 기록해 주세요. 같이 간 사람도 각자 기록하면 목표에 더 빨리 가까워져요.", "goalKg": 110, "progressG": 111100, "participants": 126, "likes": 433, "creator": "밤산책러", "cover": "assets/camp/night-view.jpg", "createdAt": now - 6 * day},
    { id: 'seed-1', tag: 'transit', title: '주말 나들이 버스로 가기', sub: '주말 나들이는 자동차 대신 버스로',
      body: '주말에 공원이나 한강 갈 때 버스 타고 가 봐요. 근교는 대부분 버스로 충분히 갈 수 있어요.\n\n이번 캠페인은 주말 나들이를 버스로 다녀오는 거예요. 혼자 자동차로 10km를 가면 CO₂ 약 2.1kg이 나오지만, 버스로 가면 약 0.28kg이에요. 한 번의 선택으로 탄소를 85% 넘게 줄일 수 있어요.',
      goalKg: 500, progressG: 523400, participants: 128, likes: 312, creator: '초록버스', createdAt: now - 20 * day },
    { id: 'seed-2', tag: 'walk', title: '한 정거장 먼저 내려 걸어요', sub: '하루 10분 걷기로 탄소도 줄이고 건강도 챙기기',
      body: '집이나 회사에 가는 길, 한 정거장만 먼저 내려서 걸어보세요. 약 600m, 걸어서 8~10분이에요.\n\n버스가 덜 달린 거리만큼 탄소가 줄고, 하루 1,000보가 저절로 채워져요.\n\n목표는 참여자 모두 합쳐 200kg! 오늘 퇴근길부터 시작해요.',
      goalKg: 200, progressG: 151200, participants: 96, likes: 241, creator: '산책하는해달', createdAt: now - 14 * day },
    { id: 'seed-3', tag: 'carfree', title: '금요일엔 차 두고 출근하기', sub: '매주 금요일은 자동차 대신 대중교통 출근',
      body: '일주일에 하루만 자동차를 집에 두고 출근해 보면 어떨까요?\n\n출퇴근 왕복 30km를 자동차 대신 지하철로 다니면 하루에 CO₂ 약 6kg을 줄일 수 있어요. 한 사람이 1년 동안 금요일마다 실천하면 나무 30그루를 심은 것과 같은 효과예요.\n\n목표 1,000kg 달성했어요. 계속 참여할 수 있어요.',
      goalKg: 1000, progressG: 1042000, participants: 214, likes: 198, creator: '금요일의지하철', createdAt: now - 30 * day },
    { id: 'seed-4', tag: 'bike', title: '가까운 거리는 자전거로', sub: '5km 이내는 자전거로 이동하기',
      body: '5km 이내 가까운 거리는 자전거가 가장 빠르고 깨끗한 이동 수단이에요. 자전거는 탄소가 나오지 않아요.\n\n공공자전거를 이용해도 좋아요. 자전거도로를 따라 달리며 우리 동네의 몰랐던 길을 발견해 보세요.\n\n목표는 300kg이에요.',
      goalKg: 300, progressG: 118500, participants: 73, likes: 176, creator: '페달밟는곰', createdAt: now - 9 * day },
    { id: 'seed-5', tag: 'together', title: '같이 타면 혜택이 두 배', sub: '친구·동료와 함께 대중교통으로 이동하기',
      body: '친구나 동료랑 같이 하면 더 오래 할 수 있어요. 친구나 동료를 한 명 초대해서 함께 대중교통으로 이동해 보세요.\n\n같은 방향으로 출근하는 동료와 버스를 같이 타거나, 약속 장소까지 지하철로 함께 가는 것도 좋아요. 함께한 이동이 쌓일수록 목표에 더 빨리 가까워져요.',
      goalKg: 150, progressG: 88600, participants: 64, likes: 154, creator: '함께가요', createdAt: now - 5 * day },
    { id: 'seed-6', tag: 'bike', title: '새벽 공공자전거 출근 챌린지', sub: '선선한 아침, 자전거로 출근하기',
      body: '차가 막히기 전 이른 아침, 공공자전거로 출근해 보는 작은 챌린지예요.\n\n목표는 소박하게 50kg! 이미 달성했지만 계속 함께 달려요.',
      goalKg: 50, progressG: 50300, participants: 18, likes: 37, creator: '아침라이더', createdAt: now - 3 * day },
  ].map((c) => ({ cover: '', liked: false, joined: false, mine: false, rewarded: false, ...c }));
}
const campStore = {
  load() {
    try {
      const list = JSON.parse(localStorage.getItem(CAMP_KEY) || 'null');
      if (Array.isArray(list)) return list;
    } catch (e) { /* 무시 */ }
    if (dbMode()) return []; // 서버 DB: 진짜 캠페인만 (서버에서 받아 오는 중)
    const seeded = seedCampaigns();
    this.save(seeded);
    return seeded;
  },
  save(list) {
    try { localStorage.setItem(CAMP_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  },
};
// 탄소 포인트: 이동할 때마다 (아낀 탄소 1kg당 10P + 친환경 이동 1km당 1P), 캠페인 보상도 같은 포인트
const POINT_MONTH_KEY = 'pureun-points-month';
const PT_PER_KG = 10;
const PT_PER_KM = 1;
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
function loadPoints() { try { return Number(localStorage.getItem(POINT_KEY)) || 0; } catch (e) { return 0; } }
function loadMonthPoints(key = monthKey()) {
  try { return Number((JSON.parse(localStorage.getItem(POINT_MONTH_KEY) || '{}'))[key]) || 0; } catch (e) { return 0; }
}
function addPoints(p) {
  p = Math.max(0, Math.round(p));
  try {
    localStorage.setItem(POINT_KEY, String(loadPoints() + p));
    const m = JSON.parse(localStorage.getItem(POINT_MONTH_KEY) || '{}');
    m[monthKey()] = (Number(m[monthKey()]) || 0) + p;
    localStorage.setItem(POINT_MONTH_KEY, JSON.stringify(m));
  } catch (e) { /* 무시 */ }
  return p;
}
// 한 번 이동했을 때 받을 포인트 (자동차 구간 거리는 빼요)
function tripPoints(route) {
  const ecoKm = (route.segments || []).filter((sg) => sg.mode !== 'car').reduce((a, sg) => a + (sg.km || 0), 0);
  const kg = Math.max(0, route.saving || 0) / 1000;
  return { kgP: Math.round(kg * PT_PER_KG), kmP: Math.round(ecoKm * PT_PER_KM), ecoKm, total: Math.round(kg * PT_PER_KG) + Math.round(ecoKm * PT_PER_KM) };
}
const kgShort = (g) => `${(g / 1000).toLocaleString(undefined, { maximumFractionDigits: g >= 100000 ? 0 : 1 })}kg`;
const campPct = (c) => Math.min(100, (c.progressG / (c.goalKg * 1000)) * 100);
const isPopular = (c) => c.goalKg >= POPULAR_MIN_KG && c.progressG >= c.goalKg * 1000;
const campReward = (c, t = rewardTier(c) || REWARD_TIERS[0]) => Math.round(c.goalKg * t.maker);
// ── 관리자 검토 ──
//  새 캠페인은 status 'pending'(검토 대기) → 관리자가 'approved'(게시) 또는 'rejected'(반려, 사유 포함)
//  예시 캠페인처럼 status 가 없으면 이미 게시된 캠페인이에요.
//  ※ 서버 DB가 있으면 승인·반려는 서버가 관리자인지 다시 확인해요 (users.role = 'admin').
const ADMIN_EMAILS = (CFG.ADMIN_EMAILS || ['admin@bluesky.kr']).map((e) => String(e).trim().toLowerCase());
// 관리자: 회원 DB에서 role = 'admin' 인 계정 (또는 config.js 의 관리자 이메일)
const isAdmin = () => !!(state.user && (String(state.user.role || '').trim() === 'admin' || (state.user.email && ADMIN_EMAILS.includes(String(state.user.email).toLowerCase()))));
function userKey(u) {
  if (!u) return '';
  if (u.email) return `e:${String(u.email).toLowerCase()}`;
  if (u.id) return `k:${u.id}`;
  return `n:${u.name || ''}`;
}
const isMine = (c) => (c.ownerId === '@me' || (c.ownerId ? c.ownerId === userKey(state.user) : !!c.mine));
// 완료한 캠페인: 목표를 100% 달성하고 7일이 지나면 목록·TOP 5에서 내려가고 더 참여할 수 없어요
//  (만든 사람·참여했던 사람은 내 캠페인 목록에서 "종료"로 계속 볼 수 있어요)
const CAMP_END_DAYS = 7;
const campEnded = (c) => !!(c && (c.ended || (c.reachedAt && Date.now() - c.reachedAt >= CAMP_END_DAYS * 86400000)));
const endsInDays = (c) => (c && c.reachedAt && !campEnded(c) ? Math.max(1, Math.ceil((c.reachedAt + CAMP_END_DAYS * 86400000 - Date.now()) / 86400000)) : 0);
const isApproved = (c) => !c.status || c.status === 'approved';
const isPublic = (c) => isApproved(c) && !campEnded(c);
const publicCampaigns = (list = campStore.load()) => list.filter(isPublic);
const joinedCampaigns = (list = campStore.load()) => list.filter((c) => c.joined && isApproved(c))
  .sort((a, b) => (campEnded(a) - campEnded(b)) || (b.myG || 0) - (a.myG || 0) || (b.progressG - a.progressG));
const pendingCampaigns = (list = campStore.load()) => list.filter((c) => c.status === 'pending').sort((a, b) => (a.submittedAt || a.createdAt) - (b.submittedAt || b.createdAt));
const STATUS_LABEL = { pending: '검토 중', approved: '게시 중', rejected: '반려됨' };
const REJECT_REASONS = ['탄소 절약·친환경 이동과 관련이 적어요', '내용이 짧거나 무엇을 하자는지 알기 어려워요', '목표량이 너무 크거나 작아요', '부적절한 사진이나 표현이 있어요', '광고·홍보 목적이에요'];

// 메인 화면 순서: 인기 캠페인 → 좋아요 → 달성률
function rankCampaigns(list) {
  return list.filter(isPublic).sort((a, b) => (isPopular(b) - isPopular(a)) || (b.likes - a.likes) || (campPct(b) - campPct(a)));
}
function topCampaigns(n) { return rankCampaigns(publicCampaigns()).slice(0, n); }
// 캠페인 보상 정산 (이 휴대폰에만 저장하는 체험 모드용 — 서버 DB가 있으면 서버가 정산해요)
//  목표 100kg 이상 캠페인이 끝나면(달성 7일 뒤) 최종 달성률 배수로 한 번
function checkRewards(list) {
  if (dbMode()) return [];
  const won = [];
  list.forEach((c) => {
    if (!isApproved(c) || !campEnded(c) || c.goalKg < POPULAR_MIN_KG || c.rewarded) return;
    const t = rewardTier(c);
    if (!t) return;
    c.rewarded = true;
    let mine = 0;
    if (isMine(c)) mine += addPoints(campReward(c, t));
    if (c.myG > 0) mine += addPoints(Math.round((c.myG / 1000) * t.member)); // 참여자 보상
    if (mine) { c.myReward = mine; won.push({ ...c, myReward: mine, tierPct: t.pct }); }
  });
  return won;
}
const wonText = (w) => `"${w.title}" 최종 달성률 ${w.tierPct}% 이상! 캠페인 보상 +${w.myReward.toLocaleString()}P`;
// 캠페인 길찾기로 도착하면: 그 캠페인에 아낀 탄소를 더하고 내 기여로 기록해요
function addSavingToCampaign(id, g) {
  g = Math.max(0, Math.round(g || 0));
  const list = campStore.load();
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  const beforeG = c.progressG;
  c.progressG += g;
  if (!c.reachedAt && c.progressG >= c.goalKg * 1000) c.reachedAt = Date.now(); // 목표 달성 시각 (7일 뒤 내려가요)
  c.myG = (c.myG || 0) + g;
  c.myTrips = (c.myTrips || 0) + 1;
  if (!c.joined) { c.joined = true; c.participants += 1; }
  const won = checkRewards(list);
  campStore.save(list);
  if (won.length) setTimeout(() => toast(wonText(won[0])), 600);
  return { beforeG, afterG: c.progressG };
}
// 캠페인 보상표: 최종 달성률 100 · 120 · 150 · 200% → 만든 사람 ×2~5, 참여자 ×10~20 (지금 단계에 불이 들어와요)
function rewardLadderHTML(c) {
  const cur = c ? rewardTier(c) : null;
  const cls = (t) => `${cur && cur.pct === t.pct ? 'on' : ''}${cur && t.pct < cur.pct ? ' past' : ''}`;
  return `<div class="rw-ladder" role="table" aria-label="최종 달성률별 보상 배수">
    <span class="rw-k" role="rowheader">최종 달성률</span>${REWARD_TIERS.map((t) => `<b class="rw-c ${cls(t)}">${t.pct}%${t.pct > 100 ? '↑' : ''}</b>`).join('')}
    <span class="rw-k">만든 사람<small>목표 kg ×</small></span>${REWARD_TIERS.map((t) => `<span class="rw-c ${cls(t)}">${t.maker}P</span>`).join('')}
    <span class="rw-k">참여자<small>아낀 kg ×</small></span>${REWARD_TIERS.map((t) => `<span class="rw-c ${cls(t)}">${t.member}P</span>`).join('')}
  </div>`;
}
function campRewardBoxHTML(c) {
  if (c.goalKg < POPULAR_MIN_KG) {
    return `<section class="cd-reward"><b>ℹ️ 목표가 ${POPULAR_MIN_KG}kg 미만이라 보상 대상이 아니에요</b><p>목표를 ${POPULAR_MIN_KG}kg 이상으로 크게 잡은 캠페인만 탄소 포인트 보상을 받아요.</p></section>`;
  }
  const t = rewardTier(c);
  const pct = Math.floor(campRatioPct(c));
  let head; let note;
  if (c.rewarded) {
    head = `🏆 정산 완료 · 최종 달성률 ${pct}%`;
    note = c.myReward ? `나는 <strong>+${c.myReward.toLocaleString()}P</strong>를 받았어요.` : '만든 사람과 참여자에게 보상이 지급됐어요.';
  } else if (t) {
    head = `🎉 지금 달성률 ${pct}% · ${campEnded(c) ? '곧 정산돼요' : `${endsInDays(c)}일 뒤 정산`}`;
    const nextT = REWARD_TIERS.find((x) => x.pct > t.pct);
    note = `지금 끝나면 만든 사람(${esc(c.creator)}) <strong>${campReward(c, t).toLocaleString()}P</strong>, 참여자는 아낀 kg × <strong>${t.member}P</strong>${nextT ? ` · ${nextT.pct}%를 넘기면 ×${nextT.maker} · ×${nextT.member}로 올라가요` : ' · 최고 단계예요!'}`;
  } else {
    head = '🎯 목표를 달성하면 보상이 쌓여요';
    note = `목표 달성 ${CAMP_END_DAYS}일 뒤 <strong>최종 달성률</strong>로 정산해요. 더 많이 달성할수록 배수가 커져요.`;
  }
  return `<section class="cd-reward ${c.rewarded || t ? 'won' : ''}"><b>${head}</b><p>${note}</p>${rewardLadderHTML(c)}</section>`;
}
// 캠페인 카드 배경 (올린 사진이 있으면 사진, 없으면 분류별 하늘·초록 그라데이션)
function campBg(c, shade) {
  const dark = shade || 'linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.5))';
  return c.cover ? `${dark},url('${c.cover}') center/cover` : `${dark},${tagOf(c.tag).bg}`;
}

// ---------------------------------------------------------------------
// 칭호: 지금까지 아낀 CO₂(kg)에 따라 씨앗 → 새싹 → … → 숲 → 산 → 푸른하늘
//  기준은 "나무 1그루가 1년 동안 흡수하는 양(9.8kg)"에 맞춰 잡았어요.
// ---------------------------------------------------------------------
const TITLES = [
  { kg: 0, icon: '🌰', name: '씨앗', desc: '첫 친환경 이동을 기다리고 있어요' },
  { kg: 1, icon: '🌱', name: '새싹', desc: '첫 1kg! 풍선 40개만큼 하늘을 지켰어요' },
  { kg: 5, icon: '🌿', name: '묘목', desc: '나무 한 그루가 반년 동안 흡수하는 양' },
  { kg: 10, icon: '🌳', name: '나무', desc: '나무 1그루가 1년 동안 흡수하는 양' },
  { kg: 50, icon: '🌲', name: '작은 숲', desc: '나무 5그루가 1년 동안 흡수하는 양' },
  { kg: 100, icon: '🏕️', name: '숲', desc: '나무 10그루가 1년 동안 흡수하는 양' },
  { kg: 300, icon: '🌴', name: '밀림', desc: '나무 30그루가 1년 동안 흡수하는 양 — 빽빽한 초록 세상' },
  { kg: 1000, icon: '⛰️', name: '산', desc: '나무 100그루 — 작은 동산 하나만큼' },
  { kg: 3000, icon: '🏔️', name: '산맥', desc: '나무 300그루가 1년 동안 흡수하는 양' },
  { kg: 10000, icon: '🌤️', name: '푸른하늘', desc: '나무 1,000그루 — 하늘을 지키는 사람' },
];
function titleOf(g) {
  const kg = Math.max(0, g) / 1000;
  let i = 0;
  TITLES.forEach((t, k) => { if (kg >= t.kg) i = k; });
  const next = TITLES[i + 1] || null;
  const cur = TITLES[i];
  const pct = next ? Math.min(100, ((kg - cur.kg) / (next.kg - cur.kg)) * 100) : 100;
  return { ...cur, level: i + 1, next, pct, leftKg: next ? Math.max(0, next.kg - kg) : 0 };
}
const titleChipHTML = (t, cls = '') => `<span class="ttl-chip ${cls}" title="칭호">${t.icon} ${esc(t.name)}</span>`;
function leftText(kg) { return kg >= 10 ? `${Math.ceil(kg).toLocaleString()}kg` : kg >= 1 ? `${kg.toFixed(1)}kg` : `${Math.max(1, Math.round(kg * 1000))}g`; }

// 칭호 화면 ("지금까지 탄소 절약" 카드를 누르면)
function titlesHTML() {
  const log = loadLog();
  const t = titleOf(log.g);
  const kg = log.g / 1000;
  return `${appBar('내 칭호', 'back')}
    <main class="content ttl">
      <section class="ttl-hero">
        <span class="ttl-me">${tierAvatarHTML((state.user && state.user.name) || '나', loadAvatar(), 'av-xl', log.g)}</span>
        <p class="ttl-lv">LV.${t.level} · 지금까지 ${kg >= 100 ? kg.toFixed(0) : kg.toFixed(1)}kg 아낌</p>
        <h2>${esc((state.user && state.user.name) || '나')} <span>${esc(t.name)}</span></h2>
        <p class="ttl-desc">${esc(t.desc)}</p>
        ${t.next ? `<div class="ttl-bar"><span style="width:${Math.max(3, t.pct).toFixed(1)}%"></span></div>
          <p class="ttl-next">다음 칭호 <b>${t.next.icon} ${esc(t.next.name)}</b>까지 <b class="num">${leftText(t.leftKg)}</b> 남았어요</p>`
          : '<p class="ttl-next">🎉 가장 높은 칭호를 얻었어요!</p>'}
      </section>
      <h3 class="c-h">칭호 단계 <small>아낀 이산화탄소가 쌓이면 올라가요</small></h3>
      <ol class="ttl-list">${TITLES.map((x, i) => {
        const got = i < t.level;
        return `<li class="${got ? 'got' : 'lock'} ${i === t.level - 1 ? 'now' : ''}">
          <span class="ttl-ic tf-prev" aria-hidden="true"><span class="avf t${i} f-md"><span class="av av-md" style="background:${got ? '#F1F7F3' : '#E5E7EB'}"><i>${got ? x.icon : '🔒'}</i></span>${tierFrameSVG(i)}</span></span>
          <span class="ttl-txt"><b>${esc(x.name)}${i === t.level - 1 ? ' <em>지금</em>' : ''}</b><small>${esc(x.desc)}</small></span>
          <span class="ttl-kg num">${x.kg ? `${x.kg.toLocaleString()}kg` : '시작'}</span>
        </li>`;
      }).join('')}</ol>
      <p class="rk-note">나무 1그루는 1년에 CO₂ 약 9.8kg을 흡수해요 (국립산림과학원)</p>
    </main>`;
}

function greetingText() {
  const h = new Date().getHours();
  const hi = '안녕하세요';
  const name = state.user && state.user.name && !/사용자$/.test(state.user.name) ? state.user.name : '';
  return name ? `${hi}, ${name}님` : hi;
}
function weekInfo(log) {
  const now = new Date();
  const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const days = new Set(log.days || []);
  const week = ['월', '화', '수', '목', '금', '토', '일'].map((label, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    return { label, done: days.has(dayKey(d)), today: dayKey(d) === dayKey(now) };
  });
  return { week, count: week.filter((d) => d.done).length };
}
// ── 최근 7일 탄소 절약 그래프 (메인 카드 · 분석 화면) ──
//  오늘까지 7일, 하루에 아낀 양을 막대로. 막대 뒤는 하늘 사진, 오늘 막대는 파란색
function weekSeries(log) {
  const now = new Date();
  return [6, 5, 4, 3, 2, 1, 0].map((back) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const rec = dayRecord(log, dayKey(d));
    return { key: dayKey(d), label: '일월화수목금토'[d.getDay()], today: back === 0, g: rec && rec.g ? rec.g : 0, n: rec ? rec.n : 0 };
  });
}
function shortG(g) {
  if (!(g > 0)) return '0g';
  return g < 1000 ? `${Math.round(g)}g` : `${(g / 1000).toFixed(g >= 10000 ? 0 : 1)}kg`;
}
function weekHeadHTML(series) {
  const avg = series.reduce((a, d) => a + d.g, 0) / 7;
  return avg > 0
    ? `<p class="wk-title">최근 7일 동안 하루<br>평균 <b>${shortG(avg)}</b> 절약했어요</p>`
    : '<p class="wk-title">최근 7일 동안<br>아직 절약한 탄소가 없어요</p>';
}
function weekChartHTML(series, big) {
  const max = Math.max(...series.map((d) => d.g), 1);
  const anim = state.lastRendered !== state.screen; // 화면에 처음 들어올 때만 막대가 자라나요 (달 넘길 때는 그대로)
  return `<div class="wk-sky ${big ? 'big' : ''} ${anim ? 'anim' : ''}">
      <ol class="wk-bars">${series.map((d, i) => `<li class="${d.today ? 'is-today' : ''} ${d.g > 0 ? '' : 'is-zero'}" style="--i:${i}">
        <span class="wk-val num">${shortG(d.g)}</span>
        <span class="wk-bar" style="--h:${d.g > 0 ? Math.max(6, (d.g / max) * 100).toFixed(1) : 2.5}%"></span></li>`).join('')}</ol>
    </div>
    <ol class="wk-days">${series.map((d) => `<li class="${d.today ? 'is-today' : ''}">${d.label}</li>`).join('')}</ol>`;
}

// ── 튜토리얼 ──
//  모든 사용자에게 앱을 새로 열 때마다 처음부터 짚어 줘요. "다음부터 보지 않기"를 체크하면 그 계정은 이 기기에서 그만.
//  단계표(TOUR_STEPS): 화면 · 밝힐 곳(target) · 안내 문구 · 넘어가는 방법
//   1   메인    빠른 길찾기 버튼 → 누르면
//   2-1 길찾기  출발지 · 도착지 칸 (시연이라 안양역 → 강남역 자동 입력) → 화면을 누르면
//   2-2 길찾기  길찾기 버튼 → 누르면
//   3-1 경로    절약 강도 → 강도를 누르면
//   3-2 경로    경로 목록 (계산 방식 · 놀라운 사실) → 경로를 누르면
//   3-3 경로    고른 경로 카드 → 안내 시작을 누르면
//   4-1 안내    시연 이동 안내 → 화면을 누르면 내 위치가 도착지까지 움직여요(4-go)
//   4-2 안내    도착 버튼 → 누르면 (시연 이동은 기록 · 포인트에 안 들어가요)
//   5-1 도착    이번 이동 절약 계산식 → 화면을 누르면
//   5-2 도착    나의 숲(지금까지 절약량) → 화면을 누르면
//   6   도착    홈으로 돌아가기 → 누르면 끝
//  밝은 곳(버튼)은 직접 눌러야 넘어가고, 설명만 있는 단계는 화면 아무 곳이나 누르면 다음으로 넘어가요.
//  화면이 다시 그려질 때마다(tourPaint) 다시 칠해요. 진행 상황은 이 창(sessionStorage)에만 저장해요.
const TOUR_KEY = 'pureun-tour'; // { 계정: 'off' }
const TOUR_NOW = 'pureun-tour-now'; // { 계정: '1' … '6' | 'done' }
const TOUR_FROM = { name: '안양역', lat: 37.40157, lng: 126.92272 };
const TOUR_TO = { name: '강남역', lat: 37.49795, lng: 127.02762 };
function tourMap(where, key) { try { return JSON.parse(window[where].getItem(key) || '{}'); } catch (e) { return {}; } }
function tourPut(where, key, v) {
  try {
    const m = tourMap(where, key);
    if (v === null) delete m[userKey(state.user)]; else m[userKey(state.user)] = v;
    window[where].setItem(key, JSON.stringify(m));
  } catch (e) { /* 무시 */ }
}
const tourOff = () => tourMap('localStorage', TOUR_KEY)[userKey(state.user)] === 'off';
const tourGo = (n) => tourPut('sessionStorage', TOUR_NOW, n);
// 지금 단계 ('' = 없음). 보는 도중에 "보지 않기"를 체크해도 지금 튜토리얼은 끝까지 그대로예요.
function tourStage() {
  if (!state.user || (tourOff() && !state.tourActive)) return '';
  const raw = tourMap('sessionStorage', TOUR_NOW)[userKey(state.user)];
  if (raw === 'done') return '';
  let v = String(raw || '1');
  // 앱을 새로 열었는데(새로고침 등) 중간 단계였다면 처음부터
  if (!state.tourBoot) { state.tourBoot = true; if (v !== '1') { v = '1'; tourGo('1'); } }
  return TOUR_STEPS[v] ? v : '1';
}
const TOUR_MODE = { walk: '걷기', bike: '자전거', bus: '버스', subway: '지하철', car: '자동차' };
const tKm = (km) => `${(Math.round(km * 10) / 10).toLocaleString()}km`;
const tG = (g) => formatG(Math.max(0, Math.round(g)));
// 계산식에 쓰는 숫자 (앱이 실제로 계산하는 식 그대로: 구간 거리 × 1인 1km 배출계수, 함께 타면 ÷ 사람 수)
function tourCalc() {
  const { ranked, chosen } = currentPlan();
  if (!ranked || !chosen) return null;
  const baseKm = ranked.baseline.segments.reduce((a, s) => a + s.km, 0);
  const by = {};
  chosen.segments.forEach((s) => { by[s.mode] = (by[s.mode] || 0) + s.km; });
  const parts = Object.entries(by).filter(([, km]) => km >= 0.05).map(([m, km]) => `${TOUR_MODE[m] || m} ${tKm(km)} × ${FACTORS[m]}g`);
  return { baseKm, car: ranked.baseline.emission, em: chosen.emission, saving: chosen.saving, parts, people: chosen.people || 1 };
}
const TOUR_NEXT = (t = '화면을 누르면 다음으로 ›') => `<span class="tour-next">${t}</span>`;
const TOUR_STEPS = {
  1: { screen: 'main', target: '.m-quick', text: () => '<b class="no">1.</b> 여기를 눌러<br>길찾기를 시작해 보세요' },
  '2-1': {
    screen: 'home', target: '.float-top .trip-box', lift: '.float-top', tap: true, when: () => state.ready,
    prep: () => { if (state.ready && state.from && state.to && !state.raw && !state.loading && (state.tourRouteTry || 0) < 2) { state.tourRouteTry = (state.tourRouteTry || 0) + 1; findRoutes(); } },
    text: () => `<b class="no">2-1.</b> 출발지 · 도착지는 이 칸을 눌러<br>장소를 검색해서 넣을 수 있어요<span class="tour-sub">지금은 시연이라 <b>${esc(TOUR_FROM.name)} → ${esc(TOUR_TO.name)}</b>으로 넣어 뒀어요</span>${TOUR_NEXT()}`,
  },
  '2-2': {
    screen: 'home', target: '#go-result', lift: '.cta', fixed: true, when: () => state.ready && !state.loading && !!currentPlan().chosen,
    text: () => '<b class="no">2-2.</b> 길찾기를 눌러<br>탄소를 아끼는 경로를 찾아볼까요?',
  },
  '3-1': {
    screen: 'result', target: '.stabs-wrap', box: true, when: () => !state.loading && !!currentPlan().ranked,
    text: () => '<b class="no">3-1.</b> 절약 강도는 혼자 자동차로 갈 때보다<br>탄소를 얼마나 줄이는지로 경로를 나눠요<span class="tour-f">☁️ 조금: 1% 절약 · ⛅ 중간: 70% 절약 · ☀️ 많이: 97% 절약<br>많이 줄일수록 하늘이 맑아져요</span><span class="tour-act">원하는 강도를 눌러 보세요</span>',
  },
  '3-2': {
    screen: 'result', target: '.rlist', box: true, at: 0.5, when: () => !state.loading && !!currentPlan().chosen,
    text: () => {
      const c = tourCalc();
      const yr = c ? (c.saving * 500) / TREE_YEAR_G : 0; // 1년 출퇴근 = 250일 × 왕복 2번
      const trees = yr >= 10 ? Math.round(yr).toLocaleString() : (Math.round(yr * 10) / 10).toString();
      return `<b class="no">3-2.</b> 경로마다 탄소는 이렇게 계산해요<span class="tour-f">구간 거리 × 1인 1km 배출계수를 모두 더해요<br>자동차 210g · 버스 27.7g · 지하철 1.53g · 걷기 · 자전거 0g<br>아낀 양 = 혼자 자동차 배출 − 이 경로 배출</span><span class="tour-wow">💡 지하철은 1km에 1.53g으로 자동차의 약 1/137이에요. 지금 고른 경로로 1년 동안 출퇴근(250일 왕복)하면 <b>나무 ${trees}그루</b>를 심은 효과예요</span><span class="tour-act">경로를 하나 눌러 보세요</span>`;
    },
  },
  '3-3': {
    screen: 'result', target: '.rcard.sel', place: 'above', when: () => !state.loading && !!currentPlan().chosen,
    text: () => '<b class="no">3-3.</b> 고른 경로가 아끼는 탄소를<br>나무 · 휴대폰 충전으로 바꿔 보여 줘요<span class="tour-act"><b>안내 시작</b>을 눌러 출발해 볼까요?</span>',
  },
  '4-1': {
    screen: 'nav', tap: true,
    text: () => `<b class="no">4-1.</b> 실제로 이동하면 GPS로 내 위치를 따라가며<br>다음에 할 일을 알려 줘요<span class="tour-sub">지금은 시연이라 화면 속에서 <b>${esc((state.from || TOUR_FROM).name)} → ${esc((state.to || TOUR_TO).name)}</b>까지 이동해 볼게요</span>${TOUR_NEXT('화면을 누르면 출발 ›')}`,
  },
  '4-go': { screen: 'nav', chip: true },
  '4-2': {
    screen: 'nav', target: '.navx-arrive', lift: '.navx-bottom', fixed: true,
    text: () => '<b class="no">4-2.</b> 도착했어요! 도착지 30m 안에 오면<br>도착 버튼이 생겨요<span class="tour-act"><b>도착</b>을 눌러 아낀 탄소를 확인해 보세요</span>',
  },
  '5-1': {
    screen: 'done', target: '.done', box: true, tap: true, place: 'below',
    text: () => {
      const c = tourCalc();
      if (!c) return `<b class="no">5-1.</b> 이번 이동에서 아낀 탄소예요${TOUR_NEXT()}`;
      return `<b class="no">5-1.</b> 이번 이동에서 아낀 탄소는<br>이렇게 계산했어요<span class="tour-f">🚗 혼자 자동차 ${tKm(c.baseKm)} × 210g = ${tG(c.car)}<br>🚌 이 경로 ${c.parts.join(' + ') || '0g'}${c.people > 1 ? ` ÷ ${c.people}명` : ''} = ${tG(c.em)}<br>🌱 아낀 양 ${tG(c.car)} − ${tG(c.em)} = <b>${tG(c.saving)}</b></span><span class="tour-sub">= ${esc(saveSense(c.saving).text)}</span>${TOUR_NEXT()}`;
    },
  },
  '5-2': {
    screen: 'done', target: '.mf', tap: true, place: 'above',
    text: () => {
      const g = Math.max(0, loadLog().g || 0);
      return `<b class="no">5-2.</b> 나의 숲에는 지금까지 아낀 탄소가<br>모두 모여 있어요<span class="tour-f">🌳 소나무 1그루가 1년 동안 흡수하는 CO₂ 9.8kg이 모일 때마다 나무가 한 그루씩 늘어요<br>지금까지 ${mfKg(g)} → 나무 <b>${Math.floor(g / TREE_YEAR_G).toLocaleString()}그루</b></span><span class="tour-sub">시연으로 한 이동은 기록에 더하지 않았어요</span>${TOUR_NEXT()}`;
    },
  },
  6: {
    screen: 'done', target: '#cta .btn', lift: '.cta', fixed: true, label: '홈으로 돌아가기',
    text: () => '<b class="no">6.</b> 튜토리얼 끝! 🎉<br>홈으로 돌아가 직접 길을 찾아보세요',
  },
};
const TOUR_ARROW = '<svg class="tour-arrow" viewBox="0 0 40 46" aria-hidden="true"><path d="M9 42 C 8 26 18 16 30 7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="1 6"/><path d="M23 5 L31 5.5 L30 14" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// 지금 단계를 화면에 칠해요: 어두운 막 + 밝힐 곳(빛나는 테두리) + 안내 문구 + "다음부터 보지 않기"
function tourPaint() {
  const root = document.getElementById('app');
  if (!root) return;
  root.querySelectorAll('.tour-hl, .tour-lift').forEach((el) => el.classList.remove('tour-hl', 'tour-lift', 'tour-pad', 'tour-look', 'nudge'));
  let layer = root.querySelector(':scope > .tour-layer');
  const st = tourStage();
  const cfg = st ? TOUR_STEPS[st] : null;
  if (cfg && cfg.prep && cfg.screen === state.screen) cfg.prep();
  if (!cfg || cfg.screen !== state.screen || (cfg.when && !cfg.when())) { if (layer) layer.remove(); return; }
  state.tourActive = true;
  // 4-go: 이동 시연 중에는 막 없이 작은 알림만
  if (cfg.chip) {
    if (!layer || layer.dataset.st !== st) {
      if (layer) layer.remove();
      layer = document.createElement('div');
      layer.className = 'tour-layer';
      layer.dataset.st = st;
      layer.innerHTML = `<div class="tour-chip" role="status"><span>🚶 시연 중 · ${esc((state.to || TOUR_TO).name)}까지 이동하고 있어요</span><i></i></div>`;
      root.appendChild(layer);
    }
    layer.querySelector('.tour-chip').style.setProperty('--p', `${Math.round((state.tourSimP || 0) * 100)}%`);
    return;
  }
  const target = cfg.target ? root.querySelector(cfg.target) : null;
  if (cfg.target && !target) { if (layer) layer.remove(); return; }
  const first = state.tourAnim !== st;
  state.tourAnim = st;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  // 처음 칠할 때 밝힐 곳이 안내 문구와 함께 보이게 스크롤
  if (target && first && !cfg.fixed) {
    const r = target.getBoundingClientRect();
    let want;
    if (cfg.at) want = vh * cfg.at;
    else if (cfg.place === 'above') want = Math.min(vh * 0.46, Math.max(vh * 0.3, vh - r.height - 20));
    else if (cfg.place === 'below') want = r.height > vh * 0.5 ? vh * 0.5 - r.height : vh * 0.16;
    else want = vh * 0.18;
    window.scrollTo(0, Math.max(0, window.scrollY + r.top - want));
  }
  if (target) {
    target.classList.add('tour-hl');
    if (cfg.box) target.classList.add('tour-pad');
    if (cfg.tap) target.classList.add('tour-look');
    if (cfg.label) target.textContent = cfg.label;
  }
  if (cfg.lift) { const l = root.querySelector(cfg.lift); if (l) l.classList.add('tour-lift'); }
  if (layer) layer.remove();
  layer = document.createElement('div');
  layer.className = `tour-layer${first ? ' tour-in' : ''}`;
  layer.dataset.st = st;
  layer.innerHTML = `<div class="tour-dim" data-act="${cfg.tap ? 'tour-next' : 'tour-nudge'}" aria-hidden="true"></div>
    <div class="tour-tip tt" role="status">${target ? TOUR_ARROW : ''}<div class="tour-txt"><p>${cfg.text()}</p></div></div>
    <div class="tour-opt"><label class="tour-never"><input type="checkbox" id="tour-never" ${tourOff() ? 'checked' : ''}><span class="tour-box" aria-hidden="true"></span>다음부터 보지 않기</label></div>`;
  root.appendChild(layer);
  // 안내 문구 자리: 밝힌 곳의 위나 아래 중 넓은 쪽 (화면 가운데 줄 480px 안)
  const tip = layer.querySelector('.tour-tip');
  const side = Math.max(0, (vw - 480) / 2) + 16;
  tip.style.left = `${side}px`;
  tip.style.right = `${side}px`;
  let r2 = null;
  if (!target) tip.classList.add('mid');
  else {
    r2 = target.getBoundingClientRect();
    const below = cfg.place === 'below' || (cfg.place !== 'above' && vh - r2.bottom >= r2.top);
    if (below) { tip.style.top = `${r2.bottom + 10}px`; tip.classList.add('up'); } else { tip.style.top = 'auto'; tip.style.bottom = `${vh - r2.top + 10}px`; tip.classList.add('down'); }
    if (r2.left + r2.width / 2 > vw * 0.62) tip.classList.add('right'); // 오른쪽 버튼(도착 등)은 화살표도 오른쪽
  }
  const tr = tip.getBoundingClientRect();
  if (tr.bottom > vh - 170 || (r2 && r2.bottom > vh - 170)) layer.querySelector('.tour-opt').classList.add('top'); // 아래가 붐비면 위로
}
// 튜토리얼 막이 떠 있는 동안엔 화면 스크롤을 막아요 (휠 · 손가락) — 밝힌 곳과 안내 문구가 어긋나지 않게
function tourBlockScroll(e) {
  if (!document.querySelector('#app > .tour-layer .tour-dim')) return;
  if (e.target && e.target.closest && e.target.closest('.sheet-card')) return;
  if (e.type === 'keydown' && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) return;
  if (e.type === 'keydown' && e.target && e.target.closest && e.target.closest('input, textarea')) return;
  e.preventDefault();
}
['wheel', 'touchmove', 'keydown'].forEach((t) => document.addEventListener(t, tourBlockScroll, { passive: false }));
// 4-go: 고른 경로의 선을 따라 내 위치가 출발지 → 도착지로 9초 동안 움직여요 (진짜 GPS 대신)
function tourSimStart() {
  const { chosen } = currentPlan();
  if (!chosen || !state.from || !state.to) return;
  const pts = [];
  (chosen.lines || []).forEach((ln) => (ln.path || []).forEach((p) => { if (p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng)) pts.push({ lat: +p.lat, lng: +p.lng }); }));
  if (pts.length > 1 && distM(pts[0], state.from) > distM(pts[pts.length - 1], state.from)) pts.reverse();
  pts.unshift({ lat: state.from.lat, lng: state.from.lng });
  pts.push({ lat: state.to.lat, lng: state.to.lng });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distM(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1] || 1;
  const at = (d) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)));
    return { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t, lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * t };
  };
  const dur = 9000;
  const t0 = performance.now();
  clearInterval(tourSimStart.t);
  tourSimStart.t = setInterval(() => {
    if (state.screen !== 'nav' || tourStage() !== '4-go') {
      clearInterval(tourSimStart.t);
      if (tourStage() === '4-go') { tourGo('3-3'); tourPaint(); } // 중간에 안내를 끝내면 경로 고르기부터 다시
      return;
    }
    const p = Math.min(1, (performance.now() - t0) / dur);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // 천천히 출발 → 빠르게 → 천천히 도착
    state.tourSimP = p;
    state.me = p >= 1 ? { lat: state.to.lat, lng: state.to.lng } : at(e * total);
    state.step = Math.min(chosen.steps.length - 1, Math.floor(e * chosen.steps.length));
    if (mapCtl) mapCtl.setMe(state.me, true);
    if (p >= 1) { clearInterval(tourSimStart.t); state.step = chosen.steps.length - 1; tourGo('4-2'); }
    updateNav();
  }, 100);
}
// 4-2 → 도착: 시연 이동은 내 기록 · 포인트 · 캠페인에 더하지 않고 도착 화면만 보여 줘요
function tourDemoFinish() {
  clearInterval(tourSimStart.t);
  state.lastLog = loadLog();
  state.newTitle = null;
  state.lastEarn = null;
  state.campResult = null;
  state.recorded = true;
  go('done');
}
function mainHTML() {
  const log = loadLog();
  const kg = log.g / 1000;
  const part = ((log.g % TREE_YEAR_G) / TREE_YEAR_G) * 100;
  const im = impact(log.g);
  const wk7 = weekSeries(log);
  const quickTo = state.to ? esc(state.to.name) : '어디로 갈까요?';
  const quickFrom = state.from ? esc(state.from.name) : '현재 위치';
  const tops = topCampaigns(5);
  const myJoined = joinedCampaigns();
  const myJoinedG = myJoined.reduce((a, c) => a + (c.myG || 0), 0);
  return `<main class="main">
    <header class="m-top">
      <div class="m-brand">
        <span class="m-logo"><span class="brand-mark" aria-hidden="true"></span></span>
        <span><b>푸른하늘</b><small>BETTER WAY, BETTER AIR</small></span>
      </div>
      <button type="button" class="m-round m-me" data-act="open-account" aria-label="계정 설정">${tierAvatarHTML((state.user && state.user.name) || '나', loadAvatar(), '', loadLog().g)}</button>
    </header>

    <p class="m-hello">${esc(greetingText())}</p>
    <h1 class="m-title">오늘은<br>어디로 가세요?</h1>

    <div class="m-quick-wrap">
    <button type="button" class="m-quick" data-act="open-route">
      <span class="m-quick-ic">${ICON.route}</span>
      <span class="m-quick-txt">
        <small>빠른 길찾기</small>
        <span><b>${quickFrom}</b><i aria-hidden="true">→</i><em class="${state.to ? 'set' : ''}">${quickTo}</em></span>
      </span>
      <span class="m-chev">${ICON.chev}</span>
    </button>
    ${mascotSVG()}
    <p class="mascot-say" id="mascot-say" role="status" aria-live="polite"></p>
    </div>

    <section class="m-card m-wk-card" id="wk-card" data-act="open-week" role="button" tabindex="0" aria-label="최근 7일 탄소 절약 자세히 보기">
      <div class="m-card-head">${weekHeadHTML(wk7)}<span class="m-more">자세히 ${ICON.chev}</span></div>
      ${weekChartHTML(wk7)}
    </section>

    <section class="m-card m-save-card" data-act="open-titles" role="button" tabindex="0" aria-label="내 칭호 보기">
      <div class="m-card-head">
        <div><p class="m-label">지금까지 탄소 절약 <span class="m-ttl">${titleChipHTML(titleOf(log.g), 'sm')}</span></p><p class="m-big"><b>${kg >= 100 ? kg.toFixed(0) : kg.toFixed(1)}</b> kg CO<sub>2</sub></p></div>
        <span class="m-tile">${ICON.leaf}</span>
      </div>
      <div class="m-bar"><span style="width:${log.g > 0 ? Math.max(3, part).toFixed(1) : 0}%"></span></div>
      <p class="m-note">${log.trips ? `${esc(im.short)} · 다음 나무까지 ${formatG(TREE_YEAR_G - (log.g % TREE_YEAR_G))}` : '첫 친환경 이동을 하면 여기에 쌓여요'}</p>
    </section>

    <section class="m-card kg-card ${state.kgOpen ? 'open' : ''}" id="kg-card">${kgCardHTML(state.kgView || 'one', log.g)}</section>

    ${myJoined.length ? `<section class="m-card m-myc-card" data-act="open-my-camps" role="button" tabindex="0" aria-label="내가 참여한 캠페인 보기">
      <div class="m-card-head">
        <div><p class="m-label">내가 참여한 캠페인</p><p class="m-h3">${myJoined.length}개 참여 중 · 총 ${kgText(myJoinedG)} 기여</p></div>
        <span class="m-more">${ICON.chev}</span>
      </div>
      <ul class="mjc-mini">${myJoined.slice(0, 3).map((c) => `<li><span class="mjc-mini-ic">${tagOf(c.tag).icon}</span><span class="mjc-mini-name">${esc(c.title)}</span><span class="mjc-mini-kg">${kgText(c.myG || 0)}</span></li>`).join('')}</ul>
    </section>` : ''}

    <section class="m-sec">
      <div class="m-sec-head">
        <div><p class="m-kicker">${ICON.spark}인기 캠페인 TOP 5</p><h2>요즘 많이 참여하는 캠페인</h2></div>
        <div class="m-dots" id="m-dots">${tops.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>
      </div>
      <div class="m-carousel" id="m-carousel">
        ${tops.map((c, i) => `<button type="button" class="m-camp" data-act="open-camp" data-id="${c.id}" style="background:${campBg(c)}">
          <span class="m-rank">${i + 1}</span>
          ${c.cover ? '' : `<span class="m-camp-art" aria-hidden="true">${tagOf(c.tag).icon}</span>`}
          <span class="m-chip tone-${tagOf(c.tag).tone}">${isPopular(c) ? '🏆 인기 캠페인' : esc(tagOf(c.tag).label)}</span>
          <strong>${esc(c.title)}</strong>
          <span class="m-camp-sub">♥ ${c.likes.toLocaleString()} · ${c.participants.toLocaleString()}명 참여 · ${Math.floor(campPct(c))}% 달성</span>
          <span class="m-camp-go">${ICON.arrow}</span>
        </button>`).join('')}
        <button type="button" class="m-camp m-camp-more" data-act="open-camps"><span class="m-camp-art" aria-hidden="true">＋</span><strong>캠페인 전체 보기</strong><span class="m-camp-sub">직접 캠페인을 만들 수도 있어요</span></button>
      </div>
    </section>
  </main>
  ${tabBarHTML('route')}`;
}
// "CO₂ 1kg은 얼마나 될까요?" — kg을 생활 속 크기로 (1kg 기준 ↔ 내가 아낀 양)
function kgTiles(g) {
  const n = (x) => (x >= 100 ? Math.round(x).toLocaleString() : x >= 10 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString());
  const days = g / EQUIV.pineDayG;
  return [
    { icon: '🎈', tone: 'sky', big: n(g / EQUIV.balloonG), unit: '개', text: '풍선을 가득 채우는 양' },
    days < 365
      ? { icon: '🌳', tone: 'mint', big: n(days), unit: '일', text: '나무 한 그루가 흡수하는 기간' }
      : { icon: '🌳', tone: 'mint', big: n(g / TREE_YEAR_G), unit: '그루', text: '나무가 1년 동안 흡수하는 양' },
    { icon: '📱', tone: 'violet', big: n(g / EQUIV.phoneG), unit: '번', text: '휴대폰 완충할 때 나오는 양' },
    { icon: MI.car, tone: 'sun', big: n(g / FACTORS.car), unit: 'km', text: '혼자 자동차로 달릴 때 나오는 양' },
  ];
}
const MIN_MINE_G = 50;
function kgCardHTML(view, myG) {
  const has = myG >= MIN_MINE_G; // 몇 g 수준은 아직 아낀 양이 없는 걸로 봐요 (0.0kg 방지)
  const mine = view === 'mine';
  const g = mine ? myG : 1000;
  const kgText = !mine ? '1kg' : !has ? '' : myG < 1000 ? `${Math.round(myG)}g` : `${(myG / 1000).toFixed(myG >= 100000 ? 0 : 1)}kg`;
  const title = mine && !has ? '내가 아낀 탄소는 얼마나 될까요?' : `이산화탄소 ${kgText}은 얼마나 될까요?`;
  const body = mine && !has
    ? `<div class="kg-empty">
        <span aria-hidden="true">🌱</span>
        <b>아직 아낀 탄소가 없어요</b>
        <p>버스·지하철·걷기·자전거로 이동하고 도착하면<br>아낀 양을 풍선·나무·휴대폰 충전으로 보여 드려요.</p>
        <button type="button" class="btn primary small" data-act="open-route">친환경 길찾기 시작</button>
      </div>`
    : `<ul class="kg-grid">${kgTiles(g).map((t) => `<li class="kg-tile tone-${t.tone}">
      <span class="kg-ic" aria-hidden="true">${t.icon}</span>
      <b class="num">${t.big}<small>${t.unit}</small></b>
      <span>${t.text}</span></li>`).join('')}</ul>`;
  // 제목을 누르면 아래 설명(풍선·나무·휴대폰·자동차)이 펼쳐져요
  const open = !!state.kgOpen;
  return `<button type="button" class="kg-head" data-act="kg-toggle" aria-expanded="${open}" aria-controls="kg-fold">
      <div><p class="m-label">탄소량 쉽게 보기</p><h3 class="m-h3">${title}</h3></div>
      <span class="kg-chev" aria-hidden="true">${ICON.chev}</span>
    </button>
    <div class="kg-fold ${open ? 'open' : ''}" id="kg-fold"><div class="kg-fold-in">
    <div class="kg-seg" role="tablist" aria-label="기준" data-from="${state.kgSegFrom != null ? state.kgSegFrom : (mine ? 1 : 0)}" data-to="${mine ? 1 : 0}">
      <span class="kg-seg-ind" aria-hidden="true"></span>
      <button type="button" role="tab" class="${mine ? '' : 'on'}" aria-selected="${!mine}" data-act="kg-view" data-id="one">1kg 기준</button>
      <button type="button" role="tab" class="${mine ? 'on' : ''}" aria-selected="${mine}" data-act="kg-view" data-id="mine">내가 아낀 양</button>
    </div>
    ${body}
    <p class="kg-src">풍선 지름 30cm · 소나무(국립산림과학원) · 전력배출계수 2023 · 승용차 210g/km 기준</p>
    </div></div>`;
}
// ── 그린 캘린더: 하루에 아낀 양이 많을수록 진한 하늘색 ──
//  단계: 1 연한 하늘(500g 미만) · 2 하늘(500g~2kg) · 3 파랑(2~5kg) · 4 진한 파랑(5kg 이상)
const CAL_LEVELS = [
  { min: 0, label: '500g 미만' },
  { min: 500, label: '500g~2kg' },
  { min: 2000, label: '2~5kg' },
  { min: 5000, label: '5kg 이상' },
];
function dayRecord(log, key) {
  const d = log.daily && log.daily[key];
  if (d) return d;
  const n = (log.days || []).filter((k) => k === key).length; // 예전 기록(날짜만 있음)
  return n ? { g: null, n } : null;
}
function dayLevel(rec) {
  if (!rec) return 0;
  if (rec.g == null) return 1;
  let lv = 1;
  CAL_LEVELS.forEach((l, i) => { if (rec.g >= l.min) lv = i + 1; });
  return lv;
}
function calendarHTML() {
  const log = loadLog();
  const now = new Date();
  const cur = state.calMonth || { y: now.getFullYear(), m: now.getMonth() };
  const first = new Date(cur.y, cur.m, 1);
  const lead = (first.getDay() + 6) % 7; // 월요일 시작
  const last = new Date(cur.y, cur.m + 1, 0).getDate();
  const todayKey = dayKey(now);
  let monthG = 0; let monthDays = 0; let monthTrips = 0;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<li class="cal-blank"></li>');
  for (let d = 1; d <= last; d++) {
    const key = dayKey(new Date(cur.y, cur.m, d));
    const rec = dayRecord(log, key);
    const lv = dayLevel(rec);
    if (rec) { monthDays++; monthTrips += rec.n; monthG += rec.g || 0; }
    const sel = state.calSel === key;
    cells.push(`<li><button type="button" class="cal-day lv-${lv} ${key === todayKey ? 'is-today' : ''}" aria-pressed="${sel}" data-act="cal-day" data-id="${key}"
      aria-label="${cur.m + 1}월 ${d}일${rec ? ` ${rec.g != null ? formatG(rec.g) : ''} 절약` : ' 기록 없음'}">${d}</button></li>`);
  }
  const isThisMonth = cur.y === now.getFullYear() && cur.m === now.getMonth();
  const im = impact(monthG);
  const wk7 = weekSeries(log);
  const wkG = wk7.reduce((a, d) => a + d.g, 0);
  const wkTrips = wk7.reduce((a, d) => a + d.n, 0);
  const wkDays = wk7.filter((d) => d.n > 0).length;
  const who = state.user && state.user.name && !/사용자$/.test(state.user.name) ? `${state.user.name}님이` : '내가';
  const wim = impact(wkG);
  return `${appBar('내 탄소 절약', 'back')}
    <main class="content cal">
      <section class="m-card wk-big" id="wk-card">
        ${weekHeadHTML(wk7)}
        ${weekChartHTML(wk7, true)}
      </section>
      <section class="m-card wk-done">
        <p class="wk-done-h">${esc(who)} 지난 7일간<br>친환경으로 이동해 해낸 것들이에요</p>
        <ul>
          <li><span class="wk-ic" aria-hidden="true">🌿</span><div><b><em>${shortG(wkG)}</em>의 탄소를 아꼈어요</b><small>${wkG > 0 ? `${wim.icon} ${esc(wim.short)}` : '친환경 경로로 도착하면 쌓여요'}</small></div></li>
          <li><span class="wk-ic" aria-hidden="true">🚌</span><div><b>친환경 이동 <em>${wkTrips}번</em> 했어요</b><small>7일 중 ${wkDays}일 이동</small></div></li>
          <li><span class="wk-ic" aria-hidden="true">🚗</span><div><b>자동차 <em>${(wkG / FACTORS.car).toFixed(1)}km</em>만큼 줄였어요</b><small>혼자 자동차로 달릴 때 나오는 양 기준</small></div></li>
        </ul>
      </section>
      <section class="m-card cal-sum">
        <p class="m-label">${cur.m + 1}월 그린 이동</p>
        <p class="m-h3">${monthDays ? `${monthDays}일 · ${formatG(monthG)} 절약` : '아직 기록이 없어요'}</p>
        ${monthDays ? `<p class="m-note">${im.icon} ${esc(im.short)} · 친환경 이동 ${monthTrips}번</p>` : '<p class="m-note">친환경 경로로 도착하면 이곳에 하늘색으로 쌓여요</p>'}
      </section>
      <section class="m-card cal-card">
        <div class="cal-head">
          <button type="button" class="m-round sm" data-act="cal-prev" aria-label="이전 달">‹</button>
          <h2>${cur.y}년 ${cur.m + 1}월</h2>
          <button type="button" class="m-round sm" data-act="cal-next" aria-label="다음 달" ${isThisMonth ? 'disabled' : ''}>›</button>
        </div>
        <ol class="cal-wd">${'월화수목금토일'.split('').map((w) => `<li>${w}</li>`).join('')}</ol>
        <ol class="cal-grid">${cells.join('')}<span class="cal-ring" id="cal-ring" aria-hidden="true"></span></ol>
        <div class="cal-legend"><span>조금</span>${CAL_LEVELS.map((l, i) => `<i class="lv-${i + 1}" title="${l.label}"></i>`).join('')}<span>많이</span></div>
        <p class="cal-scale">${CAL_LEVELS.map((l, i) => `<span><i class="lv-${i + 1}"></i>${l.label}</span>`).join('')}</p>
      </section>
      <div id="cal-detail">${calDetailHTML(log)}</div>
    </main>`;
}
// 고른 날 자세히
function calDetailHTML(log) {
  if (!state.calSel) return '<p class="cal-hint">날짜를 누르면 그날 아낀 양을 볼 수 있어요</p>';
  const [y, m, d] = state.calSel.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const rec = dayRecord(log, state.calSel);
  const wd = '일월화수목금토'[dt.getDay()];
  return rec
    ? `<div class="cal-detail lv-${dayLevel(rec)}"><span class="cal-dot"></span><div>
        <b>${m}월 ${d}일 (${wd})</b>
        <p>${rec.g != null ? `<strong>${formatG(rec.g)}</strong> 절약 · ` : ''}친환경 이동 ${rec.n}번</p>
        ${rec.g != null ? `<small>${impact(rec.g).icon} ${esc(impact(rec.g).short)}</small>` : '<small>예전 기록이라 아낀 양은 없어요</small>'}
      </div></div>`
    : `<div class="cal-detail lv-0"><span class="cal-dot"></span><div><b>${m}월 ${d}일 (${wd})</b><p>이 날은 기록이 없어요</p></div></div>`;
}
// 선택 동그라미: 화면은 그대로 두고 고른 날짜로 동그라미만 미끄러지듯 이동
function placeCalRing(animate) {
  const grid = document.querySelector('.cal-grid');
  const ring = document.getElementById('cal-ring');
  if (!grid || !ring) return;
  const btn = state.calSel && grid.querySelector(`.cal-day[data-id="${state.calSel}"]`);
  if (!btn) { ring.style.opacity = '0'; return; }
  const g = grid.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  ring.style.transition = animate ? '' : 'none';
  ring.style.transform = `translate(${b.left - g.left + b.width / 2}px, ${b.top - g.top + b.height / 2}px)`;
  ring.style.opacity = '1';
  if (!animate) { void ring.offsetWidth; ring.style.transition = ''; }
}

// ── 캠페인 목록 (탭 3번째) ──
function campaignsHTML() {
  const list = publicCampaigns();
  const tops = rankCampaigns(list).slice(0, 5);
  const sort = state.campSort || 'popular';
  const all = sort === 'new' ? list.slice().sort((a, b) => (b.approvedAt || b.createdAt) - (a.approvedAt || a.createdAt)) : rankCampaigns(list);
  return `<main class="main camps">
    <header class="m-top">
      <div><p class="m-kicker">${ICON.spark}푸른하늘 캠페인</p><h1 class="m-title sm">같이 참여하고<br>탄소 줄이기</h1></div>
      <button type="button" class="m-new" data-act="camp-new">${ICON.plus}<span>만들기</span></button>
    </header>
    <h2 class="c-h">인기 캠페인 TOP 5</h2>
    <ol class="c-top">${tops.map((c, i) => `<li><button type="button" data-act="open-camp" data-id="${c.id}">
      <span class="c-top-n ${['gold', 'silver', 'bronze'][i] || ''}">${i + 1}</span><span class="c-top-t">${esc(c.title)}</span>
      <span class="c-top-m">${isPopular(c) ? '<em>인기</em>' : ''}♥ ${c.likes}</span></button></li>`).join('')}</ol>
    <details class="c-rule">
      <summary><span>🏆 인기 캠페인은 어떻게 정해질까?</span><i aria-hidden="true">${ICON.chev}</i></summary>
      <div class="c-rule-body">
        <p>새 캠페인은 <strong>관리자 검토</strong>를 거쳐 올라가요.</p>
        <p>목표 <strong>${POPULAR_MIN_KG}kg 이상</strong>을 참여자들이 <strong>100% 달성</strong>하면 인기 캠페인이 돼요.</p>
        <p>목표를 달성하고 <strong>${CAMP_END_DAYS}일</strong>이 지나면 캠페인이 마무리되고, 그때의 <strong>최종 달성률</strong>로 탄소 포인트 보상을 정산해요. (목표 ${POPULAR_MIN_KG}kg 이상인 모든 캠페인)</p>
        ${rewardLadderHTML(null)}
        <p>메인 화면에는 인기 캠페인 → 좋아요 순으로 TOP 5가 올라가요.</p>
      </div>
    </details>
    <div class="c-list-head">
      <h2 class="c-h">전체 캠페인 <small>${list.length}개</small></h2>
      <div class="c-sort">
        <button type="button" class="${sort === 'popular' ? 'on' : ''}" data-act="camp-sort" data-id="popular">인기순</button>
        <button type="button" class="${sort === 'new' ? 'on' : ''}" data-act="camp-sort" data-id="new">최신순</button>
      </div>
    </div>
    <div class="c-list">${all.map(campCardHTML).join('')}</div>
  </main>
  ${tabBarHTML('camp')}`;
}
// ── 내가 참여한 캠페인 (메인 화면 > 캘린더 위 버튼) ──
function myJoinedCampsHTML() {
  const list = joinedCampaigns();
  const totalG = list.reduce((a, c) => a + (c.myG || 0), 0);
  return `${appBar('내가 참여한 캠페인', 'back')}
    <main class="content mjc">
      ${list.length ? `<section class="mjc-sum">
        <p class="m-label">참여한 캠페인 <b>${list.length}개</b>${list.some(campEnded) ? ` <small>(종료 ${list.filter(campEnded).length}개 포함)</small>` : ''}</p>
        <p class="m-big"><b>${kgText(totalG)}</b> <small>내가 기여한 탄소</small></p>
      </section>` : ''}
      ${list.length ? `<div class="c-list">${list.map(campCardHTML).join('')}</div>`
        : `<p class="empty">아직 참여한 캠페인이 없어요.<br>마음에 드는 캠페인에서 "캠페인 참여하기"를 눌러 보세요.</p>
           <button type="button" class="btn primary" data-act="open-camps" style="margin-top:14px">캠페인 둘러보기</button>`}
    </main>`;
}
function campCardHTML(c) {
  const pct = campPct(c);
  return `<article class="c-card" data-act="open-camp" data-id="${c.id}">
    <div class="c-cover" style="background:${campBg(c, 'linear-gradient(180deg,rgba(0,0,0,0) 50%,rgba(0,0,0,.25))')}">${c.cover ? '' : `<span>${tagOf(c.tag).icon}</span>`}
      ${campEnded(c) ? '<em class="c-badge ended">🏁 종료</em>' : isPopular(c) ? '<em class="c-badge">🏆 인기</em>' : ''}</div>
    <div class="c-body">
      <span class="c-tag tone-${tagOf(c.tag).tone}">${esc(tagOf(c.tag).label)}</span>
      <h3>${esc(c.title)}</h3>
      <p class="c-by">by ${esc(c.creator)} · ${c.participants.toLocaleString()}명 참여</p>
      <p class="c-mode">${campMode(c).icon}<span>${campMode(c).label}로 참여</span></p>
      <div class="c-prog"><span style="width:${pct.toFixed(1)}%"></span></div>
      <p class="c-num"><b>${kgShort(c.progressG)}</b> / ${c.goalKg.toLocaleString()}kg <span>${Math.floor(pct)}%</span></p>
      <p class="c-like ${c.liked ? 'on' : ''}">${ICON.heart}${c.likes.toLocaleString()}</p>
    </div>
  </article>`;
}
// ── 캠페인 상세 ──
function campaignHTML() {
  const c = campStore.load().find((x) => x.id === state.campId);
  const ended = !!c && isApproved(c) && campEnded(c);
  if (!c || (!isPublic(c) && !isMine(c) && !isAdmin() && !(ended && c.joined))) return `${appBar('캠페인', 'back')}<main class="content"><p class="empty">캠페인을 찾지 못했어요.</p></main>`;
  const pub = isPublic(c);
  const pct = campPct(c);
  const pop = isPopular(c);
  const left = Math.max(0, c.goalKg * 1000 - c.progressG);
  return `<main class="cd">
    <div class="cd-cover" style="background:${campBg(c, 'linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,0) 30%,rgba(0,0,0,.55))')}">
      <button type="button" class="m-round back" data-act="back" aria-label="뒤로">←</button>
      ${isMine(c) ? `<button type="button" class="cd-del" data-act="camp-del" data-id="${c.id}" aria-label="캠페인 삭제">${ICON.trash}<span>삭제</span></button>` : ''}
      ${c.cover ? '' : `<span class="cd-art" aria-hidden="true">${tagOf(c.tag).icon}</span>`}
      <div class="cd-cover-txt">
        <span class="cd-chips"><span class="m-chip tone-${tagOf(c.tag).tone}">${pop ? '🏆 인기 캠페인' : esc(tagOf(c.tag).label)}</span><span class="m-chip cd-mode">${campMode(c).icon}${campMode(c).label}로 참여</span></span>
        <h1>${esc(c.title)}</h1>
        <p>${esc(c.sub || '')}</p>
      </div>
    </div>
    <div class="cd-wrap">
      ${ended ? `<section class="cd-review ended" role="status"><b>🏁 종료된 캠페인이에요</b>
        <p>목표를 달성하고 ${CAMP_END_DAYS}일이 지나 목록에서 내려갔어요. 함께해 주셔서 고마워요!</p>
        <small>${new Date(c.reachedAt || Date.now()).toLocaleDateString('ko-KR')} 목표 달성</small></section>`
      : pub ? (endsInDays(c) ? `<section class="cd-review ending" role="status"><b>🎉 목표 달성! ${endsInDays(c)}일 뒤 종료돼요</b><p>목표를 달성한 캠페인은 ${CAMP_END_DAYS}일 동안 더 참여할 수 있어요.</p></section>` : '') : reviewBannerHTML(c)}
      <section class="m-card cd-goal">
        <p class="m-label">참여자들이 함께 아낀 탄소</p>
        <p class="m-big"><b>${(c.progressG / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}</b> / ${c.goalKg.toLocaleString()} kg CO<sub>2</sub></p>
        <div class="m-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
        <p class="m-note">${pct >= 100 ? '🎉 목표 달성!' : `목표까지 ${kgShort(left)} 남았어요`} · ${c.participants.toLocaleString()}명 참여${c.progressG > 0 ? ` · ${impact(c.progressG).icon} ${esc(impact(c.progressG).short)}` : ''}</p>
      </section>
      ${pub || ended ? campRankHTML(c) : ''}
      ${campRewardBoxHTML(c)}
      <article class="cd-body">
        <p class="c-by">by <b>${esc(c.creator)}</b> · ${new Date(c.createdAt).toLocaleDateString('ko-KR')}</p>
        ${esc(c.body).split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('')}
        <p class="cd-how">"캠페인 참여하기"를 누르고 출발지·도착지를 정하면 <b>${campMode(c).label}</b>로 가는 길만 보여 드려요. 도착하면 자동차 대신 아낀 탄소가 이 캠페인에 더해지고 기여 랭킹에 올라가요.</p>
      </article>
    </div>
    ${pub ? `<div class="cd-bar">
      <button type="button" class="cd-like ${c.liked ? 'on' : ''}" data-act="camp-like" data-id="${c.id}" aria-pressed="${c.liked}">${ICON.heart}<span>${c.likes.toLocaleString()}</span></button>
      <button type="button" class="btn primary cd-join" data-act="camp-join" data-id="${c.id}">${campMode(c).icon}<span>${c.myTrips ? '캠페인 또 참여하기' : '캠페인 참여하기'}</span></button>
    </div>` : ended ? `<div class="cd-bar"><button type="button" class="btn cd-join" disabled><span>종료된 캠페인이에요</span></button></div>` : reviewBarHTML(c)}
  </main>`;
}
// 검토 중·반려된 캠페인 상세 위쪽 안내
function reviewBannerHTML(c) {
  const when = new Date(c.submittedAt || c.createdAt).toLocaleDateString('ko-KR');
  if (c.status === 'rejected') {
    return `<section class="cd-review rejected" role="status">
      <b>반려됐어요</b>
      <p class="cd-reason">${esc(c.rejectReason || '사유가 적혀 있지 않아요')}</p>
      <small>${isMine(c) ? '내용을 고친 뒤 다시 검토를 요청할 수 있어요.' : `${when} 신청`}</small>
    </section>`;
  }
  return `<section class="cd-review pending" role="status">
    <b>관리자가 검토하고 있어요</b>
    <p>${isMine(c) ? '승인되면 캠페인 목록과 메인 화면에 올라가고, 알림으로 알려 드려요. 그전에는 나만 볼 수 있어요.' : `${esc(c.creator)}님이 ${when}에 신청한 캠페인이에요. 내용을 확인하고 승인하거나 반려해 주세요.`}</p>
  </section>`;
}
// 검토 중·반려된 캠페인 아래쪽 버튼 (관리자: 승인·반려 / 만든 사람: 수정)
function reviewBarHTML(c) {
  if (isAdmin() && c.status === 'pending') {
    return `<div class="cd-bar">
      <button type="button" class="btn rv-no" data-act="camp-reject" data-id="${c.id}">반려</button>
      <button type="button" class="btn primary rv-ok" data-act="camp-approve" data-id="${c.id}">승인하고 게시</button>
    </div>`;
  }
  if (isMine(c)) {
    return `<div class="cd-bar">
      <button type="button" class="btn ${c.status === 'rejected' ? 'primary' : ''} rv-edit" data-act="camp-edit" data-id="${c.id}">${c.status === 'rejected' ? '수정해서 다시 신청' : '검토 전에 내용 고치기'}</button>
    </div>`;
  }
  if (isAdmin() && c.status === 'rejected') {
    return `<div class="cd-bar"><button type="button" class="btn primary rv-ok" data-act="camp-approve" data-id="${c.id}">다시 보고 승인하기</button></div>`;
  }
  return '';
}
// ── 캠페인 만들기 ──
function campaignNewHTML() {
  const d = state.campDraft || (state.campDraft = { tag: 'transit', mode: 'bus', goalKg: 100, cover: '' });
  const editing = !!state.campEditId;
  return `${appBar(editing ? '캠페인 고치기' : '캠페인 만들기', 'back')}
    <main class="content cn">
      <form id="camp-form" class="cn-form" novalidate>
        ${d.rejectReason ? `<section class="cd-review rejected"><b>반려 사유</b><p class="cd-reason">${esc(d.rejectReason)}</p><small>사유를 참고해서 고친 뒤 다시 신청해 주세요.</small></section>` : ''}
        <label class="cn-cover" style="${d.cover ? `background:url('${d.cover}') center/cover` : ''}">
          <input type="file" id="camp-cover" accept="image/*" hidden>
          ${d.cover ? '<span class="cn-cover-edit">사진 바꾸기</span>' : `<span class="cn-cover-empty">${ICON.plus}<b>커버 이미지 올리기</b><small>캠페인을 잘 보여주는 사진 한 장</small></span>`}
        </label>
        <div class="field"><span class="label">분류</span>
          <div class="cn-tags">${CAMP_TAGS.map((t) => `<button type="button" class="cn-tag ${d.tag === t.id ? 'on' : ''}" data-act="cn-tag" data-id="${t.id}">${t.icon} ${t.label}</button>`).join('')}</div></div>
        <div class="field"><span class="label">이동 수단 <small class="cn-sub">참여자는 이 수단으로 가는 길만 찾을 수 있어요</small></span>
          <div class="cn-tags cn-modes">${CAMP_MODES.map((m) => `<button type="button" class="cn-tag ${(d.mode || TAG_MODE[d.tag]) === m.id ? 'on' : ''}" data-act="cn-mode" data-id="${m.id}">${m.icon} ${m.label}</button>`).join('')}</div></div>
        <label class="field"><span class="label">캠페인 제목</span>
          <input class="input" name="title" maxlength="30" placeholder="예: 한 정거장 먼저 내려 걸어요" value="${esc(d.title || '')}"></label>
        <label class="field"><span class="label">한 줄 소개</span>
          <input class="input" name="sub" maxlength="40" placeholder="예: 하루 10분 걷기로 탄소 줄이기" value="${esc(d.sub || '')}"></label>
        <label class="field"><span class="label">캠페인 글</span>
          <textarea class="input cn-body" name="body" rows="7" maxlength="1500" placeholder="어떤 실천을 함께 하고 싶은지, 왜 중요한지 적어 주세요.">${esc(d.body || '')}</textarea></label>
        <div class="field"><span class="label">목표 탄소 절약량</span>
          <div class="cn-goal"><input class="input" name="goalKg" type="number" inputmode="numeric" min="10" max="100000" step="10" value="${d.goalKg || ''}"><b>kg</b></div>
          <div class="cn-quick">${[50, 100, 300, 500, 1000].map((k) => `<button type="button" class="${Number(d.goalKg) === k ? 'on' : ''}" data-act="cn-goal" data-id="${k}">${k.toLocaleString()}kg</button>`).join('')}</div>
          <p class="cn-help" id="cn-help">${goalHelp(d.goalKg)}</p></div>
        ${state.campErr ? `<p class="login-msg" role="alert">${esc(state.campErr)}</p>` : ''}
        <p class="cn-review">📋 올리면 관리자가 검토해요. 승인되면 캠페인 목록에 올라가고 알림으로 알려 드려요.</p>
        <button type="submit" class="btn primary">${editing ? '다시 올리기' : '올리기'}</button>
      </form>
    </main>`;
}
function goalHelp(kg) {
  kg = Number(kg) || 0;
  if (!kg) return `목표가 ${POPULAR_MIN_KG}kg 이상이고 100% 달성하면 인기 캠페인이 돼요.`;
  const im = impact(kg * 1000);
  return kg >= POPULAR_MIN_KG
    ? `${im.icon} ${im.short} · 달성하면 만든 사람에게 ${(kg * REWARD_TIERS[0].maker).toLocaleString()}P부터 최대 ${(kg * REWARD_TIERS[3].maker).toLocaleString()}P`
    : `${im.icon} ${im.short} · ${POPULAR_MIN_KG}kg 이상이어야 캠페인 보상을 받을 수 있어요`;
}
// 커버 사진: 긴 변 1080px 로 줄여 저장 (휴대폰 저장 공간 아끼기)
function readCover(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('사진 파일을 골라 주세요.'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
      img.onload = () => {
        const sc = Math.min(1, 1080 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.78));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function saveDraftFromForm() {
  const f = document.getElementById('camp-form');
  if (!f) return;
  const fd = new FormData(f);
  Object.assign(state.campDraft, { title: String(fd.get('title') || ''), sub: String(fd.get('sub') || ''), body: String(fd.get('body') || ''), goalKg: Number(fd.get('goalKg')) || '' });
}
function submitCampaign() {
  saveDraftFromForm();
  const d = state.campDraft;
  const err = !d.title.trim() ? '캠페인 제목을 적어 주세요.'
    : d.body.trim().length < 20 ? '캠페인 글을 20자 이상 적어 주세요.'
    : !(d.goalKg >= 10) ? '목표는 10kg 이상으로 정해 주세요.' : '';
  state.campErr = err;
  if (err) { render(); return; }
  const fields = { tag: d.tag, mode: d.mode || TAG_MODE[d.tag] || 'bus', title: d.title.trim(), sub: d.sub.trim(), body: d.body.trim(), goalKg: Math.round(d.goalKg), cover: d.cover || '' };
  if (dbMode()) { submitCampaignDb(fields); return; }
  const list = campStore.load();
  const old = state.campEditId && list.find((x) => x.id === state.campEditId && isMine(x));
  let c;
  if (old) {
    c = Object.assign(old, fields, { status: 'pending', rejectReason: '', submittedAt: Date.now(), notice: null });
  } else {
    c = {
      id: `c-${Date.now().toString(36)}`, ...fields, progressG: 0, myG: 0, participants: 1, likes: 0,
      creator: (state.user && state.user.name) || '푸른하늘 사용자', ownerId: userKey(state.user),
      status: 'pending', joined: true, liked: false, rewarded: false, createdAt: Date.now(), submittedAt: Date.now(),
    };
    list.unshift(c);
  }
  if (!campStore.save(list)) { state.campErr = '저장 공간이 부족해요. 더 작은 사진으로 바꿔 주세요.'; render(); return; }
  state.campDraft = null; state.campErr = ''; state.campEditId = null;
  state.campId = c.id;
  state.campReturn = 'account'; // 검토 상태는 계정정보 > 내 캠페인에서 봐요
  go('campaign');
  toast('검토 요청을 보냈어요! 승인되면 알려 드릴게요');
}

// 서버 DB: 서버에 올리고 → 서버 기록으로 맞춘 뒤 → 올린 캠페인 화면으로
async function submitCampaignDb(fields) {
  if (state.campBusy) return;
  state.campBusy = true;
  const btn = document.querySelector('#camp-form [type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = '올리는 중…'; }
  const r = await dataApi('camp-save', { id: state.campEditId || undefined, ...fields });
  state.campBusy = false;
  if (r.status === 401) { needRelogin(); return; }
  if (r.status !== 200) { state.campErr = r.data.error || '올리지 못했어요. 잠시 후 다시 시도해 주세요.'; render(); return; }
  await syncFromServer({ quiet: true });
  state.campDraft = null; state.campErr = ''; state.campEditId = null;
  state.campId = r.data.id;
  state.campReturn = 'account';
  go('campaign');
  toast('검토 요청을 보냈어요! 승인되면 알려 드릴게요');
}

// ── 관리자: 캠페인 검토 화면 (계정정보 > 캠페인 검토) ──
function adminHTML() {
  if (!isAdmin()) return `${appBar('캠페인 검토', 'back')}<main class="content"><p class="empty">관리자만 볼 수 있어요.</p></main>`;
  const list = campStore.load();
  const tab = state.adminTab || 'pending';
  const pend = pendingCampaigns(list);
  const done = list.filter((c) => c.ownerId && c.status && c.status !== 'pending').sort((a, b) => (b.reviewedAt || 0) - (a.reviewedAt || 0));
  const rows = tab === 'pending' ? pend : done;
  const item = (c) => `<article class="ad-item">
      <button type="button" class="ad-head" data-act="open-camp" data-id="${c.id}">
        <span class="acc-camp-cover" style="background:${campBg(c, 'linear-gradient(0deg,rgba(0,0,0,0),rgba(0,0,0,0))')}">${c.cover ? '' : tagOf(c.tag).icon}</span>
        <span class="ad-txt">
          <span class="ad-meta"><span class="c-tag tone-${tagOf(c.tag).tone}">${esc(tagOf(c.tag).label)}</span>${tab === 'pending' ? '' : `<span class="st st-${c.status}">${STATUS_LABEL[c.status]}</span>`}</span>
          <b>${esc(c.title)}</b>
          <small>by ${esc(c.creator)} · 목표 ${c.goalKg.toLocaleString()}kg · ${new Date(c.submittedAt || c.createdAt).toLocaleDateString('ko-KR')} 신청</small>
        </span>${ICON.chev}
      </button>
      ${c.sub ? `<p class="ad-sub">${esc(c.sub)}</p>` : ''}
      <p class="ad-body">${esc(c.body).replace(/\n+/g, ' ')}</p>
      ${c.status === 'rejected' ? `<p class="ad-reason">반려 사유 · ${esc(c.rejectReason || '-')}</p>` : ''}
      <div class="ad-acts">
        ${c.status === 'pending' ? `<button type="button" class="btn rv-no" data-act="camp-reject" data-id="${c.id}">반려</button>
          <button type="button" class="btn primary rv-ok" data-act="camp-approve" data-id="${c.id}">승인</button>`
        : c.status === 'approved' ? `<button type="button" class="btn rv-no" data-act="camp-reject" data-id="${c.id}">게시 내리기</button>`
        : `<button type="button" class="btn primary rv-ok" data-act="camp-approve" data-id="${c.id}">다시 승인</button>`}
      </div>
    </article>`;
  return `${appBar('캠페인 검토', 'back')}
    <main class="content ad">
      <p class="ad-lead">사용자가 만든 캠페인을 확인하고 승인하면 캠페인 목록과 메인 TOP 5 후보에 올라가요.</p>
      <div class="c-sort ad-tabs" role="tablist">
        <button type="button" role="tab" class="${tab === 'pending' ? 'on' : ''}" aria-selected="${tab === 'pending'}" data-act="admin-tab" data-id="pending">검토 대기 ${pend.length}</button>
        <button type="button" role="tab" class="${tab === 'done' ? 'on' : ''}" aria-selected="${tab === 'done'}" data-act="admin-tab" data-id="done">처리 완료 ${done.length}</button>
      </div>
      ${rows.length ? rows.map(item).join('') : `<p class="acc-empty">${tab === 'pending' ? '✅ 검토할 캠페인이 없어요.' : '아직 처리한 캠페인이 없어요.'}</p>`}
      ${dbMode() ? demoHTML() : ''}
    </main>`;
}
// 예시 데이터: 사람이 많을 때 랭킹·캠페인이 어떻게 보이는지 확인용 (관리자만)
function demoHTML() {
  const n = state.demoUsers || 0; const cal = state.demoCal || 0;
  const busy = state.demoBusy ? 'disabled' : '';
  return `<section class="ad-demo">
      <b>🧪 예시 데이터</b>
      <p>시연용이에요. ① 가상 회원 100명과 이동 기록(약 1,200번)·캠페인 8개 ② <b>내 계정</b>에 8월 1일부터 오늘까지 불규칙한 이동 기록(그린 캘린더 색이 고루 보이게)을 넣어요. 가상 회원은 로그인할 수 없고, 진짜 회원 기록은 건드리지 않아요.</p>
      ${n || cal ? `<p class="ad-demo-now">${n ? `예시 회원 <b>${n.toLocaleString()}명</b>` : '예시 회원 없음'} · ${cal ? `내 캘린더 예시 이동 <b>${cal.toLocaleString()}번</b>` : '내 캘린더 예시 없음'}</p>` : ''}
      ${!n || !cal ? `<button type="button" class="btn primary" data-act="demo-seed" ${busy}>${state.demoBusy ? '넣는 중…' : n || cal ? '빠진 예시 데이터 넣기' : '예시 데이터 넣기'}</button>` : ''}
      ${n || cal ? `<button type="button" class="btn rv-no" data-act="demo-clear" ${busy}>${state.demoBusy ? '지우는 중…' : '예시 데이터 모두 지우기'}</button>` : ''}
    </section>`;
}
// 관리자: 포인트 지급·삭제 / 탄소 절약량 더하기·빼기 (같은 모양의 창)
//  kind 'points' | 'carbon', target: 회원 관리에서 고른 회원 { id, name } (없으면 닉네임 칸, 비우면 나)
const ADJ = {
  points: { title: '💰 포인트 지급 · 삭제', modes: [['grant', '지급', '지급하기'], ['deduct', '삭제', '삭제하기']], unit: 'P', label: '포인트', ph: '예: 1000', chips: [100, 500, 1000, 5000, 10000], min: 1, max: 1000000, step: 1, api: 'admin-points', key: 'amount' },
  carbon: { title: '🌿 탄소 절약량 조절', modes: [['plus', '더하기', '더하기'], ['minus', '빼기', '빼기']], unit: 'kg', label: '절약량 (kg)', ph: '예: 12.5', chips: [0.5, 1, 5, 10, 50], min: 0.1, max: 100000, step: 0.1, api: 'admin-carbon', key: 'kg' },
};
// 안드로이드는 유리 흐림(backdrop-filter)·빛 애니메이션이 버벅여서 가벼운 디자인으로 바꿔요 (style.css 의 html.android)
if (/Android/i.test(navigator.userAgent)) document.documentElement.classList.add('android');

// 아래에서 올라오는 시트(탄소 절약량 조절 · 포인트 지급 등)가 떠 있는 동안 뒤 화면이 스크롤되지 않게 고정해요.
//  휴대폰 사파리는 body overflow:hidden 만으로는 막히지 않아서, body 를 그 자리에 고정했다가 닫으면 원래 위치로 돌려놔요.
const sheetLock = { on: false, y: 0 };
function syncSheetLock() {
  const on = !!document.querySelector('body > .sheet-wrap');
  if (on === sheetLock.on) return;
  sheetLock.on = on;
  const b = document.body.style;
  if (on) {
    sheetLock.y = window.scrollY || 0;
    Object.assign(b, { position: 'fixed', top: `-${sheetLock.y}px`, left: '0', right: '0', width: '100%' });
    document.documentElement.classList.add('sheet-lock');
  } else {
    Object.assign(b, { position: '', top: '', left: '', right: '', width: '' });
    document.documentElement.classList.remove('sheet-lock');
    window.scrollTo(0, sheetLock.y);
  }
}
if (typeof MutationObserver !== 'undefined' && document.body) new MutationObserver(syncSheetLock).observe(document.body, { childList: true });

function adminAdjustSheet(kind, target = null) {
  const c = ADJ[kind]; let mode = c.modes[0][0];
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet-bg" data-no></div>
    <section class="sheet-card ap" role="dialog" aria-label="${c.title}">
      <span class="sheet-grab" aria-hidden="true"></span>
      <div class="sheet-ask"><b>${c.title}</b><p>${target ? `<strong>${esc(target.name)}</strong>님에게 적용돼요.` : '받는 사람 닉네임을 비우면 내 계정에 적용돼요.'}${kind === 'points' ? '<br>삭제는 보유 포인트에서 먼저 빼고, 모자라면 이번 달 탄소 포인트에서 빼요.' : ''}</p></div>
      <div class="ap-seg" role="tablist">${c.modes.map(([id, lb], i) => `<button type="button" role="tab" class="${i ? '' : 'on'} ${id === 'deduct' || id === 'minus' ? 'neg' : ''}" data-mode="${id}">${lb}</button>`).join('')}</div>
      ${target ? '' : '<label class="ap-l">대상 회원<input class="input" id="ap-name" maxlength="40" placeholder="닉네임 (비우면 나)"></label>'}
      <label class="ap-l">${c.label}<input class="input num" id="ap-amount" type="number" inputmode="decimal" min="${c.min}" max="${c.max}" step="${c.step}" placeholder="${c.ph}"></label>
      <div class="ap-chips">${c.chips.map((v) => `<button type="button" class="rj-chip" data-add="${v}">+${v.toLocaleString()}${c.unit}</button>`).join('')}</div>
      <p class="rj-err" id="ap-err" hidden></p>
      <button type="button" class="btn primary" data-yes>${c.modes[0][2]}</button>
      <button type="button" class="btn sheet-cancel" data-no>취소</button>
    </section>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  const close = () => { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); };
  const amt = sheet.querySelector('#ap-amount'); const err = sheet.querySelector('#ap-err'); const yes = sheet.querySelector('[data-yes]');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  sheet.addEventListener('click', async (e) => {
    const md = e.target.closest('[data-mode]');
    if (md) {
      mode = md.dataset.mode;
      sheet.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b === md));
      const lb = c.modes.find((m) => m[0] === mode)[1];
      yes.textContent = (c.modes.find((m) => m[0] === mode) || [])[2] || lb; yes.classList.toggle('danger', md.classList.contains('neg'));
      sheet.querySelectorAll('[data-add]').forEach((b) => { b.textContent = `${md.classList.contains('neg') ? '-' : '+'}${Number(b.dataset.add).toLocaleString()}${c.unit}`; });
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) { amt.value = String(Math.round(((Number(amt.value) || 0) + Number(add.dataset.add)) * 10) / 10); return; }
    if (e.target.closest('[data-no]')) return close();
    if (!e.target.closest('[data-yes]')) return;
    const v = Number(amt.value);
    if (!(v >= c.min && v <= c.max)) return fail(`${c.min.toLocaleString()} ~ ${c.max.toLocaleString()}${c.unit} 사이로 적어 주세요.`);
    const name = target ? '' : sheet.querySelector('#ap-name').value.trim();
    if (!dbMode()) {
      if (kind !== 'points' || name || mode !== 'grant') return fail('이 기능은 서버 DB가 연결된 곳에서만 쓸 수 있어요.');
      addPoints(v); close(); render(); toast(`+${v.toLocaleString()}P 지급했어요`); return;
    }
    yes.disabled = true; const keep = yes.textContent; yes.textContent = '처리하는 중…';
    const r = await dataApi(c.api, { [c.key]: v, mode, name, id: target ? target.id : undefined });
    if (r.status === 401) { close(); return needRelogin(); }
    if (r.status !== 200) { yes.disabled = false; yes.textContent = keep; return fail(r.data.error || '처리하지 못했어요.'); }
    close();
    const who = r.data.me ? '내 계정' : `${r.data.name}님`;
    toast(kind === 'points'
      ? `${who} ${r.data.mode === 'deduct' ? `-${r.data.amount.toLocaleString()}P 삭제` : `+${r.data.amount.toLocaleString()}P 지급`}했어요 (보유 ${r.data.total.toLocaleString()}P · 이번 달 ${Number(r.data.month || 0).toLocaleString()}P)`
      : `${who} 탄소 절약량 ${r.data.mode === 'minus' ? '-' : '+'}${r.data.kg.toLocaleString()}kg (총 ${r.data.totalKg.toLocaleString(undefined, { maximumFractionDigits: 1 })}kg)`);
    await syncFromServer({ quiet: true });
    if (state.screen === 'admin-users') loadAdminUsers(state.adm && state.adm.q); else render();
  });
}

// ── 관리자: 회원 관리 (검색 · 차단 · 삭제) ──
function loadAdminUsers(q = '') {
  state.adm = { ...(state.adm || {}), q, loading: true };
  if (state.screen === 'admin-users') renderAdminList();
  const seq = (loadAdminUsers.seq = (loadAdminUsers.seq || 0) + 1);
  dataApi('admin-users', undefined, `&q=${encodeURIComponent(q)}`).then((r) => {
    if (seq !== loadAdminUsers.seq) return; // 늦게 온 예전 검색 결과는 버려요
    if (r.status === 401) return needRelogin();
    state.adm = r.status === 200 ? { ...r.data, loading: false } : { q, users: [], loading: false, error: r.data.error || '불러오지 못했어요.' };
    if (state.screen === 'admin-users') renderAdminList();
  });
}
function adminUserRowHTML(u) {
  const kg = (u.savedG / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `<li class="au-row ${u.blocked ? 'is-blocked' : ''}">
    <div class="au-top">
      ${tierAvatarHTML(u.name, '', '', u.savedG)}
      <div class="au-txt">
        <b>${esc(u.name)}${u.me ? ' <em class="au-tag me">나</em>' : ''}${u.admin ? ' <em class="au-tag adm">관리자</em>' : ''}${u.blocked ? ' <em class="au-tag blk">차단됨</em>' : ''}</b>
        <small>${u.provider === 'kakao' ? '카카오' : u.provider === 'seed' ? '예시 회원' : esc(u.email || '이메일')} · 이동 ${u.trips.toLocaleString()}번 · ${u.points.toLocaleString()}P · ${kg}kg</small>
        ${u.blocked ? `<small class="au-when">${new Date(u.blockedAt).toLocaleDateString('ko-KR')} 차단</small>` : ''}
      </div>
    </div>
    <div class="au-acts">
      <button type="button" class="btn small" data-act="adm-pt" data-id="${u.id}">포인트</button>
      <button type="button" class="btn small" data-act="adm-co2" data-id="${u.id}">탄소</button>
      <button type="button" class="btn small" data-act="adm-name" data-id="${u.id}">닉네임</button>
      ${u.admin || u.me ? '' : `<button type="button" class="btn small ${u.blocked ? '' : 'rv-no'}" data-act="adm-block" data-id="${u.id}" data-on="${u.blocked ? 0 : 1}">${u.blocked ? '차단 해제' : '차단'}</button>
      <button type="button" class="btn small au-del" data-act="adm-del" data-id="${u.id}" aria-label="${esc(u.name)} 삭제">${ICON.trash}</button>`}
    </div>
  </li>`;
}
function adminListHTML() {
  const a = state.adm || {};
  const list = a.users || [];
  const head = a.q ? `"${esc(a.q)}" 검색 결과 ${list.length.toLocaleString()}명` : `차단된 회원 ${(a.blockedCount || 0).toLocaleString()}명`;
  return `<p class="au-head">${head}${a.loading ? ' <span class="spinner" aria-hidden="true"></span>' : ''}</p>
    ${a.error ? `<p class="hint">${esc(a.error)}</p>` : ''}
    ${list.length ? `<ul class="au-list">${list.map(adminUserRowHTML).join('')}</ul>`
      : a.loading ? '' : `<p class="acc-empty">${a.q ? '찾는 회원이 없어요.' : '차단된 회원이 없어요. 위에서 닉네임이나 이메일로 검색해 보세요.'}</p>`}`;
}
function renderAdminList() { const el = document.getElementById('au-out'); if (el) el.innerHTML = adminListHTML(); }
function adminUsersHTML() {
  if (!isAdmin()) return `${appBar('회원 관리', 'back')}<main class="content"><p class="empty">관리자만 볼 수 있어요.</p></main>`;
  const a = state.adm || {};
  return `${appBar('회원 관리', 'back')}
    <main class="content au">
      <p class="ad-lead">닉네임이나 이메일로 회원을 찾아 차단하거나 지울 수 있어요. 차단된 회원은 로그인할 수 없고 랭킹에서도 빠져요.${a.userCount ? ` (전체 ${a.userCount.toLocaleString()}명)` : ''}</p>
      <form class="search-bar" id="au-form">
        <input id="au-q" class="input" type="search" enterkeyhint="search" autocomplete="off" placeholder="닉네임 · 이메일 검색" value="${esc(a.q || '')}">
        <button type="submit" class="btn primary small">검색</button>
      </form>
      ${a.q ? '<button type="button" class="au-blocked-link" data-act="adm-blocked">🚫 차단된 회원 목록 보기</button>' : ''}
      <div id="au-out">${adminListHTML()}</div>
    </main>`;
}
// 관리자: 회원 닉네임 바꾸기 (아래에서 올라오는 창)
function adminRenameSheet(u) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet-bg" data-no></div>
    <section class="sheet-card ap" role="dialog" aria-label="닉네임 바꾸기">
      <span class="sheet-grab" aria-hidden="true"></span>
      <div class="sheet-ask"><b>✏️ 닉네임 바꾸기</b><p><strong>${esc(u.name)}</strong>님의 닉네임을 바꿔요. 랭킹과 캠페인에 바로 반영돼요.</p></div>
      <form class="ap-form" novalidate><label class="ap-l">새 닉네임<input class="input" id="rn-name" maxlength="12" autocomplete="off" value="${esc(u.name)}" placeholder="2~12자"></label></form>
      <p class="rj-err" id="rn-err" hidden></p>
      <button type="button" class="btn primary" data-yes>바꾸기</button>
      <button type="button" class="btn sheet-cancel" data-no>취소</button>
    </section>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  const input = sheet.querySelector('#rn-name'); const err = sheet.querySelector('#rn-err'); const yes = sheet.querySelector('[data-yes]');
  setTimeout(() => { input.focus(); input.select(); }, 250);
  const close = () => { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); };
  const fail = (m) => { err.textContent = m; err.hidden = false; input.focus(); };
  const save = async () => {
    if (yes.disabled) return;
    const name = input.value.trim();
    if (name.length < 2) return fail('닉네임은 2자 이상이에요.');
    if (name === u.name) return fail('지금과 같은 닉네임이에요.');
    yes.disabled = true; yes.textContent = '바꾸는 중…';
    const r = await dataApi('admin-rename', { id: u.id, name });
    if (r.status === 401) { close(); return needRelogin(); }
    if (r.status !== 200) { yes.disabled = false; yes.textContent = '바꾸기'; return fail(r.data.error || '바꾸지 못했어요.'); }
    close();
    toast(`${r.data.old} → ${r.data.name} 으로 바꿨어요`);
    await syncFromServer({ quiet: true }); // 랭킹 · 내 이름(나를 바꿨을 때)도 새로
    // 검색 중이었는데 새 닉네임이 검색어와 안 맞으면, 바꾼 회원이 목록에서 사라지지 않게 새 닉네임으로 다시 찾아요
    let q = (state.adm && state.adm.q) || '';
    const low = (v) => String(v || '').toLowerCase();
    if (q && !low(r.data.name).includes(low(q)) && !low(u.email).includes(low(q))) { q = r.data.name; const box = document.getElementById('au-q'); if (box) box.value = q; }
    loadAdminUsers(q);
  };
  sheet.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  input.addEventListener('input', () => { err.hidden = true; });
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-no]')) return close();
    if (e.target.closest('[data-yes]')) save();
  });
}
const admUser = (id) => ((state.adm && state.adm.users) || []).find((u) => u.id === String(id));
// 승인 / 반려 처리
function reviewCampaign(id, status, reason) {
  if (dbMode()) {
    if (!isAdmin()) return;
    dbWrite('camp-review', { id, decision: status, reason }, status === 'approved' ? '승인했어요. 캠페인 목록에 올라갔어요' : '반려했어요. 만든 사람에게 사유가 전달돼요')
      .then((ok) => { if (ok && state.screen === 'campaign') goBack(); });
    return;
  }
  const list = campStore.load();
  const c = list.find((x) => x.id === id);
  if (!c || !isAdmin()) return;
  Object.assign(c, { status, rejectReason: status === 'rejected' ? reason : '', reviewedAt: Date.now(), notice: { type: status, seen: false } });
  if (status === 'approved' && !c.approvedAt) c.approvedAt = Date.now();
  campStore.save(list);
  toast(status === 'approved' ? '승인했어요. 캠페인 목록에 올라갔어요' : '반려했어요. 만든 사람에게 사유가 전달돼요');
  if (state.screen === 'campaign') goBack(); else render();
}
// 반려 사유 고르기 (아래에서 올라오는 창)
function rejectSheet(c) {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.className = 'sheet-wrap';
    sheet.innerHTML = `<div class="sheet-bg" data-no></div>
      <section class="sheet-card rj" role="dialog" aria-label="반려 사유">
        <span class="sheet-grab" aria-hidden="true"></span>
        <div class="sheet-ask"><b>${c.status === 'approved' ? '게시를 내릴까요?' : '반려할까요?'}</b><p>"${esc(c.title)}" · 만든 사람에게 사유를 알려 드려요.</p></div>
        <div class="rj-chips">${REJECT_REASONS.map((r) => `<button type="button" class="rj-chip" aria-pressed="false">${esc(r)}</button>`).join('')}</div>
        <textarea class="input rj-more" rows="2" maxlength="200" placeholder="더 알려 줄 내용 (선택)"></textarea>
        <p class="rj-err" hidden>사유를 하나 이상 골라 주세요.</p>
        <button type="button" class="btn sheet-out" data-yes>${c.status === 'approved' ? '게시 내리기' : '반려하기'}</button>
        <button type="button" class="btn sheet-cancel" data-no>취소</button>
      </section>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('open'));
    const close = (v) => { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); resolve(v); };
    sheet.addEventListener('click', (e) => {
      const chip = e.target.closest('.rj-chip');
      if (chip) { chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true')); return; }
      if (e.target.closest('[data-no]')) return close(null);
      if (e.target.closest('[data-yes]')) {
        const picked = [...sheet.querySelectorAll('.rj-chip[aria-pressed="true"]')].map((b) => b.textContent);
        const more = sheet.querySelector('.rj-more').value.trim();
        if (more) picked.push(more);
        if (!picked.length) { sheet.querySelector('.rj-err').hidden = false; return; }
        close(picked.join(' · '));
      }
    });
  });
}
// 만든 사람에게: 검토 결과 알림 (앱을 열거나 로그인했을 때)
function showCampNotices() {
  if (!state.user || state.screen === 'login') return;
  const list = campStore.load();
  const won = checkRewards(list);
  const n = list.find((c) => isMine(c) && c.notice && !c.notice.seen);
  if (!n && !won.length) return;
  if (n) n.notice.seen = true;
  campStore.save(list);
  if (n && dbMode()) dataApi('camp-seen', { id: n.id });
  if (won.length) toast(wonText(won[0]));
  if (!n) return;
  const ok = n.notice.type === 'approved';
  setTimeout(() => confirmSheet(ok ? '🎉 캠페인이 승인됐어요' : '캠페인이 반려됐어요',
    ok ? `"${n.title}" 캠페인이 목록에 올라갔어요. 이제 다른 사람들도 참여할 수 있어요.` : `"${n.title}" · 사유: ${n.rejectReason || '-'}`,
    ok ? '캠페인 보러 가기' : '수정하러 가기', '닫기', 'primary').then((go2) => {
    if (go2) {
      state.campId = n.id; state.campReturn = state.screen === 'account' ? 'account' : 'campaigns';
      if (ok) go('campaign'); else startEdit(n.id);
    }
    showCampNotices(); // 알림이 더 있으면 이어서
  }), 350);
}
function startEdit(id) {
  const c = campStore.load().find((x) => x.id === id && isMine(x));
  if (!c) return;
  state.campEditId = id; state.campErr = '';
  state.campDraft = { tag: c.tag, mode: campMode(c).id, title: c.title, sub: c.sub, body: c.body, goalKg: c.goalKg, cover: c.cover, rejectReason: c.status === 'rejected' ? c.rejectReason : '' };
  state.campNewReturn = state.screen === 'campaign-new' ? 'account' : state.screen;
  go('campaign-new');
}

// ---------------------------------------------------------------------
// 프로필 사진 (이 휴대폰에 저장) · 동그란 아바타
// ---------------------------------------------------------------------
const AVATAR_KEY = 'pureun-avatar';
function loadAvatar() { try { return localStorage.getItem(AVATAR_KEY) || ''; } catch (e) { return ''; } }
function saveAvatar(url) { try { url ? localStorage.setItem(AVATAR_KEY, url) : localStorage.removeItem(AVATAR_KEY); return true; } catch (e) { return false; } }
const AV_COLORS = [['#7FB2FF', '#3366F0'], ['#8EE0C0', '#1F9A6B'], ['#FFC98A', '#E07A1F'], ['#C9B6FF', '#6C4FE0'], ['#FFB3C1', '#D9466A'], ['#9FD8F0', '#1F86B8'], ['#D6E58A', '#7F9A1F']];
function hashStr(t) { let h = 0; for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
// 사진이 있으면 사진, 없으면 이름 첫 글자 + 이름별 색
function avatarHTML(name, photo, cls = '') {
  if (photo) return `<span class="av ${cls}" style="background-image:url('${photo}')"></span>`;
  const [a, b] = AV_COLORS[hashStr(name) % AV_COLORS.length];
  return `<span class="av ${cls}" style="background:linear-gradient(135deg,${a},${b})"><i>${esc(String(name || '?').trim().slice(0, 1))}</i></span>`;
}
// ---------------------------------------------------------------------
// 칭호(티어) 프로필 테두리 — 게임 티어처럼 칭호가 오를수록 테두리가 화려해져요
//  씨앗 → 새싹 → 묘목 → 나무 → 작은 숲 → 숲 → 밀림 → 산 → 산맥 → 푸른하늘
//  SVG 한 장(120×120)에 아바타(지름 80)를 가운데 두고,
//  금속 고리(테두리선 · 빛 반사 · 안쪽 그림자) 위에 잎 · 월계관 · 문장 · 날개 · 보석을 겹쳐 그려요.
//  빛은 모두 왼쪽 위에서 들어오는 것으로 맞췄어요.
// ---------------------------------------------------------------------
const TIER_STYLE = [
  { m: ['#F6EDDD', '#D9C19C', '#A9855A', '#6E5133'], w: 3.2 },                                                         // 씨앗: 흙빛
  { m: ['#F1FDE6', '#B4E58C', '#6BB646', '#2F6B1E'], w: 3.8, sprout: 1, leaf: 'g' },                                    // 새싹
  { m: ['#E3F8D2', '#7FCB5C', '#3E8E33', '#1E5420'], w: 4.4, sprout: 2, sideLeaves: 3, leaf: 'g' },                     // 묘목
  { m: ['#E7C49A', '#A8743F', '#6F4522', '#3E2510'], w: 5.4, grain: 1, canopy: 1, sideLeaves: 3, leaf: 'g', acorn: 1 }, // 나무: 나무결
  { m: ['#D2FBE9', '#4FD3A1', '#0E9F6E', '#05553A'], w: 5.6, laurel: [96, 178, 6], leaf: 'g', crest: 'leaf3' },        // 작은 숲: 비취
  { m: ['#C7F9E2', '#2BC48A', '#07774F', '#033D29'], w: 6, gold: 1, laurel: [94, 205, 8], leaf: 'g', crest: 'gleaf', gem: 'em' },         // 숲: 에메랄드 + 금
  { m: ['#D9FFB8', '#4CC33A', '#137A2A', '#063A16'], w: 6.4, gold: 2, laurel: [92, 236, 9], leaf: 'j', crest: 'palm', gem: 'em', vines: 1, glow: 'rgba(76,195,58,.6)' }, // 밀림
  { m: ['#FFFFFF', '#D5DDE7', '#8592A6', '#3D4757'], w: 7, gold: 's', plaque: 'm', wings: [4, 30, 's'], gem: 'sp', filigree: 1, glow: 'rgba(100,116,139,.55)' },   // 산: 은
  { m: ['#FFFFFF', '#BFE9FF', '#3BA7E6', '#0B4F86'], w: 7.4, gold: 2, plaque: 'ice', wings: [6, 36, 'i'], gem: 'di', filigree: 1, stars: 4, glow: 'rgba(56,189,248,.65)' }, // 산맥: 얼음 백금
  { m: ['#FFFBEA', '#9CDCFF', '#2F7CF6', '#123C9C'], w: 8, gold: 2, sun: 1, wings: [8, 42, 'k'], gem: 'di', clouds: 1, filigree: 1, stars: 7, spin: 1, glow: 'rgba(59,130,246,.75)' }, // 푸른하늘
];
const tierOfG = (g) => (g == null || !Number.isFinite(Number(g)) ? null : titleOf(Number(g)).level - 1);
const f1 = (n) => Math.round(n * 100) / 100;
const pol = (r, deg) => [60 + Math.cos((deg * Math.PI) / 180) * r, 60 + Math.sin((deg * Math.PI) / 180) * r];
const mirror = (svg) => `${svg}<g transform="translate(120 0) scale(-1 1)">${svg}</g>`;
// 잎: 두 가지 색(빛 받는 쪽 · 그늘 쪽) + 잎맥 + 얇은 테두리
function leafSVG(x, y, deg, len, k = 'g') {
  const w = len * 0.4;
  return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(deg)})">
    <path d="M0 0C${f1(len * 0.28)} ${f1(-w * 1.05)} ${f1(len * 0.78)} ${f1(-w * 0.95)} ${f1(len)} 0C${f1(len * 0.74)} ${f1(w * 0.85)} ${f1(len * 0.26)} ${f1(w * 0.9)} 0 0Z" fill="url(#tl-${k})" stroke="url(#tlo-${k})" stroke-width=".7"/>
    <path d="M0 0C${f1(len * 0.28)} ${f1(-w * 1.05)} ${f1(len * 0.78)} ${f1(-w * 0.95)} ${f1(len)} 0Z" fill="#fff" opacity=".22"/>
    <path d="M${f1(len * 0.06)} 0Q${f1(len * 0.5)} ${f1(-w * 0.12)} ${f1(len * 0.9)} 0" fill="none" stroke="rgba(255,255,255,.7)" stroke-width=".6" stroke-linecap="round"/></g>`;
}
// 깃털: 비대칭 곡선 + 깃대
function featherSVG(x, y, deg, len, wid, k) {
  const L = len; const W = wid;
  return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(deg)})">
    <path d="M0 ${f1(-W * 0.35)}C${f1(L * 0.3)} ${f1(-W * 1.15)} ${f1(L * 0.82)} ${f1(-W * 1.1)} ${f1(L)} ${f1(-W * 0.2)}C${f1(L * 1.02)} ${f1(W * 0.25)} ${f1(L * 0.9)} ${f1(W * 0.55)} ${f1(L * 0.78)} ${f1(W * 0.6)}C${f1(L * 0.5)} ${f1(W * 0.75)} ${f1(L * 0.2)} ${f1(W * 0.7)} 0 ${f1(W * 0.35)}Z" fill="url(#tw-${k})" stroke="url(#two-${k})" stroke-width=".6"/>
    <path d="M${f1(L * 0.04)} 0Q${f1(L * 0.5)} ${f1(-W * 0.18)} ${f1(L * 0.93)} ${f1(-W * 0.12)}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width=".6" stroke-linecap="round"/>
    <path d="M${f1(L * 0.55)} ${f1(W * 0.62)}L${f1(L * 0.62)} ${f1(W * 0.2)}M${f1(L * 0.7)} ${f1(W * 0.58)}L${f1(L * 0.76)} ${f1(W * 0.18)}" stroke="url(#two-${k})" stroke-width=".45" opacity=".6"/></g>`;
}
// 날개 (왼쪽만 그리고 거울로): 뒤쪽 긴 깃 → 가운데 깃 → 앞쪽 짧은 덮깃
function wingSVG(outer, [n, maxLen, k]) {
  const bx = 60 - outer + 5; const by = 63;
  let s = '';
  const layer = (cnt, a0, a1, l0, l1, wid, dy) => {
    for (let i = 0; i < cnt; i++) {
      const t = cnt === 1 ? 1 : i / (cnt - 1);
      s += featherSVG(bx + t * 3, by + dy - t * 9, a0 + (a1 - a0) * t, l0 + (l1 - l0) * t, wid, k);
    }
  };
  layer(n, 162, 244, maxLen * 0.6, maxLen, maxLen * 0.2, 0);                          // 긴 깃
  layer(Math.max(2, n - 2), 170, 230, maxLen * 0.42, maxLen * 0.68, maxLen * 0.19, -1); // 가운데 깃
  layer(Math.max(2, Math.round(n / 2)), 180, 218, maxLen * 0.26, maxLen * 0.4, maxLen * 0.17, -2); // 덮깃
  return mirror(s);
}
// 월계관: 줄기(호) 위로 잎을 엇갈려 붙여요
function laurelSVG(outer, [a0, a1, n], k) {
  const r = outer + 3.6;
  const p0 = pol(r, a0); const p1 = pol(r, a1);
  let s = `<path d="M${f1(p0[0])} ${f1(p0[1])}A${f1(r)} ${f1(r)} 0 0 1 ${f1(p1[0])} ${f1(p1[1])}" fill="none" stroke="url(#tlo-${k})" stroke-width="1.3" stroke-linecap="round"/>`;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); const a = a0 + (a1 - a0) * t; const len = 11.5 - t * 3.5;
    const [x, y] = pol(r, a);
    s += leafSVG(x, y, a + 90 + 38, len, k) + leafSVG(x, y, a + 90 - 30, len * 0.85, k); // 바깥 · 안쪽 잎
  }
  const [tx, ty] = pol(r, a1);
  s += leafSVG(tx, ty, a1 + 90, 10, k);
  return mirror(s);
}
// 보석: 깎인 면 + 금 테두리 + 반짝임
function gemSVG(y, kind, size = 6) {
  const c = { em: ['#B8FFD9', '#16A34A', '#065F2E'], tq: ['#C9FFF6', '#14B8A6', '#0B5E57'], sp: ['#D6E4FF', '#3B5BDB', '#1E2A78'], di: ['#FFFFFF', '#8FD3FF', '#2563EB'] }[kind];
  const s = size;
  return `<g transform="translate(60 ${f1(y)})">
    <path d="M${-s - 3} 0Q${-s - 6} -3 ${-s - 9} -1M${s + 3} 0Q${s + 6} -3 ${s + 9} -1" fill="none" stroke="url(#tg-gold)" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M0 ${-s - 2.2}L${s + 2.2} 0L0 ${s + 2.2}L${-s - 2.2} 0Z" fill="url(#tg-gold)" stroke="#8A5A10" stroke-width=".7"/>
    <path d="M0 ${-s}L${s} 0L0 ${s}L${-s} 0Z" fill="${c[1]}" stroke="${c[2]}" stroke-width=".6"/>
    <path d="M0 ${-s}L${-s} 0L0 0Z" fill="${c[0]}" opacity=".9"/><path d="M0 ${-s}L${s} 0L0 0Z" fill="${c[0]}" opacity=".45"/>
    <path d="M0 ${s}L${s} 0L0 0Z" fill="${c[2]}" opacity=".55"/>
    <circle cx="${f1(-s * 0.35)}" cy="${f1(-s * 0.4)}" r="${f1(s * 0.22)}" fill="#fff"/></g>`;
}
function sparkleSVG(x, y, r) {
  const p = (rr, k) => { const out = []; for (let i = 0; i < 8; i++) { const a = (Math.PI / 4) * i - Math.PI / 2; const q = i % 2 ? rr * k : rr; out.push(`${f1(x + Math.cos(a) * q)} ${f1(y + Math.sin(a) * q)}`); } return `M${out.join('L')}Z`; };
  return `<g class="tf-star"><circle cx="${x}" cy="${y}" r="${f1(r * 0.9)}" fill="url(#tg-glint)"/><path d="${p(r, 0.22)}" fill="#fff"/></g>`;
}
// 위쪽 문장들
function crestSVG(st, outer) {
  const top = 60 - outer;
  if (st.crest === 'leaf3') return `<g>${leafSVG(60, top + 2, -90, 13, 'g')}${leafSVG(59, top + 3, -128, 11, 'g')}${leafSVG(61, top + 3, -52, 11, 'g')}</g>`;
  if (st.crest === 'gleaf' || st.crest === 'gcrown') {
    const big = st.crest === 'gcrown';
    let s = `<path d="M${big ? 46 : 50} ${f1(top + 3)}Q60 ${f1(top - (big ? 3 : 1))} ${big ? 74 : 70} ${f1(top + 3)}" fill="none" stroke="url(#tg-gold)" stroke-width="3" stroke-linecap="round"/>`;
    s += leafSVG(60, top + 1, -90, big ? 17 : 14, 'gold') + leafSVG(58.5, top + 2, -126, big ? 13 : 11, 'gold') + leafSVG(61.5, top + 2, -54, big ? 13 : 11, 'gold');
    if (big) s += leafSVG(57, top + 3, -150, 10, 'gold') + leafSVG(63, top + 3, -30, 10, 'gold');
    return s + `<circle cx="60" cy="${f1(top + 1.5)}" r="2.6" fill="url(#tr-gem-tq)" stroke="#8A5A10" stroke-width=".6"/>`;
  }
  if (st.crest === 'palm') { // 야자잎 다발 + 금 고리
    let s = '';
    [[-90, 22], [-118, 19], [-62, 19], [-146, 15], [-34, 15]].forEach(([a, l]) => { s += leafSVG(60, top + 3, a, l, 'j'); });
    return s + `<circle cx="60" cy="${f1(top + 3)}" r="3.4" fill="url(#tg-gold)" stroke="#7A4A0C" stroke-width=".7"/><circle cx="59" cy="${f1(top + 2)}" r="1" fill="#fff" opacity=".8"/>`;
  }
  if (st.plaque === 'm') { // 은 방패 + 산
    return `<g transform="translate(60 ${f1(top + 1)})">
      <path d="M-15 2L15 2L13 -11Q0 -19 -13 -11Z" fill="url(#tm-7)" stroke="#3D4757" stroke-width="1"/>
      <path d="M-13 1L13 1L11.5 -10Q0 -17 -11.5 -10Z" fill="none" stroke="rgba(255,255,255,.75)" stroke-width=".7"/>
      <path d="M-10 0L-4 -8L-1 -5L3 -12L10 0Z" fill="url(#tmt-s)" stroke="#3D4757" stroke-width=".7" stroke-linejoin="round"/>
      <path d="M3 -12L1 -8.5L3 -9L4.6 -8Z M-4 -8L-5.4 -6L-3.6 -6.4Z" fill="#fff"/></g>`;
  }
  if (st.plaque === 'ice') { // 얼음 결정 + 설산
    let spikes = '';
    [[-50, 15], [-24, 19], [24, 19], [50, 15]].forEach(([a, L2]) => {
      spikes += `<g transform="translate(0 -4) rotate(${a})"><path d="M-2.6 0L0 ${-L2}L2.6 0Z" fill="url(#tmt-i)" stroke="#0B4F86" stroke-width=".6" stroke-linejoin="round"/><path d="M0 ${-L2}L-2.6 0L0 -1Z" fill="#fff" opacity=".7"/></g>`;
    });
    return `<g transform="translate(60 ${f1(top + 2)})">${spikes}
      <path d="M-17 3L-8 -10L-3.5 -5L3 -17L10 -6L17 3Z" fill="url(#tmt-i)" stroke="#0B4F86" stroke-width=".9" stroke-linejoin="round"/>
      <path d="M3 -17L0 -11.5L2.6 -12.4L4.8 -10.6L6.2 -12.2Z M-8 -10L-10 -7L-7.6 -7.6L-6 -7Z" fill="#fff"/>
      <path d="M-17 3H17" stroke="url(#tg-gold)" stroke-width="2.4" stroke-linecap="round"/></g>`;
  }
  if (st.sun) { // 태양 + 후광
    let rays = '';
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI / 8) * i; const L2 = i % 2 ? 12.5 : 17; const wa = i % 2 ? 0.16 : 0.12;
      rays += `<path d="M${f1(Math.cos(a - wa) * 8)} ${f1(Math.sin(a - wa) * 8)}L${f1(Math.cos(a) * L2)} ${f1(Math.sin(a) * L2)}L${f1(Math.cos(a + wa) * 8)} ${f1(Math.sin(a + wa) * 8)}Z" fill="url(#tg-gold)" stroke="#B7791F" stroke-width=".4"/>`;
    }
    return `<g transform="translate(60 ${f1(top - 7)})"><circle r="22" fill="url(#tr-halo)"/><g class="tf-rays">${rays}</g>
      <circle r="8.6" fill="url(#tr-sun)" stroke="#C2410C" stroke-width=".8"/><circle r="8.6" fill="none" stroke="#FFF7D6" stroke-width=".7" opacity=".8"/>
      <circle cx="-2.6" cy="-2.8" r="2.6" fill="#fff" opacity=".7"/></g>`;
  }
  return '';
}
const tierSvgCache = {};
function tierFrameSVG(t) {
  if (tierSvgCache[t]) return tierSvgCache[t];
  const st = TIER_STYLE[t]; const w = st.w;
  const R = 40 + w / 2 + 1.1; const outer = R + w / 2 + 1.2;
  let back = ''; let ring = ''; let front = ''; let fx = '';
  if (st.wings) back += `<g class="tf-wings">${wingSVG(outer, st.wings)}</g>`;
  if (st.laurel) back += laurelSVG(outer, st.laurel, st.leaf || 'g');
  if (st.clouds) {
    const cloud = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-12 4Q-16 4 -16 0Q-16 -5 -10 -5Q-9 -11 -2 -11Q4 -11 6 -6Q13 -7 14 -1Q16 4 10 4Z" fill="url(#tc-cloud)" stroke="#9CC8F2" stroke-width=".8"/></g>`;
    back += `<g class="tf-clouds">${mirror(cloud(30, 102, 1)) + mirror(cloud(18, 92, 0.7))}</g>`;
  }
  // 고리: 진한 바깥선 → 금속 → 입체(위 밝게 · 아래 어둡게) → 바깥 반사선 → 안쪽 그림자선
  if (st.gold) {
    const gR = outer + 1.8; const sil = st.gold === 's';
    ring += `<circle cx="60" cy="60" r="${f1(gR)}" fill="none" stroke="${sil ? '#3D4757' : '#7A4A0C'}" stroke-width="4.2"/>
      <circle cx="60" cy="60" r="${f1(gR)}" fill="none" stroke="${sil ? 'url(#tm-7)' : 'url(#tg-gold)'}" stroke-width="2.6"/>
      <circle cx="60" cy="60" r="${f1(gR)}" fill="none" stroke="url(#tb-bevel)" stroke-width="2.6" opacity=".6"/>`;
    if (st.gold === 2) ring += `<circle cx="60" cy="60" r="${f1(gR + 2.3)}" fill="none" stroke="url(#tg-gold)" stroke-width=".9" stroke-dasharray="1.2 2.2" opacity=".95"/>`;
  }
  ring += `<circle cx="60" cy="60" r="${f1(R)}" fill="none" stroke="${st.m[3]}" stroke-width="${f1(w + 2.4)}"/>`;
  ring += `<circle cx="60" cy="60" r="${f1(R)}" fill="none" stroke="url(#tm-${t})" stroke-width="${w}"${st.spin ? ' class="tf-spin"' : ''}/>`;
  if (st.grain) ring += `<circle cx="60" cy="60" r="${f1(R)}" fill="none" stroke="rgba(62,37,16,.35)" stroke-width="${f1(w * 0.5)}" stroke-dasharray="7 3 2 4 11 3" />`;
  ring += `<circle cx="60" cy="60" r="${f1(R)}" fill="none" stroke="url(#tb-bevel)" stroke-width="${w}" opacity=".75"/>`;
  ring += `<circle cx="60" cy="60" r="${f1(R + w / 2 - 0.5)}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width=".7" stroke-dasharray="${f1(Math.PI * (R + w / 2) * 0.55)} 999" transform="rotate(178 60 60)"/>`;
  ring += `<circle cx="60" cy="60" r="${f1(R - w / 2 + 0.5)}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width=".8"/>`;
  ring += `<circle cx="60" cy="60" r="40.3" fill="none" stroke="rgba(0,0,0,.35)" stroke-width=".9"/>`;
  // 앞 장식
  if (st.sprout) {
    const y = 60 + outer - 1;
    front += `<path d="M60 ${f1(y + 1)}Q59.4 ${f1(y - 4)} 60 ${f1(y - 7)}" fill="none" stroke="#3E8E33" stroke-width="1.5" stroke-linecap="round"/>`;
    front += leafSVG(60, y - 6.5, -30, st.sprout > 1 ? 10 : 8.5, 'g') + leafSVG(60, y - 6.5, -150, st.sprout > 1 ? 10 : 8.5, 'g');
    if (st.sprout > 1) front += leafSVG(60, y - 7, -90, 7, 'g');
  }
  if (st.sideLeaves) {
    let s = '';
    for (let i = 0; i < st.sideLeaves; i++) { const a = 112 + i * 15; const [x, y] = pol(outer + 1, a); s += leafSVG(x, y, a + 90 + 30, 9.5 - i * 1.2, 'g'); }
    front += mirror(s);
  }
  if (st.canopy) {
    const y = 60 - outer;
    [[-90, 0, 0, 15], [-122, -3, 1, 13], [-58, 3, 1, 13], [-148, -6, 3, 11], [-32, 6, 3, 11]].forEach(([a, dx, dy, l]) => { front += leafSVG(60 + dx, y + 2 + dy, a, l, 'g'); });
  }
  if (st.acorn) front += `<g transform="translate(60 ${f1(60 + outer + 2)})"><ellipse cx="0" cy="2" rx="3.6" ry="4.4" fill="#B7793E" stroke="#5D3A1A" stroke-width=".7"/><path d="M-4.6 -0.6Q0 -4.6 4.6 -0.6Q0 1.6 -4.6 -0.6Z" fill="#6F4522" stroke="#3E2510" stroke-width=".6"/><circle cx="-1.2" cy="1.6" r="1" fill="#fff" opacity=".5"/></g>`;
  if (st.vines) {
    let v = '';
    [[200, 250], [290, 340]].forEach(([a0, a1]) => {
      const r = outer + 0.5; const [x0, y0] = pol(r, a0); const [x1, y1] = pol(r, a1);
      v += `<path d="M${f1(x0)} ${f1(y0)}A${f1(r)} ${f1(r)} 0 0 1 ${f1(x1)} ${f1(y1)}" fill="none" stroke="#1F6B23" stroke-width="1.6" stroke-dasharray="5 2.2" stroke-linecap="round"/>`;
      for (let a = a0 + 10; a < a1; a += 16) { const [x, y] = pol(r, a); v += leafSVG(x, y, a + (a % 32 > 15 ? 60 : -60), 6.5, 'j'); }
    });
    front += v;
  }
  if (st.filigree) {
    const [x0, y0] = pol(outer + 1.5, 150); const [x1, y1] = pol(outer + 1.5, 118);
    front += mirror(`<path d="M${f1(x0)} ${f1(y0)}Q${f1(x0 - 6)} ${f1(y0 + 8)} ${f1(x1)} ${f1(y1 + 2)}" fill="none" stroke="url(#tg-gold)" stroke-width="1.8" stroke-linecap="round"/><circle cx="${f1(x0)}" cy="${f1(y0)}" r="1.8" fill="url(#tg-gold)" stroke="#8A5A10" stroke-width=".5"/>`);
  }
  front += crestSVG(st, st.gold ? outer + 1.8 : outer);
  if (st.gem) front += gemSVG(60 + outer + (st.gold ? 2 : 0.8), st.gem, st.gem === 'di' ? 6.4 : 5.6);
  if (st.stars) {
    const pos = [[14, 30, 4.6], [106, 26, 3.8], [8, 82, 3.2], [112, 88, 4], [26, 6, 3.2], [96, 4, 3.6], [4, 52, 2.8]];
    for (let i = 0; i < st.stars; i++) fx += sparkleSVG(...pos[i]);
  }
  tierSvgCache[t] = `<svg class="tf" viewBox="-40 -40 200 200" aria-hidden="true"><g class="tf-back">${back}</g>${ring}${front}<g class="tf-stars">${fx}</g></svg>`;
  return tierSvgCache[t];
}
// 그라데이션 모음 (한 번만 문서에 넣어 두고 모든 테두리가 같이 써요)
function installTierDefs() {
  if (document.getElementById('tier-defs')) return;
  const lg = (id, stops, x1 = 0, y1 = 0, x2 = 1, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}%" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const rg = (id, stops, cx = 50, cy = 50, r = 50) => `<radialGradient id="${id}" cx="${cx}%" cy="${cy}%" r="${r}%">${stops.map(([o, c, a = 1]) => `<stop offset="${o}%" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  // 금속 고리: 밝음 → 중간 → 어둠 → 다시 반사 (금속 느낌)
  const metal = TIER_STYLE.map((s, i) => lg(`tm-${i}`, [[0, s.m[0]], [22, s.m[1]], [48, s.m[2]], [62, s.m[3]], [78, s.m[2]], [92, s.m[1]], [100, s.m[0]]], 0, 0, 1, 1)).join('');
  const leaf = (k, a, b, c) => lg(`tl-${k}`, [[0, a], [55, b], [100, c]], 0, 0, 1, 1) + lg(`tlo-${k}`, [[0, c], [100, c]]);
  const wing = (k, a, b, c, o) => lg(`tw-${k}`, [[0, c], [62, b], [100, a]], 0, 0.5, 1, 0.5) + lg(`two-${k}`, [[0, o], [100, o]]);
  const defs = metal +
    lg('tg-gold', [[0, '#FFF6CC'], [25, '#F7D46B'], [50, '#C98A1B'], [70, '#F2C04E'], [100, '#FFF1B8']]) +
    lg('tb-bevel', [[0, '#FFFFFF', 0.9], [42, '#FFFFFF', 0], [58, '#000000', 0], [100, '#000000', 0.45]], 0, 0, 0, 1) +
    leaf('g', '#C2F5A4', '#3DA548', '#17602A') + leaf('t', '#D5FFF6', '#22B8A4', '#0B5E57') + leaf('j', '#C8FF8A', '#2E9E2E', '#0B4A17') + leaf('gold', '#FFF6CC', '#E9B949', '#94600F') +
    wing('s', '#FBFCFE', '#C3CDDA', '#6B778A', '#3D4757') + wing('i', '#F2FBFF', '#8ED3FA', '#2C88D0', '#0B4F86') + wing('k', '#FFFFFF', '#A9D3FF', '#3F7FEA', '#1E4DB7') +
    lg('tmt-s', [[0, '#FFFFFF'], [45, '#B7C2D0'], [100, '#4B5566']], 0, 0, 0, 1) + lg('tmt-i', [[0, '#FFFFFF'], [40, '#BDE7FF'], [100, '#1C77C3']], 0, 0, 0, 1) +
    rg('tr-sun', [[0, '#FFFDF0'], [45, '#FFD84D'], [100, '#F08A0C']], 38, 35, 70) + rg('tr-halo', [[0, '#FFE58A', 0.85], [55, '#FFE58A', 0.25], [100, '#FFE58A', 0]]) +
    rg('tr-gem-tq', [[0, '#E6FFFB'], [60, '#14B8A6'], [100, '#0B5E57']], 35, 35, 70) + rg('tg-glint', [[0, '#FFFFFF', 0.85], [100, '#BFE3FF', 0]]) +
    lg('tc-cloud', [[0, '#FFFFFF'], [100, '#D8ECFF']], 0, 0, 0, 1);
  document.body.insertAdjacentHTML('beforeend', `<svg id="tier-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg>`);
}
// 아바타 + 칭호 테두리. g = 그 사람이 지금까지 아낀 탄소(g). 모르면 테두리 없이.
//  mode 'badge': 테두리 대신 오른쪽 아래 작은 칭호 배지 (랭킹 시상대처럼 이미 메달 고리가 있는 곳)
function tierAvatarHTML(name, photo, cls = '', g = null, mode = '') {
  const t = tierOfG(g);
  const av = avatarHTML(name, photo, cls);
  if (t == null) return av;
  if (mode === 'badge') return `<span class="avf-b">${av}<i class="avf-badge tb-${t}" title="${esc(TITLES[t].name)}">${TITLES[t].icon}</i></span>`;
  return `<span class="avf t${t} ${cls ? cls.replace('av-', 'f-') : 'f-sm'}" title="${esc(TITLES[t].name)}">${av}${tierFrameSVG(t)}</span>`;
}
// 프로필 사진: 가운데를 정사각형으로 잘라 320px 로 저장
function readAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('사진 파일을 골라 주세요.'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const cv = document.createElement('canvas');
        cv.width = cv.height = 320;
        cv.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 320, 320);
        resolve(cv.toDataURL('image/jpeg', 0.82));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------
// 랭킹: 이달의 절약왕 (그달에 탄소 포인트를 가장 많이 모은 사람)
//  ※ 서버 DB가 있으면 진짜 회원끼리 순위를 매겨요. DB가 없는 곳에서는 가상 사용자와 비교해요.
// ---------------------------------------------------------------------
const NICK_A = ['초록', '맑은', '푸른', '느린', '바람', '햇살', '조용한', '반짝', '산뜻한', '가벼운', '새벽', '하늘', '숲속', '파란', '상쾌한', '든든한'];
const NICK_B = ['버스', '자전거', '산책러', '여우', '고래', '해달', '참새', '나무', '펭귄', '다람쥐', '지하철', '라이더', '구름', '토끼', '곰', '두루미'];
function seededRand(seed) { let x = seed % 2147483647; if (x <= 0) x += 2147483646; return () => (x = (x * 16807) % 2147483647) / 2147483647; }
function rankingUsers(mKey) {
  const rnd = seededRand(hashStr(mKey) + 7);
  const used = new Set();
  const list = [];
  for (let i = 0; i < 110; i++) {
    let name;
    do { name = NICK_A[Math.floor(rnd() * NICK_A.length)] + NICK_B[Math.floor(rnd() * NICK_B.length)] + (rnd() < 0.35 ? Math.floor(rnd() * 90 + 10) : ''); } while (used.has(name));
    used.add(name);
    // 포인트는 위로 갈수록 크게 (지수 분포)
    const pts = Math.round(40 + 4200 * Math.pow(rnd(), 2.6));
    list.push({ id: `u${i}`, name, points: pts, photo: '', g: Math.round(pts * (8 + rnd() * 110)) });
  }
  return list;
}
function monthRanking(mKey = monthKey()) {
  const me = { id: 'me', me: true, name: (state.user && state.user.name) || '나', points: loadMonthPoints(mKey), photo: loadAvatar() };
  if (dbMode()) {
    const rk = state.rank && state.rank.month === mKey ? state.rank : null;
    const others = rk ? rk.users.filter((u) => !u.me).map((u) => ({ ...u })) : [];
    const all = others.concat(me).sort((a, b) => (b.points - a.points) || (a.me ? -1 : b.me ? 1 : 0) || a.name.localeCompare(b.name));
    all.forEach((u, i) => { u.rank = i + 1; });
    if (rk && rk.myRank && !rk.users.some((u) => u.me)) me.rank = Math.max(me.rank, rk.myRank); // 100위 밖
    return { all, me };
  }
  const all = rankingUsers(mKey).concat(me).sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
  all.forEach((u, i) => { u.rank = i + 1; });
  return { all, me: all.find((u) => u.me) };
}
// ── 푸른하늘 푸름이 (마스코트): 빠른 길찾기 카드 위에 걸터앉아 다리를 흔들어요. 누르면 폴짝 ──
function mascotSVG() {
  const sp = (x, y, r, c, d) => `<path class="ms-spark" style="animation-delay:${d}s" d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${c}"/>`;
  const star = (cx, cy, R, r) => {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.PI / 5) * i + 0.25; const rr = i % 2 ? r : R;
      d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
    }
    return `${d}Z`;
  };
  // 몽글몽글한 구름 몸: 위쪽은 크고 작은 뭉게 덩이, 아래는 작은 물결 덩이
  const body = '<circle cx="70" cy="37" r="26"/><circle cx="43" cy="49" r="19"/><circle cx="97" cy="47" r="20"/>'
    + '<circle cx="27" cy="65" r="13"/><circle cx="113" cy="64" r="13"/><ellipse cx="70" cy="70" rx="46" ry="21"/>';
  const ol = '#2F5597';
  const foot = (x, cls) => `<g class="ms-foot ${cls}"><ellipse cx="${x}" cy="99" rx="8.5" ry="6.5" fill="url(#ms-g)" stroke="${ol}" stroke-width="3.2"/></g>`;
  const hand = (x, cls) => `<g class="ms-hand ${cls}"><circle cx="${x}" cy="87" r="9.2" fill="url(#ms-g)" stroke="${ol}" stroke-width="3.2"/><circle cx="${x - 3}" cy="84" r="2.4" fill="#fff" opacity=".9"/></g>`;
  return `<button type="button" class="mascot" data-act="mascot-hop" aria-label="푸른하늘 푸름이">
    <svg viewBox="0 0 140 110" aria-hidden="true">
      <defs>
        <linearGradient id="ms-g" gradientUnits="userSpaceOnUse" x1="0" y1="14" x2="0" y2="100"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F7FBFF"/><stop offset="1" stop-color="#D6E7FF"/></linearGradient>
      </defs>
      ${sp(10, 26, 6, '#FFC94D', 0)}${sp(132, 20, 5, '#FFC94D', 0.9)}${sp(134, 82, 4.5, '#5B9BFF', 1.7)}${sp(6, 78, 3.5, '#5B9BFF', 1.2)}
      <g class="ms-body">
        ${foot(56, 'l')}${foot(84, 'r')}
        <g fill="${ol}" stroke="${ol}" stroke-width="6.5" stroke-linejoin="round">${body}</g>
        <g fill="url(#ms-g)">${body}</g>
        <g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" opacity=".95">
          <path d="M53 27a22 22 0 0 1 12-10"/><path d="M31 45a15 15 0 0 1 7-8"/>
        </g>
        <path d="${star(97, 21, 8.5, 4)}" fill="#FFC94D" stroke="${ol}" stroke-width="2.4" stroke-linejoin="round"/>
        <g class="ms-face">
          <path d="M51.5 60q5.5-6.5 11 0M77.5 60q5.5-6.5 11 0" fill="none" stroke="#1E2A44" stroke-width="3.4" stroke-linecap="round"/>
          <ellipse cx="47" cy="70" rx="6" ry="3.6" fill="#FFA3B8"/><ellipse cx="93" cy="70" rx="6" ry="3.6" fill="#FFA3B8"/>
          <path d="M63.5 66h13q-.6 9.5-6.5 9.5t-6.5-9.5z" fill="#1E2A44" stroke="#1E2A44" stroke-width="1.6" stroke-linejoin="round"/>
          <ellipse cx="70" cy="73" rx="3.6" ry="2.3" fill="#FF869C"/>
        </g>
        ${hand(21, 'l')}${hand(119, 'r')}
      </g>
    </svg>
  </button>`;
}
// ── 푸름이 신났어요! (상품 구매 창) — 통통 뛰며 두 손을 번쩍, 눈은 반짝, 하트·별이 퐁퐁 ──
function mascotJoySVG() {
  const ol = '#2F5597';
  const body = '<circle cx="70" cy="47" r="26"/><circle cx="43" cy="59" r="19"/><circle cx="97" cy="57" r="20"/>'
    + '<circle cx="27" cy="75" r="13"/><circle cx="113" cy="74" r="13"/><ellipse cx="70" cy="80" rx="46" ry="21"/>';
  const star = (cx, cy, R, r) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (Math.PI / 5) * i + 0.25; const rr = i % 2 ? r : R; d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`; } return `${d}Z`; };
  const heart = (x, y, s, c, d) => `<path class="mj-heart" style="--d:${d}s;--x:${(x - 70) * 0.25}px" transform="translate(${x} ${y}) scale(${s})" d="M0 3C-6-3-11 1-8 6C-6 9 0 12 0 14C0 12 6 9 8 6C11 1 6-3 0 3Z" fill="${c}"/>`;
  const spark = (x, y, r, c, d) => `<path class="mj-spark" style="--d:${d}s" d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${c}"/>`;
  // 반짝이는 눈: 감은 눈(^^) 대신 동그란 눈 + 하이라이트 → 기대에 찬 표정
  const eye = (x) => `<g class="mj-eye"><ellipse cx="${x}" cy="66" rx="5.4" ry="6.4" fill="#1E2A44"/><circle cx="${x + 1.8}" cy="63.4" r="2.3" fill="#fff"/><circle cx="${x - 1.6}" cy="68.6" r="1.1" fill="#fff" opacity=".85"/></g>`;
  return `<svg class="mj" viewBox="0 0 140 130" aria-hidden="true">
    <defs><linearGradient id="mj-g" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="110"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F7FBFF"/><stop offset="1" stop-color="#D6E7FF"/></linearGradient></defs>
    <ellipse class="mj-shadow" cx="70" cy="122" rx="34" ry="5" fill="#1E3A6E" opacity=".16"/>
    ${heart(30, 30, 0.9, '#FF6F91', 0)}${heart(108, 22, 0.75, '#FF8FAB', 0.7)}${heart(70, 14, 0.6, '#FFB3C6', 1.3)}
    ${spark(14, 50, 6, '#FFC94D', 0.2)}${spark(128, 52, 5, '#FFC94D', 0.9)}${spark(122, 96, 4, '#5B9BFF', 0.5)}${spark(10, 96, 3.6, '#5B9BFF', 1.2)}
    <g class="mj-body">
      <g class="mj-foot l"><ellipse cx="56" cy="108" rx="8.5" ry="6.5" fill="url(#mj-g)" stroke="${ol}" stroke-width="3.2"/></g>
      <g class="mj-foot r"><ellipse cx="84" cy="108" rx="8.5" ry="6.5" fill="url(#mj-g)" stroke="${ol}" stroke-width="3.2"/></g>
      <g class="mj-arm l"><circle cx="18" cy="56" r="9.2" fill="url(#mj-g)" stroke="${ol}" stroke-width="3.2"/><circle cx="15" cy="53" r="2.4" fill="#fff"/></g>
      <g class="mj-arm r"><circle cx="122" cy="56" r="9.2" fill="url(#mj-g)" stroke="${ol}" stroke-width="3.2"/><circle cx="119" cy="53" r="2.4" fill="#fff"/></g>
      <g fill="${ol}" stroke="${ol}" stroke-width="6.5" stroke-linejoin="round">${body}</g>
      <g fill="url(#mj-g)">${body}</g>
      <g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"><path d="M53 37a22 22 0 0 1 12-10"/><path d="M31 55a15 15 0 0 1 7-8"/></g>
      <path class="mj-star" d="${star(97, 31, 8.5, 4)}" fill="#FFC94D" stroke="${ol}" stroke-width="2.4" stroke-linejoin="round"/>
      ${eye(57)}${eye(83)}
      <ellipse class="mj-blush" cx="46" cy="78" rx="6.4" ry="3.8" fill="#FF9DB5"/><ellipse class="mj-blush" cx="94" cy="78" rx="6.4" ry="3.8" fill="#FF9DB5"/>
      <path class="mj-mouth" d="M61 75h18q-1 12-9 12t-9-12z" fill="#1E2A44" stroke="#1E2A44" stroke-width="1.6" stroke-linejoin="round"/>
      <ellipse cx="70" cy="83.5" rx="4.4" ry="2.8" fill="#FF869C"/>
    </g>
  </svg>`;
}
// ── 푸름이가 울어요 (포인트가 모자랄 때, 구매 창) — 처진 눈썹, 볼을 타고 흐르는 눈물, 아래로 똑똑 떨어지는 빗방울 ──
function mascotSadSVG() {
  const ol = '#2F5597';
  const body = '<circle cx="70" cy="47" r="26"/><circle cx="43" cy="59" r="19"/><circle cx="97" cy="57" r="20"/>'
    + '<circle cx="27" cy="75" r="13"/><circle cx="113" cy="74" r="13"/><ellipse cx="70" cy="80" rx="46" ry="21"/>'
    + '<ellipse cx="54" cy="99" rx="11" ry="7"/><ellipse cx="86" cy="99" rx="11" ry="7"/>';
  const star = (cx, cy, R, r) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (Math.PI / 5) * i + 0.25; const rr = i % 2 ? r : R; d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`; } return `${d}Z`; };
  const drop = (x, y, s) => `M${x} ${y}q${-3.4 * s} ${5 * s} ${-3.4 * s} ${7.6 * s}a${3.4 * s} ${3.4 * s} 0 0 0 ${6.8 * s} 0q0 ${-2.6 * s} ${-3.4 * s} ${-7.6 * s}z`;
  const eye = (x) => `<g class="cry-eye"><ellipse cx="${x}" cy="67" rx="5.2" ry="6.2" fill="#1E2A44"/><circle cx="${x + 1.7}" cy="64.6" r="2.1" fill="#fff"/></g>`;
  return `<svg class="cry" viewBox="0 0 140 130" aria-hidden="true">
    <defs><linearGradient id="cry-g" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="110"><stop offset="0" stop-color="#F4F8FD"/><stop offset=".6" stop-color="#E4EDF8"/><stop offset="1" stop-color="#C9D9EF"/></linearGradient></defs>
    <g class="cry-rain" fill="#5B9BFF">
      <path style="--d:0s" d="${drop(48, 108, 1)}"/><path style="--d:.45s" d="${drop(70, 112, 1.1)}"/><path style="--d:.9s" d="${drop(92, 108, 1)}"/>
    </g>
    <g class="cry-body">
      <g fill="${ol}" stroke="${ol}" stroke-width="6.5" stroke-linejoin="round">${body}</g>
      <g fill="url(#cry-g)">${body}</g>
      <g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" opacity=".8"><path d="M53 37a22 22 0 0 1 12-10"/><path d="M31 55a15 15 0 0 1 7-8"/></g>
      <path class="cry-star" d="${star(97, 31, 8.5, 4)}" fill="#FFC94D" stroke="${ol}" stroke-width="2.4" stroke-linejoin="round"/>
      <g class="cry-brow" fill="none" stroke="#1E2A44" stroke-width="3.6" stroke-linecap="round"><path d="M47.5 57.5 60.5 52.5"/><path d="M79.5 52.5 92.5 57.5"/></g>
      ${eye(57)}${eye(83)}
      <path class="cry-mouth" d="M62.5 84q7.5-7 15 0" fill="none" stroke="#1E2A44" stroke-width="3.4" stroke-linecap="round"/>
      <path class="cry-tear l" d="${drop(52, 74, 0.9)}" fill="#5B9BFF"/>
      <path class="cry-tear r" d="${drop(88, 74, 0.8)}" fill="#7DB3FF"/>
    </g>
  </svg>`;
}
// 1위 왕관 (SVG): 금 몸체 + 보석 3개 + 위쪽 구슬
function crownSVG() {
  return `<svg class="crown-svg" viewBox="0 0 64 44" aria-hidden="true">
    <defs>
      <linearGradient id="cr-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF4B8"/><stop offset=".4" stop-color="#FFCF33"/><stop offset=".8" stop-color="#E09A00"/><stop offset="1" stop-color="#A86C00"/></linearGradient>
      <linearGradient id="cr-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE27A"/><stop offset="1" stop-color="#B57800"/></linearGradient>
      <radialGradient id="cr-r" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FFD0D6"/><stop offset=".45" stop-color="#E5293F"/><stop offset="1" stop-color="#7A0A1A"/></radialGradient>
      <radialGradient id="cr-s" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#D6E4FF"/><stop offset=".45" stop-color="#2F6BFF"/><stop offset="1" stop-color="#132E8A"/></radialGradient>
    </defs>
    <path d="M8 34 4 12l14 11 14-19 14 19 14-11-4 22z" fill="url(#cr-g)" stroke="#8A5A00" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M10 31 7.5 17l11 8.6L32 8l13.5 17.6 11-8.6L54 31" fill="none" stroke="#FFF7D0" stroke-width="1" opacity=".8" stroke-linejoin="round"/>
    <rect x="7" y="33" width="50" height="8" rx="2.5" fill="url(#cr-b)" stroke="#8A5A00" stroke-width="1.1"/>
    <path d="M9 35h46" stroke="#FFF4C0" stroke-width="1" opacity=".8"/>
    <circle cx="4" cy="11" r="3" fill="url(#cr-g)" stroke="#8A5A00" stroke-width=".9"/><circle cx="60" cy="11" r="3" fill="url(#cr-g)" stroke="#8A5A00" stroke-width=".9"/>
    <circle cx="32" cy="5" r="3.6" fill="url(#cr-g)" stroke="#8A5A00" stroke-width=".9"/>
    <circle cx="32" cy="26" r="4.4" fill="url(#cr-r)" stroke="#8A5A00" stroke-width=".8"/>
    <circle cx="19" cy="29" r="3" fill="url(#cr-s)" stroke="#8A5A00" stroke-width=".7"/><circle cx="45" cy="29" r="3" fill="url(#cr-s)" stroke="#8A5A00" stroke-width=".7"/>
    <circle cx="30.6" cy="24.5" r="1.2" fill="#fff" opacity=".85"/>
    <circle cx="20" cy="37" r="1.6" fill="#E5293F"/><circle cx="32" cy="37" r="1.6" fill="#2F6BFF"/><circle cx="44" cy="37" r="1.6" fill="#E5293F"/>
  </svg>`;
}
// ---------------------------------------------------------------------
// 포인트 상점: 모은 탄소 포인트를 1만 원 이하 상품으로 바꿔요 (1P = 1원 가치)
//  서버 DB가 있으면 서버가 잔액을 확인하고 교환권 번호를 만들어요. 없으면 이 휴대폰에서만.
// ---------------------------------------------------------------------
const SHOP_ORDER_KEY = 'pureun-shop-orders';
const SHOP_CATS = [{ id: 'all', label: '전체' }, { id: 'transit', label: '교통' }, { id: 'cafe', label: '카페·편의점' }, { id: 'goods', label: '친환경 굿즈' }, { id: 'donate', label: '기부' }];
const SHOP_TONE = { transit: 'sky', cafe: 'sun', goods: 'mint', donate: 'leaf' };
// 서버를 못 쓸 때(체험 모드) 보여 줄 상품 — 서버(db/schema.sql shop_items)와 같게
const SHOP_ITEMS_LOCAL = [
  ['bike-day', 'transit', '공공자전거 1일 이용권', '하루 동안 1시간씩 자유롭게', 1000, '🚲'],
  ['transit-3000', 'transit', '대중교통 충전권 3,000원', '버스 · 지하철 교통카드 충전', 3000, '🚌'],
  ['transit-5000', 'transit', '대중교통 충전권 5,000원', '버스 · 지하철 교통카드 충전', 5000, '🚇'],
  ['coffee', 'cafe', '아메리카노 교환권', '텀블러를 가져가면 더 좋아요', 4500, '☕'],
  ['store-5000', 'cafe', '편의점 상품권 5,000원', '전국 편의점에서 사용', 5000, '🏪'],
  ['bamboo-brush', 'goods', '대나무 칫솔 2개 세트', '플라스틱 대신 대나무', 3900, '🪥'],
  ['seed-kit', 'goods', '반려식물 씨앗 키트', '바질 · 방울토마토 중 랜덤', 6500, '🌱'],
  ['straw-set', 'goods', '스테인리스 빨대 세트', '빨대 2개 + 세척솔', 5900, '🥤'],
  ['eco-bag', 'goods', '에코백', '튼튼한 캔버스 천 · 비닐봉지 대신', 7900, '👜'],
  ['cloud-cushion', 'goods', '푸름이 쿠션', '말랑말랑 푸름이 얼굴 쿠션', 9000, '☁️', 'code'],
  ['cloud-tumbler', 'goods', '푸름이 텀블러 350ml', '푸름이가 그려진 보온·보냉 텀블러', 7000, '🥤', 'code'],
  ['tree-donate', 'donate', '나무 한 그루 심기 기부', '숲 가꾸기 단체에 기부돼요', 10000, '🌳', 'donate'],
].map(([code, cat, name, sub, price, icon, voucher = 'barcode']) => ({ code, cat, name, sub, price, icon, voucher }));
const voucherOf = (o) => o.voucher || (o.code === 'tree-donate' ? 'donate' : /^cloud-/.test(o.code) ? 'code' : 'barcode');
// 푸름이 굿즈 그림 (쿠션 · 텀블러) — 이모지 대신 직접 그려요
function goodsArtSVG(code) {
  const ol = '#2F5597';
  const face = (x, y, k = 1) => `<path d="M${x - 9 * k} ${y}q${3 * k}-${4 * k} ${6 * k} 0M${x + 3 * k} ${y}q${3 * k}-${4 * k} ${6 * k} 0" fill="none" stroke="#1E2A44" stroke-width="${2.2 * k}" stroke-linecap="round"/>
    <ellipse cx="${x - 11 * k}" cy="${y + 6 * k}" rx="${3.4 * k}" ry="${2 * k}" fill="#FFA3B8"/><ellipse cx="${x + 11 * k}" cy="${y + 6 * k}" rx="${3.4 * k}" ry="${2 * k}" fill="#FFA3B8"/>
    <path d="M${x - 3.6 * k} ${y + 4 * k}h${7.2 * k}q-.4 ${5.4 * k}-${3.6 * k} ${5.4 * k}t-${3.6 * k}-${5.4 * k}z" fill="#1E2A44"/><ellipse cx="${x}" cy="${y + 8 * k}" rx="${2 * k}" ry="${1.2 * k}" fill="#FF869C"/>`;
  if (code === 'cloud-cushion') {
    const body = '<circle cx="60" cy="40" r="20"/><circle cx="39" cy="50" r="15"/><circle cx="81" cy="49" r="16"/><circle cx="25" cy="63" r="11"/><circle cx="95" cy="62" r="11"/><ellipse cx="60" cy="66" rx="38" ry="18"/>';
    return `<svg viewBox="0 0 120 100" class="goods-art" aria-hidden="true">
      <defs><radialGradient id="ga-cu" cx=".35" cy=".25" r=".9"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#F1F6FF"/><stop offset="1" stop-color="#C9DCF7"/></radialGradient></defs>
      <ellipse cx="60" cy="90" rx="40" ry="5" fill="#1E3A6E" opacity=".14"/>
      <g fill="${ol}" stroke="${ol}" stroke-width="4" stroke-linejoin="round">${body}</g><g fill="url(#ga-cu)">${body}</g>
      <path d="M26 72q34 10 68 0" fill="none" stroke="#B9CDEB" stroke-width="1.4" stroke-dasharray="2.5 2.5"/>
      <path d="M46 30a17 17 0 0 1 9-7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      ${face(60, 56, 1)}</svg>`;
  }
  if (code === 'cloud-tumbler') {
    return `<svg viewBox="0 0 120 100" class="goods-art" aria-hidden="true">
      <defs><linearGradient id="ga-tb" x1="0" x2="1"><stop offset="0" stop-color="#5E8FD9"/><stop offset=".3" stop-color="#9CC2F2"/><stop offset=".55" stop-color="#7EAAE8"/><stop offset="1" stop-color="#3F6EB8"/></linearGradient>
        <linearGradient id="ga-lid" x1="0" x2="1"><stop offset="0" stop-color="#E6ECF4"/><stop offset=".4" stop-color="#FFFFFF"/><stop offset="1" stop-color="#B8C4D4"/></linearGradient></defs>
      <ellipse cx="60" cy="93" rx="22" ry="4" fill="#1E3A6E" opacity=".16"/>
      <path d="M41 24h38l-4 66q-.4 3-3.4 3H48.4q-3 0-3.4-3z" fill="url(#ga-tb)"/>
      <rect x="38" y="13" width="44" height="12" rx="4" fill="url(#ga-lid)" stroke="#9AA8BC" stroke-width=".8"/>
      <rect x="52" y="8" width="16" height="6" rx="2.5" fill="#C9D3E1"/>
      <path d="M46 26l-1 60" stroke="#fff" stroke-width="3" opacity=".35" stroke-linecap="round"/>
      <g transform="translate(60 54) scale(.42) translate(-60 -50)"><g fill="${ol}" stroke="${ol}" stroke-width="5" stroke-linejoin="round"><circle cx="60" cy="40" r="20"/><circle cx="39" cy="50" r="15"/><circle cx="81" cy="49" r="16"/><ellipse cx="60" cy="62" rx="36" ry="17"/></g>
        <g fill="#fff"><circle cx="60" cy="40" r="20"/><circle cx="39" cy="50" r="15"/><circle cx="81" cy="49" r="16"/><ellipse cx="60" cy="62" rx="36" ry="17"/></g>${face(60, 52, 1)}</g>
      <path d="M48 80q12 4 24 0" stroke="#fff" stroke-width="1.4" opacity=".6" fill="none"/></svg>`;
  }
  return '';
}
// 상품 사진: assets/shop/<상품 코드>.jpg 를 넣고 여기 코드를 적으면 아이콘 대신 사진이 나와요
const SHOP_PHOTOS = new Set([]);
const shopPicHTML = (i, size = '') => (SHOP_PHOTOS.has(i.code)
  ? `<span class="shop-pic photo ${size}"><img src="assets/shop/${i.code}.jpg" alt="" loading="lazy" decoding="async"></span>`
  : `<span class="shop-pic ${size} tone-${/^cloud-/.test(i.code) ? 'cloud' : SHOP_TONE[i.cat] || 'sky'}" aria-hidden="true">${goodsArtSVG(i.code) || i.icon}</span>`);
const shopItems = () => (state.shopItems && state.shopItems.length ? state.shopItems : SHOP_ITEMS_LOCAL);
const loadOrders = () => { try { return JSON.parse(localStorage.getItem(SHOP_ORDER_KEY) || '[]') || []; } catch (e) { return []; } };
function spendPoints(p) { try { localStorage.setItem(POINT_KEY, String(Math.max(0, loadPoints() - p))); } catch (e) { /* 무시 */ } }
const couponText = (c) => String(c || '').replace(/(\d{4})(?=\d)/g, '$1 ');
// 바코드 그림 (교환권 번호로 만든 EAN 모양 막대 — 시연용)
function barcodeSVG(code) {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map((p) => p.replace(/./g, (b) => (b === '0' ? '1' : '0')));
  const d = String(code).replace(/\D/g, '').padEnd(12, '0').slice(0, 12).split('').map(Number);
  const bits = `101${d.slice(0, 6).map((x) => L[x]).join('')}01010${d.slice(6).map((x) => R[x]).join('')}101`;
  let bars = '';
  const guard = (i) => i < 3 || i >= bits.length - 3 || (i >= 45 && i < 50); // 양 끝·가운데 구분 막대는 조금 더 길게
  [...bits].forEach((b, i) => { if (b === '1') bars += `<rect x="${i}" y="0" width="1" height="${guard(i) ? 60 : 54}"/>`; });
  return `<svg class="cp-bar" viewBox="0 0 ${bits.length} 60" preserveAspectRatio="none" aria-hidden="true"><g fill="#0F1626">${bars}</g></svg>`;
}
function shopHTML() {
  const bal = loadPoints();
  const tab = state.shopTab || 'items';
  const cat = state.shopCat || 'all';
  const orders = loadOrders();
  const items = shopItems().filter((i) => cat === 'all' || i.cat === cat);
  const itemsHTML = `<div class="shop-cats" role="tablist">${SHOP_CATS.map((c) => `<button type="button" role="tab" class="${cat === c.id ? 'on' : ''}" data-act="shop-cat" data-id="${c.id}">${c.label}</button>`).join('')}</div>
    <ul class="shop-grid">${items.map((i) => `<li><button type="button" class="shop-item" data-act="shop-item" data-id="${i.code}">
      ${shopPicHTML(i)}
      <b>${esc(i.name)}</b><small>${esc(i.sub)}</small>
      <span class="shop-price">${i.price.toLocaleString()}P</span>
    </button></li>`).join('')}</ul>`;
  const ordersHTML = orders.length
    ? `<ul class="shop-orders">${orders.map((o) => `<li><button type="button" data-act="shop-coupon" data-id="${esc(o.id)}">
        ${shopPicHTML({ ...o, cat: '' }, 'sm')}
        <span class="so-t"><b>${esc(o.name)}</b><small>${new Date(o.at).toLocaleDateString('ko-KR')} · ${voucherOf(o) === 'code' ? esc(o.coupon) : couponText(o.coupon)}</small></span>
        <span class="so-p">-${o.price.toLocaleString()}P</span></button></li>`).join('')}</ul>`
    : '<div class="shop-empty"><span aria-hidden="true">🎁</span><b>아직 교환한 상품이 없어요</b><p>포인트를 모아 첫 상품으로 바꿔 보세요.</p></div>';
  return `${appBar('포인트 상점', 'back')}
    <main class="content shop">
      <section class="shop-hero">
        <div><p>보유 포인트</p><b>${bal.toLocaleString()}<small>P</small></b><span>1P = 1원 · 친환경 이동과 캠페인으로 모아요</span></div>
        <span class="shop-hero-ic" aria-hidden="true">🛍️</span>
      </section>
      <div class="shop-tabs" role="tablist">
        <button type="button" role="tab" class="${tab === 'items' ? 'on' : ''}" data-act="shop-tab" data-id="items">상품</button>
        <button type="button" role="tab" class="${tab === 'orders' ? 'on' : ''}" data-act="shop-tab" data-id="orders">교환 내역${orders.length ? ` <i>${orders.length}</i>` : ''}</button>
      </div>
      ${tab === 'items' ? itemsHTML : ordersHTML}
      <p class="shop-note">교환권은 시연용이에요. 실제 매장에서는 사용할 수 없어요.</p>
    </main>`;
}
// 상품을 누르면: 교환 확인 시트 → 교환 → 교환권
function shopBuySheet(code) {
  const it = shopItems().find((i) => i.code === code);
  if (!it) return;
  const bal = loadPoints();
  const enough = bal >= it.price;
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet-bg" data-no></div>
    <section class="sheet-card shop-sheet" role="dialog" aria-label="${esc(it.name)} 교환">
      <span class="sheet-grab" aria-hidden="true"></span>
      <div class="ss-hero">${shopPicHTML(it, 'big')}<span class="ss-mascot">${mascotJoySVG()}</span></div>
      <div class="sheet-ask"><b>${esc(it.name)}</b><p>${esc(it.sub)}</p></div>
      <dl class="ss-calc">
        <div><dt>상품 가격</dt><dd>${it.price.toLocaleString()}P</dd></div>
        <div><dt>보유 포인트</dt><dd>${bal.toLocaleString()}P</dd></div>
        ${enough ? `<div class="ss-after"><dt>구매 후 남는 포인트</dt><dd>${(bal - it.price).toLocaleString()}P</dd></div>` : ''}
      </dl>
      <p class="ss-short" id="ss-short" role="alert" hidden></p>
      <p class="rj-err" id="ss-err" hidden></p>
      <button type="button" class="btn primary" data-yes>${it.price.toLocaleString()}P로 구매하기</button>
      <button type="button" class="btn sheet-cancel" data-no>취소</button>
    </section>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  const close = () => { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); };
  sheet.addEventListener('click', async (e) => {
    if (e.target.closest('[data-no]')) return close();
    const yes = e.target.closest('[data-yes]');
    if (!yes || yes.disabled) return;
    if (loadPoints() < it.price) { // 포인트가 모자라면: 신났던 푸름이가 울고, 창 안에 모자란 만큼 알려 줘요
      const m = sheet.querySelector('.ss-mascot');
      if (m && !m.classList.contains('sad')) { m.classList.add('sad'); m.innerHTML = mascotSadSVG(); }
      const msg = sheet.querySelector('#ss-short');
      msg.innerHTML = `<span>포인트가 <b>${(it.price - loadPoints()).toLocaleString()}P</b> 부족해요</span><small>친환경 이동이나 캠페인으로 조금만 더 모아 봐요</small>`;
      msg.hidden = false;
      [m, msg, yes].forEach((el) => { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }); // 다시 누르면 다시 흔들려요
      return;
    }
    yes.disabled = true; yes.textContent = '구매하는 중…';
    let order = null;
    if (dbMode()) {
      const r = await dataApi('shop-buy', { code });
      if (r.status === 401) { close(); needRelogin(); return; }
      if (r.status !== 200) { const err = sheet.querySelector('#ss-err'); err.textContent = r.data.error || '구매하지 못했어요.'; err.hidden = false; yes.textContent = '다시 시도'; yes.disabled = false; return; }
      order = r.data.order;
      lsSet(POINT_KEY, String(r.data.points));
      lsSet(SHOP_ORDER_KEY, [order, ...loadOrders()]);
      syncFromServer();
    } else {
      if (loadPoints() < it.price) return;
      spendPoints(it.price);
      const rb = crypto.getRandomValues(new Uint8Array(12)); const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      order = { id: `l${Date.now()}`, code: it.code, name: it.name, icon: it.icon, voucher: voucherOf(it), price: it.price, at: Date.now(),
        coupon: voucherOf(it) === 'code' ? `PUREUM-${Array.from(rb.slice(0, 8), (x, i) => (i === 4 ? '-' : '') + ABC[x % ABC.length]).join('')}` : Array.from(rb, (x) => String(x % 10)).join('') };
      lsSet(SHOP_ORDER_KEY, [order, ...loadOrders()]);
    }
    close();
    if (state.screen === 'shop') render();
    setTimeout(() => couponSheet(order, true), 240);
  });
}
// 교환권 (바코드 + 번호)
// ── 기부 감사 화면: 땅에서 나무가 자라나고, 잎이 떨어지고, 빛·반짝임 속에 감사 문구가 떠요 ──
function donateTreeSVG() {
  // 실제 나무처럼: 작은 잎 뭉치 수백 개를 겹쳐 그리고, 왼쪽 위에서 빛이 오는 것처럼 밝기를 나눠요 (뒤·가운데·앞 3겹)
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const CX = 110; const CY = 92; const RX = 80; const RY = 64;
  const shades = ['#1F4F1B', '#26601F', '#2E7226', '#37842C', '#459736', '#56A93F', '#6BBB4A', '#86CC5C', '#A3DC74'];
  const layer = (n, k, rMin, rMax, bias) => {
    let out = '';
    for (let i = 0; i < n; i++) {
      const t = Math.sqrt(rnd()) * k; const a = rnd() * Math.PI * 2;
      const x = CX + Math.cos(a) * RX * t; const y = CY + Math.sin(a) * RY * t * (Math.sin(a) > 0 ? 0.9 : 1.05);
      const light = (-(x - CX) / RX * 0.55 - (y - CY) / RY * 0.8 + 1) / 2; // 왼쪽 위가 밝아요
      const idx = Math.max(0, Math.min(shades.length - 1, Math.round(light * 6 + bias + (rnd() - 0.5) * 1.6)));
      const r = rMin + rnd() * (rMax - rMin);
      out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * (0.82 + rnd() * 0.25)).toFixed(1)}" transform="rotate(${(rnd() * 180).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${shades[idx]}"/>`;
    }
    return out;
  };
  const back = layer(70, 1.0, 10, 17, -1.2);
  const mid = layer(120, 0.95, 6, 11, 0.4);
  const front = layer(110, 0.9, 3.5, 7, 1.6);
  const glint = Array.from({ length: 46 }, () => {
    const a = Math.PI * (1.0 + rnd() * 0.75); const t = 0.45 + rnd() * 0.5;
    const x = CX + Math.cos(a) * RX * t; const y = CY + Math.sin(a) * RY * t;
    const r = 1.6 + rnd() * 1.8; // 햇빛 받은 잎 끝 (작은 잎 모양)
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.55).toFixed(1)}" transform="rotate(${(rnd() * 180).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="#B4E383" opacity="${(0.45 + rnd() * 0.3).toFixed(2)}"/>`;
  }).join('');
  const holes = Array.from({ length: 9 }, () => { // 잎 사이로 보이는 어두운 틈 (깊이감)
    const a = rnd() * Math.PI * 2; const t = 0.2 + rnd() * 0.55;
    return `<ellipse cx="${(CX + Math.cos(a) * RX * t).toFixed(1)}" cy="${(CY + Math.sin(a) * RY * t).toFixed(1)}" rx="${(4 + rnd() * 5).toFixed(1)}" ry="${(3 + rnd() * 3).toFixed(1)}" fill="#163D14" opacity=".55"/>`;
  }).join('');
  const leaf = (i, x, d) => `<g class="dn-leaf" style="--x:${x}px;--d:${d}s;--r:${i % 2 ? -1 : 1}"><path d="M0 -6C4.5 -4 5 2.5 0 6.5C-5 2.5 -4.5 -4 0 -6Z" fill="url(#dn-lf${i % 2})"/><path d="M0 -5.5V6" stroke="#2A5E22" stroke-width=".6"/></g>`;
  return `<svg class="dn-tree" viewBox="0 0 220 240" aria-hidden="true">
    <defs>
      <radialGradient id="dn-glow" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="#FFF6C9" stop-opacity=".95"/><stop offset=".5" stop-color="#E8F7D4" stop-opacity=".5"/><stop offset="1" stop-color="#E8F7D4" stop-opacity="0"/></radialGradient>
      <linearGradient id="dn-bark" x1="0" x2="1"><stop offset="0" stop-color="#3E2614"/><stop offset=".35" stop-color="#6E4627"/><stop offset=".6" stop-color="#8A5B34"/><stop offset="1" stop-color="#3A2312"/></linearGradient>
      <radialGradient id="dn-soil" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#7A5233"/><stop offset=".7" stop-color="#5A3A22"/><stop offset="1" stop-color="#4A2F1B" stop-opacity="0"/></radialGradient>
      <radialGradient id="dn-shadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#1B3A12" stop-opacity=".35"/><stop offset="1" stop-color="#1B3A12" stop-opacity="0"/></radialGradient>
      <radialGradient id="dn-shade" cx=".32" cy=".25" r=".85"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".18"/><stop offset=".55" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#0B2408" stop-opacity=".45"/></radialGradient>
      <linearGradient id="dn-lf0" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9AD86A"/><stop offset="1" stop-color="#3F8F31"/></linearGradient>
      <linearGradient id="dn-lf1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E3C65A"/><stop offset="1" stop-color="#7FA437"/></linearGradient>
      <clipPath id="dn-crown-clip"><ellipse cx="${CX}" cy="${CY}" rx="${RX + 16}" ry="${RY + 16}"/></clipPath>
    </defs>
    <g class="dn-rays">${Array.from({ length: 12 }, (_, i) => `<path d="M${CX} ${CY}L${(CX + Math.cos(i * Math.PI / 6 - 0.08) * 170).toFixed(1)} ${(CY + Math.sin(i * Math.PI / 6 - 0.08) * 170).toFixed(1)}L${(CX + Math.cos(i * Math.PI / 6 + 0.08) * 170).toFixed(1)} ${(CY + Math.sin(i * Math.PI / 6 + 0.08) * 170).toFixed(1)}Z" fill="#FFE9A3" opacity=".3"/>`).join('')}</g>
    <circle class="dn-halo" cx="${CX}" cy="${CY}" r="110" fill="url(#dn-glow)"/>
    <ellipse class="dn-ground-shadow" cx="${CX}" cy="214" rx="88" ry="14" fill="url(#dn-shadow)"/>
    <ellipse cx="${CX}" cy="214" rx="54" ry="9" fill="url(#dn-soil)"/>
    <path class="dn-grass" d="M62 214q3-10 6-1q2-12 6 0q3-9 5 1M86 216q2-7 4 0M140 216q2-8 4 0M150 214q3-11 6 0q3-9 6-1q3-10 6 1" fill="none" stroke="#4E9B38" stroke-width="2" stroke-linecap="round"/>
    <g class="dn-sprout"><path d="M${CX} 214C${CX} 206 ${CX + 1} 200 ${CX} 194" stroke="#5C9A3A" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M${CX} 196C${CX - 9} 190 ${CX - 15} 194 ${CX - 15} 194C${CX - 12} 200 ${CX - 4} 200 ${CX} 196Z" fill="#7CC250"/>
      <path d="M${CX} 194C${CX + 8} 186 ${CX + 15} 189 ${CX + 15} 189C${CX + 13} 196 ${CX + 4} 197 ${CX} 194Z" fill="#8FD25F"/></g>
    <g class="dn-grow">
      <g class="dn-wood">
        <path d="M${CX - 9} 214C${CX - 7} 190 ${CX - 6} 160 ${CX - 4} 128L${CX + 4} 128C${CX + 6} 160 ${CX + 7} 190 ${CX + 10} 214C${CX + 4} 216 ${CX - 4} 216 ${CX - 9} 214Z" fill="url(#dn-bark)"/>
        <path d="M${CX - 3} 150C${CX - 18} 136 ${CX - 30} 124 ${CX - 42} 108M${CX + 2} 142C${CX + 16} 128 ${CX + 28} 118 ${CX + 40} 104M${CX - 1} 132C${CX - 6} 116 ${CX - 10} 104 ${CX - 14} 92M${CX + 1} 130C${CX + 8} 114 ${CX + 14} 102 ${CX + 18} 90" fill="none" stroke="#5E3C21" stroke-width="5" stroke-linecap="round"/>
        <path d="M${CX - 42} 108C${CX - 50} 100 ${CX - 56} 96 ${CX - 60} 90M${CX + 40} 104C${CX + 48} 98 ${CX + 54} 94 ${CX + 58} 88M${CX - 22} 126C${CX - 30} 128 ${CX - 38} 126 ${CX - 46} 122" fill="none" stroke="#5E3C21" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M${CX - 3} 210C${CX - 2} 190 ${CX - 3} 170 ${CX - 1} 140M${CX + 4} 206C${CX + 3} 186 ${CX + 4} 168 ${CX + 2} 146M${CX - 6} 200C${CX - 5} 188 ${CX - 6} 176 ${CX - 4} 164" stroke="#2C1A0D" stroke-width=".9" opacity=".55" fill="none"/>
        <path d="M${CX + 1} 208C${CX + 2} 186 ${CX + 1} 166 ${CX + 1} 136" stroke="#B88655" stroke-width="1.6" opacity=".45" fill="none"/>
        <path d="M${CX - 9} 214q-7 2-12 0M${CX + 10} 214q7 2 13-1" stroke="#4A2F1B" stroke-width="3" stroke-linecap="round" fill="none"/>
      </g>
      <ellipse cx="${CX}" cy="${CY + 50}" rx="24" ry="7" fill="#0E2A0B" opacity=".35"/>
      <g class="dn-crown" clip-path="url(#dn-crown-clip)">
        <g class="dn-layer l1">${back}${holes}</g>
        <g class="dn-layer l2">${mid}</g>
        <g class="dn-layer l3">${front}${glint}</g>
      </g>
    </g>
    <g class="dn-leaves" transform="translate(${CX} 104)">${[-52, -22, 8, 34, 58, -66].map((x, i) => leaf(i, x, 2.6 + i * 0.6)).join('')}</g>
    <g class="dn-sparks">${[[30, 40], [190, 52], [22, 140], [198, 150], [60, 14], [160, 12], [110, 2]].map(([x, y], i) => `<path style="--i:${i}" d="M${x} ${y - 7}Q${x + 1.3} ${y - 1.3} ${x + 7} ${y}Q${x + 1.3} ${y + 1.3} ${x} ${y + 7}Q${x - 1.3} ${y + 1.3} ${x - 7} ${y}Q${x - 1.3} ${y - 1.3} ${x} ${y - 7}Z" fill="${i % 3 === 2 ? '#8FD3FF' : '#FFD54A'}"/>`).join('')}</g>
  </svg>`;
}
function donateSheet(o, fresh) {
  const u = state.user || {};
  const kg = (TREE_YEAR_G / 1000).toFixed(1);
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  const bits = Array.from({ length: 22 }, (_, i) => `<i style="--a:${(i * 360 / 22).toFixed(0)}deg;--d:${(i % 5) * 0.06 + 1.5}s;--c:${['#FFD54A', '#7CCB4E', '#8FD3FF', '#FF9DB5', '#FFFFFF'][i % 5]};--l:${70 + (i * 29) % 70}px"></i>`).join('');
  sheet.innerHTML = `<div class="sheet-bg" data-no></div>
    <section class="sheet-card dn-sheet ${fresh ? 'fresh' : ''}" role="dialog" aria-label="기부 감사">
      <button type="button" class="dn-x" data-no aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="dn-stage">${donateTreeSVG()}<div class="dn-burst" aria-hidden="true">${bits}</div></div>
      <div class="dn-text">
        <p class="dn-kicker">🌱 나무 한 그루 심기 기부 완료</p>
        <h2>${esc(u.name || '')}님, 따뜻한 기부<br>정말 감사합니다</h2>
        <p>모아 주신 <b>${o.price.toLocaleString()}P</b>로 나무 한 그루가 심어져요.<br>이 나무는 1년에 이산화탄소 약 <b>${kg}kg</b>을 흡수하며 우리 하늘을 푸르게 지켜 줄 거예요.</p>
        <small>기부일 ${new Date(o.at).toLocaleDateString('ko-KR')} · 기부 번호 ${couponText(o.coupon)}</small>
      </div>
    </section>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-no]')) { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); } });
}
// ── 푸름이 굿즈 쿠폰 코드: (가상) 푸름이 굿즈샵에서 입력하면 상품이 무료 (배송비만 따로) ──
function goodsCodeSheet(o, fresh) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet-bg" data-no></div>
    <section class="sheet-card gc-sheet" role="dialog" aria-label="푸름이 굿즈 쿠폰">
      <span class="sheet-grab" aria-hidden="true"></span>
      <div class="cp-joy" aria-hidden="true">${mascotJoySVG()}</div>
      ${fresh ? '<p class="cp-done">🎉 구매 완료!</p>' : ''}
      <div class="gc-ticket">
        <div class="gc-top">${shopPicHTML({ ...o, cat: '' }, 'sm')}<div><b>${esc(o.name)}</b><small>푸름이 굿즈샵 무료 교환 쿠폰</small></div></div>
        <div class="cp-cut" aria-hidden="true"></div>
        <p class="gc-label">쿠폰 코드</p>
        <div class="gc-code"><code>${esc(o.coupon)}</code><button type="button" class="gc-copy" data-copy>복사</button></div>
        <ol class="gc-steps">
          <li><b>푸름이 굿즈샵</b>에서 같은 상품을 장바구니에 담아요</li>
          <li>주문서의 <b>쿠폰 코드</b> 칸에 위 코드를 입력해요</li>
          <li>상품 금액은 <b>0원</b>, 배송비만 결제하면 끝!</li>
        </ol>
        <p class="cp-meta">구매일 ${new Date(o.at).toLocaleDateString('ko-KR')} · 1회만 사용 가능 · 배송비 별도<br>푸름이 굿즈샵은 시연용 가상 사이트예요</p>
      </div>
      <button type="button" class="btn primary" data-no>확인</button>
    </section>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheet.addEventListener('click', async (e) => {
    if (e.target.closest('[data-copy]')) {
      const btn = e.target.closest('[data-copy]');
      try { await navigator.clipboard.writeText(o.coupon); } catch (err) {
        const ta = document.createElement('textarea'); ta.value = o.coupon; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) { /* 무시 */ } ta.remove();
      }
      btn.textContent = '복사됨 ✓'; btn.classList.add('done'); setTimeout(() => { btn.textContent = '복사'; btn.classList.remove('done'); }, 1600);
      return;
    }
    if (e.target.closest('[data-no]')) { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); }
  });
}
function couponSheet(o, fresh) {
  if (!o) return;
  if (voucherOf(o) === 'donate') return donateSheet(o, fresh); // 기부는 바코드 대신 감사 화면
  if (voucherOf(o) === 'code') return goodsCodeSheet(o, fresh); // 푸름이 굿즈는 굿즈샵 쿠폰 코드
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet-bg" data-no></div>
    <section class="sheet-card cp-sheet" role="dialog" aria-label="교환권">
      <span class="sheet-grab" aria-hidden="true"></span>
      <div class="cp-joy" aria-hidden="true">${mascotJoySVG()}</div>
      ${fresh ? '<p class="cp-done">🎉 교환 완료!</p>' : ''}
      <div class="cp-ticket">
        <div class="cp-top"><span class="shop-pic sm" aria-hidden="true">${o.icon}</span><div><b>${esc(o.name)}</b><small>푸른하늘 포인트 상점 · ${o.price.toLocaleString()}P</small></div></div>
        <div class="cp-cut" aria-hidden="true"></div>
        ${barcodeSVG(o.coupon)}
        <p class="cp-num">${couponText(o.coupon)}</p>
        <p class="cp-meta">교환일 ${new Date(o.at).toLocaleDateString('ko-KR')} · 시연용 교환권 (실제 사용 불가)</p>
      </div>
      <button type="button" class="btn primary" data-no>확인</button>
    </section>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-no]')) { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); } });
}
// 이달의 절약왕 보너스: 지난달 1·2·3등 (서버가 다음 달 1일 이후 처음 들어올 때 지급)
const MONTH_AWARDS = [1000, 500, 300];
function lastAwardsHTML() {
  const list = state.lastAwards || [];
  if (!list.length) return '';
  const m = Number(String(list[0].month).slice(5));
  const mine = list.find((x) => x.me);
  // 접혀 있다가 누르면 지난달 1·2·3등이 펼쳐져요 (탄소 포인트 설명 바로 위)
  return `<details class="rk-last">
    <summary class="rk-last-h"><span>🎖️ ${m}월 절약왕 보너스${mine ? ` <em>나 ${mine.rank}등 +${mine.points.toLocaleString()}P</em>` : ''}</span><i aria-hidden="true">${ICON.chev}</i></summary>
    <ol>${list.map((x) => `<li class="r${x.rank} ${x.me ? 'me' : ''}"><i>${x.rank}</i><b>${esc(x.name)}</b><span>+${x.points.toLocaleString()}P</span></li>`).join('')}</ol>
  </details>`;
}
// 랭킹 화면에 들어올 때: 3등 → 2등 → 1등 순서로 단상이 아래에서 솟아오르고, 포인트는 0부터 세어 올라가요
function podiumIntro() {
  const pod = appEl.querySelector('.rk .podium');
  if (!pod) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  pod.classList.add('pod-anim');
  const delay = { 'pod-3': 0, 'pod-2': 140, 'pod-1': 280 };
  pod.querySelectorAll('.pod-pt[data-n]').forEach((el) => {
    const n = Number(el.dataset.n) || 0;
    const place = [...el.parentElement.classList].find((c) => /^pod-\d$/.test(c));
    const wait = (delay[place] || 0) + 380; const dur = 1100;
    el.textContent = '0P';
    const t0 = performance.now() + wait;
    const tick = (now) => {
      if (!el.isConnected) return;
      const k = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = `${Math.round(n * e).toLocaleString()}P`;
      if (k < 1) requestAnimationFrame(tick); else el.classList.add('pt-done');
    };
    requestAnimationFrame(tick);
  });
  setTimeout(() => pod.classList.remove('pod-anim'), 2200);
}
function rankHTML() {
  const now = new Date();
  const mKey = monthKey(now);
  const { all, me } = monthRanking(mKey);
  const top = all.slice(0, 100);
  const left = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const pod = (u, place) => u ? `<div class="pod pod-${place}">
      ${place === 1 ? `<span class="crown" aria-hidden="true">${crownSVG()}</span>` : ''}
      <div class="medal m${place}">${tierAvatarHTML(u.name, u.photo, 'av-lg', u.me ? loadLog().g : u.g, 'badge')}</div>
      <b class="pod-name">${esc(u.name)}${u.me ? ' <em>나</em>' : ''}</b>${u.me ? titleChipHTML(titleOf(loadLog().g), 'sm') : ''}
      <span class="pod-pt" data-n="${u.points}">${u.points.toLocaleString()}P</span>
      <div class="step"><span>${place}</span><em class="step-prize">+${MONTH_AWARDS[place - 1].toLocaleString()}P</em></div>
    </div>` : '';
  return `<main class="main rk">
    <header class="rk-head">
      <p class="m-kicker">${ICON.spark}${now.getFullYear()}년 ${now.getMonth() + 1}월</p>
      <h1 class="m-title sm">이달의 절약왕</h1>
      <p class="rk-sub">탄소 포인트를 가장 많이 모은 사람 · ${left ? `${left}일 남았어요` : '오늘 마감'}</p>
    </header>
    <section class="podium" aria-label="1~3위">
      ${pod(all[1], 2)}${pod(all[0], 1)}${pod(all[2], 3)}
    </section>
    ${lastAwardsHTML()}
    <details class="rk-rule"><summary>ⓘ 탄소 포인트는 이렇게 모여요</summary>
      <p>친환경 경로로 도착하면 <b>아낀 탄소 1kg당 ${PT_PER_KG}P</b> + <b>버스·지하철·걷기·자전거로 이동한 거리 1km당 ${PT_PER_KM}P</b>를 받아요. 캠페인 보상도 함께 쌓이고, 매달 1일에 새로 시작해요.</p>
      <p>🏆 매달 마지막 순위 <b>1등 ${MONTH_AWARDS[0].toLocaleString()}P · 2등 ${MONTH_AWARDS[1].toLocaleString()}P · 3등 ${MONTH_AWARDS[2].toLocaleString()}P</b> 보너스를 다음 달 1일에 드려요. (보너스와 상점에서 쓴 포인트는 순위에 들어가지 않아요)</p>
    </details>
    <ol class="rk-list">${top.slice(3).map((u) => `<li class="${u.me ? 'is-me' : ''}">
      <span class="rk-n">${u.rank}</span>${tierAvatarHTML(u.name, u.photo, '', u.me ? loadLog().g : u.g)}
      <span class="rk-name">${esc(u.name)}${u.me ? ` <em>나</em> ${titleChipHTML(titleOf(loadLog().g), 'sm')}` : ''}</span>
      <span class="rk-pt">${u.points.toLocaleString()}P</span></li>`).join('')}</ol>
    <div class="rk-me">
      <span class="rk-n">${me.rank > 999 ? '999+' : me.rank}</span>${tierAvatarHTML(me.name, me.photo, '', loadLog().g)}
      <span class="rk-name">내 순위${me.rank <= 3 ? ' 🏅' : ''} ${titleChipHTML(titleOf(loadLog().g), 'sm')}</span>
      <span class="rk-pt">${me.points.toLocaleString()}P</span>
    </div>
  </main>
  ${tabBarHTML('rank')}`;
}

// ---------------------------------------------------------------------
// 계정 설정: 프로필 사진 · 닉네임 · 포인트 · 로그아웃
// ---------------------------------------------------------------------
// 계정정보 > 내 캠페인
function myCampaignsHTML() {
  const mine = campStore.load().filter(isMine).sort((a, b) => (b.submittedAt || b.createdAt) - (a.submittedAt || a.createdAt));
  return `<section class="m-card acc-camps">
    <div class="acc-camps-head"><h2>내 캠페인 <small>${mine.length}개</small></h2>
      <button type="button" class="acc-new" data-act="camp-new">${ICON.plus}만들기</button></div>
    ${mine.length ? `<ul>${mine.map((c) => `<li>
        <button type="button" class="acc-camp" data-act="open-camp" data-id="${c.id}">
          <span class="acc-camp-cover" style="background:${campBg(c, 'linear-gradient(0deg,rgba(0,0,0,0),rgba(0,0,0,0))')}">${c.cover ? '' : tagOf(c.tag).icon}</span>
          <span class="acc-camp-txt">${isApproved(c) && campEnded(c) ? '<span class="st st-ended">종료</span>' : `<span class="st st-${c.status || 'approved'}">${STATUS_LABEL[c.status || 'approved']}</span>`}<b>${esc(c.title)}</b>
            ${isApproved(c) ? `<small>${isPopular(c) ? '🏆 인기 캠페인 · ' : ''}${Math.floor(campPct(c))}% 달성 · ${c.participants.toLocaleString()}명 참여 · ♥ ${c.likes.toLocaleString()}</small>
            <span class="c-prog"><span style="width:${campPct(c).toFixed(1)}%"></span></span>`
            : c.status === 'rejected' ? `<small class="acc-why">사유 · ${esc(c.rejectReason || '-')}</small>`
            : '<small>관리자가 검토하고 있어요 · 승인되면 알려 드려요</small>'}</span>
        </button>
        <button type="button" class="acc-camp-del" data-act="camp-del" data-id="${c.id}" aria-label="${esc(c.title)} 삭제">${ICON.trash}</button>
      </li>`).join('')}</ul>`
      : '<p class="acc-empty">아직 만든 캠페인이 없어요. 환경을 위한 실천을 함께할 사람을 모아 보세요!</p>'}
  </section>`;
}
// 삭제 확인 (아래에서 올라오는 창)
function confirmSheet(title, desc, okLabel, cancelLabel = '취소', okClass = 'sheet-out') {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.className = 'sheet-wrap';
    sheet.innerHTML = `<div class="sheet-bg" data-no></div>
      <section class="sheet-card" role="alertdialog" aria-label="${esc(title)}">
        <span class="sheet-grab" aria-hidden="true"></span>
        <div class="sheet-ask"><b>${esc(title)}</b><p>${esc(desc)}</p></div>
        <button type="button" class="btn ${okClass}" data-yes>${esc(okLabel)}</button>
        ${cancelLabel ? `<button type="button" class="btn sheet-cancel" data-no>${esc(cancelLabel)}</button>` : ''}
      </section>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('open'));
    const close = (v) => { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); resolve(v); };
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-yes]')) close(true);
      else if (e.target.closest('[data-no]')) close(false);
    });
  });
}

function accountHTML() {
  const u = state.user || {};
  const how = { kakao: '카카오 계정', email: '이메일' }[u.provider] || '로그인';
  const { me } = monthRanking();
  const photo = loadAvatar();
  return `<main class="main acc">
      <header class="m-top">
        <div><p class="m-kicker">${ICON.spark}내 정보</p><h1 class="m-title sm">계정정보</h1></div>
        ${themeSwitchHTML()}
      </header>
      <section class="acc-top">
        <label class="acc-photo" aria-label="프로필 사진 바꾸기">
          <input type="file" id="avatar-input" accept="image/*" hidden>
          ${tierAvatarHTML(u.name || '나', photo, 'av-xl', loadLog().g)}
          <span class="acc-cam" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>
        </label>
        <p class="acc-who"><b>${esc(u.name || '나')}</b><button type="button" class="ttl-btn" data-act="open-titles" aria-label="내 칭호 보기">${titleChipHTML(titleOf(loadLog().g))}</button></p>
        ${photo ? '<button type="button" class="acc-reset" data-act="avatar-reset">기본 이미지로</button>' : '<p class="acc-hint">사진을 눌러 프로필 사진을 바꿔요</p>'}
      </section>
      <section class="m-card acc-card">
        <form id="name-form" class="acc-name" novalidate>
          <label class="label" for="acc-name">닉네임</label>
          <div class="acc-row"><input id="acc-name" class="input" name="name" maxlength="12" value="${esc(u.name || '')}" placeholder="랭킹에 보일 이름"><button type="submit" class="btn small primary">저장</button></div>
        </form>
      </section>
      <section class="acc-stats">
        <div><span>이번 달 탄소 포인트</span><b>${loadMonthPoints().toLocaleString()}P</b></div>
        <div><span>이번 달 순위</span><b>${me.rank}위</b></div>
        <div><span>보유 포인트</span><b>${loadPoints().toLocaleString()}P</b></div>
      </section>
      ${myCampaignsHTML()}
      <section class="m-card acc-list">
        <button type="button" class="acc-shop" data-act="open-shop"><span>🛍️ 포인트 상점</span><span class="acc-cnt"><em class="acc-pt">${loadPoints().toLocaleString()}P</em>${ICON.chev}</span></button>
        ${isAdmin() ? `<button type="button" class="acc-admin" data-act="open-admin"><span>🛡️ 캠페인 검토 <em>관리자</em></span><span class="acc-cnt">${pendingCampaigns().length ? `<i>${pendingCampaigns().length}</i>` : ''}${ICON.chev}</span></button>
        <button type="button" class="acc-admin" data-act="admin-points"><span>💰 포인트 지급 · 삭제 <em>관리자</em></span><span class="acc-cnt">${ICON.chev}</span></button>
        <button type="button" class="acc-admin" data-act="admin-carbon"><span>🌿 탄소 절약량 조절 <em>관리자</em></span><span class="acc-cnt">${ICON.chev}</span></button>
        <button type="button" class="acc-admin" data-act="admin-users"><span>🚫 회원 관리 · 차단 <em>관리자</em></span><span class="acc-cnt">${ICON.chev}</span></button>
        <button type="button" class="acc-admin" data-act="admin-feedback"><span>📬 받은 의견 <em>관리자</em></span><span class="acc-cnt">${state.fbNew ? `<i>${state.fbNew}</i>` : ''}${ICON.chev}</span></button>` : ''}
        <button type="button" data-act="open-rank"><span>🏆 이달의 절약왕 랭킹</span>${ICON.chev}</button>
        <button type="button" data-act="open-calendar"><span>📅 그린 캘린더</span>${ICON.chev}</button>
        <button type="button" data-act="open-help"><span>❓ 자주 묻는 질문 · 의견 보내기</span>${ICON.chev}</button>
        <div class="acc-info"><span>로그인 방식</span><b>${esc(how)}${u.demo ? ' (체험용)' : ''}</b></div>
        ${u.email ? `<div class="acc-info"><span>이메일</span><b>${esc(u.email)}</b></div>` : ''}
      </section>
      <button type="button" class="btn sheet-out" data-act="logout">로그아웃</button>
      <p class="rk-note">프로필 사진과 닉네임은 이 기기에 저장돼요</p>
    </main>
    ${tabBarHTML('me')}`;
}

// ── 도움말: 자주 묻는 질문 + 관리자에게 의견 보내기 (계정정보 > 자주 묻는 질문 · 의견 보내기) ──
//  질문·답은 되도록 두 줄 안에 들어오게 짧게 적어요
const FAQ = [
  { q: '이 앱은 무슨 앱이에요?', a: '푸른하늘은 이동 과정의 탄소 배출을 줄이도록 돕는 친환경 내비게이션이에요. 목적지까지 갈 수 있는 경로를 수단별 CO₂ 배출량과 함께 비교해 보여 주고, 자동차 대신 걷기·자전거·대중교통을 선택해 실제로 줄인 배출량을 기록해 포인트로 보상해요.' },
  { q: '탄소 배출은 어떤 방식으로 계산해요?', a: '같은 목적지를 승용차로 갔을 때의 배출량에서, 실제로 이용한 경로의 배출량(구간 거리 × 수단별 배출계수)을 뺀 값이 아낀 탄소예요. 배출계수는 1인이 1km를 이동할 때 나오는 CO₂ 양이에요.',
    table: [['승용차', FACTORS.car], ['버스', FACTORS.bus], ['지하철', FACTORS.subway], ['걷기·자전거', FACTORS.walk]],
    src: '출처: 서울시 자료(그린피스 코리아 인용), 1인 1km 기준' },
  { q: '포인트는 어떻게 쌓고 어디에 써요?', a: `친환경 이동 1km에 ${PT_PER_KM}P, 탄소 1kg 절약에 ${PT_PER_KG}P예요. 상점에서 굿즈·쿠폰으로 바꿔요.` },
  { q: '이동 기록은 언제 저장돼요?', a: '목적지에 도착하면 저장돼요. 인터넷이 끊겼다면 연결될 때 올라가요.' },
  { q: '캠페인은 어떻게 만들어요?', a: '캠페인 탭의 만들기 버튼으로 신청해요. 관리자가 승인하면 목록에 올라가요.' },
];
const FB_KINDS = [
  { id: 'bug', icon: '🐞', label: '오류 신고', hint: '어떤 화면에서 무슨 일이 있었는지 알려 주세요' },
  { id: 'idea', icon: '✏️', label: '고칠 점', hint: '이렇게 바뀌면 좋겠다 싶은 점을 적어 주세요' },
  { id: 'etc', icon: '💬', label: '기타', hint: '하고 싶은 말을 편하게 남겨 주세요' },
];
const FB_MAX = 500;
const FB_MIN = 5;
const FB_STATE = { new: '확인 전', read: '확인함', done: '처리 완료' };
const fbKind = (id) => FB_KINDS.find((k) => k.id === id) || FB_KINDS[2];
const fbWhen = (t) => {
  const d = new Date(t); const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${p(d.getHours())}:${p(d.getMinutes())}`;
};
function faqItemHTML(f, i) {
  const open = state.faqOpen === i;
  return `<div class="faq-item ${open ? 'open' : ''}">
    <button type="button" class="faq-q" data-act="faq" data-id="${i}" aria-expanded="${open}" aria-controls="faq-a${i}"><i aria-hidden="true">Q</i><span>${esc(f.q)}</span>${ICON.chev}</button>
    <div class="faq-a" id="faq-a${i}" role="region"><div><p>${esc(f.a)}${f.table ? `<span class="faq-ef">${f.table.map(([k, g]) => `<span><small>${esc(k)}</small><b>${g}g</b></span>`).join('')}</span>` : ''}${f.src ? `<small class="faq-src">${esc(f.src)}</small>` : ''}</p></div></div>
  </div>`;
}
function fbChipHTML(x) {
  const k = fbKind(x.kind);
  return `<div class="fb-row"><span class="fb-chip k-${esc(x.kind)}">${k.icon} ${k.label}</span><span class="fb-state s-${esc(x.status)}">${FB_STATE[x.status] || ''}</span><time>${fbWhen(x.at)}</time></div>`;
}
// 내가 보낸 의견 (관리자가 확인했는지 보여 줘요)
function fbMineHTML() {
  const m = (state.fb && state.fb.mine) || [];
  if (!m.length) return '';
  return `<section class="fb-mine" aria-label="내가 보낸 의견"><h3>내가 보낸 의견</h3>
    <ul>${m.map((x) => `<li>${fbChipHTML(x)}<p>${esc(x.body)}</p></li>`).join('')}</ul></section>`;
}
function helpHTML() {
  const f = state.fb || (state.fb = { kind: 'bug', text: '', busy: false, mine: null });
  return `${appBar('도움말', 'back')}
    <main class="content help">
      <section class="m-card faq" aria-label="자주 묻는 질문">${FAQ.map(faqItemHTML).join('')}</section>
      <section class="m-card fb-card">
        <div class="fb-head"><h2>관리자에게 의견 보내기</h2><p>오류나 고쳤으면 하는 점을 남겨 주시면 관리자가 확인해요.</p></div>
        <form id="fb-form" novalidate data-kb-anchor>
          <div class="fb-kinds" role="radiogroup" aria-label="의견 종류">${FB_KINDS.map((k) => `<button type="button" role="radio" class="fb-kind ${f.kind === k.id ? 'on' : ''}" aria-checked="${f.kind === k.id}" data-act="fb-kind" data-id="${k.id}">${k.icon} ${k.label}</button>`).join('')}</div>
          <textarea id="fb-text" class="input fb-text" rows="5" maxlength="${FB_MAX}" aria-label="의견 내용" placeholder="${esc(fbKind(f.kind).hint)}">${esc(f.text)}</textarea>
          <div class="fb-foot"><span class="fb-count" id="fb-count">${f.text.length}/${FB_MAX}</span>
            <button type="submit" class="btn primary" id="fb-send" ${f.busy ? 'disabled' : ''}>${f.busy ? '보내는 중…' : '보내기'}</button></div>
        </form>
      </section>
      <div id="fb-mine">${fbMineHTML()}</div>
    </main>`;
}
function loadMyFeedback() {
  if (!dbMode()) return;
  dataApi('feedback-mine').then((r) => {
    if (r.status === 401) return needRelogin();
    if (r.status !== 200 || !state.fb) return;
    state.fb.mine = r.data.items || [];
    const el = document.getElementById('fb-mine');
    if (el && state.screen === 'help') el.innerHTML = fbMineHTML();
  });
}
async function sendFeedback() {
  const f = state.fb;
  if (!f || f.busy) return;
  const text = String(f.text || '').trim();
  if (text.length < FB_MIN) { toast(`내용을 ${FB_MIN}자 이상 적어 주세요`); const t = document.getElementById('fb-text'); if (t) t.focus(); return; }
  if (!dbMode()) { toast('의견 보내기는 서버에 연결된 곳에서만 쓸 수 있어요'); return; }
  const setBtn = (busy) => { const b = document.getElementById('fb-send'); if (b) { b.disabled = busy; b.textContent = busy ? '보내는 중…' : '보내기'; } };
  f.busy = true; setBtn(true);
  const r = await dataApi('feedback-send', { kind: f.kind, body: text });
  f.busy = false; setBtn(false);
  if (r.status === 401) return needRelogin();
  if (r.status !== 200) { toast(r.data.error || '보내지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
  f.text = '';
  const t = document.getElementById('fb-text'); if (t) t.value = '';
  const c = document.getElementById('fb-count'); if (c) c.textContent = `0/${FB_MAX}`;
  toast('의견을 보냈어요. 관리자가 확인할게요');
  loadMyFeedback();
}

// 관리자: 받은 의견 (계정정보 > 받은 의견)
function loadAdminFeedback(f) {
  const cur = state.fba || {};
  state.fba = { ...cur, f: f || cur.f || 'new', loading: true, error: '' };
  if (state.screen === 'admin-feedback') renderAdminFeedback();
  const seq = (loadAdminFeedback.seq = (loadAdminFeedback.seq || 0) + 1);
  dataApi('feedback-list', undefined, `&f=${state.fba.f}`).then((r) => {
    if (seq !== loadAdminFeedback.seq) return; // 늦게 온 예전 결과는 버려요
    if (r.status === 401) return needRelogin();
    if (r.status === 200) {
      state.fba = { f: r.data.f, items: r.data.items, newCount: r.data.newCount, total: r.data.total, loading: false };
      state.fbNew = r.data.newCount; // 계정정보의 빨간 숫자
    } else state.fba = { ...state.fba, loading: false, error: r.data.error || '불러오지 못했어요.' };
    if (state.screen === 'admin-feedback') renderAdminFeedback();
  });
}
function fbItemHTML(x) {
  const who = x.email ? `${esc(x.name)} · ${esc(x.email)}` : `${esc(x.name)}${x.provider === 'kakao' ? ' · 카카오' : ''}`;
  return `<li class="fb-item s-${esc(x.status)}">
    ${fbChipHTML(x)}
    <p class="fb-who">${who}</p>
    <p class="fb-body">${esc(x.body)}</p>
    <div class="au-acts fb-acts">
      ${x.status === 'new' ? `<button type="button" class="btn small" data-act="fb-set" data-id="${esc(x.id)}" data-to="read">확인함</button>` : ''}
      ${x.status === 'done' ? `<button type="button" class="btn small" data-act="fb-set" data-id="${esc(x.id)}" data-to="read">다시 열기</button>`
        : `<button type="button" class="btn small fb-ok" data-act="fb-set" data-id="${esc(x.id)}" data-to="done">처리 완료</button>`}
      <button type="button" class="btn small au-del" data-act="fb-del" data-id="${esc(x.id)}" aria-label="의견 삭제">${ICON.trash}</button>
    </div>
  </li>`;
}
function adminFeedbackListHTML() {
  const a = state.fba || {};
  const list = a.items || [];
  const tab = a.f || 'new';
  const tabBtn = (id, label, n) => `<button type="button" role="tab" class="${tab === id ? 'on' : ''}" aria-selected="${tab === id}" data-act="fb-tab" data-id="${id}">${label} ${(n || 0).toLocaleString()}</button>`;
  return `<div class="c-sort ad-tabs" role="tablist">${tabBtn('new', '안 읽음', a.newCount)}${tabBtn('all', '전체', a.total)}</div>
    ${a.newCount ? '<button type="button" class="au-blocked-link" data-act="fb-readall">모두 확인함으로 표시</button>' : ''}
    ${a.error ? `<p class="hint">${esc(a.error)}</p>` : ''}
    ${list.length ? `<ul class="fb-list">${list.map(fbItemHTML).join('')}</ul>`
      : a.loading ? '<p class="acc-empty">불러오는 중…</p>' : `<p class="acc-empty">${tab === 'new' ? '✅ 새로 온 의견이 없어요.' : '아직 받은 의견이 없어요.'}</p>`}`;
}
function renderAdminFeedback() { const el = document.getElementById('fba-out'); if (el) el.innerHTML = adminFeedbackListHTML(); }
function adminFeedbackHTML() {
  if (!isAdmin()) return `${appBar('받은 의견', 'back')}<main class="content"><p class="empty">관리자만 볼 수 있어요.</p></main>`;
  return `${appBar('받은 의견', 'back')}
    <main class="content fba">
      <p class="ad-lead">사용자가 보낸 오류 신고와 고칠 점이에요. 확인함이나 처리 완료로 표시하면 보낸 사람 화면에도 그대로 보여요.</p>
      <div id="fba-out">${adminFeedbackListHTML()}</div>
    </main>`;
}

// 아래 탭 바 (글라스 UI): 선택 표시가 눌린 탭으로 미끄러지듯 이동하고, 손가락으로 끌어서 옮길 수도 있어요
const TAB_IDS = ['route', 'rank', 'camp', 'me'];
let tabIdx = null; // 마지막으로 보여 준 탭 (다음 화면에서 여기서부터 미끄러져요)
function tabBarHTML(active) {
  const cur = TAB_IDS.indexOf(active);
  const from = tabIdx == null ? cur : tabIdx;
  const tab = (id, icon, label, act) => `<button type="button" class="m-tab ${active === id ? 'on' : ''}" data-act="${act}">${icon}<span>${label}</span></button>`;
  return `<nav class="m-tabs" aria-label="메뉴" data-cur="${cur}" data-from="${from}">
    <span class="m-tab-ind" aria-hidden="true"></span>
    ${tab('route', ICON.route, '길찾기', 'open-main')}
    ${tab('rank', ICON.rank, '랭킹', 'open-rank')}
    ${tab('camp', ICON.flag, '캠페인', 'open-camps')}
    ${tab('me', ICON.user, '계정정보', 'open-account')}
  </nav>`;
}
// "1kg 기준 / 내가 아낀 양" 토글: 탭 바처럼 선택 표시가 미끄러져요
function initKgSeg() {
  const seg = document.querySelector('#app .kg-seg');
  if (!seg) return;
  const ind = seg.querySelector('.kg-seg-ind');
  const to = Number(seg.dataset.to);
  const from = Number(seg.dataset.from);
  ind.style.transition = 'none';
  ind.style.transform = `translateX(${from * 100}%)`;
  void ind.offsetWidth;
  ind.style.transition = '';
  if (from !== to) requestAnimationFrame(() => { ind.style.transform = `translateX(${to * 100}%)`; });
}
// 탭 전환: 오른쪽 탭으로 가면 화면이 오른쪽에서, 왼쪽 탭으로 가면 왼쪽에서 들어와요
const TAB_SCREENS = ['main', 'rank', 'campaigns', 'account'];
function goTab(screen) {
  if (state.screen === screen) return;
  const from = TAB_SCREENS.indexOf(state.screen);
  const to = TAB_SCREENS.indexOf(screen);
  // 탭 화면이 아닌 곳(캠페인 상세 등)에서 오면: 메인은 뒤로, 나머지는 앞으로
  const back = from >= 0 ? to < from : screen === 'main';
  go(screen, back ? 'back' : undefined);
}
function tabX(nav, i) { const t = nav.querySelectorAll('.m-tab')[i]; return t ? t.offsetLeft : 0; }
function setTabInd(ind, x, animate) {
  if (!animate) ind.style.transition = 'none';
  ind.style.transform = `translateX(${x}px)`;
  if (!animate) { void ind.offsetWidth; ind.style.transition = ''; }
}
// 화면을 그린 뒤: 이전 탭 자리에서 지금 탭 자리로 미끄러지게
function initTabBar() {
  const nav = appEl.querySelector('.m-tabs');
  if (!nav) return;
  const ind = nav.querySelector('.m-tab-ind');
  const tabs = nav.querySelectorAll('.m-tab');
  const cur = Number(nav.dataset.cur);
  const from = Number(nav.dataset.from);
  ind.style.width = `${tabs[0].offsetWidth}px`;
  if (nav.dataset.kept === '1') { setTabInd(ind, tabX(nav, cur), true); tabIdx = cur; return; } // 그대로 둔 바: 지금 자리에서 바로 미끄러져요
  nav.dataset.kept = '1';
  setTabInd(ind, tabX(nav, from), false);
  if (from !== cur) requestAnimationFrame(() => setTabInd(ind, tabX(nav, cur), true));
  tabIdx = cur;
}
window.addEventListener('resize', () => {
  const nav = appEl.querySelector('.m-tabs');
  if (!nav) return;
  const ind = nav.querySelector('.m-tab-ind');
  ind.style.width = `${nav.querySelector('.m-tab').offsetWidth}px`;
  setTabInd(ind, tabX(nav, Number(nav.dataset.cur)), false);
});
// 손가락으로 끌기: 선택 표시가 손가락을 따라오고, 놓은 자리의 탭으로 이동해요
let tabDrag = null;
let tabDragJustMoved = false;
function nearestTab(nav, x) {
  const tabs = [...nav.querySelectorAll('.m-tab')];
  let best = 0;
  tabs.forEach((t, i) => { if (Math.abs(t.offsetLeft - x) < Math.abs(tabs[best].offsetLeft - x)) best = i; });
  return best;
}
document.getElementById('app').addEventListener('pointerdown', (e) => {
  const nav = e.target.closest('.m-tabs');
  if (!nav || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const ind = nav.querySelector('.m-tab-ind');
  const tabs = nav.querySelectorAll('.m-tab');
  tabDrag = { nav, ind, id: e.pointerId, x0: e.clientX, moved: false, w: tabs[0].offsetWidth,
    min: tabs[0].offsetLeft, max: tabs[tabs.length - 1].offsetLeft, left: nav.getBoundingClientRect().left };
  nav.classList.add('pressing');
});
document.getElementById('app').addEventListener('pointermove', (e) => {
  const d = tabDrag;
  if (!d || e.pointerId !== d.id) return;
  if (!d.moved && Math.abs(e.clientX - d.x0) < 8) return;
  if (!d.moved) { d.moved = true; d.nav.classList.add('dragging'); try { d.nav.setPointerCapture(d.id); } catch (err) { /* 무시 */ } }
  const x = Math.max(d.min, Math.min(d.max, e.clientX - d.left - d.w / 2));
  setTabInd(d.ind, x, false);
  const near = nearestTab(d.nav, x);
  d.nav.querySelectorAll('.m-tab').forEach((t, i) => t.classList.toggle('on', i === near));
});
function endTabDrag(e) {
  const d = tabDrag;
  if (!d || e.pointerId !== d.id) return;
  tabDrag = null;
  d.nav.classList.remove('pressing', 'dragging');
  if (!d.moved) return; // 그냥 누른 거면 평소처럼 click 으로 이동
  const x = Math.max(d.min, Math.min(d.max, e.clientX - d.left - d.w / 2));
  const i = nearestTab(d.nav, x);
  setTabInd(d.ind, tabX(d.nav, i), true);
  tabDragJustMoved = true;
  setTimeout(() => { tabDragJustMoved = false; }, 350);
  const btn = d.nav.querySelectorAll('.m-tab')[i];
  if (i !== Number(d.nav.dataset.cur)) {
    tabIdx = i; // 이미 그 자리에 있으니 다음 화면에서는 미끄러지지 않게
    setTimeout(() => { const fn = actions[btn.dataset.act]; if (fn) fn(btn); }, 160);
  }
}
document.getElementById('app').addEventListener('pointerup', endTabDrag);
document.getElementById('app').addEventListener('pointercancel', endTabDrag);
// 끌기를 끝낸 직후 생기는 click 은 무시 (두 번 이동하지 않게)
document.getElementById('app').addEventListener('click', (e) => {
  if (tabDragJustMoved && e.target.closest('.m-tabs')) { e.stopPropagation(); e.preventDefault(); }
}, true);

// 캠페인 점 표시 (넘길 때마다)
function bindMain() {
  const car = document.getElementById('m-carousel');
  const dots = document.getElementById('m-dots');
  if (!car || !dots) return;
  car.addEventListener('scroll', () => {
    const w = car.firstElementChild ? car.firstElementChild.getBoundingClientRect().width + 12 : 1;
    const i = Math.min(dots.children.length - 1, Math.round(car.scrollLeft / w));
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
}
// 내 정보 (프로필 버튼): 로그인한 이름 + 로그아웃
function openProfile() {
  const u = state.user || {};
  const how = { kakao: '카카오 계정', email: '이메일' }[u.provider] || '로그인';
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet-bg" data-close></div>
    <section class="sheet-card" role="dialog" aria-label="내 정보">
      <span class="sheet-grab" aria-hidden="true"></span>
      <div class="sheet-user"><span class="m-tile">${ICON.user}</span>
        <div><b>${esc(u.name || '푸른하늘 사용자')}</b><small>${esc(how)}${u.email ? ` · ${esc(u.email)}` : ''}${u.demo ? ' · 체험용' : ''}</small></div></div>
      <div class="sheet-points"><span>🌿 탄소 포인트</span><b>${loadPoints().toLocaleString()}P</b></div>
      <button type="button" class="btn sheet-out" data-logout>로그아웃</button>
      <button type="button" class="btn sheet-cancel" data-close>닫기</button>
    </section>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  const close = () => { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); };
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
    if (e.target.closest('[data-logout]')) { close(); askLogout(); }
  });
}
// ---------------------------------------------------------------------
// 서버 DB 연결 (Vercel + Neon)
//  - 로그인하면 서버가 출입증 쿠키를 줘요. 앱을 켜거나 기록이 바뀔 때마다 서버에서 내 기록을 받아
//    이 휴대폰의 저장 공간(localStorage)에 그대로 덮어써요. 화면은 지금처럼 저장 공간을 읽어서 그려요.
//  - 이동·캠페인·프로필을 바꾸면 화면에 먼저 보여 주고 서버에 저장한 뒤 다시 받아 와요.
//  - DB가 없는 곳(내 맥 server.js 등)에서는 예전처럼 이 휴대폰에만 저장해요.
// ---------------------------------------------------------------------
const DB_FLAG_KEY = 'pureun-db';         // '1' 이면 서버 DB를 쓰는 중
const PENDING_KEY = 'pureun-pending-trips'; // 인터넷이 끊겨 아직 못 보낸 이동
const dbMode = () => { try { return localStorage.getItem(DB_FLAG_KEY) === '1'; } catch (e) { return false; } };
function setDbMode(on) { try { on ? localStorage.setItem(DB_FLAG_KEY, '1') : localStorage.removeItem(DB_FLAG_KEY); } catch (e) { /* 무시 */ } }
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) { /* 무시 */ } };
const rememberedLogin = () => { try { return !!localStorage.getItem(USER_KEY); } catch (e) { return true; } };

// 서버 호출 → { status, data }. 인터넷이 끊기면 status 0
async function dataApi(a, body, query = '') {
  try {
    const res = await fetch(`/api/data?a=${a}${query}`, body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 무시 */ }
    return { status: res.status, data: data || {} };
  } catch (e) { return { status: 0, data: { error: '인터넷 연결을 확인해 주세요.' } }; }
}
// 출입증이 없거나 만료됐을 때: 로그인 화면으로 (한 번만 다시 로그인하면 돼요)
function needRelogin(msg) {
  if (!state.user) return;
  clearServerCache();
  saveUser(null);
  state.user = null;
  state.auth = { busy: false, message: msg || '기록을 서버에 안전하게 저장하려고 해요. 한 번만 다시 로그인해 주세요.' };
  go('login');
}
function clearServerCache() {
  [LOG_KEY, POINT_KEY, POINT_MONTH_KEY, CAMP_KEY, AVATAR_KEY, RECENT_KEY, SHOP_ORDER_KEY].forEach((k) => lsSet(k, null));
  state.rank = null; state.campRanks = {};
  state.fb = null; state.fba = null; state.fbNew = 0;
}
// 서버에서 받은 내 기록을 저장 공간에 덮어쓰기
function applySync(d) {
  setDbMode(true);
  lsSet(LOG_KEY, d.log);
  lsSet(POINT_KEY, String(d.points || 0));
  lsSet(POINT_MONTH_KEY, d.monthPoints || {});
  lsSet(CAMP_KEY, d.camps || []);
  lsSet(AVATAR_KEY, d.user && d.user.avatar ? d.user.avatar : null);
  state.rank = d.rank || null;
  state.campRanks = {};
  state.lastAwards = d.lastAwards || [];
  if (d.shop) { state.shopItems = d.shop.items || []; lsSet(SHOP_ORDER_KEY, d.shop.orders || []); }
  state.demoUsers = d.demoUsers || 0; // 관리자에게만: 예시 회원 수
  state.fbNew = d.feedbackNew || 0;   // 관리자에게만: 안 읽은 의견 수
  state.demoCal = d.demoCal || 0;     // 관리자에게만: 내 캘린더 예시 이동 수
  if (Array.isArray(d.recentPlaces)) lsSet(RECENT_KEY, mergeRecent(d.recentPlaces, loadRecent())); // 다른 기기에서 간 곳도
  if (state.user && d.user) {
    const { avatar, ...u } = d.user;
    state.user = { ...state.user, ...u };
    saveUser(state.user, rememberedLogin());
  }
}
let syncing = null;
const MAP_SCREENS_DB = ['home', 'search', 'result', 'nav']; // 지도 화면은 다시 그리지 않아요 (지도·입력이 초기화돼서)
// 서버와 맞추기: 못 보낸 이동부터 보내고 → 내 기록 받아 오기
function syncFromServer({ quiet = false } = {}) {
  if (!state.user || state.user.demo) return Promise.resolve(false);
  if (syncing) return syncing;
  syncing = (async () => {
    await flushTrips();
    const r = await dataApi('sync');
    if (r.status === 200) {
      applySync(r.data);
      if (!quiet && !MAP_SCREENS_DB.includes(state.screen) && state.screen !== 'login') render();
      return true;
    }
    if (r.status === 401) { needRelogin(); return false; }
    if (r.status === 403 && r.data.blocked) { needRelogin(r.data.error); return false; }
    if (r.status === 404 || r.status === 503) setDbMode(false); // 이 서버엔 DB가 없어요 → 예전처럼 휴대폰에만
    return false;
  })().finally(() => { syncing = null; });
  return syncing;
}

// ── 이동 저장 (못 보내면 모아 두었다가 다음에) ──
function loadPending() { try { const l = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function queueTrip(chosen) {
  const t = {
    key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    uid: state.user && state.user.uid,
    from: state.from && { name: state.from.name, lat: state.from.lat, lng: state.from.lng },
    to: state.to && { name: state.to.name, lat: state.to.lat, lng: state.to.lng },
    minutes: chosen.minutes, savedG: Math.max(0, chosen.saving || 0),
    segments: (chosen.segments || []).map((s) => ({ mode: s.mode, km: s.km })),
    campaignId: state.campTrip ? state.campTrip.campId : null,
  };
  lsSet(PENDING_KEY, loadPending().concat(t).slice(-50));
}
let flushing = null;
function flushTrips() {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const t of loadPending()) {
      if (!state.user || t.uid !== state.user.uid) continue; // 다른 계정이 남긴 건 그 계정으로 로그인하면 보내요
      const r = await dataApi('trip', t);
      if (r.status === 0 || r.status >= 500) break; // 인터넷·서버 문제: 다음에 다시
      if (r.status === 401) break;
      lsSet(PENDING_KEY, loadPending().filter((x) => x.key !== t.key)); // 저장됐거나(200) 잘못된 기록(4xx)이면 목록에서 빼요
      if (r.status >= 400 && r.data && r.data.error) { toast(`기록이 저장되지 않았어요: ${r.data.error}`); syncFromServer({ quiet: true }); } // 서버가 거절한 이유 (하루 상한 등)
      if (r.status === 200 && r.data.reached) toast(`"${r.data.reached.title}" 목표 달성! ${r.data.reached.rewardable ? `${CAMP_END_DAYS}일 뒤 최종 달성률로 보상을 정산해요` : '함께해 줘서 고마워요'}`);
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

// ── 화면에서 쓰는 서버 저장 도우미 ──
//  성공하면 서버에서 다시 받아 오고, 실패하면 알려 준 뒤 서버 기록으로 되돌려요.
async function dbWrite(a, body, okMsg) {
  const r = await dataApi(a, body);
  if (r.status === 401) { needRelogin(); return null; }
  if (r.status !== 200) { toast(r.data.error || '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); syncFromServer(); return null; }
  if (okMsg) toast(okMsg);
  await syncFromServer();
  return r.data;
}

// 캠페인 참여자 랭킹 (서버) — 처음 볼 때 받아 와요
function loadCampRank(id) {
  state.campRanks = state.campRanks || {};
  if (state.campRanks[id]) return;
  state.campRanks[id] = { loading: true, users: [], me: null };
  dataApi('camp-rank', undefined, `&id=${encodeURIComponent(id)}`).then((r) => {
    if (r.status !== 200) { delete state.campRanks[id]; return; }
    state.campRanks[id] = r.data;
    if (['campaign', 'campdone'].includes(state.screen)) render();
  });
}

// 로그아웃 확인 (예 / 아니요)
function askLogout() {
  confirmSheet('정말로 로그아웃 하시겠습니까?', '다시 들어오려면 로그인해야 해요.', '예', '아니요').then((ok) => { if (ok) logout(); });
}
// 로그아웃: 저장된 로그인을 지워요.
//  서버 DB를 쓰는 중이면 출입증도 지우고, 이 휴대폰에 받아 둔 기록도 지워요 (다음 사람이 못 보게).
//  DB가 없는 곳에서는 예전처럼 이동 기록·나의 숲이 이 휴대폰에 그대로 남아요.
function logout() {
  if (dbMode()) { dataApi('logout', {}); clearServerCache(); }
  saveUser(null);
  state.user = null;
  state.auth = { busy: false, message: '' };
  go('login', 'back');
}

// 앱 코드에서 난 오류를 화면 아래에 잠깐 보여줘요 (캡처해서 보내 주면 원인을 바로 알 수 있어요)
function reportError(err) {
  const msg = (err && (err.message || err.reason && err.reason.message)) || String(err);
  console.error('[푸른하늘 오류]', err);
  try {
    toast(`앱 오류: ${String(msg).slice(0, 90)}`);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { const el = document.getElementById('toast'); if (el) el.classList.remove('show'); }, 6000);
  } catch (e) { /* 무시 */ }
}
window.addEventListener('error', (e) => { if (e.filename && /\/app\.js/.test(e.filename)) reportError(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { if (e.reason && /app\.js/.test(String(e.reason.stack || ''))) reportError(e.reason); });

// "준비 중" 안내 (아직 없는 기능 버튼)
let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ── 홈 ──
// 지금까지 아낀 양 (한 번이라도 도착했을 때만)
function myPillHTML() {
  const l = loadLog();
  const i = impact(l.g);
  return l.trips ? `<p class="my-pill">${i.icon} 지금까지 <b>${esc(i.short)}</b> <small class="num">${formatG(l.g)}</small></p>` : '';
}
function homeHTML() {
  const source = currentSource();
  let body;
  if (state.ready) {
    body = `
      <div class="map full" id="map-home"></div>
      <div class="float-top">
        <div class="float-head"><button type="button" class="m-round back" data-act="back" aria-label="뒤로">←</button><div class="brand-line"><span class="brand-mark" aria-hidden="true"></span>푸른하늘 <small>탄소 절약 길찾기</small></div></div>
        ${tripBox(false)}
        ${state.loading ? '<p class="float-note"><span class="spinner" aria-hidden="true"></span>경로를 찾는 중이에요…</p>' : ''}
      </div>`;
  } else {
    const msg = state.mapError === 'nokey'
      ? '지도 키가 아직 없어요. <code>config.js</code>에 네이버 또는 카카오 키를 넣고 새로고침하면 장소 검색과 실제 길찾기를 쓸 수 있어요. 지금은 거리만 넣어 체험해 볼 수 있어요.'
      : state.mapError ? `${esc(state.mapError)} 지금은 거리만 넣어 체험해 볼 수 있어요.` : '<span class="spinner" aria-hidden="true"></span> 지도를 불러오는 중이에요…';
    body = `
      <div class="map full map-empty"></div>
      <div class="float-top">
        <div class="float-head"><button type="button" class="m-round back" data-act="back" aria-label="뒤로">←</button><div class="brand-line"><span class="brand-mark" aria-hidden="true"></span>푸른하늘 <small>탄소 절약 길찾기</small></div></div>
        <div class="trip-box"><div class="field" style="flex:1">
          <p class="notice ${state.mapError && state.mapError !== 'nokey' ? 'warn' : ''}">${msg}</p>
          ${state.mapError && state.mapError !== 'nokey' ? '<button type="button" class="btn small map-retry" data-act="reload">↻ 지도 다시 불러오기</button>' : ''}
          <label class="label" for="m-km">이동 거리 (km)</label>
          <input id="m-km" class="input" type="number" inputmode="decimal" min="0.1" step="0.1" value="${esc(state.manualKm)}">
        </div></div>
      </div>`;
  }
  const can = state.ready ? state.from && state.to && !state.loading && state.raw : !!source;
  const ct = campTripCamp();
  if (ct) body = body.replace(/(<div class="float-head">[\s\S]*?<\/div><\/div>)/, `$1${campTripBanner(ct)}`);
  return `<main class="home ${ct ? 'camp-mode' : ''}">${body}${ecoFabHTML()}</main>
    ${cta(`<button type="button" class="btn primary" id="go-result" data-act="to-result" ${can ? '' : 'disabled'}>길찾기</button>`)}`;
}

// ── 지도 화면 오른쪽 아래 앱 아이콘: 누르면 "이 길로 가면 얼마나 아끼는지" 카드가 아래에서 올라와요 ──
//  출발지 · 도착지가 정해지고 경로를 다 찾으면 아이콘 둘레가 빛나며 "얼마나 아낄까?" 말풍선이 떠요
function ecoFabHTML() {
  const { chosen } = currentPlan();
  const ready = !!chosen && !state.loading;
  return `<button type="button" class="eco-fab${ready ? ' ready' : ''}" data-act="eco-peek" aria-label="이 길로 가면 아끼는 탄소 미리 보기">
    <span class="eco-fab-tip">${ready ? '🌱 얼마나 아낄까?' : '🌱 탄소 절약 미리보기'}</span>
    <span class="eco-fab-ic"><img src="assets/icon-180.png?v=2" alt="" width="56" height="56"></span>
  </button>`;
}
function openEcoPeek() {
  const { ranked, chosen } = currentPlan();
  if (state.ready && (!state.from || !state.to)) { toast('출발지와 도착지를 먼저 정해 주세요'); return; }
  if (state.loading || !ranked || !chosen) { toast('경로를 찾는 중이에요. 잠시만 기다려 주세요'); return; }
  closeEcoPeek(true);
  state.openDetail = null;
  state.ecoPlayed = null; // 열 때마다 나무 · 배터리 그림과 숫자가 처음부터
  const card = routeCardHTML(chosen, true, ranked.baseline.emission)
    .replace(' data-act="select"', '')
    .replace(/<div class="rc-actions">[\s\S]*?<\/div>\s*/, '');
  const el = document.createElement('div');
  el.className = 'sheet-wrap eco-peek';
  el.id = 'eco-peek';
  el.innerHTML = `<div class="sheet-bg" data-act="peek-close"></div>
    <section class="sheet-card peek-card" role="dialog" aria-label="이 길로 가면 아끼는 탄소">
      <span class="sheet-grab" aria-hidden="true"></span>
      <p class="peek-h"><img src="assets/icon-180.png?v=2" alt="" width="26" height="26">이 길로 가면 이만큼 아껴요</p>
      ${card}
      <div class="peek-acts"><button type="button" class="btn" data-act="peek-close">닫기</button><button type="button" class="btn primary" data-act="peek-go">경로 모두 보기</button></div>
    </section>`;
  appEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
}
function closeEcoPeek(now) {
  const el = document.getElementById('eco-peek');
  if (!el) return;
  if (now) { el.remove(); return; }
  el.classList.remove('open');
  setTimeout(() => el.remove(), 220);
}
// 캠페인 길찾기 중일 때 위쪽 띠: 어떤 캠페인 · 어떤 수단으로만 찾는지
function campTripBanner(c, compact) {
  const m = campModeOf(state.campTrip.mode);
  return `<div class="camp-trip ${compact ? 'sm' : ''}">
    <span class="camp-trip-ic" aria-hidden="true">${m.icon}</span>
    <span class="camp-trip-txt"><small>캠페인 참여 중</small><b>${esc(c.title)}</b>${compact ? '' : `<em>${m.label}로 가는 길만 찾아요</em>`}</span>
    <button type="button" class="camp-trip-x" data-act="camp-trip-cancel" aria-label="캠페인 참여 그만두기">✕</button>
  </div>`;
}

// ── 검색 ──
function searchHTML() {
  const s = state.search;
  const byName = state.places && state.places.byName;
  return `${appBar(s.which === 'from' ? '출발지 검색' : '도착지 검색', 'back-search')}
    <main class="content">
      <form class="search-bar" id="search-form">
        <input id="search-input" class="input" type="search" enterkeyhint="search" autocomplete="off"
          placeholder="${byName ? '장소·주소 검색 초성도 돼요 (예: ㄱㄴㅇ)' : '도로명 주소 (예: 세종대로 110)'}" value="${esc(s.query)}">
        <button type="submit" class="btn primary small">검색</button>
      </form>
      ${s.which === 'from' ? '<button type="button" class="mine" data-act="mine">◎ 현재 위치에서 출발</button>' : ''}
      <div id="search-out">${searchOutHTML()}</div>
    </main>`;
}
// ── 최근 출발지·도착지 (최대 15개, 새로 고른 게 맨 위) ──
//  출발지·도착지로 고르면 이 휴대폰에 기록하고, 서버 DB가 있으면 실제로 이동한 기록과 합쳐요.
const RECENT_KEY = 'pureun-recent-places';
const RECENT_MAX = 15;
const placeKey = (p) => `${p.name}|${Number(p.lat).toFixed(4)}|${Number(p.lng).toFixed(4)}`;
const isMyPos = (p) => !p || /^(내 위치|현재 위치|위치)$/.test(String(p.name || '').trim());
function loadRecent() { try { const l = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function mergeRecent(...lists) {
  const map = new Map();
  lists.flat().forEach((p) => {
    if (!p || isMyPos(p) || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return;
    const k = placeKey(p); const old = map.get(k);
    if (!old || (p.at || 0) > (old.at || 0)) map.set(k, { name: p.name, address: p.address || (old && old.address) || '', lat: Number(p.lat), lng: Number(p.lng), at: p.at || 0 });
  });
  return [...map.values()].sort((a, b) => b.at - a.at).slice(0, RECENT_MAX);
}
function rememberPlace(p) {
  if (isMyPos(p)) return;
  lsSet(RECENT_KEY, mergeRecent([{ ...p, at: Date.now() }], loadRecent()));
}
const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
function recentHTML() {
  const list = loadRecent();
  if (!list.length) return '';
  return `<p class="recent-h">최근 출발지·도착지</p>
    <ul class="results recent">${list.map((p, i) => `
      <li><button type="button" data-act="pick-recent" data-i="${i}">
        <span class="recent-ic">${ICON_CLOCK}</span>
        <span class="recent-txt"><strong>${esc(p.name)}</strong>${p.address ? `<span>${esc(p.address)}</span>` : ''}</span>
      </button></li>`).join('')}</ul>`;
}

// 검색 결과 목록 (입력한 글자를 굵게 표시)
function searchOutHTML() {
  const s = state.search;
  const q = s.query.trim();
  if (!q && !s.busy && !s.results.length) return `${s.message ? `<p class="hint">${esc(s.message)}</p>` : ''}${recentHTML()}`;
  const mark = (t) => {
    const text = esc(t);
    if (!q) return text;
    const i = String(t).indexOf(q);
    return i < 0 ? text : `${esc(String(t).slice(0, i))}<mark>${esc(q)}</mark>${esc(String(t).slice(i + q.length))}`;
  };
  return `${s.busy && !s.results.length ? '<p class="hint"><span class="spinner" aria-hidden="true"></span> 찾는 중…</p>' : ''}
    ${s.message ? `<p class="hint">${esc(s.message)}</p>` : ''}
    <ul class="results">
      ${s.results.map((p, i) => `
        <li><button type="button" data-act="pick" data-i="${i}">
          <strong>${mark(p.name)}</strong>
          <span>${p.distM != null ? `<b class="dist">${formatM(p.distM)}</b> · ` : ''}${p.category ? `${esc(p.category)} · ` : ''}${esc(p.address)}</span>
        </button></li>`).join('')}
    </ul>`;
}
function renderSearchOut() {
  const el = document.getElementById('search-out');
  if (el) el.innerHTML = searchOutHTML();
}

// ── 결과(경로 목록) ──
function timeBarHTML(route) {
  const total = route.segments.reduce((s, x) => s + x.min, 0) || 1;
  return `<div class="tbar" aria-label="구간별 시간">${route.segments.map((s) => {
    const share = s.min / total;
    const show = share > 0.13;
    return `<span class="tseg ${s.mode === 'walk' ? 'walk' : ''}" style="flex-grow:${Math.max(share, 0.04)};--c:${s.color}" title="${esc(s.name)} ${s.min}분">
      ${show ? `<b>${MODES[s.mode].icon}</b>${s.min}분` : ''}</span>`;
  }).join('')}</div>`;
}
function modeTimesHTML(route) {
  const t = route.time;
  const items = [
    ['transit', MI.subway, '대중교통', t.transit], ['walk', MI.walk, '도보', t.walk],
    ['car', MI.car, '자동차', t.car], ['bike', '🚲', '자전거', t.bike],
  ].filter((x) => x[3] > 0 || x[0] !== 'bike');
  return `<div class="mtimes">${items.map(([k, ic, label, v]) =>
    `<span class="mt mt-${k} ${v > 0 ? '' : 'zero'}"><i aria-hidden="true">${ic}</i>${label} <b class="num">${formatMin(v)}</b></span>`).join('')}</div>`;
}
function legsHTML(route) {
  const items = route.legs.map((l) => `
    <li><span class="leg-chip" style="--c:${l.color}">${MODES[l.mode].icon} ${esc(l.name)}</span><span class="leg-st">${esc(l.start)}${l.way ? ` <small>${esc(l.way)} 방면</small>` : ''}</span></li>`).join('');
  const last = route.legs.length ? route.legs[route.legs.length - 1].end : '';
  return `<ol class="legs">${items}${last ? `<li class="off-row"><span class="leg-chip off">하차</span><span class="leg-st">${esc(last)}</span></li>` : ''}</ol>`;
}
// 아낀 탄소: 생활 비유(나무 · 휴대폰 완충)를 크게 먼저, 그 아래 CO₂ 양.
//  고른 카드는 오른쪽 위 빈 곳에 그림이 움직여요 (ecoArtHTML · routeCardHTML)
// play: 막 고른 카드면 숫자가 0부터 올라가요 (runCounters)
function ecoHTML(r, play) {
  const tier = r.tier || TIERS[0];
  const k = saveSense(r.saving);
  const g = Math.max(0, Math.round(r.saving || 0));
  const lead = play && k.num ? `${k.pre}<b ${countAttr(k.num, k.fmt)}>${COUNT_FMT[k.fmt](0)}</b>${k.post}` : k.html;
  const co2 = play && g > 0 ? `<b class="num" ${countAttr(g, 'g')}>${formatG(0)}</b>` : `<b class="num">${formatG(r.saving)}</b>`;
  return `<div class="eco eco-${tier.id} eco-k-${k.kind}" aria-label="${esc(k.text)}, 자동차보다 CO₂ ${formatG(r.saving)} 덜 배출">
    <p class="eco-lead" aria-hidden="true"><span class="eco-ic">${k.icon}</span><span>${lead}</span></p>
    <p class="eco-co2" aria-hidden="true"><span class="eco-sky">${tier.sky}</span>자동차보다 CO₂ ${co2} 덜 배출</p>
    ${k.hint ? `<p class="eco-hint"><span aria-hidden="true">ⓘ</span>${k.hint}</p>` : ''}
  </div>`;
}
// 오른쪽 위 그림. play: 이 카드를 막 골랐을 때만 나무가 자라고 · 배터리가 차오르는 등장 효과 (다시 그려질 땐 바로 완성된 모습)
//  나뭇잎이 흩날리고 · 번개가 반짝이는 건 계속
const ECO_LEAF = 'M0 0C2.6-3.2 6.8-3.3 9.2 0 6.8 3.3 2.6 3.2 0 0Z';
function ecoArtHTML(kind, play) {
  const cls = `eco-art ${kind}${play ? ' play' : ''}`;
  if (kind === 'tree') return `<div class="${cls}" aria-hidden="true"><svg viewBox="0 0 80 80">
    <defs><radialGradient id="eco-leaf-g" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#9BF5BE"/><stop offset=".5" stop-color="#38C878"/><stop offset="1" stop-color="#138A47"/></radialGradient></defs>
    <ellipse class="t-shadow" cx="40" cy="73" rx="21" ry="3.6" fill="rgba(18,110,60,.2)"/>
    <path class="t-grass" d="M22 73q2-6 4 0M53 73q2.5-7 5 0M57 73q1.5-4 3 0" fill="none" stroke="#3DBE74" stroke-width="2" stroke-linecap="round"/>
    <path class="t-trunk" d="M36.6 73V52.5c0-2.4 1.5-4 3.4-4s3.4 1.6 3.4 4V73Z" fill="#9C6A43"/>
    <g class="t-crown">
      <circle class="t-c t-c1" cx="28.5" cy="42" r="13.5" fill="url(#eco-leaf-g)"/>
      <circle class="t-c t-c2" cx="51.5" cy="42" r="13.5" fill="url(#eco-leaf-g)"/>
      <circle class="t-c t-c3" cx="40" cy="29" r="17" fill="url(#eco-leaf-g)"/>
      <circle class="t-c t-c4" cx="34" cy="23" r="4.5" fill="#fff" opacity=".35"/>
    </g>
    <g transform="translate(24 40)"><path class="lf lf1" d="${ECO_LEAF}" fill="#41CF7E"/></g>
    <g transform="translate(52 38)"><path class="lf lf2" d="${ECO_LEAF}" fill="#2BB366"/></g>
    <g transform="translate(43 22)"><path class="lf lf3" d="${ECO_LEAF}" fill="#6BE09C"/></g>
    <g transform="translate(31 48)"><path class="lf lf4" d="${ECO_LEAF}" fill="#34C26F"/></g>
    <path class="spk spk1" d="M66 12l1.6 3.9 3.9 1.6-3.9 1.6L66 23l-1.6-3.9-3.9-1.6 3.9-1.6Z" fill="#FFD84D"/>
    <path class="spk spk2" d="M13 22l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1Z" fill="#8FE3B0"/>
  </svg></div>`;
  if (kind === 'phone') return `<div class="${cls}" aria-hidden="true"><svg viewBox="0 0 80 80">
    <defs><linearGradient id="eco-bat-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#16A34A"/><stop offset="1" stop-color="#6EE7A0"/></linearGradient></defs>
    <ellipse cx="40" cy="74" rx="17" ry="3" fill="rgba(20,60,120,.16)"/>
    <g class="p-body">
      <rect x="23" y="7" width="34" height="64" rx="8" fill="#1E2A44"/>
      <rect x="26" y="12" width="28" height="54" rx="4.5" fill="#0E1729"/>
      <rect x="35" y="9" width="10" height="1.8" rx=".9" fill="#3A4A6B"/>
      <rect x="31.5" y="22" width="17" height="34" rx="3.5" fill="none" stroke="#8FA3C2" stroke-width="2"/>
      <rect x="36.5" y="18.6" width="7" height="3" rx="1.2" fill="#8FA3C2"/>
      <rect class="p-fill" x="34" y="24.5" width="12" height="29" rx="2" fill="url(#eco-bat-g)"/>
      <path class="p-bolt" d="M41.4 28.5 35.6 40h4.3l-1.5 9.2L45 37.2h-4.4Z" fill="#FFE066" stroke="#D49A06" stroke-width=".7" stroke-linejoin="round"/>
    </g>
    <circle class="pp pp1" cx="16" cy="54" r="2.4" fill="#4ADE80"/>
    <circle class="pp pp2" cx="64" cy="46" r="2" fill="#22C55E"/>
    <path class="pp pp3" d="M65 60h5M67.5 57.5v5" stroke="#4ADE80" stroke-width="1.8" stroke-linecap="round"/>
    <path class="pp pp4" d="M11 38h4M13 36v4" stroke="#86EFAC" stroke-width="1.6" stroke-linecap="round"/>
  </svg></div>`;
  return '';
}
function routeCardHTML(r, selected, baseEm) {
  const open = state.openDetail === r.id;
  const kind = saveSense(r.saving).kind;
  const art = selected && kind !== 'none';
  const play = selected && state.ecoPlayed !== r.id; // 막 고른 카드만 등장 효과 (전체 안내 열기 등으로 다시 그려질 땐 그대로)
  if (selected) state.ecoPlayed = r.id;
  if (play) setTimeout(() => runCounters(), 0); // 화면에 붙은 다음 숫자를 올려요
  return `<article class="rcard ${selected ? 'sel' : ''}${art ? ' has-art' : ''}" data-act="select" data-id="${r.id}" aria-selected="${selected}">
    ${art ? ecoArtHTML(kind, play) : ''}
    <div class="rc-top">
      ${(r.badges || []).map((b) => `<span class="rc-badge">${b}</span>`).join('')}
      ${r.real === true ? '' : `<span class="rc-est">${r.real === 'partial' ? '자동차 구간 추정' : '추정'}</span>`}
    </div>
    <div class="rc-main">
      <span class="rc-min num">${formatMin(r.minutes)}</span>
      <span class="rc-sub">${arriveText(r.minutes)}${r.fare > 0 ? ` · ${r.fare.toLocaleString()}원` : ''}</span>
    </div>
    ${ecoHTML(r, play)}
    ${timeBarHTML(r)}
    ${selected ? `${legsHTML(r)}
    <div class="rc-actions">
      <button type="button" class="link-like" data-act="detail" data-id="${r.id}" aria-expanded="${open}">${open ? '접기' : '전체 안내 보기'} ›</button>
      <button type="button" class="btn primary small go" data-act="start-nav" data-id="${r.id}">안내 시작</button>
    </div>` : ''}
    ${open ? `<ol class="detail">${r.steps.map((s) => `<li style="--c:${s.color || MODES[s.mode].color}"><strong>${esc(s.text)}</strong>${s.sub ? `<span>${esc(s.sub)}</span>` : ''}</li>`).join('')}</ol>` : ''}
  </article>`;
}
// 자동차로 갈 때와 비교: 지금 고른 절약 단계(조금·중간·많이)의 경로만, 위 경로 카드와 같은 순서로 보여줘요
//  - "혼자 자동차로 가면 OOkg" 을 기준으로, 경로마다 아끼는 탄소 kg + 나무 몇 그루 심은 효과
//  - 막대가 길수록 많이 아껴요 (자동차 배출량 대비 %)
function cmpKg(g) {
  const kg = g / 1000;
  return kg >= 100 ? `${Math.round(kg)}kg` : kg >= 1 ? `${kg.toFixed(1)}kg` : `${Math.round(g)}g`;
}
function compareHTML(options, baseline, chosenId, tier) {
  if (!options.length) return '';
  const base = baseline.emission;
  return `<details class="compare cmp2" ${state.cmpOpen ? 'open' : ''}>
    <summary class="label">${tier.sky} ${esc(tier.label)} 경로 ${options.length}개, 자동차보다 얼마나 아낄까요?</summary>
    <div class="cmp-base">
      <span class="cmp-base-ic" aria-hidden="true">${MI.car}</span>
      <div><b>혼자 자동차로 가면 CO₂ ${cmpKg(base)}</b><small>이 양을 기준으로 얼마나 덜 나오는지 비교해요</small></div>
    </div>
    <ul>${options.map((r, i) => {
      const pct = Math.max(0, Math.min(100, r.savingPct));
      const saved = Math.max(0, r.saving);
      return `<li class="cmp-row ${r.id === chosenId ? 'me' : ''}">
        <span class="cmp-name"><i class="cmp-no num">${i + 1}</i>${esc(r.name)}${r.id === chosenId ? '<em>선택</em>' : ''}</span>
        <span class="cmp-save num">−${cmpKg(saved)}</span>
        <span class="cmp-track"><span class="cmp-bar" style="width:${pct.toFixed(1)}%"></span></span>
        <span class="cmp-sub">${saveSense(saved).icon} ${saveSense(saved).text}</span>
        <span class="cmp-pct num">${Math.round(pct)}% 줄여요</span>
      </li>`;
    }).join('')}</ul>
    <p class="cmp-note">막대가 길수록 탄소를 많이 아껴요 · 나무 1그루는 1년에 CO₂ 약 9.8kg을 흡수해요</p>
  </details>`;
}
// "CO₂ 1kg은 얼마나?" — 단위 자체를 처음 보는 사람을 위한 설명
function kgGuideHTML() {
  const items = [...senseList(1000), { icon: MI.car, text: `혼자 자동차로 약 ${(1000 / FACTORS.car).toFixed(1)}km 달릴 때 나오는 양` }];
  return `<details class="kgguide">
    <summary>ⓘ CO₂ 1kg은 얼마나 될까요?</summary>
    <ul>${items.map((s) => `<li><span aria-hidden="true">${s.icon}</span>${esc(s.text)}</li>`).join('')}</ul>
    <p class="source">${EQUIV_SOURCE}</p>
  </details>`;
}
// 색깔 뜻 (경로 막대의 색이 어떤 이동 수단인지) — 지금 보이는 경로에 있는 수단만
const LEGEND = [
  { mode: 'walk', label: '도보', sw: 'walk' },
  { mode: 'bus', label: '버스', sw: 'bus', title: '초록 지선 · 파랑 간선 · 빨강 광역' },
  { mode: 'subway', label: '지하철', sw: 'subway', title: '호선마다 노선 색' },
  { mode: 'bike', label: '자전거', sw: 'bike' },
  { mode: 'car', label: '자동차', sw: 'car' },
];
function legendHTML(options) {
  const used = new Set();
  (options || []).forEach((r) => (r.segments || []).forEach((sg) => used.add(sg.mode)));
  const items = LEGEND.filter((l) => (used.size ? used.has(l.mode) : ['walk', 'bus', 'subway'].includes(l.mode)));
  return `<ul class="legend" aria-label="색깔 뜻">${items.map((l) => `<li${l.title ? ` title="${l.title}"` : ''}><i class="sw sw-${l.sw}" aria-hidden="true"></i>${l.label}</li>`).join('')}</ul>`;
}
function resultSheetHTML() {
  const { ranked, options, chosen } = currentPlan();
  const { prefs, level } = state;
  const counts = ranked ? Object.fromEntries(TIERS.map((t) => [t.id, ranked.byTier[t.id].length])) : {};
  const tier = TIERS.find((t) => t.id === level);

  // 절약 강도: 끝이 둥근 바 안에서 색 알약이 하단 바처럼 미끄러져요 (조금 연파랑 · 중간 파랑 · 많이 새파랑)
  const idx = Math.max(0, TIERS.findIndex((t) => t.id === level));
  const fromIdx = TIERS.findIndex((t) => t.id === state.levelFrom);
  state.levelFrom = null; // 한 번만 움직이고, 다시 그릴 때는 제자리
  const tabs = `<div class="stabs-wrap">
    <p class="stabs-h">절약 강도</p>
    <div class="stabs lv-${level}" role="tablist" style="--i:${idx}">
      <span class="stab-ind ${fromIdx >= 0 && fromIdx !== idx ? `slide from-${TIERS[fromIdx].id}` : ''}" style="--from:${fromIdx >= 0 ? fromIdx : idx}" aria-hidden="true"></span>
      ${TIERS.map((t) => `<button type="button" role="tab" aria-selected="${level === t.id}" class="stab s-${t.id} ${level === t.id ? 'on' : ''}" data-act="tab" data-id="${t.id}">
        <span class="stab-sky" aria-hidden="true">${t.sky}</span>${t.label.replace(' 절약', '')}<small class="num">${counts[t.id] != null ? counts[t.id] : ''}</small></button>`).join('')}
    </div>
  </div>`;

  const filters = `<div class="filters">
    <select id="sort" class="fsel" aria-label="정렬">${SORTS.map((s) => `<option value="${s.id}" ${prefs.sort === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
    ${legendHTML(options)}
  </div>`;

  let list;
  if (state.loading) list = '<p class="loading"><span class="spinner" aria-hidden="true"></span>실제 경로를 찾는 중이에요…</p>';
  else if (!options.length) list = `<p class="empty">이 구간에는 ${tier.label} 경로가 없어요. 다른 절약 단계를 눌러 보세요.</p>`;
  else list = options.map((r) => routeCardHTML(r, chosen && r.id === chosen.id, ranked.baseline.emission)).join('');

  const ct = campTripCamp();
  if (ct) {
    const m = campModeOf(state.campTrip.mode);
    if (!state.loading && !options.length) list = `<p class="empty">이 구간에는 ${m.label}로 가는 길이 없어요.${m.id === 'bike' ? '' : ' 출발지나 도착지를 바꿔 보세요.'}</p>`;
    const far = m.id === 'bike' && options[0] && options[0].km > 15;
    return `
    ${campTripBanner(ct, true)}
    <p class="camp-only">${m.icon}<span><b>${m.label}</b>로 가는 길만 보여요 · 도착하면 아낀 탄소가 캠페인에 더해져요</span></p>
    ${far ? '<p class="notice warn small">15km가 넘는 먼 거리예요. 무리하지 말고 쉬어 가며 타세요.</p>' : ''}
    ${filters}
    ${state.notes.map((n) => `<p class="notice warn small">${esc(n)}</p>`).join('')}
    <div class="rlist">${list}</div>
    ${kgGuideHTML()}
    <p class="source">배출계수: ${FACTOR_SOURCE}. 아낀 탄소는 같은 길을 혼자 자동차로 갈 때와 비교했어요.</p>`;
  }
  return `
    ${tabs}
    ${filters}
    ${state.notes.map((n) => `<p class="notice warn small">${esc(n)}</p>`).join('')}
    <div class="rlist">${list}</div>
    ${ranked && !state.loading ? compareHTML(options, ranked.baseline, chosen && chosen.id, tier) : ''}
    ${kgGuideHTML()}
    <p class="source">배출계수: ${FACTOR_SOURCE}. 대중교통·자동차는 실제 경로로, 도보·자전거와 "추정" 표시 구간은 직선거리로 계산했어요.</p>`;
}
function resultHTML() {
  return `<header class="appbar result-bar">
      <button type="button" class="icon-btn" data-act="home" aria-label="뒤로">←</button>
      ${state.ready ? tripBox(true) : `<h1>${esc(state.manualKm)}km 이동</h1>`}
    </header>
    <main class="content flush">
      ${state.ready ? `<div class="map-wrap"><div class="map route" id="map-result"></div>
        <button type="button" class="map-fab" data-act="fit">⤢ 전체경로 보기</button></div>` : ''}
      <div class="rsheet" id="result-sheet">${resultSheetHTML()}</div>
    </main>`;
}
function renderResultSheet() {
  const el = document.getElementById('result-sheet');
  if (el) el.innerHTML = resultSheetHTML();
}

// ── 실시간 안내 ──
// 내비 앱처럼: 위 = 지금 할 일 하나(크게), 가운데 = 지도, 아래 = 남은 시간·도착 시각·종료
// 안내 문구 → 방향 아이콘 (자동차·도보는 회전 방향, 대중교통은 탈것)
const TURN_SVG = {
  straight: '<path d="M24 42V10M12 22 24 10l12 12"/>',
  left: '<path d="M30 42V24a6 6 0 0 0-6-6H10M18 10l-8 8 8 8"/>',
  right: '<path d="M18 42V24a6 6 0 0 1 6-6h14M30 10l8 8-8 8"/>',
  uturn: '<path d="M16 42V18a8 8 0 0 1 16 0v14M24 26l8 8 8-8"/>',
  goal: '<path d="M14 42V8M14 9h20l-5 7 5 7H14"/>',
};
function turnKind(s) {
  const t = String(s.text || '');
  if (/유턴|U턴/.test(t)) return 'uturn';
  if (/좌회전|왼쪽/.test(t)) return 'left';
  if (/우회전|오른쪽/.test(t)) return 'right';
  if (/도착|목적지/.test(t)) return 'goal';
  return 'straight';
}
function turnIconHTML(s) {
  // 회전 안내(자동차 길 안내)만 화살표, 나머지(걷기·타기·내리기·태우기)는 탈것 아이콘
  const isTurn = /좌회전|우회전|유턴|U턴|왼쪽|오른쪽|직진|도착|목적지/.test(s.text || '') || (s.mode === 'car' && !/태워요|주차/.test(s.text || ''));
  if (!isTurn) return `<span class="turn turn-mode" aria-hidden="true">${MODES[s.mode || 'walk'].icon}</span>`;
  return `<svg class="turn" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${TURN_SVG[turnKind(s)]}</svg>`;
}
// "'평촌대로254번길' 방면으로 우회전" → 큰 글자 "우회전" + 작은 글자 "평촌대로254번길 방면"
function splitGuide(text) {
  const t = String(text || '');
  const m = t.match(/'([^']+)'\s*(방면|방향)?/);
  if (!m) return { main: t, road: '' };
  const main = t.replace(/'[^']+'\s*(방면으로|방향으로|방면|방향|으로|로)?\s*/, '').trim();
  return { main: main || t, road: `${m[1]}${m[2] ? ` ${m[2]}` : ''}` };
}
// 내 위치 아이콘 (조준점 모양)
const SVG_LOCATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7.6"/><circle class="dot" cx="12" cy="12" r="3.4"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6"/></svg>';
function navHTML() {
  return `<main class="navx tier-${state.level}">
      <div class="navx-mapbox ${state.ready ? '' : 'empty'}">${state.ready ? '<div class="navx-map" id="map-nav"></div>' : ''}</div>
      <div class="navx-top" id="nav-top"></div>
      <div class="navx-bottom" id="nav-bottom"></div>
    </main>`;
}
function updateNav() {
  const { chosen } = currentPlan();
  if (!chosen) return;
  const steps = chosen.steps;
  const s = steps[state.step] || {};
  const next = steps[state.step + 1];
  const last = state.step >= steps.length - 1;
  const me = state.me;
  const mode = s.mode || 'walk';
  const color = s.color || MODES[mode].color;

  // 다음 지점까지 거리: GPS가 있으면 실제 거리, 없으면 안내 문구의 "37m 앞"
  const toTarget = me && s.target ? distM(me, s.target) : null;
  const subDist = /^([\d.,]+\s*k?m)\s*앞$/.exec(s.sub || '');
  const dist = toTarget != null ? formatM(toTarget) : subDist ? subDist[1] : '';
  const g = splitGuide(s.text);
  const sub = [g.road, subDist ? '' : s.sub].filter(Boolean).join(' · ');

  // 남은 시간: 남은 거리 비율로 어림
  const total = state.from && state.to ? distM(state.from, state.to) : 0;
  const ratio = me && state.to && total > 0 ? Math.min(1, distM(me, state.to) / total) : 1 - state.step / steps.length;
  const remMin = Math.max(1, Math.round(chosen.minutes * ratio));
  const remKm = me && state.to ? formatM(distM(me, state.to) * ROAD_FACTOR) : '';
  const link = kakaoLink(chosen.kakaoMode, me ? { name: '내 위치', lat: me.lat, lng: me.lng } : state.from, state.to);
  const manual = !me; // GPS가 없을 때만 "다음" 버튼
  const canArrive = nearDest(); // 도착지 30m 안에서만 도착 버튼

  const top = document.getElementById('nav-top');
  if (top) {
    top.innerHTML = `
      <section class="guide" style="--c:${color}" aria-live="polite">
        ${turnIconHTML(s)}
        <div class="guide-txt">
          ${dist ? `<b class="guide-dist num">${esc(dist)}</b>` : ''}
          <p class="guide-main">${esc(g.main)}</p>
          ${sub ? `<p class="guide-sub">${esc(sub)}</p>` : ''}
        </div>
      </section>
      ${next ? `<p class="guide-next">그다음 <b>${esc(splitGuide(next.text).main)}</b></p>` : ''}`;
  }
  const bottom = document.getElementById('nav-bottom');
  if (bottom) {
    bottom.innerHTML = `
      <div class="navx-tools">
        ${link ? `<a class="tool" href="${link}" target="_blank" rel="noopener noreferrer">카카오맵</a>` : '<span></span>'}
        ${state.ready ? `<button type="button" class="locate-btn ${state.follow ? 'on' : ''}" data-act="follow" aria-pressed="${state.follow}" aria-label="${state.follow ? '내 위치 따라가는 중' : '내 위치로 이동'}">${SVG_LOCATE}</button>` : ''}
      </div>
      ${state.gpsMsg ? `<p class="navx-toast">${esc(state.gpsMsg)}</p>` : ''}
      <div class="navx-bar">
        <button type="button" class="navx-end" data-act="nav-end" aria-label="안내 종료">✕</button>
        <div class="navx-eta">
          <b class="num">${formatMin(remMin)}</b>
          <span>${arriveText(remMin)}${remKm ? ` · ${remKm}` : ''}</span>
          <small>${impact(chosen.saving).icon} ${impact(chosen.saving).short}</small>
        </div>
        ${manual && !last ? '<button type="button" class="btn navx-next" data-act="nav-next">다음 ›</button>' : ''}
        ${canArrive ? `<button type="button" class="navx-arrive ${state.campTrip ? 'camp' : ''}" data-act="arrive">${state.campTrip ? '참여 완료' : '도착'}</button>` : ''}
      </div>`;
  }
  tourPaint();
}

// ── 도착 ──
// ── 나무·숲 일러스트 (도착 화면) ──
//  둥근 잎 덩어리 여러 겹 + 갈색 줄기 (플랫 일러스트)
const TREE_PAL = [
  { back: '#9BD45A', mid: '#A9DE5F', front: '#B6E66A', shade: '#93CC52' }, // 연두
  { back: '#86C44F', mid: '#97D056', front: '#A6DA60', shade: '#7FBA48' }, // 초록
  { back: '#A5D95E', mid: '#B3E168', front: '#C2EA78', shade: '#9BCF57' }, // 밝은 연두
];
// x: 줄기 가운데, y: 땅, s: 크기(1 = 높이 약 150), p: 색 번호
function oneTreeSVG(x, y, s, p = 0) {
  const c = TREE_PAL[p % TREE_PAL.length];
  const S = (n) => (n * s).toFixed(1);
  const X = (n) => (x + n * s).toFixed(1);
  const Y = (n) => (y - n * s).toFixed(1);
  const blob = (cx, cy, r, f) => `<circle cx="${X(cx)}" cy="${Y(cy)}" r="${S(r)}" fill="${f}"/>`;
  return `<g>
    <path d="M${X(-7)} ${Y(0)} C${X(-6)} ${Y(30)} ${X(-5)} ${Y(55)} ${X(-9)} ${Y(78)} L${X(-3)} ${Y(80)} C${X(-1)} ${Y(70)} ${X(0)} ${Y(64)} ${X(2)} ${Y(60)} C${X(6)} ${Y(66)} ${X(12)} ${Y(74)} ${X(16)} ${Y(82)} L${X(21)} ${Y(79)} C${X(14)} ${Y(66)} ${X(8)} ${Y(56)} ${X(7)} ${Y(42)} C${X(6)} ${Y(28)} ${X(7)} ${Y(12)} ${X(9)} ${Y(0)} Z" fill="#C9A27E"/>
    <path d="M${X(1)} ${Y(0)} C${X(1)} ${Y(16)} ${X(0)} ${Y(34)} ${X(2)} ${Y(56)} C${X(4)} ${Y(42)} ${X(5)} ${Y(22)} ${X(9)} ${Y(0)} Z" fill="#D8B896"/>
    ${blob(-30, 92, 30, c.back)}${blob(30, 92, 30, c.back)}${blob(0, 118, 34, c.back)}
    ${blob(-38, 76, 20, c.back)}${blob(38, 76, 20, c.back)}${blob(-14, 132, 22, c.back)}${blob(16, 134, 20, c.back)}
    ${blob(-18, 98, 24, c.mid)}${blob(18, 102, 25, c.mid)}${blob(0, 120, 24, c.mid)}
    ${blob(-24, 84, 15, c.front)}${blob(-6, 92, 17, c.front)}${blob(14, 110, 16, c.front)}${blob(26, 88, 14, c.front)}
    ${blob(-34, 72, 10, c.shade)}${blob(34, 70, 11, c.shade)}
  </g>`;
}
// 도착 화면 그림: 1그루 미만~2그루 미만 → 1그루, 2·3·4·5그루, 6그루 이상 → 숲
function treeSceneSVG(trees) {
  const n = Math.floor(trees);
  const W = 320, H = 210, G = 196;
  const ground = `<ellipse cx="160" cy="${G + 2}" rx="150" ry="10" fill="#D8ECC2" opacity=".8"/>`;
  let body = '';
  if (n >= 6) return forestSVG();
  if (n <= 1) body = oneTreeSVG(160, G, 1.15, 0);
  else if (n === 2) body = oneTreeSVG(115, G, .95, 1) + oneTreeSVG(205, G, 1.08, 0);
  else {
    // 3~5그루: 뒤에 작은 나무, 가운데 앞에 큰 나무 (보내준 그림처럼 겹치게)
    const mid = [[96, .86, 1], [226, .86, 1]];
    const far = [[50, .62, 2], [272, .62, 2]];
    const order = n === 3 ? mid : n === 4 ? [far[0], ...mid] : [...far, ...mid]; // 작은(먼) 나무부터 그려서 뒤로
    body = order.map(([x, s, p]) => oneTreeSVG(x, G, s, p)).join('') + oneTreeSVG(160, G, n >= 4 ? 1.02 : 1.12, 0);
  }
  return `<svg class="tree-scene" viewBox="0 0 ${W} ${H}" role="img" aria-label="나무 ${n || 1}그루">${ground}${body}</svg>`;
}
// 6그루 이상: 숲 (뾰족한 침엽수 + 둥근 나무 + 덤불 + 꽃 + 풀밭)
function forestSVG() {
  const pine = (x, y, h, w, f, dot) => {
    const tiers = [0, .3, .58].map((t, i) => {
      const top = y - h + h * t; const bw = w * (0.62 + i * 0.2);
      return `<path d="M${x} ${top} L${x + bw / 2} ${top + h * .42} L${x + bw * .3} ${top + h * .42} L${x + bw * .5} ${top + h * .48} L${x - bw * .5} ${top + h * .48} L${x - bw * .3} ${top + h * .42} L${x - bw / 2} ${top + h * .42} Z" fill="${f}"/>`;
    }).join('');
    const dots = Array.from({ length: 14 }, (_, i) => {
      const yy = y - h * .85 + (i * 37 % 100) / 100 * h * .78; const span = (yy - (y - h)) / h * w * .4;
      const xx = x + (((i * 53) % 100) / 100 - .5) * span;
      return `<path d="M${xx.toFixed(1)} ${yy.toFixed(1)} v4" stroke="${dot}" stroke-width="1.6" stroke-linecap="round"/>`;
    }).join('');
    return `<g><rect x="${x - 3}" y="${y - h * .12}" width="6" height="${h * .12}" fill="#8C5A2E"/>${tiers}${dots}</g>`;
  };
  const round = (x, y, s, f, trunk, branch) => `<g>
    <rect x="${x - 3.5 * s}" y="${y - 70 * s}" width="${7 * s}" height="${70 * s}" rx="${2 * s}" fill="${trunk}"/>
    <circle cx="${x}" cy="${y - 92 * s}" r="${26 * s}" fill="${f}"/><circle cx="${x - 20 * s}" cy="${y - 72 * s}" r="${20 * s}" fill="${f}"/>
    <circle cx="${x + 20 * s}" cy="${y - 72 * s}" r="${20 * s}" fill="${f}"/><circle cx="${x}" cy="${y - 62 * s}" r="${22 * s}" fill="${f}"/>
    ${branch ? `<path d="M${x} ${y - 30 * s} V${y - 108 * s} M${x} ${y - 60 * s} l${-14 * s} ${-16 * s} M${x} ${y - 78 * s} l${13 * s} ${-14 * s} M${x} ${y - 94 * s} l${-9 * s} ${-10 * s}" stroke="${trunk}" stroke-width="${2.2 * s}" stroke-linecap="round" fill="none"/>` : ''}
  </g>`;
  const bush = (x, y, s, f) => `<g><circle cx="${x - 12 * s}" cy="${y - 12 * s}" r="${13 * s}" fill="${f}"/><circle cx="${x + 12 * s}" cy="${y - 12 * s}" r="${13 * s}" fill="${f}"/><circle cx="${x}" cy="${y - 22 * s}" r="${15 * s}" fill="${f}"/><rect x="${x - 2.5 * s}" y="${y - 6 * s}" width="${5 * s}" height="${8 * s}" fill="#8C5A2E"/></g>`;
  const flower = (x, y) => `<g>${[0, 72, 144, 216, 288].map((a) => `<circle cx="${(x + Math.cos(a * Math.PI / 180) * 4).toFixed(1)}" cy="${(y + Math.sin(a * Math.PI / 180) * 4).toFixed(1)}" r="3.4" fill="#F2878B"/>`).join('')}<circle cx="${x}" cy="${y}" r="2.2" fill="#F7D35B"/></g>`;
  const grass = (x, y, f) => `<path d="M${x} ${y} q-2 -9 -7 -12 M${x} ${y} q0 -10 1 -15 M${x} ${y} q3 -8 8 -11" stroke="${f}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  return `<svg class="tree-scene forest" viewBox="0 0 320 210" role="img" aria-label="숲">
    <path d="M6 186 C40 176 80 180 120 178 C170 175 230 180 314 176 L316 204 C260 210 120 206 4 206 Z" fill="#B2D98C"/>
    <circle cx="96" cy="96" r="30" fill="#2F5E45"/><circle cx="196" cy="88" r="26" fill="#2F5E45"/>
    ${pine(40, 188, 130, 70, '#4E9460', '#3C7A4D')}
    ${round(100, 188, 1.15, '#5A9455', '#C27B3E', true)}
    ${pine(160, 192, 172, 110, '#3D7660', '#2D5E4B')}
    ${round(232, 180, 1.05, '#5C9353', '#8C5A2E', false)}
    ${pine(282, 194, 150, 84, '#3D7660', '#2D5E4B')}
    ${round(214, 196, 1.12, '#92BC64', '#9A5A2B', true)}
    ${bush(80, 200, 1.2, '#94BF68')}${bush(152, 200, 1, '#5A9455')}
    ${flower(118, 197)}${flower(180, 201)}${grass(60, 204, '#7FB45E')}${grass(250, 202, '#7FB45E')}${grass(296, 198, '#6EA651')}${grass(18, 200, '#6EA651')}
  </svg>`;
}
// 도착 화면 위쪽 그림: 아낀 양만큼 나무 (1그루 = 1년 동안 CO₂ 9.8kg 흡수)
function treeHeroHTML(g) {
  return `<div class="tree-hero">${treeSceneSVG(Math.max(0, g) / TREE_YEAR_G)}</div>`;
}
// 풍선 그림: 자동차 대신 이 방법을 써서 "하늘로 안 올라간" CO₂를 풍선 개수로 보여줘요.
// 너무 많으면 풍선 1개가 5·10·50개를 뜻하도록 묶어요 (최대 40개만 그림).
function balloonsHTML(g) {
  const n = Math.max(1, Math.round(g / EQUIV.balloonG));
  const unit = [1, 5, 10, 20, 50, 100, 500].find((u) => n / u <= 40) || 1000;
  const count = Math.max(1, Math.round(n / unit));
  const dots = Array.from({ length: count }, (_, i) =>
    `<i style="--d:${(i % 8) * 0.12 + Math.floor(i / 8) * 0.05}s;--x:${((i * 37) % 11) - 5}px"></i>`).join('');
  return `<div class="balloons" role="img" aria-label="풍선 ${n}개 분량">${dots}</div>
    <p class="balloon-cap">CO₂ 풍선 ${n.toLocaleString()}개가 하늘로 안 올라갔어요</p>`;
}
// ── 나의 숲 (도착 화면 아래) ──
//  "지금까지 나무 N그루를 심은 만큼 절약했어요" + 붓으로 칠한 듯한 나무가 새싹부터 다 자란 나무까지 자라는 그림.
//  나무 1그루 = 소나무가 1년 동안 흡수하는 CO₂ 9.8kg. 아직 1그루가 안 되면 모은 만큼만 자란 어린 나무예요.
//  도착 화면에 처음 들어올 때만 자라는 모습 · 숫자 카운터가 나오고, 다시 그려질 땐 다 자란 모습 그대로.
function myTreeSVG(fin) {
  const c = (x, y, r, f) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}"/>`;
  const e = (x, y, rx, ry, f) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${f}" transform="rotate(-16 ${x} ${y})"/>`;
  const dark = [[121, 116, 38, '#3F7744'], [56, 104, 30], [82, 70, 33], [121, 50, 37], [161, 68, 33], [186, 100, 30], [172, 120, 22], [121, 114, 26], [70, 121, 22], [121, 88, 46]]
    .map(([x, y, r, f]) => c(x, y, r, f || '#4C8A4E')).join('');
  const mid = [[62, 98, 24], [87, 63, 26], [123, 43, 28], [157, 61, 26], [179, 95, 24], [119, 86, 36], [94, 105, 20], [150, 104, 20]].map(([x, y, r]) => c(x, y, r, '#5F9D59')).join('');
  const light = [[100, 46, 17, 11], [142, 54, 15, 10], [76, 82, 15, 10], [170, 88, 13, 9], [122, 78, 17, 11], [98, 104, 12, 8], [150, 98, 11, 7]].map(([x, y, rx, ry]) => e(x, y, rx, ry, '#7EB665')).join('');
  const hi = [[106, 38, 9, 5.5], [146, 46, 7, 4.5], [82, 70, 7, 4.5], [124, 68, 8, 5], [62, 96, 6, 4]].map(([x, y, rx, ry]) => e(x, y, rx, ry, '#A7D27F')).join('');
  const leaf = (x, y, n, f) => `<g transform="translate(${x} ${y})"><path class="lf lf${n}" d="${ECO_LEAF}" fill="${f}"/></g>`;
  return `<svg class="mf-tree" viewBox="0 0 240 222" aria-hidden="true">
    <defs>
      <linearGradient id="mf-bark" x1="0" x2="1"><stop offset="0" stop-color="#6E4321"/><stop offset=".45" stop-color="#A8743C"/><stop offset="1" stop-color="#7A4C25"/></linearGradient>
      <filter id="mf-brush" x="-12%" y="-12%" width="124%" height="124%">
        <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="3" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feTurbulence type="fractalNoise" baseFrequency=".075 .11" numOctaves="3" seed="9" result="s"/>
        <feColorMatrix in="s" type="matrix" values="0 0 0 0 .86  0 0 0 0 .96  0 0 0 0 .7  0 0 0 1.1 -.5" result="sl"/>
        <feComposite in="sl" in2="d" operator="in" result="tex"/>
        <feGaussianBlur in="tex" stdDeviation=".6" result="tex2"/>
        <feMerge><feMergeNode in="d"/><feMergeNode in="tex2"/></feMerge>
      </filter>
    </defs>
    <ellipse class="mf-ground" cx="120" cy="209" rx="96" ry="9" fill="#CFE6B4"/>
    <path class="mf-grass" d="M44 209q2-9 6 0M52 209q1-6 4 0M186 209q2-10 6 0M195 209q1-6 4 0M150 211q1-5 3 0" fill="none" stroke="#7DBB5E" stroke-width="2.2" stroke-linecap="round"/>
    <g class="mf-grow" style="--fin:${fin.toFixed(3)}"><g class="mf-sway">
      <g class="mf-trunk">
        <path d="M108 209C112 196 113 176 112 160C111 148 106 138 92 124L87 118C86 116 89 114 91 116L100 125C108 132 113 138 115 140C116 128 114 112 112 100C112 97 116 96 117 99C119 112 121 126 121 138C125 130 132 122 146 108L156 98C158 96 161 98 159 101L150 112C138 126 130 138 127 150C126 166 128 190 134 209Z" fill="url(#mf-bark)"/>
        <path d="M116 200C117 186 116 170 115 156M124 196C123 182 123 168 124 154M119 182C120 176 120 170 119 164" fill="none" stroke="#5E391B" stroke-width="1.2" stroke-linecap="round" opacity=".45"/>
      </g>
      <g class="mf-crown" filter="url(#mf-brush)">
        <g class="mf-l mf-l1">${dark}</g><g class="mf-l mf-l2">${mid}</g><g class="mf-l mf-l3">${light}</g><g class="mf-l mf-l4">${hi}</g>
      </g>
    </g></g>
    <g class="mf-sprout">
      <path d="M120 209V189" stroke="#4E9A4E" stroke-width="2.8" stroke-linecap="round"/>
      <path d="M120 195C110 195 103 189 103 182C112 182 119 187 120 195Z" fill="#6DBE5C"/>
      <path d="M120 191C130 191 138 185 138 177C128 177 121 183 120 191Z" fill="#82CC69"/>
    </g>
    ${leaf(70, 120, 1, '#6DB35E')}${leaf(164, 112, 2, '#5FA255')}${leaf(120, 128, 3, '#86C46A')}${leaf(92, 140, 4, '#6DB35E')}
    <path class="mf-spk s1" d="M206 30l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4Z" fill="#FFD84D"/>
    <path class="mf-spk s2" d="M30 58l1.6 3.8 3.8 1.6-3.8 1.6-1.6 3.8-1.6-3.8-3.8-1.6 3.8-1.6Z" fill="#9BE0B4"/>
    <path class="mf-spk s3" d="M196 150l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3Z" fill="#FFE58A"/>
  </svg>`;
}
function mfKg(g) {
  const kg = g / 1000;
  return kg >= 100 ? `${Math.round(kg).toLocaleString()}kg` : kg >= 1 ? `${kg.toFixed(1)}kg` : `${Math.round(g)}g`;
}
function forestHTML(log) {
  const g = Math.max(0, log.g || 0);
  const trees = Math.floor(g / TREE_YEAR_G);
  const left = TREE_YEAR_G - (g % TREE_YEAR_G);
  const part = ((g % TREE_YEAR_G) / TREE_YEAR_G) * 100;
  const play = !state.mfPlayed; // 도착 화면에 처음 들어왔을 때만 자라는 모습
  state.mfPlayed = true;
  if (play && trees > 0) setTimeout(() => runCounters(document.querySelector('.mf')), 850); // 잎이 피어날 때 숫자도 같이 올라가요
  const fin = trees > 0 ? 1 : 0.42 + 0.58 * (part / 100); // 1그루가 안 되면 모은 만큼만 자란 어린 나무
  const num = trees.toLocaleString();
  const title = trees > 0
    ? `지금까지 나무 <b ${play ? countAttr(trees, 'int') : ''}>${play ? '0' : num}</b>그루를<br>심은 만큼 절약했어요`
    : '첫 번째 나무를<br>키우고 있어요';
  const said = trees > 0 ? `지금까지 나무 ${num}그루를 심은 만큼 절약했어요` : '첫 번째 나무를 키우고 있어요';
  return `<section class="mf${play ? ' play' : ''}" aria-label="${said}. ${log.trips}번 이동, CO₂ 총 ${mfKg(g)} 아낌. 다음 나무까지 ${formatG(left)}">
    <div class="mf-art">${myTreeSVG(fin)}</div>
    <h3 class="mf-title" aria-hidden="true">${title}</h3>
    <p class="mf-sub" aria-hidden="true">${log.trips.toLocaleString()}번 이동 · CO₂ 총 <b>${mfKg(g)}</b> 아낌</p>
    <div class="mf-next" aria-hidden="true">
      <div class="mf-next-top"><span><i>🌱</i> 다음 나무까지</span><b class="num">${formatG(left)}</b></div>
      <div class="mf-bar"><span style="--w:${part.toFixed(1)}%"></span></div>
    </div>
    <p class="mf-hint"><span aria-hidden="true">ⓘ</span>나무 1그루 = 1년 동안 CO₂ 9.8kg 흡수</p>
  </section>`;
}
function doneHTML() {
  const { chosen } = currentPlan();
  const log = state.lastLog || loadLog();
  return `${appBar('도착')}
    <main class="content">
      <div class="done">
        ${state.newTitle ? `<button type="button" class="ttl-new" data-act="open-titles"><span aria-hidden="true">${state.newTitle.icon}</span><span><small>새 칭호를 얻었어요!</small><b>${esc(state.newTitle.name)}</b></span><i>보기 ›</i></button>` : ''}
        ${treeHeroHTML(chosen.saving)}
        <h2>${esc(impact(chosen.saving).long)}</h2>
        <p class="big num">−${formatG(chosen.saving)} <small>CO₂</small></p>
        <p>혼자 자동차로 올 때보다 ${Math.round(chosen.savingPct)}% 줄였어요</p>
        ${state.lastEarn ? `<div class="earn"><b>+${state.lastEarn.total.toLocaleString()}P</b><span>탄소 포인트 · 절약 ${state.lastEarn.kgP}P + 거리 ${state.lastEarn.kmP}P (${state.lastEarn.ecoKm.toFixed(1)}km)</span><button type="button" data-act="open-rank">이달의 랭킹 보기 ›</button></div>` : ''}
      </div>
      ${forestHTML(log)}
    </main>
    ${cta('<button type="button" class="btn primary" data-act="restart">새 경로 찾기</button>')}`;
}

// ── 캠페인 참여 완료 ──
function campDoneHTML() {
  const r = state.campResult;
  const c = r && campStore.load().find((x) => x.id === r.campId);
  if (!r || !c) return `${appBar('캠페인')}<main class="content"><p class="empty">캠페인을 찾지 못했어요.</p></main>${cta('<button type="button" class="btn primary" data-act="go-main">홈으로 돌아가기</button>')}`;
  const m = campModeOf(r.mode);
  const goal = c.goalKg * 1000;
  const prevPct = Math.min(100, (r.beforeG / goal) * 100);
  const nowPct = campPct(c);
  const { me } = campRanking(c);
  return `<main class="content cdone">
      <div class="done">
        ${state.newTitle ? `<button type="button" class="ttl-new" data-act="open-titles"><span aria-hidden="true">${state.newTitle.icon}</span><span><small>새 칭호를 얻었어요!</small><b>${esc(state.newTitle.name)}</b></span><i>보기 ›</i></button>` : ''}
        ${treeHeroHTML(r.g)}
        <span class="cdone-badge">✓ 캠페인 참여 완료</span>
        <h2>${esc(c.title)}</h2>
        <p class="cdone-lead">${m.icon}<span>${m.ro} 도착했어요</span></p>
        <div class="cdone-kg">
          <small>이번에 내가 기여한 탄소</small>
          <b class="num">+${kgText(r.g)}</b>
          <span>${impact(r.g).icon} ${esc(impact(r.g).short)}</span>
        </div>
        <section class="m-card cdone-goal">
          <div class="cdone-goal-top"><p class="m-label">캠페인 목표</p><b class="num">${Math.floor(nowPct)}%</b></div>
          <p class="m-big"><b>${(c.progressG / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}</b> / ${c.goalKg.toLocaleString()} kg</p>
          <div class="m-bar cdone-bar"><span class="cdone-was" style="width:${prevPct.toFixed(2)}%"></span><span class="cdone-add" style="--w:${Math.max(0, nowPct - prevPct).toFixed(2)}%"></span></div>
          <p class="m-note">내 누적 기여 <b>${kgText(c.myG || 0)}</b>${me ? ` · 참여자 중 <b>${me.rank.toLocaleString()}위</b>` : ''}</p>
        </section>
        ${state.lastEarn ? `<div class="earn"><b>+${state.lastEarn.total.toLocaleString()}P</b><span>탄소 포인트 · 절약 ${state.lastEarn.kgP}P + 거리 ${state.lastEarn.kmP}P (${state.lastEarn.ecoKm.toFixed(1)}km)</span></div>` : ''}
      </div>
    </main>
    ${cta('<button type="button" class="btn" data-act="go-main">홈으로 돌아가기</button><button type="button" class="btn primary" data-act="camp-back">캠페인 화면으로 돌아가기</button>')}`;
}

const VIEWS = { shop: shopHTML, help: helpHTML, 'admin-feedback': adminFeedbackHTML, 'admin-users': adminUsersHTML, 'my-camps': myJoinedCampsHTML, campdone: campDoneHTML, titles: titlesHTML, admin: adminHTML, rank: rankHTML, account: accountHTML, campaigns: campaignsHTML, campaign: campaignHTML, 'campaign-new': campaignNewHTML, calendar: calendarHTML, login: loginHTML, verify: verifyHTML, 'email-login': emailLoginHTML, signup: signupHTML, main: mainHTML, home: homeHTML, search: searchHTML, result: resultHTML, nav: navHTML, done: doneHTML };

// 화면 전체 그리기
function render() {
  const app = document.getElementById('app');
  const { chosen } = currentPlan();
  let screen = state.screen;
  if ((screen === 'nav' || screen === 'done') && !chosen) screen = state.screen = 'home';

  if (!state.user && !['login', 'email-login', 'signup', 'verify'].includes(screen)) screen = state.screen = 'login';
  // 아래 탭 바는 탭끼리 오갈 때 지우고 새로 만들지 않고 그대로 둬요.
  //  (새로 만들면 유리 흐림 효과가 매번 다시 계산돼서 휴대폰에서 바가 깜빡이고 덜컥거렸어요)
  const keepNav = app.querySelector(':scope > .m-tabs');
  if (keepNav) keepNav.remove();
  if (screen === 'result' && state.lastRendered !== 'result') state.ecoPlayed = null; // 경로 화면에 새로 들어오면 그림 등장 효과를 다시
  if (screen === 'done' && state.lastRendered !== 'done') state.mfPlayed = false; // 도착 화면에 새로 들어오면 나의 숲 나무가 다시 자라요
  app.innerHTML = VIEWS[screen]();
  app.dataset.screen = screen;
  const newNav = app.querySelector(':scope > .m-tabs');
  if (keepNav && newNav) {
    keepNav.dataset.cur = newNav.dataset.cur;
    keepNav.dataset.from = newNav.dataset.from;
    keepNav.classList.remove('pressing', 'dragging');
    const on = [...newNav.querySelectorAll('.m-tab')].map((t) => t.classList.contains('on'));
    keepNav.querySelectorAll('.m-tab').forEach((t, i) => t.classList.toggle('on', on[i]));
    newNav.replaceWith(keepNav);
  }
  try { initTabBar(); initKgSeg(); } catch (err) { console.warn('[탭 바]', err); }
  if (state.navDir) {
    app.classList.remove('enter-fwd', 'enter-back');
    void app.offsetWidth; // 애니메이션 다시 시작
    app.classList.add(state.navDir === 'back' ? 'enter-back' : 'enter-fwd');
    state.navDir = null;
    clearTimeout(render.enterTimer);
    render.enterTimer = setTimeout(() => app.classList.remove('enter-fwd', 'enter-back'), 320);
  } else {
    app.classList.remove('enter-fwd', 'enter-back');
  }
  if (screen === 'rank' && state.lastRendered !== 'rank') podiumIntro();
  state.lastRendered = screen;
  if (screen === 'calendar') placeCalRing(false);
  if (screen === 'main') bindMain();
  mapCtl = null;

  const homeEl = document.getElementById('map-home');
  const resultEl = document.getElementById('map-result');
  const navEl = document.getElementById('map-nav');
  if (homeEl) {
    mapCtl = createMap(homeEl);
    if (mapCtl) mapCtl.draw(state.from, state.to, straightLine('walk', state.from, state.to), []);
  } else if (resultEl) {
    mapCtl = createMap(resultEl);
    drawChosen();
  } else if (navEl && chosen) {
    mapCtl = createMap(navEl);
    if (mapCtl) { mapCtl.draw(state.from, state.to, chosen.lines, chosen.marks); mapCtl.setMe(state.me, state.follow); }
  }
  if (screen === 'nav') updateNav();
  tourPaint();
}

// 다른 화면으로 이동
const CAMP_TRIP_SCREENS = ['home', 'search', 'result', 'nav', 'titles'];
function go(screen, dir) {
  if (state.screen === 'nav' && screen !== 'nav') stopTracking();
  if (state.campTrip && !CAMP_TRIP_SCREENS.includes(screen)) state.campTrip = null; // 길찾기 밖으로 나가면 캠페인 모드 끝
  state.navDir = dir === undefined ? (screen === state.screen ? null : 'fwd') : dir;
  state.prevScreen = state.screen;
  state.screen = screen;
  render();
  window.scrollTo(0, 0);
  if (screen === 'search') {
    const input = document.getElementById('search-input');
    if (input) input.focus();
  }
}

// 뒤로 가면 나올 화면 (손가락으로 밀기·뒤로 버튼 공통)
function backOf(screen) {
  return {
    titles: state.titlesReturn || 'main', calendar: state.calReturn || 'main', rank: 'main', account: 'main', campaigns: 'main', 'my-camps': 'main', campaign: state.campReturn || 'campaigns', 'campaign-new': state.campNewReturn || 'campaigns', admin: 'account', 'admin-users': 'account', help: 'account', 'admin-feedback': 'account', shop: 'account', home: state.campTrip ? 'campaign' : 'main', campdone: 'campaign', search: state.searchReturn === 'result' ? 'result' : 'home', result: 'home', nav: 'result', done: 'main',
    'email-login': 'login', signup: 'login', verify: 'login',
  }[screen] || null;
}
function goBack(dir) {
  const to = backOf(state.screen);
  if (to) go(to, dir === undefined ? 'back' : dir);
}

// 결과 화면 안에서 바뀔 때 (지도는 그대로, 목록과 경로선만 새로)
function refreshResult() {
  renderResultSheet();
  drawChosen();
  tourPaint();
}

// ---------------------------------------------------------------------
// 9. 버튼·입력 처리
// ---------------------------------------------------------------------
// GPS로 내 위치 따라가기 + 화면 꺼짐 방지
function startTracking() {
  if (!navigator.geolocation) {
    state.gpsMsg = '이 브라우저는 위치 확인을 지원하지 않아요. 다음 버튼으로 넘겨 주세요.';
    return;
  }
  state.gpsMsg = '내 위치를 찾는 중이에요…';
  state.watchId = navigator.geolocation.watchPosition(onPosition, () => {
    state.gpsMsg = '위치 권한을 켜면 자동으로 다음 안내로 넘어가요.';
    updateNav();
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { state.wakeLock = l; }).catch(() => {});
}
function stopTracking() {
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  if (state.wakeLock) state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}
// 내 위치가 바뀔 때: 도착 확인, 안내 지점에 가까워지면 다음 단계로
function onPosition(p) {
  if (state.screen !== 'nav') return;
  state.me = { lat: p.coords.latitude, lng: p.coords.longitude };
  state.gpsMsg = '';
  const { chosen } = currentPlan();
  if (!chosen) return;
  if (nearDest(AUTO_ARRIVE_M)) { finishTrip(); return; } // 도착지 10m 안: 자동 도착
  const s = chosen.steps[state.step];
  if (s && s.target && state.step < chosen.steps.length - 1 && distM(state.me, s.target) < (s.radius || 30)) state.step += 1;
  if (mapCtl) mapCtl.setMe(state.me, state.follow);
  updateNav();
}

// 도착: 아낀 양을 내 기록에 한 번만 더하고 도착 화면으로
function finishTrip() {
  const { chosen } = currentPlan();
  if (chosen && !state.recorded) {
    const before = titleOf(loadLog().g).level;
    state.lastLog = saveTrip(chosen.saving);
    const after = titleOf(state.lastLog.g);
    state.newTitle = after.level > before ? after : null;
    state.lastEarn = tripPoints(chosen);
    addPoints(state.lastEarn.total);
    if (state.campTrip) {
      const g = Math.max(0, chosen.saving);
      const res = addSavingToCampaign(state.campTrip.campId, g);
      state.campResult = res ? { campId: state.campTrip.campId, mode: state.campTrip.mode, g, beforeG: res.beforeG } : null;
    }
    // 서버 DB: 이동을 저장하고(인터넷이 끊겨도 모아 뒀다가 다음에) 서버 기록으로 맞춰요
    if (dbMode() && state.user && state.user.uid) { queueTrip(chosen); syncFromServer({ quiet: true }); }
    state.recorded = true;
  }
  if (state.campTrip && state.campResult) { state.campId = state.campResult.campId; go('campdone'); return; }
  go('done');
}

// 현재 위치에서 출발
//  휴대폰은 실내에서 정확한 GPS(고정밀)를 잡는 데 오래 걸려 10초 안에 실패하는 일이 많았어요.
//  그래서 ① 최근(1분 안) 위치가 있으면 바로 쓰고 ② 고정밀로 8초 → 안 되면 ③ 와이파이·기지국 위치로 다시 찾아요.
//  주소 변환(역지오코딩)이 응답을 안 줘도 4초 뒤엔 그냥 '내 위치'로 진행해요.
let myLocSeq = 0;
function useMyLocation() {
  const s = state.search;
  const seq = ++myLocSeq;
  if (!navigator.geolocation) { s.message = '이 브라우저는 위치 확인을 지원하지 않아요. 장소를 검색해 주세요.'; return render(); }
  if (window.isSecureContext === false) { s.message = '보안 연결(https) 주소에서만 현재 위치를 쓸 수 있어요.'; return render(); }
  s.message = '현재 위치를 찾는 중이에요…';
  render();
  const still = () => seq === myLocSeq && state.screen === 'search' && state.search.which === 'from';
  const fail = (e) => {
    if (!still()) return;
    const code = e && e.code;
    s.message = code === 1
      ? '위치 권한이 꺼져 있어요. 휴대폰 설정에서 이 브라우저의 위치 권한을 "허용"으로 바꾼 뒤 다시 눌러 주세요. (아이폰: 설정 → 개인정보 보호 및 보안 → 위치 서비스 → Safari 웹 사이트 / Chrome)'
      : '현재 위치를 잡지 못했어요. 창가나 밖에서 다시 눌러 보거나, 장소를 검색해 주세요.';
    render();
  };
  const got = (pos) => {
    if (!still()) return;
    const lat = pos.coords.latitude; const lng = pos.coords.longitude;
    const addr = state.places && state.places.reverse
      ? Promise.race([
        Promise.resolve().then(() => state.places.reverse(lat, lng)).catch(() => ''),
        new Promise((r) => setTimeout(() => r(''), 4000)),
      ])
      : Promise.resolve('');
    addr.then((address) => { if (still()) { s.message = ''; pickPlace({ name: '내 위치', address: address || '', lat, lng }); } });
  };
  navigator.geolocation.getCurrentPosition(got, (e) => {
    if (e && e.code === 1) return fail(e); // 권한 거부는 다시 물어봐도 같아요
    if (!still()) return;
    navigator.geolocation.getCurrentPosition(got, fail, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
}

function pickPlace(place) {
  // 도로명주소 결과는 좌표가 없어서 먼저 위치를 찾아요
  if (place.needsCoords) {
    state.search.message = '위치를 찾는 중이에요…';
    render();
    state.places.locate(place)
      .then((pos) => pickPlace({ name: place.name, address: place.address, lat: pos.lat, lng: pos.lng }))
      .catch((err) => { state.search.message = err.message; render(); });
    return;
  }
  if (state.search.which === 'from') state.from = place;
  else state.to = place;
  rememberPlace(place);
  findRoutes();
  // 결과 화면에서 바꾸러 왔으면 결과로, 아니면 홈으로 (둘 다 정해지면 바로 결과로)
  go(state.searchReturn === 'result' || (state.from && state.to) ? 'result' : 'home');
}

// 검색: 글자를 칠 때마다 자동으로(0.2초 쉬면) 찾아요. 늦게 온 예전 결과는 버려요.
let searchSeq = 0;
let searchTimer = null;
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
}
function runSearch() {
  clearTimeout(searchTimer);
  const s = state.search;
  const q = s.query.trim();
  const seq = ++searchSeq;
  if (!q) { s.results = []; s.message = ''; s.busy = false; return renderSearchOut(); }
  if (!state.places) { s.message = '지도와 검색을 불러오는 중이에요…'; return renderSearchOut(); }
  s.busy = true;
  renderSearchOut();
  state.places.search(q)
    .then((list) => {
      if (seq !== searchSeq) return; // 그 사이 글자가 바뀜
      s.results = list;
      s.message = list.length ? '' : state.places.byName
        ? '검색 결과가 없어요. 이름을 조금 다르게 적어 보세요.'
        : '검색 결과가 없어요. 주소로 검색해 보세요. (예: 세종대로 110)';
    })
    .catch((err) => { if (seq === searchSeq) { s.results = []; s.message = err.message; } })
    .finally(() => { if (seq === searchSeq) { s.busy = false; renderSearchOut(); } });
}

function openSearch(which) {
  state.searchReturn = state.screen;
  state.search = { which, query: '', results: [], message: '', busy: false };
  go('search');
}

// 로그인 처리 (성공하면 기억하고 홈으로)
function keepLoginDraft() {
  const f = document.getElementById('login-form');
  if (!f) return;
  const fd = new FormData(f);
  state.auth = { ...state.auth, draft: { email: String(fd.get('email') || ''), remember: !!fd.get('remember') } };
}
function runAuth(promise, draft) {
  state.auth = { busy: true, message: '', draft: draft || {} };
  render();
  promise
    .then((user) => {
      if (user && user.needCode) { openVerify(user, draft); return; }
      loggedIn(user, !draft || draft.remember !== false);
    })
    .catch((err) => { state.auth = { busy: false, message: err.message || '로그인하지 못했어요. 다시 시도해 주세요.', draft: draft || {} }; render(); });
}
function loggedIn(user, remember) {
  state.user = user; saveUser(user, remember); state.auth = { busy: false, message: '' }; state.verify = null;
  state.tourActive = false; state.tourAnim = 0;
  go('main');
  syncFromServer().finally(() => setTimeout(showCampNotices, 300)); // 서버 DB가 있으면 내 기록을 받아 와요
}
// ── 이메일 인증 코드 입력 ──
//  가입 · 새 기기 로그인 때 메일로 받은 6자리를 넣어요. 로그인 유지를 켜면 이 기기는 다음부터 코드 없이.
function openVerify(r, draft) {
  const now = Date.now();
  state.verify = { ticket: r.ticket, email: r.email, purpose: r.purpose, demoCode: r.demoCode || '', remember: !draft || draft.remember !== false,
    expiresAt: now + (r.expiresIn || 600) * 1000, resendAt: now + (r.resendIn || 60) * 1000, busy: false, message: '', code: '' };
  state.auth = { busy: false, message: '', draft: draft || {} };
  go('verify');
  setTimeout(() => { const i = document.getElementById('vf-code'); if (i) i.focus(); renderVerifyMsg(); }, 50);
}
async function postCode(body) {
  try {
    const res = await fetch('/api/auth/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch (e) { /* 무시 */ }
    return { status: res.status, data };
  } catch (e) { return { status: 0, data: { error: '인터넷 연결을 확인해 주세요.' } }; }
}
async function submitVerify() {
  const v = state.verify;
  if (!v || v.busy || v.dead) return;
  const code = String(v.code || '').replace(/\D/g, '');
  if (code.length !== 6) { v.message = '6자리 숫자를 모두 입력해 주세요.'; return renderVerifyMsg(); }
  v.busy = true; renderVerifyMsg();
  const r = await postCode({ a: 'verify', ticket: v.ticket, code, remember: v.remember });
  v.busy = false;
  if (r.status === 200 && r.data.user) return loggedIn(r.data.user, v.remember);
  v.message = r.data.error || '확인하지 못했어요. 다시 시도해 주세요.';
  v.dead = !!(r.data.expired || r.data.restart);
  v.restart = !!r.data.restart;
  v.code = '';
  const inp = document.getElementById('vf-code'); if (inp) { inp.value = ''; if (!v.dead) inp.focus(); }
  renderVerifyMsg();
}
async function resendCode() {
  const v = state.verify;
  if (!v || v.busy || Date.now() < v.resendAt) return;
  v.busy = true; renderVerifyMsg();
  const r = await postCode({ a: 'resend', ticket: v.ticket });
  v.busy = false;
  if (r.status === 200 && r.data.ticket) {
    const now = Date.now();
    Object.assign(v, { ticket: r.data.ticket, demoCode: r.data.demoCode || '', expiresAt: now + (r.data.expiresIn || 600) * 1000, resendAt: now + (r.data.resendIn || 60) * 1000, message: '', dead: false, code: '' });
    render(); renderVerifyMsg(); toast('인증 코드를 새로 보냈어요');
    const i = document.getElementById('vf-code'); if (i) i.focus();
    return;
  }
  if (r.data.wait) v.resendAt = Date.now() + r.data.wait * 1000;
  v.message = r.data.error || '코드를 다시 보내지 못했어요.';
  v.restart = !!r.data.restart;
  renderVerifyMsg();
}
// 화면 전체를 다시 그리지 않고 안내 문구·타이머·버튼만 바꿔요 (입력 중인 칸이 지워지지 않게)
function renderVerifyMsg() {
  const v = state.verify; if (!v) return;
  const m = document.querySelector('.vf-msg'); if (m) m.textContent = v.message || '';
  const btn = document.querySelector('#verify-form [type="submit"]');
  if (btn) { btn.disabled = !!v.busy || !!v.dead; btn.innerHTML = v.busy ? '<span class="lg-spin"></span>' : '확인'; }
  const left = Math.max(0, Math.round((v.expiresAt - Date.now()) / 1000));
  const t = document.querySelector('.vf-timer');
  if (t) { t.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '시간 초과'; t.classList.toggle('over', left <= 0); }
  const rs = document.querySelector('[data-act="code-resend"]');
  const wait = Math.max(0, Math.ceil((v.resendAt - Date.now()) / 1000));
  if (rs) { rs.disabled = wait > 0 || !!v.busy || !!v.restart; rs.textContent = wait > 0 ? `코드 다시 받기 (${wait}초)` : '코드 다시 받기'; }
  const re = document.querySelector('.vf-restart'); if (re) re.hidden = !v.restart;
  // 6칸에 숫자를 하나씩 보여 주고, 다음에 넣을 칸을 표시해요
  const code = v.code || '';
  const focused = document.activeElement && document.activeElement.id === 'vf-code';
  document.querySelectorAll('.vf-cells i').forEach((c, i) => {
    c.textContent = code[i] || '';
    c.classList.toggle('fill', !!code[i]);
    c.classList.toggle('cur', focused && i === Math.min(code.length, 5) && !v.dead);
  });
  const box = document.querySelector('.vf-box'); if (box) box.classList.toggle('bad', !!v.message && !v.busy);
}
setInterval(() => { if (state.screen === 'verify') renderVerifyMsg(); }, 1000);
['focusin', 'focusout'].forEach((ev) => document.addEventListener(ev, (e) => { if (e.target && e.target.id === 'vf-code') setTimeout(renderVerifyMsg, 0); }));
function verifyHTML() {
  const v = state.verify;
  if (!v) return loginHTML();
  const what = v.purpose === 'signup' ? '회원가입' : '로그인';
  return `<main class="lg vf">
    <div class="lg-wrap">
      <header class="lg-head">
        <button type="button" class="vf-back" data-act="to-login" aria-label="뒤로">${ICON.chev}</button>
        <div class="lg-brand"><span class="lg-mark"><span class="brand-mark" aria-hidden="true"></span></span><span><b>푸른하늘</b></span></div>
      </header>
      <section class="lg-hero vf-hero">
        <span class="vf-icon" aria-hidden="true">${SVG_MAIL}</span>
        <p>${what} 이메일 인증</p>
        <h1>메일로 받은<br>6자리 코드를 입력해 주세요</h1>
      </section>
      <section class="lg-card">
        <p class="vf-to"><b>${esc(v.email)}</b> 으로 인증 코드를 보냈어요.<small>메일이 안 보이면 스팸함도 확인해 주세요.</small></p>
        ${v.demoCode ? `<p class="vf-demo">메일 발송 설정 전이라 화면에 보여 줘요 (시연용) · 코드 <b>${esc(v.demoCode)}</b></p>` : ''}
        <form id="verify-form" novalidate>
          <label class="vf-box" aria-label="인증 코드 6자리">
            <input id="vf-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" value="${esc(v.code || '')}">
            <span class="vf-cells" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<i>${esc((v.code || '')[i] || '')}</i>`).join('')}</span>
          </label>
          <p class="vf-row"><span>남은 시간 <b class="vf-timer"></b></span><button type="button" class="lg-link" data-act="code-resend"></button></p>
          <p class="lg-err vf-msg" role="alert">${esc(v.message || '')}</p>
          <button type="submit" class="lg-btn lg-primary">확인</button>
          <label class="vf-keep"><input type="checkbox" id="vf-remember" ${v.remember ? 'checked' : ''}>
            <span><b>로그인 유지</b><small>이 기기에서는 다음부터 인증 코드 없이 바로 로그인돼요. 함께 쓰는 기기라면 꺼 주세요.</small></span></label>
          <button type="button" class="lg-link vf-restart" data-act="to-login" hidden>처음부터 다시 하기</button>
        </form>
      </section>
    </div>
  </main>`;
}
function goAuth(screen) {
  state.auth = { busy: false, message: '' };
  go(screen);
}

// 버튼 클릭 (data-act 값으로 구분)
const actions = {
  'set-theme': (el) => {
    const t = el.dataset.id === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 무시 */ }
    applyTheme(t, true);
    const sw = el.closest('.thm-sw');
    if (sw) { sw.dataset.on = t; sw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === t))); }
  },
  'mascot-hop': (el) => {
    el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop'); setTimeout(() => el.classList.remove('hop'), 700);
    // 누르면 말풍선으로 인사하고 잠시 뒤 사라져요
    const say = document.getElementById('mascot-say');
    if (!say) return;
    say.textContent = '안녕, 난 푸름이야!';
    say.classList.remove('show'); void say.offsetWidth; say.classList.add('show');
    clearTimeout(say._t); say._t = setTimeout(() => say.classList.remove('show'), 2600);
  },
  'login-kakao': () => {
    const box = document.querySelector('#login-form [name="remember"]');
    const remember = box ? box.checked : true;
    try { sessionStorage.setItem('pureun-remember', remember ? '1' : '0'); } catch (e) { /* 무시 */ }
    runAuth(AUTH.kakao(remember), { remember });
  },
  'login-lang': (el) => { state.loginLang = el.dataset.id; try { localStorage.setItem('bluesky_lang', state.loginLang); } catch (e) { /* 무시 */ } keepLoginDraft(); render(); },
  'toggle-pw': () => {
    state.loginShowPw = !state.loginShowPw;
    const inp = document.querySelector('#login-form [name="pw"]');
    const btn = document.querySelector('.lg-eye');
    if (inp) inp.type = state.loginShowPw ? 'text' : 'password';
    if (btn) { btn.innerHTML = state.loginShowPw ? SVG_EYE_OFF : SVG_EYE; btn.setAttribute('aria-label', LI(state.loginShowPw ? 'hidePw' : 'showPw')); }
  },
  'soon-login': () => toast(LI('soon')),
  'to-email-login': () => goAuth('email-login'),
  'to-signup': () => goAuth('signup'),
  'code-resend': () => resendCode(),
  'to-login': () => { state.auth = { busy: false, message: '' }; go('login', 'back'); },
  home: () => go('home', 'back'),
  back: () => goBack(),
  'open-shop': () => { state.shopTab = 'items'; state.shopCat = 'all'; go('shop'); if (dbMode()) syncFromServer(); },
  'shop-tab': (el) => { state.shopTab = el.dataset.id; render(); },
  'shop-cat': (el) => { state.shopCat = el.dataset.id; render(); },
  'shop-item': (el) => shopBuySheet(el.dataset.id),
  'shop-coupon': (el) => couponSheet(loadOrders().find((o) => String(o.id) === el.dataset.id)),
  'open-route': () => {
    const t = tourStage() === '1';
    if (t) { // 튜토리얼 1 → 2-1: 시연이라 출발지 · 도착지를 안양역 → 강남역으로 넣어 둬요
      state.from = { ...TOUR_FROM }; state.to = { ...TOUR_TO }; state.raw = null; state.chosenId = null; state.tourRouteTry = 0; state.campTrip = null;
      tourGo('2-1');
    }
    go('home');
    if (t && state.ready && !state.loading) { state.tourRouteTry = 1; findRoutes(); }
  },
  'tour-next': () => { // 설명만 있는 단계: 화면을 누르면 다음으로
    const st = tourStage();
    if (st === '4-1') { tourGo('4-go'); tourPaint(); tourSimStart(); return; }
    const next = { '2-1': '2-2', '5-1': '5-2', '5-2': '6' }[st];
    if (next) { tourGo(next); tourPaint(); }
  },
  'tour-nudge': () => { // 어두운 곳을 누르면 눌러야 할 곳이 살짝 흔들려요
    const b = document.querySelector('#app .tour-hl'); if (!b) return;
    b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge'); setTimeout(() => b.classList.remove('nudge'), 520);
  },
  soon: () => toast('준비 중인 기능이에요'),
  reload: () => window.location.reload(),
  profile: () => openProfile(),
  'open-main': () => goTab('main'),
  'open-rank': () => goTab('rank'),
  'open-account': () => goTab('account'),
  logout: () => askLogout(),
  'avatar-reset': () => { if (dbMode()) { dbWrite('profile', { avatar: '' }, '기본 이미지로 바꿨어요'); return; } saveAvatar(''); render(); toast('기본 이미지로 바꿨어요'); },
  'open-camps': () => goTab('campaigns'),
  'open-my-camps': () => { state.campReturn = 'my-camps'; go('my-camps'); },
  'open-camp': (el) => { state.campId = el.dataset.id; state.campReturn = ['main', 'account', 'admin', 'my-camps'].includes(state.screen) ? state.screen : 'campaigns'; go('campaign'); },
  'open-titles': () => { state.titlesReturn = ['account', 'done'].includes(state.screen) ? state.screen : 'main'; go('titles'); },
  'open-admin': () => { state.adminTab = 'pending'; go('admin'); },
  'admin-tab': (el) => { state.adminTab = el.dataset.id; render(); },
  'admin-points': () => { if (isAdmin()) adminAdjustSheet('points'); },
  'admin-carbon': () => { if (isAdmin()) adminAdjustSheet('carbon'); },
  'admin-users': () => { if (!isAdmin()) return; if (!dbMode()) { toast('회원 관리는 서버 DB가 연결된 곳에서만 쓸 수 있어요'); return; } state.adm = { q: '' }; go('admin-users'); loadAdminUsers(''); },
  'open-help': () => { state.faqOpen = 0; if (state.fb) state.fb.mine = null; go('help'); loadMyFeedback(); },
  faq: (el) => {
    const i = Number(el.dataset.id);
    state.faqOpen = state.faqOpen === i ? -1 : i; // 하나만 펼쳐요
    document.querySelectorAll('#app .faq-item').forEach((n, j) => {
      const on = j === state.faqOpen;
      n.classList.toggle('open', on);
      n.querySelector('.faq-q').setAttribute('aria-expanded', String(on));
    });
  },
  'fb-kind': (el) => {
    if (!state.fb) return;
    state.fb.kind = el.dataset.id;
    document.querySelectorAll('#app .fb-kind').forEach((b) => { const on = b.dataset.id === state.fb.kind; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    const t = document.getElementById('fb-text'); if (t) t.placeholder = fbKind(state.fb.kind).hint;
  },
  'admin-feedback': () => { if (!isAdmin()) return; if (!dbMode()) { toast('받은 의견은 서버 DB가 연결된 곳에서만 볼 수 있어요'); return; } state.fba = { f: 'new' }; go('admin-feedback'); loadAdminFeedback('new'); },
  'fb-tab': (el) => loadAdminFeedback(el.dataset.id),
  'fb-set': async (el) => {
    const to = el.dataset.to;
    el.disabled = true;
    const r = await dataApi('feedback-set', { id: el.dataset.id, to });
    if (r.status === 401) return needRelogin();
    if (r.status !== 200) { el.disabled = false; toast(r.data.error || '바꾸지 못했어요'); return; }
    toast(to === 'done' ? '처리 완료로 표시했어요' : '확인함으로 표시했어요');
    loadAdminFeedback();
  },
  'fb-readall': async () => {
    const r = await dataApi('feedback-set', { all: true, to: 'read' });
    if (r.status === 401) return needRelogin();
    if (r.status !== 200) { toast(r.data.error || '바꾸지 못했어요'); return; }
    toast(`의견 ${r.data.count}개를 확인함으로 표시했어요`);
    loadAdminFeedback();
  },
  'fb-del': (el) => confirmSheet('이 의견을 지울까요?', '지우면 되돌릴 수 없고, 보낸 사람 목록에서도 사라져요.', '지우기').then(async (ok) => {
    if (!ok) return;
    const r = await dataApi('feedback-del', { id: el.dataset.id });
    if (r.status === 401) return needRelogin();
    if (r.status !== 200) { toast(r.data.error || '지우지 못했어요'); return; }
    toast('의견을 지웠어요');
    loadAdminFeedback();
  }),
  'adm-blocked': () => { const i = document.getElementById('au-q'); if (i) i.value = ''; loadAdminUsers(''); render(); },
  'adm-pt': (el) => { const u = admUser(el.dataset.id); if (u) adminAdjustSheet('points', u); },
  'adm-name': (el) => { const u = admUser(el.dataset.id); if (u) adminRenameSheet(u); },
  'adm-co2': (el) => { const u = admUser(el.dataset.id); if (u) adminAdjustSheet('carbon', u); },
  'adm-block': (el) => {
    const u = admUser(el.dataset.id); if (!u) return;
    const on = el.dataset.on === '1';
    confirmSheet(on ? `${u.name}님을 차단할까요?` : `${u.name}님 차단을 풀까요?`, on ? '차단하면 바로 로그아웃되고 다시 로그인할 수 없어요. 이달의 랭킹에서도 빠져요. 기록은 그대로 남아서 언제든 풀 수 있어요.' : '다시 로그인하고 앱을 쓸 수 있게 돼요.', on ? '차단하기' : '차단 풀기', '취소', on ? 'sheet-out' : 'primary').then(async (ok) => {
      if (!ok) return;
      const r = await dataApi('admin-block', { id: u.id, on });
      if (r.status !== 200) { toast(r.data.error || '처리하지 못했어요'); return; }
      toast(on ? `${u.name}님을 차단했어요` : `${u.name}님 차단을 풀었어요`);
      loadAdminUsers(state.adm.q || '');
    });
  },
  'adm-del': (el) => {
    const u = admUser(el.dataset.id); if (!u) return;
    confirmSheet(`${u.name}님을 완전히 지울까요?`, '회원 정보와 이동 기록·포인트·만든 캠페인·좋아요가 모두 지워지고 되돌릴 수 없어요. 잠시 막기만 하려면 "차단"을 써 주세요.', '완전히 지우기').then(async (ok) => {
      if (!ok) return;
      const r = await dataApi('admin-del-user', { id: u.id });
      if (r.status !== 200) { toast(r.data.error || '지우지 못했어요'); return; }
      toast(`${u.name}님을 지웠어요`);
      await syncFromServer({ quiet: true });
      loadAdminUsers(state.adm.q || '');
    });
  },
  'demo-seed': () => confirmSheet('예시 데이터를 넣을까요?', '가상 회원 100명·이동 기록·캠페인 8개, 그리고 내 계정에 8월부터의 이동 기록이 들어가요. 언제든 한 번에 지울 수 있어요.', '넣기', '취소', 'primary').then(async (ok) => {
    if (!ok) return;
    state.demoBusy = true; render();
    const r = await dbWrite('demo-seed', {});
    state.demoBusy = false; render();
    if (r) toast(`예시 회원 ${r.users}명 · 내 캘린더 이동 ${r.cal}번을 넣었어요`);
  }),
  'demo-clear': () => confirmSheet('예시 데이터를 모두 지울까요?', '가상 회원과 그 사람들의 기록, 내 계정에 넣은 캘린더 예시 이동이 지워져요. 내가 직접 한 이동과 진짜 회원 기록은 그대로예요.', '모두 지우기').then(async (ok) => {
    if (!ok) return;
    state.demoBusy = true; render();
    const r = await dbWrite('demo-clear', {});
    state.demoBusy = false; render();
    if (r) toast(`예시 회원 ${r.removed}명 · 내 캘린더 예시 ${r.calRemoved}번을 지웠어요`);
  }),
  'camp-approve': (el) => reviewCampaign(el.dataset.id, 'approved'),
  'camp-reject': (el) => {
    const c = campStore.load().find((x) => x.id === el.dataset.id);
    if (c) rejectSheet(c).then((reason) => { if (reason) reviewCampaign(c.id, 'rejected', reason); });
  },
  'camp-edit': (el) => startEdit(el.dataset.id),
  'camp-del': (el) => {
    const id = el.dataset.id;
    const c = campStore.load().find((x) => x.id === id);
    if (!c || !isMine(c)) return;
    confirmSheet('캠페인을 삭제할까요?', `"${c.title}" 캠페인과 참여·좋아요 기록이 모두 사라지고 되돌릴 수 없어요.`, '삭제하기').then((ok) => {
      if (!ok) return;
      if (dbMode()) { dbWrite('camp-del', { id }, '캠페인을 삭제했어요').then((r) => { if (r && state.screen === 'campaign') goBack(); }); return; }
      campStore.save(campStore.load().filter((x) => x.id !== id));
      toast('캠페인을 삭제했어요');
      if (state.screen === 'campaign') goBack(); else render();
    });
  },
  'camp-sort': (el) => { state.campSort = el.dataset.id; render(); },
  'camp-new': () => { state.campErr = ''; state.campEditId = null; if (state.campDraft && state.campDraft.rejectReason !== undefined) state.campDraft = null; state.campNewReturn = state.screen === 'account' ? 'account' : 'campaigns'; go('campaign-new'); },
  'camp-like': (el) => {
    const list = campStore.load(); const c = list.find((x) => x.id === el.dataset.id); if (!c) return;
    c.liked = !c.liked; c.likes += c.liked ? 1 : -1; campStore.save(list);
    el.classList.toggle('on', c.liked); el.setAttribute('aria-pressed', String(c.liked));
    el.querySelector('span').textContent = c.likes.toLocaleString();
    if (dbMode()) {
      const id = c.id; const on = c.liked;
      dataApi('camp-like', { id, on }).then((r) => {
        if (r.status === 401) return needRelogin();
        const l2 = campStore.load(); const c2 = l2.find((x) => x.id === id); if (!c2) return;
        if (r.status === 200) { c2.likes = r.data.likes; c2.liked = r.data.liked; }
        else { c2.liked = !on; c2.likes += on ? -1 : 1; toast(r.data.error || '좋아요를 저장하지 못했어요'); }
        campStore.save(l2);
        const b = document.querySelector(`[data-act="camp-like"][data-id="${id}"]`);
        if (b) { b.classList.toggle('on', c2.liked); b.setAttribute('aria-pressed', String(c2.liked)); b.querySelector('span').textContent = c2.likes.toLocaleString(); }
      });
    }
  },
  // 캠페인 참여하기 → 그 캠페인 이동 수단으로만 길찾기
  'camp-join': (el) => {
    const c = campStore.load().find((x) => x.id === el.dataset.id); if (!c) return;
    if (campEnded(c)) { toast('종료된 캠페인이에요'); return; }
    // 누르는 순간 참여자로 등록해요 → "내가 참여한 캠페인"에 바로 보여요
    if (!c.joined) {
      const list = campStore.load(); const x = list.find((y) => y.id === c.id);
      if (x) { x.joined = true; x.participants += 1; campStore.save(list); }
      if (dbMode()) {
        dataApi('camp-join', { id: c.id }).then((r) => {
          if (r.status === 401) return needRelogin();
          if (r.status !== 200) toast(r.data.error || '참여를 저장하지 못했어요');
          syncFromServer({ quiet: true });
        });
      }
    }
    state.campTrip = { campId: c.id, mode: campMode(c).id };
    state.campResult = null; state.recorded = false;
    state.to = null; state.raw = null; state.chosenId = null; state.openDetail = null;
    go('home');
    toast(`${campMode(c).label}로 가는 길만 찾아 드려요`);
  },
  'camp-trip-cancel': () => {
    confirmSheet('캠페인 참여를 그만둘까요?', '보통 길찾기로 돌아가요. 이번 이동은 캠페인에 더해지지 않아요.', '그만두기', '계속 참여').then((ok) => {
      if (!ok) return;
      state.campTrip = null; state.chosenId = null;
      if (state.screen === 'result') renderResultSheet(); else render();
      if (state.screen === 'result') drawChosen();
    });
  },
  'camp-back': () => {
    const id = state.campResult && state.campResult.campId;
    state.campTrip = null;
    if (id) state.campId = id;
    state.campReturn = 'campaigns';
    state.to = null; state.raw = null;
    go('campaign', 'back');
    setTimeout(() => { const el = document.getElementById('camp-rank'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 380);
  },
  'go-main': () => { state.campTrip = null; state.to = null; state.raw = null; goTab('main'); },
  'cn-mode': (el) => { saveDraftFromForm(); state.campDraft.mode = el.dataset.id; render(); },
  'cn-tag': (el) => { saveDraftFromForm(); state.campDraft.tag = el.dataset.id; state.campDraft.mode = TAG_MODE[el.dataset.id] || state.campDraft.mode; render(); },
  'cn-goal': (el) => { saveDraftFromForm(); state.campDraft.goalKg = Number(el.dataset.id); render(); },
  'open-week': () => {
    const open = () => { state.calReturn = 'main'; state.calMonth = null; state.calSel = dayKey(new Date()); };
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduce) { open(); document.startViewTransition(() => go('calendar', null)); }
    else { open(); go('calendar'); }
  },
  'open-calendar': () => { state.calReturn = state.screen === 'account' ? 'account' : 'main'; state.calMonth = null; state.calSel = dayKey(new Date()); go('calendar'); },
  'cal-prev': () => { const n = new Date(); const c = state.calMonth || { y: n.getFullYear(), m: n.getMonth() }; const d = new Date(c.y, c.m - 1, 1); state.calMonth = { y: d.getFullYear(), m: d.getMonth() }; state.calSel = null; render(); },
  'cal-next': () => { const n = new Date(); const c = state.calMonth || { y: n.getFullYear(), m: n.getMonth() }; const d = new Date(c.y, c.m + 1, 1); state.calMonth = { y: d.getFullYear(), m: d.getMonth() }; state.calSel = null; render(); },
  'cal-day': (el) => {
    state.calSel = el.dataset.id;
    document.querySelectorAll('.cal-day[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    el.setAttribute('aria-pressed', 'true');
    placeCalRing(true);
    const box = document.getElementById('cal-detail');
    if (box) box.innerHTML = calDetailHTML(loadLog());
  },
  'kg-toggle': (el) => {
    state.kgOpen = !state.kgOpen;
    const card = el.closest('#kg-card');
    if (!card) return;
    el.setAttribute('aria-expanded', String(state.kgOpen));
    card.classList.toggle('open', state.kgOpen);
    const fold = card.querySelector('.kg-fold');
    if (fold) fold.classList.toggle('open', state.kgOpen);
    if (state.kgOpen) setTimeout(() => { const r = card.getBoundingClientRect(); if (r.bottom > innerHeight - 110) window.scrollBy({ top: r.bottom - innerHeight + 120, behavior: 'smooth' }); }, 360); // 펼친 내용이 아래 바에 가리지 않게
  },
  'kg-view': (el) => {
    state.kgView = el.dataset.id;
    const card = document.getElementById('kg-card');
    if (!card) return;
    const prev = card.querySelector('.kg-seg');
    state.kgSegFrom = prev ? Number(prev.dataset.to) : null; // 이전 자리에서 새 자리로 미끄러지게
    card.innerHTML = kgCardHTML(state.kgView, loadLog().g);
    state.kgSegFrom = null;
    initKgSeg();
  },
  result: () => go('result'),
  'back-search': () => goBack(),
  'open-search-from': () => openSearch('from'),
  'open-search-to': () => openSearch('to'),
  pick: (el) => pickPlace(state.search.results[Number(el.dataset.i)]),
  'pick-recent': (el) => { const p = loadRecent()[Number(el.dataset.i)]; if (p) pickPlace({ name: p.name, address: p.address, lat: p.lat, lng: p.lng }); },
  mine: () => useMyLocation(),
  swap: () => { [state.from, state.to] = [state.to, state.from]; findRoutes(); render(); },
  'to-result': () => { if (tourStage() === '2-2') tourGo('3-1'); go('result'); }, // 튜토리얼 2-2 → 경로 화면 3-1
  'eco-peek': () => openEcoPeek(),
  'peek-close': () => closeEcoPeek(),
  'peek-go': () => { closeEcoPeek(true); go('result'); },
  tab: (el) => {
    if (tourStage() === '3-1') { // 튜토리얼 3-1 → 3-2 (경로가 있는 강도를 골라야 넘어가요)
      const { ranked } = currentPlan();
      if (ranked && ranked.byTier[el.dataset.id] && ranked.byTier[el.dataset.id].length) tourGo('3-2');
      else { toast('이 강도에는 경로가 없어요. 다른 강도를 눌러 보세요'); return; }
      if (el.dataset.id === state.level) { tourPaint(); return; }
    }
    if (el.dataset.id === state.level) return; state.levelFrom = state.level; state.level = el.dataset.id; state.chosenId = null; state.openDetail = null; refreshResult(); },
  select: (el) => {
    if (tourStage() === '3-2') { tourGo('3-3'); state.chosenId = el.dataset.id; refreshResult(); return; } // 튜토리얼 3-2 → 3-3
    if (state.chosenId === el.dataset.id) return; state.chosenId = el.dataset.id; refreshResult();
  },
  detail: (el) => { state.chosenId = el.dataset.id; state.openDetail = state.openDetail === el.dataset.id ? null : el.dataset.id; refreshResult(); },
  fit: () => { if (mapCtl) mapCtl.fit(); },
  'start-nav': (el) => {
    if (el.dataset.id) state.chosenId = el.dataset.id;
    state.step = 0; state.me = null; state.follow = true; state.recorded = false;
    const demo = ['3-2', '3-3'].includes(tourStage()) && state.from; // 튜토리얼(3-2에서 바로 눌러도): 진짜 GPS 대신 출발지에서 시연 이동
    if (demo) { tourGo('4-1'); state.me = { lat: state.from.lat, lng: state.from.lng }; state.tourSimP = 0; }
    go('nav'); if (!demo) startTracking(); updateNav();
    loadShapeFor(currentPlan().chosen); // 고른 경로의 실제 노선 모양 (하루 호출 수 절약)
  },
  'nav-end': () => go('result', 'back'),
  'nav-prev': () => { if (state.step > 0) { state.step -= 1; updateNav(); } else go('result'); },
  'nav-next': () => {
    const { chosen } = currentPlan();
    if (state.step < chosen.steps.length - 1) { state.step += 1; updateNav(); }
  },
  arrive: () => {
    if (tourStage() === '4-2') { tourGo('5-1'); tourDemoFinish(); return; } // 튜토리얼: 기록에 안 남기고 도착 화면만
    if (nearDest()) finishTrip();
  }, // 도착 버튼 (도착지 30m 안에서만): 아낀 탄소를 저장하고 결과(나무 N그루) 화면으로
  follow: () => { state.follow = !state.follow; if (mapCtl) mapCtl.setMe(state.me, state.follow); updateNav(); },
  restart: () => {
    if (tourStage() === '6') { // 튜토리얼 끝: 시연 출발지 · 도착지를 비우고 홈으로
      tourGo('done'); state.from = null; state.to = null; state.raw = null; state.chosenId = null; state.tourActive = false;
      go('main'); toast('튜토리얼을 마쳤어요 🎉 이제 직접 길을 찾아보세요'); return;
    }
    state.to = null; state.raw = null; go('home');
  },
};

const appEl = document.getElementById('app');

appEl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.stopPropagation(); fn(el); }
});

// "자동차보다 얼마나 아낄까요?" 목록: 펼친 상태를 기억해서 절약 강도 탭을 바꿔도 그대로 (toggle 은 버블링이 안 돼서 capture 로)
appEl.addEventListener('toggle', (e) => {
  if (e.target.classList && e.target.classList.contains('cmp2')) state.cmpOpen = e.target.open;
}, true);

appEl.addEventListener('submit', (e) => {
  if (e.target.id === 'search-form') { e.preventDefault(); runSearch(); }
  if (e.target.id === 'camp-form') { e.preventDefault(); submitCampaign(); }
  if (e.target.id === 'fb-form') { e.preventDefault(); sendFeedback(); return; }
  if (e.target.id === 'au-form') { e.preventDefault(); loadAdminUsers(String(document.getElementById('au-q').value || '').trim()); }
  if (e.target.id === 'name-form') {
    e.preventDefault();
    const name = String(new FormData(e.target).get('name') || '').trim();
    if (name.length < 2) { toast('닉네임은 2자 이상이에요'); return; }
    let remember = true;
    try { remember = !!localStorage.getItem(USER_KEY); } catch (er) { /* 무시 */ }
    state.user = { ...state.user, name };
    saveUser(state.user, remember);
    if (dbMode()) dbWrite('profile', { name }, '닉네임을 저장했어요');
    else toast('닉네임을 저장했어요');
  }
  if (e.target.id === 'verify-form') { e.preventDefault(); submitVerify(); return; }
  if (e.target.id === 'login-form' || e.target.id === 'signup-form') {
    e.preventDefault();
    const f = new FormData(e.target);
    const v = (k) => String(f.get(k) || '').trim();
    const draft = { email: v('email'), name: v('name') };
    if (e.target.id === 'login-form') {
      // 칸별로 먼저 확인 (참고 디자인처럼 틀린 칸에 빨간 테두리)
      const em = v('email'); const pw = String(f.get('pw') || '');
      draft.remember = !!f.get('remember');
      if (!em && !pw) { runAuth(AUTH.quick(draft.remember), draft); return; } // 빈 칸 → 관리자 계정으로 바로
      const fail = !em ? ['errEmailEmpty', 'email'] : !EMAIL_RE.test(em) ? ['errEmailFormat', 'email'] : !pw ? ['errPwEmpty', 'pw'] : pw.length < 8 ? ['errPwShort', 'pw'] : null;
      if (fail) { state.auth = { busy: false, errKey: fail[0], errField: fail[1], draft }; render(); const el = document.querySelector(`#login-form [name="${fail[1] === 'pw' ? 'pw' : 'email'}"]`); if (el) el.focus(); return; }
      runAuth(AUTH.email(em, pw, draft.remember), draft);
    }
    else { draft.remember = !!f.get('remember'); runAuth(AUTH.signup(v('name'), v('email'), String(f.get('pw') || ''), String(f.get('pw2') || ''), draft.remember), draft); }
  }
});

appEl.addEventListener('input', (e) => {
  if (e.target.id === 'search-input') { state.search.query = e.target.value; scheduleSearch(); }
  if (e.target.id === 'vf-remember' && state.verify) state.verify.remember = e.target.checked;
  if (e.target.id === 'vf-code' && state.verify) {
    const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (clean !== e.target.value) e.target.value = clean;
    state.verify.code = clean;
    renderVerifyMsg();
    if (state.verify.message && !state.verify.dead) { state.verify.message = ''; renderVerifyMsg(); }
    if (clean.length === 6) submitVerify(); // 6자리 다 넣으면 바로 확인
  }
  if (e.target.id === 'fb-text' && state.fb) { state.fb.text = e.target.value; const c = document.getElementById('fb-count'); if (c) c.textContent = `${e.target.value.length}/${FB_MAX}`; }
  if (e.target.id === 'au-q') { clearTimeout(loadAdminUsers.t); const v = e.target.value.trim(); loadAdminUsers.t = setTimeout(() => loadAdminUsers(v), 300); }
  if (e.target.form && e.target.form.id === 'login-form' && (state.auth.errKey || state.auth.message)) {
    state.auth = { ...state.auth, errKey: null, errField: null, message: '' };
    const p = document.querySelector('.lg-err'); if (p) p.textContent = '';
    document.querySelectorAll('.lg-field.invalid').forEach((x) => x.classList.remove('invalid'));
  }
  if (e.target.form && e.target.form.id === 'camp-form' && e.target.name === 'goalKg') {
    state.campDraft.goalKg = Number(e.target.value) || '';
    const h = document.getElementById('cn-help'); if (h) h.textContent = goalHelp(state.campDraft.goalKg);
    document.querySelectorAll('.cn-quick button').forEach((b) => b.classList.toggle('on', Number(b.dataset.id) === state.campDraft.goalKg));
  }
  if (e.target.id === 'm-km') {
    state.manualKm = e.target.value;
    const btn = document.getElementById('go-result');
    if (btn) btn.disabled = !currentSource(); // 입력 중에는 화면을 다시 그리지 않아요(커서 유지)
  }
});

appEl.addEventListener('change', (e) => {
  if (e.target.id === 'tour-never') { tourPut('localStorage', TOUR_KEY, e.target.checked ? 'off' : null); return; }
  if (e.target.id === 'avatar-input') {
    readAvatar(e.target.files[0])
      .then((url) => {
        if (dbMode()) return dbWrite('profile', { avatar: url }, '프로필 사진을 바꿨어요');
        if (!saveAvatar(url)) throw new Error('저장 공간이 부족해요.');
        render(); toast('프로필 사진을 바꿨어요');
      })
      .catch((err) => toast(err.message));
  }
  if (e.target.id === 'camp-cover') {
    saveDraftFromForm();
    readCover(e.target.files[0])
      .then((url) => { state.campDraft.cover = url; render(); })
      .catch((err) => toast(err.message));
  }
  if (e.target.id === 'sort') { state.prefs.sort = e.target.value; refreshResult(); }
});

// ---------------------------------------------------------------------
// 손가락으로 왼쪽 → 오른쪽 밀어서 이전 화면으로 (아이폰처럼)
//  - 지도가 있는 화면(길찾기·경로·안내)은 지도를 움직여야 하니 화면 왼쪽 끝(28px)에서 시작할 때만
//  - 나머지 화면은 어디서든 가로로 밀면 돼요
//  - 미는 동안 뒤에 이전 화면이 보이고, 1/3 이상 밀거나 빠르게 튕기면 넘어가요
// ---------------------------------------------------------------------
window.addEventListener('resize', () => { if (state.screen === 'calendar') placeCalRing(false); });
const MAP_SCREENS = ['home', 'result', 'nav'];
let swipe = null;
function swipeUnderlay(target) {
  let under = document.getElementById('swipe-under');
  if (!under) {
    under = document.createElement('div');
    under.id = 'swipe-under';
    under.className = 'shell swipe-under';
    appEl.parentNode.insertBefore(under, appEl);
  }
  // 이전 화면 모습만 그려요 (id·버튼 동작은 빼서 실제 화면과 섞이지 않게)
  under.innerHTML = VIEWS[target]().replace(/\sid="/g, ' data-under-id="').replace(/\sdata-act="/g, ' data-under-act="');
  under.dataset.screen = target;
  return under;
}
function clearSwipe() {
  const under = document.getElementById('swipe-under');
  if (under) under.remove();
  appEl.style.transition = '';
  appEl.style.transform = '';
  appEl.classList.remove('swiping');
}
appEl.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1 || swipe) return;
  const target = backOf(state.screen);
  if (!target) return;
  const t = e.touches[0];
  const edge = t.clientX - appEl.getBoundingClientRect().left < 28;
  if (!edge && (MAP_SCREENS.includes(state.screen) || e.target.closest('.m-carousel, input, select, textarea, .filters'))) return;
  if (e.target.closest('.m-tabs')) return; // 탭 바는 손가락으로 끌어서 탭을 고르는 곳
  swipe = { x0: t.clientX, y0: t.clientY, t0: Date.now(), dx: 0, active: false, target, under: null };
}, { passive: true });
appEl.addEventListener('touchmove', (e) => {
  if (!swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x0;
  const dy = t.clientY - swipe.y0;
  if (!swipe.active) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // 세로 스크롤
    if (dx < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    swipe.active = true;
    swipe.under = swipeUnderlay(swipe.target);
    appEl.classList.add('swiping');
  }
  e.preventDefault();
  swipe.dx = Math.max(0, dx);
  const w = appEl.offsetWidth || 1;
  appEl.style.transform = `translateX(${swipe.dx}px)`;
  swipe.under.style.transform = `translateX(${-30 + (swipe.dx / w) * 30}%)`;
  swipe.under.style.setProperty('--dim', String(0.12 * (1 - swipe.dx / w)));
}, { passive: false });
function endSwipe() {
  if (!swipe) return;
  const s = swipe;
  swipe = null;
  if (!s.active) return;
  const w = appEl.offsetWidth || 1;
  const fast = s.dx / Math.max(1, Date.now() - s.t0) > 0.5;
  const ok = s.dx > w / 3 || (fast && s.dx > 40);
  appEl.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)';
  s.under.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)';
  appEl.style.transform = `translateX(${ok ? w : 0}px)`;
  s.under.style.transform = `translateX(${ok ? 0 : -30}%)`;
  setTimeout(() => {
    clearSwipe();
    if (ok) go(s.target, null); // 이미 밀어서 보여줬으니 등장 효과 없이
  }, 230);
}
appEl.addEventListener('touchend', endSwipe);
appEl.addEventListener('touchcancel', endSwipe);

// ── 키보드가 입력 칸을 가리지 않게 ──
//  인스타그램 · 카카오톡 안 브라우저 같은 일부 안드로이드 웹뷰는 키보드가 화면 아래를 덮기만 하고
//  입력 칸이 보이게 스크롤해 주지 않아요. 그래서 칸을 누르면 아래에 여유 공간을 잠깐 만들고,
//  칸의 아래 끝이 키보드 바로 위에 오도록 직접 올려요 (data-kb-anchor 가 있으면 그 묶음째, 예: 의견 칸 + 보내기 버튼).
//  키보드 높이: 브라우저가 화면을 줄여 주면(아이폰 · 크롬) 그만큼, 덮기만 하는 웹뷰면 화면의 48%로 어림해요.
const KB_FIELDS = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=hidden])';
const KB_GUESS = 0.48; // 덮기만 하는 웹뷰에서 키보드가 차지하는 비율 (안드로이드 세로 화면 실측 약 47%)
const KB_GAP = 10; // 키보드와 칸 사이 간격(px)
let kbBaseH = window.innerHeight; // 키보드가 없을 때 화면 높이
window.addEventListener('resize', () => { if (!document.body.classList.contains('kb-open')) kbBaseH = window.innerHeight; });
function liftField(el) {
  if (document.activeElement !== el || !el.isConnected) return;
  const vv = window.visualViewport;
  const viewTop = vv ? vv.offsetTop : 0;
  const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const shrunk = kbBaseH - (viewBottom - viewTop) > 120; // 화면이 줄었으면 키보드가 그만큼
  const kbTop = shrunk ? viewBottom : viewBottom - kbBaseH * KB_GUESS;
  const bar = document.querySelector('#app .appbar');
  const barBottom = viewTop + (bar ? bar.getBoundingClientRect().height : 0);
  const anchor = el.closest('[data-kb-anchor]') || el;
  const box = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (box.bottom <= kbTop - KB_GAP && r.top >= barBottom) return; // 이미 키보드 위에 다 보이면 그대로
  let dy = box.bottom - (kbTop - KB_GAP); // 아래 끝을 키보드 바로 위로
  if (r.top - dy < barBottom + 8) dy = r.top - (barBottom + 8); // 묶음이 너무 크면 칸 윗부분이 제목 바에 안 가리게
  if (Math.abs(dy) < 3) return;
  window.scrollBy({ top: dy, behavior: 'smooth' });
}
appEl.addEventListener('focusin', (e) => {
  const el = e.target.closest ? e.target.closest(KB_FIELDS) : null;
  if (!el || MAP_SCREENS.includes(state.screen)) return;
  document.body.classList.add('kb-open');
  clearTimeout(liftField.t1); clearTimeout(liftField.t2);
  liftField.t1 = setTimeout(() => liftField(el), 300);
  liftField.t2 = setTimeout(() => liftField(el), 700);
});
appEl.addEventListener('focusout', () => {
  setTimeout(() => {
    const a = document.activeElement;
    if (!(a && a.closest && a.closest(KB_FIELDS) && appEl.contains(a))) document.body.classList.remove('kb-open');
  }, 150);
});
// 키보드 높이를 알려 주는 브라우저면, 높이가 바뀔 때마다 다시 맞춰요
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const a = document.activeElement;
    if (a && a.closest && a.closest(KB_FIELDS) && appEl.contains(a) && !MAP_SCREENS.includes(state.screen)) {
      clearTimeout(liftField.t3); liftField.t3 = setTimeout(() => liftField(a), 120);
    }
  });
}

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
// 카카오 로그인에서 돌아왔을 때 (/#kakao=…)
(function readKakaoReturn() {
  const m = /^#kakao=(.+)$/.exec(window.location.hash);
  if (!m) return;
  history.replaceState(null, '', window.location.pathname);
  let data = null;
  try { data = JSON.parse(decodeURIComponent(m[1])); } catch (e) { /* 무시 */ }
  let saved = null;
  try { saved = sessionStorage.getItem('pureun-kakao-state'); sessionStorage.removeItem('pureun-kakao-state'); } catch (e) { /* 무시 */ }
  if (!data) return;
  if (!saved || data.state !== saved) {
    state.auth = { busy: false, message: '로그인 확인 값이 맞지 않아요. 다시 시도해 주세요.' };
  } else if (!data.ok) {
    state.auth = { busy: false, message: data.error || '카카오 로그인에 실패했어요.' };
  } else {
    // 서버가 회원 DB에 기록하고 회원 번호(uid)·권한(role)을 같이 보내 줘요 (DB가 없는 곳이면 uid 없음)
    state.user = { provider: 'kakao', id: data.id, name: data.name, uid: data.uid, role: data.role };
    let remember = true;
    try { remember = sessionStorage.getItem('pureun-remember') !== '0'; sessionStorage.removeItem('pureun-remember'); } catch (e) { /* 무시 */ }
    saveUser(state.user, remember);
    state.screen = 'main';
  }
})();

// ── 시작 화면 (index.html 의 #splash) ──
//  앱을 새로 열면 하늘 화면(구름이 흐르고, 아이콘이 톡 나타나 둥실) + "탄소 절약 내비게이션 앱"을 4.5초 보여 주고,
//  아래 로딩 바는 남은 시간에 맞춰 차올라요.
//  시작 화면이 사르르 사라지는 동안 로그인 · 메인 화면이 사르르 나타나요.
//  같은 창에서 새로고침하거나 카카오 로그인에서 돌아올 때는 기다리지 않고 바로 넘어가요.
const SPLASH_MS = 4500;
(function splash() {
  const el = document.getElementById('splash');
  if (!el) return;
  let seen = false;
  try { seen = sessionStorage.getItem('pureun-splash') === '1'; sessionStorage.setItem('pureun-splash', '1'); } catch (e) { /* 무시 */ }
  const wait = seen ? 0 : Math.max(0, SPLASH_MS - performance.now()); // 페이지를 연 순간부터 4.5초
  el.style.setProperty('--sp-left', `${wait}ms`); // 로딩 바가 남은 시간 동안 차올라요
  el.classList.add('go');
  document.body.classList.add('splashing');
  setTimeout(() => {
    el.classList.add('out');
    document.body.classList.remove('splashing');
    setTimeout(() => el.remove(), 800);
  }, wait);
})();

installTierDefs();
try { render(); } catch (err) { reportError(err); }
if (state.user) syncFromServer().finally(() => setTimeout(showCampNotices, 300)); // 서버 DB가 있으면 내 기록을 받아 와요
// 다른 앱에 갔다가 돌아오면 다시 맞춰요 (다른 기기에서 바꾼 것·못 보낸 이동)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.user && dbMode()) syncFromServer(); });
window.addEventListener('online', () => { if (state.user && dbMode()) syncFromServer(); });

serverCheck = checkServer();
serverCheck.then(() => { if (state.screen === 'login') render(); });
serverCheck.then(() => { if (state.naver || state.kakao) { updateReady(); if (state.screen !== 'nav') render(); } });

if (HAS_NAVER) {
  const slow = setTimeout(() => {
    if (state.naver || state.mapError) return;
    state.mapError = '지도를 20초 넘게 불러오지 못했어요. 인터넷 연결을 확인하고, 광고 차단·추적 방지 기능이 있다면 이 주소에서 꺼 주세요.';
    if (['home', 'result', 'nav'].includes(state.screen)) render();
  }, 22000);
  loadNaverMaps()
    .then((naver) => {
      clearTimeout(slow);
      if (!naver || !naver.maps) { state.mapError = '네이버 지도를 불러오지 못했어요. 아래 버튼으로 다시 시도해 주세요.'; render(); return; }
      state.naver = naver; state.mapError = ''; updateReady(); if (state.screen !== 'nav') render();
      // 주소 검색 모듈(Service)이 빠진 채로 시작했으면 따로 불러와요
      if (!naver.maps.Service) {
        loadScript('https://oapi.map.naver.com/openapi/v3/maps-geocoder.js').catch(() => {})
          .then(() => setTimeout(() => { if (naver.maps.Service) { updateReady(); if (state.screen === 'search') runSearch(); } }, 300));
      }
    })
    .catch((err) => { clearTimeout(slow); state.mapError = err.message; render(); });
}
if (HAS_JS) {
  loadKakaoMaps()
    .then((kakao) => {
      state.kakao = kakao; updateReady();
      // 카카오(가게·역 이름 검색)가 늦게 준비되면, 이미 입력한 검색어로 다시 찾아요
      if (state.screen === 'search' && state.search.query.trim()) runSearch();
      else if (state.screen !== 'nav') render();
    })
    .catch((err) => {
      if (MAP_KIND === 'kakao') { state.mapError = err.message; render(); }
      else console.warn('카카오 장소 검색을 쓸 수 없어 네이버 주소 검색으로 대신해요:', err.message);
    });
}
