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
const APP_VERSION = '2026.10.02-places';
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

const MODES = {
  walk: { label: '도보', color: '#8a97a5', icon: '🚶' },
  bike: { label: '자전거', color: '#127a52', icon: '🚲' },
  bus: { label: '버스', color: '#2f7fd0', icon: '🚌' },
  subway: { label: '지하철', color: '#5b4bb7', icon: '🚇' },
  car: { label: '자차', color: '#a24b3c', icon: '🚗' },
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
const ARRIVE_M = 50; // 도착지에서 이만큼 가까워지면 도착으로 판단(m)

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
function loadNaverMaps() {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(window.naver); } };
    window.navermap_authFailure = () => {
      const err = new Error(naverAuthHelp());
      if (!done) { done = true; reject(err); return; }
      state.mapError = err.message; state.naver = null; updateReady(); render(); // 시작한 뒤에 인증 실패가 온 경우
    };
    window.__pureunNaverReady = finish;
    loadScript(`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_KEY_ID}&submodules=geocoder&callback=__pureunNaverReady`)
      .catch(() => { if (!done) { done = true; reject(new Error('네이버 지도를 불러오지 못했어요. 인터넷 연결과 클라이언트 ID를 확인해 주세요.')); } });
    const t0 = Date.now();
    const poll = setInterval(() => {
      const nm = window.naver && window.naver.maps;
      if (done || Date.now() - t0 > 15000) { clearInterval(poll); return; }
      if (nm && nm.Map && nm.LatLng) {
        clearInterval(poll);
        if (nm.Service) { finish(); return; }
        // 주소 검색 모듈이 안 왔으면 직접 불러오고, 실패해도 지도는 써요
        loadScript('https://oapi.map.naver.com/openapi/v3/maps-geocoder.js').catch(() => {}).then(() => setTimeout(finish, 200));
        setTimeout(finish, 2500);
      }
    }, 250);
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

// ODsay 경로 하나 → "자차로 첫 지하철역까지 + 나머지 대중교통" (조금 절약용)
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
    name: ['자차', ...t.legs.map((l) => l.name)].join(' → '),
    kind: 'car',
    real: 'partial',
    segments: [{ mode: 'car', km: carKm, min: carMin, name: '자차', color: MODES.car.color }, ...t.segments],
    legs: [{ mode: 'car', name: '자차', color: MODES.car.color, start: from.name, end: stName }, ...t.legs],
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

// 자동차: 기준(혼자 타기) + 함께 타기
function carRoutes(car, km, from, to) {
  const base = car
    ? { km: car.km, minutes: car.minutes, lines: [{ mode: 'car', color: MODES.car.color, path: car.path }], steps: car.guides.map((g) => ({ ...g, mode: 'car', radius: 50 })), real: true }
    : {
        km, minutes: Math.round((km / SPEED.car) * 60 + 5), lines: straightLine('car', from, to), real: false,
        steps: [{ mode: 'car', text: `${to ? to.name : '도착지'} 방향으로 운전해요`, sub: '자세한 길은 카카오맵 자동차 안내에서 확인하세요', target: to || null, radius: ARRIVE_M }],
      };
  const make = (id, name, people, extraMin, firstStep) => ({
    id, name, kind: 'car', real: base.real,
    segments: [{ mode: 'car', km: base.km, min: base.minutes + extraMin, name: people > 1 ? `${people}명 함께` : '자차', color: MODES.car.color }],
    legs: [{ mode: 'car', name: people > 1 ? `자차 ${people}명` : '자차', color: MODES.car.color, start: from ? from.name : '출발지', end: to ? to.name : '도착지' }],
    steps: firstStep ? [firstStep, ...base.steps] : base.steps,
    lines: base.lines, marks: [], km: base.km,
    minutes: base.minutes + extraMin, walkM: 0, transfers: 0, people, kakaoMode: 'car',
  });
  return {
    baseline: make('car', '혼자 자동차 타기', 1, 0),
    pools: [
      make('carpool-2', '2명이 함께 차 타기', 2, 8, { mode: 'walk', text: '함께 갈 친구나 가족을 태워요', sub: '탄소를 두 사람이 나눠요' }),
      make('carpool-3', '3명이 함께 차 타기', 3, 12, { mode: 'walk', text: '함께 갈 사람 2명을 태워요', sub: '탄소를 세 사람이 나눠요' }),
    ],
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

// 이동수단별 시간 합계 (대중교통 / 도보 / 자차 / 자전거)
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
    else if (r.kind === 'car' && !prefs.hasCar) blocked = '자차 끔';
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
//  - 이메일: 지금은 체험용이에요. 실제 서비스에서는 Firebase Authentication 같은 서버 인증으로 바꿔요.
//    비밀번호는 절대 이 앱(localStorage)에 저장하지 않아요.
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
const AUTH = {
  // 카카오: server.js 에 키가 있으면 카카오 로그인 화면으로 이동, 없으면 체험용
  kakao: () => (serverCheck || Promise.resolve()).then(() => {
    if (!serverInfo.kakaoLogin) return { provider: 'kakao', name: '카카오 사용자', demo: true };
    const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('pureun-kakao-state', st); } catch (e) { /* 무시 */ }
    window.location.href = `/api/kakao/start?state=${encodeURIComponent(st)}`;
    return new Promise(() => {}); // 카카오 화면으로 넘어가는 중
  }),
  email: (email, pw) => {
    if (!EMAIL_RE.test(email)) return Promise.reject(new Error('이메일 주소를 확인해 주세요.'));
    if (pw.length < 8) return Promise.reject(new Error('비밀번호는 8자 이상이에요.'));
    return Promise.resolve({ provider: 'email', email, name: email.split('@')[0] });
  },
  signup: (name, email, pw, pw2) => {
    if (!name) return Promise.reject(new Error('이름(닉네임)을 적어 주세요.'));
    if (!EMAIL_RE.test(email)) return Promise.reject(new Error('이메일 주소를 확인해 주세요.'));
    if (pw.length < 8) return Promise.reject(new Error('비밀번호는 8자 이상으로 만들어 주세요.'));
    if (pw !== pw2) return Promise.reject(new Error('비밀번호가 서로 달라요.'));
    return Promise.resolve({ provider: 'email', email, name });
  },
};

// ---------------------------------------------------------------------
// 7. 앱 상태
// ---------------------------------------------------------------------
const state = {
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
  return { baseline: cars.baseline, candidates: [...activeRoutes(km, null, null), ...transitEstimates(km, null, null), ...cars.pools] };
}
function currentPlan() {
  const source = currentSource();
  const ranked = source ? rankRoutes(source, state.prefs) : null;
  const options = ranked ? ranked.byTier[state.level] : [];
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
    state.raw = { baseline: cars.baseline, candidates: [...activeRoutes(estKm, from, to), ...transit, ...cars.pools] };
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
  ko: { eyebrow: '푸른하늘', title: '탄소 줄이는 길찾기', chip: '이메일로 로그인', email: '이메일', password: '비밀번호', showPw: '비밀번호 보기', hidePw: '비밀번호 숨기기', login: '로그인', remember: '로그인 상태 유지', forgot: '비밀번호 찾기', or: '또는', kakao: '카카오 로그인', noAccount: '아직 푸른하늘 회원이 아니신가요?', signup: '회원가입',
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
        ${message ? `<p class="login-msg" role="alert">${esc(message)}</p>` : ''}
        <button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>가입하기</button>
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
//    → 만든 사람에게 탄소 포인트 보상 (1kg당 10P)
//  - 메인 화면 TOP 5: 인기 캠페인 먼저 → 좋아요 많은 순 → 달성률 높은 순
//  ※ 지금은 서버 DB가 없어서 이 휴대폰(브라우저)에만 저장돼요.
//    여러 사람이 함께 보려면 campStore 의 load/save 만 Firebase 같은 DB로 바꾸면 돼요.
// ---------------------------------------------------------------------
const POPULAR_MIN_KG = 100;
const REWARD_P_PER_KG = 10;
const CAMP_KEY = 'pureun-campaigns';
const POINT_KEY = 'pureun-points';
const CAMP_TAGS = [
  { id: 'transit', label: '대중교통', tone: 'sky', icon: '🚌', bg: 'linear-gradient(160deg,#7fb6e8 0%,#a8d4c0 50%,#4f8a5b 100%)' },
  { id: 'walk', label: '걷기', tone: 'sun', icon: '🚶', bg: 'linear-gradient(160deg,#9cc3e6 0%,#c9d9c4 50%,#6f8f72 100%)' },
  { id: 'bike', label: '자전거', tone: 'mint', icon: '🚲', bg: 'linear-gradient(160deg,#a9c6e0 0%,#b9d3b0 50%,#4d7a57 100%)' },
  { id: 'carfree', label: '차 없는 날', tone: 'violet', icon: '🏙️', bg: 'linear-gradient(160deg,#b5c9dc 0%,#d6d2c4 50%,#6d7f73 100%)' },
  { id: 'together', label: '함께하기', tone: 'sky', icon: '🤝', bg: 'linear-gradient(160deg,#6f9fb8 0%,#5f8f62 55%,#2f5e3c 100%)' },
];
const tagOf = (id) => CAMP_TAGS.find((t) => t.id === id) || CAMP_TAGS[0];
// 예시 캠페인 6개 (좋아요·참여·달성 정도를 다르게 넣어 순위가 매겨지는지 확인용)
function seedCampaigns() {
  const day = 86400000; const now = Date.now();
  return [
    { id: 'seed-1', tag: 'transit', title: '주말 나들이 버스로 가기', sub: '주말 나들이는 자동차 대신 버스로',
      body: '주말에 공원이나 한강 갈 때 버스 타고 가 봐요. 근교는 대부분 버스로 충분히 갈 수 있어요.\n\n이번 캠페인은 주말 나들이를 버스로 다녀오는 거예요. 혼자 자동차로 10km를 가면 CO₂ 약 2.1kg이 나오지만, 버스로 가면 약 0.28kg이에요. 한 번의 선택으로 탄소를 85% 넘게 줄일 수 있어요.',
      goalKg: 500, progressG: 523400, participants: 128, likes: 312, creator: '초록버스', createdAt: now - 20 * day },
    { id: 'seed-2', tag: 'walk', title: '한 정거장 먼저 내려 걸어요', sub: '하루 10분 걷기로 탄소도 줄이고 건강도 챙기기',
      body: '집이나 회사에 가는 길, 한 정거장만 먼저 내려서 걸어보세요. 약 600m, 걸어서 8~10분이에요.\n\n버스가 덜 달린 거리만큼 탄소가 줄고, 하루 1,000보가 저절로 채워져요.\n\n목표는 참여자 모두 합쳐 200kg! 오늘 퇴근길부터 시작해요.',
      goalKg: 200, progressG: 151200, participants: 96, likes: 241, creator: '산책하는해달', createdAt: now - 14 * day },
    { id: 'seed-3', tag: 'carfree', title: '금요일엔 차 두고 출근하기', sub: '매주 금요일은 자차 대신 대중교통 출근',
      body: '일주일에 하루만 자동차를 집에 두고 출근해 보면 어떨까요?\n\n출퇴근 왕복 30km를 자차 대신 지하철로 다니면 하루에 CO₂ 약 6kg을 줄일 수 있어요. 한 사람이 1년 동안 금요일마다 실천하면 나무 30그루를 심은 것과 같은 효과예요.\n\n목표 1,000kg 달성했어요. 계속 참여할 수 있어요.',
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
const campReward = (c) => c.goalKg * REWARD_P_PER_KG;
// ── 관리자 검토 ──
//  새 캠페인은 status 'pending'(검토 대기) → 관리자가 'approved'(게시) 또는 'rejected'(반려, 사유 포함)
//  예시 캠페인처럼 status 가 없으면 이미 게시된 캠페인이에요.
//  ※ DB 전이라 관리자 확인도 이 휴대폰 안에서만 돼요 (진짜 서비스는 서버에서 권한을 확인해야 해요).
const ADMIN_EMAILS = (CFG.ADMIN_EMAILS || ['admin@bluesky.kr']).map((e) => String(e).trim().toLowerCase());
const isAdmin = () => !!(state.user && state.user.email && ADMIN_EMAILS.includes(String(state.user.email).toLowerCase()));
function userKey(u) {
  if (!u) return '';
  if (u.email) return `e:${String(u.email).toLowerCase()}`;
  if (u.id) return `k:${u.id}`;
  return `n:${u.name || ''}`;
}
const isMine = (c) => (c.ownerId ? c.ownerId === userKey(state.user) : !!c.mine);
const isPublic = (c) => !c.status || c.status === 'approved';
const publicCampaigns = (list = campStore.load()) => list.filter(isPublic);
const pendingCampaigns = (list = campStore.load()) => list.filter((c) => c.status === 'pending').sort((a, b) => (a.submittedAt || a.createdAt) - (b.submittedAt || b.createdAt));
const STATUS_LABEL = { pending: '검토 중', approved: '게시 중', rejected: '반려됨' };
const REJECT_REASONS = ['탄소 절약·친환경 이동과 관련이 적어요', '내용이 짧거나 무엇을 하자는지 알기 어려워요', '목표량이 너무 크거나 작아요', '부적절한 사진이나 표현이 있어요', '광고·홍보 목적이에요'];

// 메인 화면 순서: 인기 캠페인 → 좋아요 → 달성률
function rankCampaigns(list) {
  return list.filter(isPublic).sort((a, b) => (isPopular(b) - isPopular(a)) || (b.likes - a.likes) || (campPct(b) - campPct(a)));
}
function topCampaigns(n) { return rankCampaigns(publicCampaigns()).slice(0, n); }
// 인기 캠페인이 되면 만든 사람에게 보상 (내가 만든 거면 내 포인트에 바로 더해요)
function checkRewards(list) {
  const won = [];
  list.forEach((c) => {
    if (!isPublic(c) || !isPopular(c) || c.rewarded) return;
    if (c.ownerId && !isMine(c)) return; // 만든 사람이 로그인했을 때 지급해요
    c.rewarded = true;
    if (isMine(c)) { addPoints(campReward(c)); won.push(c); }
  });
  return won;
}
// 도착하면: 내가 참여한 캠페인에 아낀 탄소를 더해요
function addSavingToCampaigns(g) {
  if (!(g > 0)) return;
  const list = campStore.load();
  let changed = false;
  list.forEach((c) => { if (c.joined && isPublic(c)) { c.progressG += g; changed = true; } });
  const won = checkRewards(list);
  if (changed || won.length) campStore.save(list);
  if (won.length) setTimeout(() => toast(`내 캠페인이 인기 캠페인이 됐어요 +${campReward(won[0]).toLocaleString()}P`), 600);
}
// 캠페인 카드 배경 (올린 사진이 있으면 사진, 없으면 분류별 하늘·초록 그라데이션)
function campBg(c, shade) {
  const dark = shade || 'linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.5))';
  return c.cover ? `${dark},url('${c.cover}') center/cover` : `${dark},${tagOf(c.tag).bg}`;
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
function mainHTML() {
  const log = loadLog();
  const kg = log.g / 1000;
  const part = ((log.g % TREE_YEAR_G) / TREE_YEAR_G) * 100;
  const im = impact(log.g);
  const wk = weekInfo(log);
  const quickTo = state.to ? esc(state.to.name) : '어디로 갈까요?';
  const quickFrom = state.from ? esc(state.from.name) : '현재 위치';
  const tops = topCampaigns(5);
  return `<main class="main">
    <header class="m-top">
      <div class="m-brand">
        <span class="m-logo"><span class="brand-mark" aria-hidden="true"></span></span>
        <span><b>푸른하늘</b><small>BETTER WAY, BETTER AIR</small></span>
      </div>
      <button type="button" class="m-round m-me" data-act="open-account" aria-label="계정 설정">${loadAvatar() ? avatarHTML('', loadAvatar()) : ICON.user}</button>
    </header>

    <p class="m-hello">${esc(greetingText())}</p>
    <h1 class="m-title">오늘은<br>어디로 가세요?</h1>

    <button type="button" class="m-quick" data-act="open-route">
      <span class="m-quick-ic">${ICON.route}</span>
      <span class="m-quick-txt">
        <small>빠른 길찾기</small>
        <span><b>${quickFrom}</b><i aria-hidden="true">→</i><em class="${state.to ? 'set' : ''}">${quickTo}</em></span>
      </span>
      <span class="m-chev">${ICON.chev}</span>
    </button>

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

    <section class="m-card">
      <div class="m-card-head">
        <div><p class="m-label">지금까지 탄소 절약</p><p class="m-big"><b>${kg >= 100 ? kg.toFixed(0) : kg.toFixed(1)}</b> kg CO<sub>2</sub></p></div>
        <span class="m-tile">${ICON.leaf}</span>
      </div>
      <div class="m-bar"><span style="width:${log.g > 0 ? Math.max(3, part).toFixed(1) : 0}%"></span></div>
      <p class="m-note">${log.trips ? `${esc(im.short)} · 다음 나무까지 ${formatG(TREE_YEAR_G - (log.g % TREE_YEAR_G))}` : '첫 친환경 이동을 하면 여기에 쌓여요'}</p>
    </section>

    <section class="m-card kg-card" id="kg-card">${kgCardHTML(state.kgView || 'one', log.g)}</section>

    <section class="m-card m-week-card" data-act="open-calendar" role="button" tabindex="0" aria-label="그린 캘린더 열기">
      <div class="m-card-head">
        <div><p class="m-label">이번 주 그린 이동</p><p class="m-h3">${wk.count ? `${wk.count}일 이동했어요` : '이번 주 첫 이동을 시작해요'}</p></div>
        <span class="m-more">달력 ${ICON.chev}</span>
      </div>
      <ol class="m-week">${wk.week.map((d) => `<li class="${d.done ? 'is-done' : ''} ${d.today ? 'is-today' : ''}"><span>${d.done ? ICON.check : ''}</span>${d.label}</li>`).join('')}</ol>
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
    { icon: '🚗', tone: 'sun', big: n(g / FACTORS.car), unit: 'km', text: '혼자 자동차로 달릴 때 나오는 양' },
  ];
}
const MIN_MINE_G = 50;
function kgCardHTML(view, myG) {
  const has = myG >= MIN_MINE_G; // 몇 g 수준은 아직 아낀 양이 없는 걸로 봐요 (0.0kg 방지)
  const mine = view === 'mine';
  const g = mine ? myG : 1000;
  const kgText = !mine ? '1kg' : !has ? '' : myG < 1000 ? `${Math.round(myG)}g` : `${(myG / 1000).toFixed(myG >= 100000 ? 0 : 1)}kg`;
  const title = mine && !has ? '내가 아낀 탄소는 얼마나 될까요?' : `CO<sub>2</sub> ${kgText}은 얼마나 될까요?`;
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
  return `<div class="kg-head">
      <div><p class="m-label">탄소량 쉽게 보기</p><h3 class="m-h3">${title}</h3></div>
      <span class="m-tile">ⓘ</span>
    </div>
    <div class="kg-seg" role="tablist" aria-label="기준">
      <button type="button" role="tab" class="${mine ? '' : 'on'}" aria-selected="${!mine}" data-act="kg-view" data-id="one">1kg 기준</button>
      <button type="button" role="tab" class="${mine ? 'on' : ''}" aria-selected="${mine}" data-act="kg-view" data-id="mine">내가 아낀 양</button>
    </div>
    ${body}
    <p class="kg-src">풍선 지름 30cm · 소나무(국립산림과학원) · 전력배출계수 2023 · 승용차 210g/km 기준</p>`;
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
  return `${appBar('그린 캘린더', 'back')}
    <main class="content cal">
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
    <section class="c-rule">
      <b>🏆 인기 캠페인은 이렇게 정해져요</b>
      <p>새 캠페인은 <strong>관리자 검토</strong>를 거쳐 올라가요. 목표 <strong>${POPULAR_MIN_KG}kg 이상</strong>을 참여자들이 <strong>100% 달성</strong>하면 인기 캠페인이 되고, 만든 사람에게 <strong>탄소 포인트(1kg당 ${REWARD_P_PER_KG}P)</strong>를 드려요. 메인 화면에는 인기 캠페인 → 좋아요 순으로 TOP 5가 올라가요.</p>
    </section>
    <h2 class="c-h">지금 메인에 올라간 TOP 5</h2>
    <ol class="c-top">${tops.map((c, i) => `<li><button type="button" data-act="open-camp" data-id="${c.id}">
      <span class="c-top-n">${i + 1}</span><span class="c-top-t">${esc(c.title)}</span>
      <span class="c-top-m">${isPopular(c) ? '<em>인기</em>' : ''}♥ ${c.likes}</span></button></li>`).join('')}</ol>
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
function campCardHTML(c) {
  const pct = campPct(c);
  return `<article class="c-card" data-act="open-camp" data-id="${c.id}">
    <div class="c-cover" style="background:${campBg(c, 'linear-gradient(180deg,rgba(0,0,0,0) 50%,rgba(0,0,0,.25))')}">${c.cover ? '' : `<span>${tagOf(c.tag).icon}</span>`}
      ${isPopular(c) ? '<em class="c-badge">🏆 인기</em>' : ''}</div>
    <div class="c-body">
      <span class="c-tag tone-${tagOf(c.tag).tone}">${esc(tagOf(c.tag).label)}</span>
      <h3>${esc(c.title)}</h3>
      <p class="c-by">by ${esc(c.creator)} · ${c.participants.toLocaleString()}명 참여</p>
      <div class="c-prog"><span style="width:${pct.toFixed(1)}%"></span></div>
      <p class="c-num"><b>${kgShort(c.progressG)}</b> / ${c.goalKg.toLocaleString()}kg <span>${Math.floor(pct)}%</span></p>
      <p class="c-like ${c.liked ? 'on' : ''}">${ICON.heart}${c.likes.toLocaleString()}</p>
    </div>
  </article>`;
}
// ── 캠페인 상세 ──
function campaignHTML() {
  const c = campStore.load().find((x) => x.id === state.campId);
  if (!c || (!isPublic(c) && !isMine(c) && !isAdmin())) return `${appBar('캠페인', 'back')}<main class="content"><p class="empty">캠페인을 찾지 못했어요.</p></main>`;
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
        <span class="m-chip tone-${tagOf(c.tag).tone}">${pop ? '🏆 인기 캠페인' : esc(tagOf(c.tag).label)}</span>
        <h1>${esc(c.title)}</h1>
        <p>${esc(c.sub || '')}</p>
      </div>
    </div>
    <div class="cd-wrap">
      ${pub ? '' : reviewBannerHTML(c)}
      <section class="m-card cd-goal">
        <p class="m-label">참여자들이 함께 아낀 탄소</p>
        <p class="m-big"><b>${(c.progressG / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}</b> / ${c.goalKg.toLocaleString()} kg CO<sub>2</sub></p>
        <div class="m-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
        <p class="m-note">${pct >= 100 ? '🎉 목표 달성!' : `목표까지 ${kgShort(left)} 남았어요`} · ${c.participants.toLocaleString()}명 참여${c.progressG > 0 ? ` · ${impact(c.progressG).icon} ${esc(impact(c.progressG).short)}` : ''}</p>
      </section>
      <section class="cd-reward ${pop ? 'won' : ''}">
        <b>${pop ? '🏆 인기 캠페인 선정 · 보상 지급 완료' : c.goalKg >= POPULAR_MIN_KG ? '🎯 목표를 달성하면 인기 캠페인!' : `ℹ️ 목표가 ${POPULAR_MIN_KG}kg 미만이라 인기 캠페인 대상이 아니에요`}</b>
        <p>${c.goalKg >= POPULAR_MIN_KG ? `만든 사람(${esc(c.creator)})에게 탄소 포인트 <strong>${campReward(c).toLocaleString()}P</strong>${pop ? '를 드렸어요' : '를 드려요'}` : '목표를 크게 잡을수록 인기 캠페인이 될 수 있어요'}</p>
      </section>
      <article class="cd-body">
        <p class="c-by">by <b>${esc(c.creator)}</b> · ${new Date(c.createdAt).toLocaleDateString('ko-KR')}</p>
        ${esc(c.body).split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('')}
        <p class="cd-how">참여하면 앞으로 친환경 경로로 도착할 때마다 아낀 탄소가 이 캠페인에 더해져요.</p>
      </article>
    </div>
    ${pub ? `<div class="cd-bar">
      <button type="button" class="cd-like ${c.liked ? 'on' : ''}" data-act="camp-like" data-id="${c.id}" aria-pressed="${c.liked}">${ICON.heart}<span>${c.likes.toLocaleString()}</span></button>
      <button type="button" class="btn ${c.joined ? '' : 'primary'} cd-join" data-act="camp-join" data-id="${c.id}">${c.joined ? '✓ 참여 중 · 그만하기' : '캠페인 참여하기'}</button>
    </div>` : reviewBarHTML(c)}
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
  const d = state.campDraft || (state.campDraft = { tag: 'transit', goalKg: 100, cover: '' });
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
    ? `${im.icon} ${im.short} · 달성하면 인기 캠페인 + 탄소 포인트 ${(kg * REWARD_P_PER_KG).toLocaleString()}P`
    : `${im.icon} ${im.short} · ${POPULAR_MIN_KG}kg 이상이어야 인기 캠페인 후보가 돼요`;
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
  const fields = { tag: d.tag, title: d.title.trim(), sub: d.sub.trim(), body: d.body.trim(), goalKg: Math.round(d.goalKg), cover: d.cover || '' };
  const list = campStore.load();
  const old = state.campEditId && list.find((x) => x.id === state.campEditId && isMine(x));
  let c;
  if (old) {
    c = Object.assign(old, fields, { status: 'pending', rejectReason: '', submittedAt: Date.now(), notice: null });
  } else {
    c = {
      id: `c-${Date.now().toString(36)}`, ...fields, progressG: 0, participants: 1, likes: 0,
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
    </main>`;
}
// 승인 / 반려 처리
function reviewCampaign(id, status, reason) {
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
  if (won.length) toast(`내 캠페인이 인기 캠페인이 됐어요 +${campReward(won[0]).toLocaleString()}P`);
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
  state.campDraft = { tag: c.tag, title: c.title, sub: c.sub, body: c.body, goalKg: c.goalKg, cover: c.cover, rejectReason: c.status === 'rejected' ? c.rejectReason : '' };
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
//  ※ 아직 DB가 없어서 다른 사용자는 가상 사용자예요 (달마다 같은 결과가 나오게 고정).
//    DB를 붙이면 rankingUsers() 만 서버에서 받아오게 바꾸면 돼요.
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
    list.push({ id: `u${i}`, name, points: pts, photo: '' });
  }
  return list;
}
function monthRanking(mKey = monthKey()) {
  const me = { id: 'me', me: true, name: (state.user && state.user.name) || '나', points: loadMonthPoints(mKey), photo: loadAvatar() };
  const all = rankingUsers(mKey).concat(me).sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
  all.forEach((u, i) => { u.rank = i + 1; });
  return { all, me: all.find((u) => u.me) };
}
function rankHTML() {
  const now = new Date();
  const mKey = monthKey(now);
  const { all, me } = monthRanking(mKey);
  const top = all.slice(0, 100);
  const left = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const pod = (u, place) => u ? `<div class="pod pod-${place}">
      ${place === 1 ? '<span class="crown" aria-hidden="true">👑</span>' : ''}
      <div class="medal m${place}">${avatarHTML(u.name, u.photo, 'av-lg')}</div>
      <b class="pod-name">${esc(u.name)}${u.me ? ' <em>나</em>' : ''}</b>
      <span class="pod-pt">${u.points.toLocaleString()}P</span>
      <div class="step"><span>${place}</span></div>
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
    <details class="rk-rule"><summary>ⓘ 탄소 포인트는 이렇게 모여요</summary>
      <p>친환경 경로로 도착하면 <b>아낀 탄소 1kg당 ${PT_PER_KG}P</b> + <b>버스·지하철·걷기·자전거로 이동한 거리 1km당 ${PT_PER_KM}P</b>를 받아요. 인기 캠페인 보상도 함께 쌓이고, 매달 1일에 새로 시작해요.</p>
    </details>
    <ol class="rk-list">${top.slice(3).map((u) => `<li class="${u.me ? 'is-me' : ''}">
      <span class="rk-n">${u.rank}</span>${avatarHTML(u.name, u.photo)}
      <span class="rk-name">${esc(u.name)}${u.me ? ' <em>나</em>' : ''}</span>
      <span class="rk-pt">${u.points.toLocaleString()}P</span></li>`).join('')}</ol>
    <div class="rk-me">
      <span class="rk-n">${me.rank > 999 ? '999+' : me.rank}</span>${avatarHTML(me.name, me.photo)}
      <span class="rk-name">내 순위${me.rank <= 3 ? ' 🏅' : ''}</span>
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
          <span class="acc-camp-txt"><span class="st st-${c.status || 'approved'}">${STATUS_LABEL[c.status || 'approved']}</span><b>${esc(c.title)}</b>
            ${isPublic(c) ? `<small>${isPopular(c) ? '🏆 인기 캠페인 · ' : ''}${Math.floor(campPct(c))}% 달성 · ${c.participants.toLocaleString()}명 참여 · ♥ ${c.likes.toLocaleString()}</small>
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
        <button type="button" class="btn sheet-cancel" data-no>${esc(cancelLabel)}</button>
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
  return `${appBar('계정 설정', 'back')}
    <main class="content acc">
      <section class="acc-top">
        <label class="acc-photo" aria-label="프로필 사진 바꾸기">
          <input type="file" id="avatar-input" accept="image/*" hidden>
          ${avatarHTML(u.name || '나', photo, 'av-xl')}
          <span class="acc-cam" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>
        </label>
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
        <div><span>누적 탄소 포인트</span><b>${loadPoints().toLocaleString()}P</b></div>
      </section>
      ${myCampaignsHTML()}
      <section class="m-card acc-list">
        ${isAdmin() ? `<button type="button" class="acc-admin" data-act="open-admin"><span>🛡️ 캠페인 검토 <em>관리자</em></span><span class="acc-cnt">${pendingCampaigns().length ? `<i>${pendingCampaigns().length}</i>` : ''}${ICON.chev}</span></button>` : ''}
        <button type="button" data-act="open-rank"><span>🏆 이달의 절약왕 랭킹</span>${ICON.chev}</button>
        <button type="button" data-act="open-calendar"><span>📅 그린 캘린더</span>${ICON.chev}</button>
        <div class="acc-info"><span>로그인 방식</span><b>${esc(how)}${u.demo ? ' (체험용)' : ''}</b></div>
        ${u.email ? `<div class="acc-info"><span>이메일</span><b>${esc(u.email)}</b></div>` : ''}
      </section>
      <button type="button" class="btn sheet-out" data-act="logout">로그아웃</button>
      <p class="rk-note">프로필 사진과 닉네임은 이 기기에 저장돼요</p>
    </main>`;
}

function tabBarHTML(active) {
  const tab = (id, icon, label, act) => `<button type="button" class="m-tab ${active === id ? 'on' : ''}" data-act="${act}">${icon}<span>${label}</span></button>`;
  return `<nav class="m-tabs" aria-label="메뉴">
    ${tab('route', ICON.route, '길찾기', 'open-main')}
    ${tab('rank', ICON.rank, '랭킹', 'open-rank')}
    ${tab('camp', ICON.flag, '캠페인', 'open-camps')}
    ${tab('me', ICON.user, '계정정보', 'open-account')}
  </nav>`;
}
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
    if (e.target.closest('[data-logout]')) { close(); logout(); }
  });
}
// 로그아웃: 저장된 로그인만 지워요 (이동 기록·나의 숲은 이 휴대폰에 그대로)
function logout() {
  saveUser(null);
  state.user = null;
  state.auth = { busy: false, message: '' };
  go('login', 'back');
}

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
  return `<main class="home">${body}</main>
    ${cta(`<button type="button" class="btn primary" id="go-result" data-act="to-result" ${can ? '' : 'disabled'}>길찾기</button>`)}`;
}

// ── 검색 ──
function searchHTML() {
  const s = state.search;
  const byName = state.places && state.places.byName;
  return `${appBar(s.which === 'from' ? '출발지 검색' : '도착지 검색', 'back-search')}
    <main class="content">
      <form class="search-bar" id="search-form">
        <input id="search-input" class="input" type="search" enterkeyhint="search" autocomplete="off"
          placeholder="${byName ? '장소, 건물, 가게 이름이나 주소' : '도로명 주소 (예: 세종대로 110)'}" value="${esc(s.query)}">
        <button type="submit" class="btn primary small">검색</button>
      </form>
      ${s.which === 'from' ? '<button type="button" class="mine" data-act="mine">◎ 현재 위치에서 출발</button>' : ''}
      <div id="search-out">${searchOutHTML()}</div>
    </main>`;
}
// 검색 결과 목록 (입력한 글자를 굵게 표시)
function searchOutHTML() {
  const s = state.search;
  const q = s.query.trim();
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
      ${show ? `<b>${s.mode === 'walk' ? '' : MODES[s.mode].icon}</b>${s.min}분` : ''}</span>`;
  }).join('')}</div>`;
}
function modeTimesHTML(route) {
  const t = route.time;
  const items = [
    ['transit', '🚇', '대중교통', t.transit], ['walk', '🚶', '도보', t.walk],
    ['car', '🚗', '자차', t.car], ['bike', '🚲', '자전거', t.bike],
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
// 탄소 게이지: 막대 전체 = 혼자 자동차로 갈 때 배출량.
// 회색(연기) = 이 경로가 실제로 내는 양, 파랑(하늘) = 아낀 양. "파란 부분이 클수록 좋다"만 알면 돼요.
function ecoHTML(r, baseEm, selected) {
  const tier = r.tier || TIERS[0];
  const pct = baseEm > 0 ? Math.min(100, (r.emission / baseEm) * 100) : 0;
  const savePct = 100 - pct;
  return `<div class="eco eco-${tier.id}">
    <div class="eco-head">
      <span class="eco-sky" aria-hidden="true">${tier.sky}</span>
      <span class="eco-main"><b class="num">${formatG(r.saving)}</b> 덜 배출</span>
      <span class="eco-tree">${impact(r.saving).icon} ${impact(r.saving).short}</span>
    </div>
    ${selected ? `<div class="eco-gauge" role="img" aria-label="혼자 자동차 ${formatG(baseEm)} 중 이 경로는 ${formatG(r.emission)} 배출, ${Math.round(r.savingPct)}% 절약">
      <span class="g-emit" style="flex-basis:${Math.max(pct, 1.2)}%"></span>
      <span class="g-save">${savePct > 30 ? `아낀 만큼 ${Math.round(r.savingPct)}%` : ''}</span>
    </div>
` : ''}
  </div>`;
}
function routeCardHTML(r, selected, baseEm) {
  const open = state.openDetail === r.id;
  return `<article class="rcard ${selected ? 'sel' : ''}" data-act="select" data-id="${r.id}" aria-selected="${selected}">
    <div class="rc-top">
      ${(r.badges || []).map((b) => `<span class="rc-badge">${b}</span>`).join('')}
      ${r.real === true ? '' : `<span class="rc-est">${r.real === 'partial' ? '자차 구간 추정' : '추정'}</span>`}
    </div>
    <div class="rc-main">
      <span class="rc-min num">${formatMin(r.minutes)}</span>
      <span class="rc-sub">${arriveText(r.minutes)}${r.fare > 0 ? ` · ${r.fare.toLocaleString()}원` : ''}</span>
    </div>
    ${ecoHTML(r, baseEm, selected)}
    ${timeBarHTML(r)}
    ${selected ? `${legsHTML(r)}
    <div class="rc-actions">
      <button type="button" class="link-like" data-act="detail" data-id="${r.id}" aria-expanded="${open}">${open ? '접기' : '전체 안내 보기'} ›</button>
      <button type="button" class="btn primary small go" data-act="start-nav" data-id="${r.id}">안내 시작</button>
    </div>` : ''}
    ${open ? `<ol class="detail">${r.steps.map((s) => `<li style="--c:${s.color || MODES[s.mode].color}"><strong>${esc(s.text)}</strong>${s.sub ? `<span>${esc(s.sub)}</span>` : ''}</li>`).join('')}</ol>` : ''}
  </article>`;
}
function compareHTML(ranked, chosenId) {
  const rows = [ranked.baseline, ...ranked.all.slice().sort((a, b) => b.emission - a.emission)];
  const max = Math.max(...rows.map((r) => r.emission), 1);
  return `<details class="compare">
    <summary class="label">자동차로 갈 때와 비교 <small>(${rows.length}가지 방법)</small></summary>
    <ul>${rows.map((r) => {
      const tierId = r.id === 'car' || !r.tier ? 'base' : r.tier.id;
      const icon = r.id === 'car' ? '🚗' : r.tier ? r.tier.sky : '';
      return `<li class="c-row ${r.id === chosenId ? 'me' : ''} ${r.blocked ? 'off' : ''}">
        <span class="c-name">${icon} ${esc(r.name)}${r.blocked ? `<small>${esc(r.blocked)}</small>` : ''}</span>
        <span class="num c-val">${r.id === 'car' ? formatG(r.emission) : vsCarText(r.emission, ranked.baseline.emission)}</span>
        <span class="c-track"><span class="c-bar bar-${tierId}" style="width:${Math.max(1, (r.emission / max) * 100)}%"></span></span>
      </li>`;
    }).join('')}</ul>
  </details>`;
}
// "CO₂ 1kg은 얼마나?" — 단위 자체를 처음 보는 사람을 위한 설명
function kgGuideHTML() {
  const items = [...senseList(1000), { icon: '🚗', text: `혼자 자동차로 약 ${(1000 / FACTORS.car).toFixed(1)}km 달릴 때 나오는 양` }];
  return `<details class="kgguide">
    <summary>ⓘ CO₂ 1kg은 얼마나 될까요?</summary>
    <ul>${items.map((s) => `<li><span aria-hidden="true">${s.icon}</span>${esc(s.text)}</li>`).join('')}</ul>
    <p class="source">${EQUIV_SOURCE}</p>
  </details>`;
}
function resultSheetHTML() {
  const { ranked, options, chosen } = currentPlan();
  const { prefs, level } = state;
  const counts = ranked ? Object.fromEntries(TIERS.map((t) => [t.id, ranked.byTier[t.id].length])) : {};
  const tier = TIERS.find((t) => t.id === level);

  const tabs = `<div class="stabs" role="tablist">${TIERS.map((t) =>
    `<button type="button" role="tab" aria-selected="${level === t.id}" class="stab s-${t.id} ${level === t.id ? 'on' : ''}" data-act="tab" data-id="${t.id}">
      <span class="stab-sky" aria-hidden="true">${t.sky}</span>${t.label}<small class="num">${counts[t.id] != null ? counts[t.id] : ''}</small></button>`).join('')}</div>`;

  const filters = `<div class="filters">
    <select id="sort" class="fsel" aria-label="정렬">${SORTS.map((s) => `<option value="${s.id}" ${prefs.sort === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
  </div>`;

  let list;
  if (state.loading) list = '<p class="loading"><span class="spinner" aria-hidden="true"></span>실제 경로를 찾는 중이에요…</p>';
  else if (!options.length) list = `<p class="empty">이 구간에는 ${tier.label} 경로가 없어요. 다른 절약 단계를 눌러 보세요.</p>`;
  else list = options.map((r) => routeCardHTML(r, chosen && r.id === chosen.id, ranked.baseline.emission)).join('');

  return `
    ${tabs}
    ${filters}
    ${state.notes.map((n) => `<p class="notice warn small">${esc(n)}</p>`).join('')}
    <div class="rlist">${list}</div>
    ${ranked ? compareHTML(ranked, chosen && chosen.id) : ''}
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
        ${state.ready ? `<button type="button" class="tool ${state.follow ? 'on' : ''}" data-act="follow" aria-pressed="${state.follow}">${state.follow ? '◉ 내 위치' : '◎ 내 위치'}</button>` : ''}
      </div>
      ${state.gpsMsg ? `<p class="navx-toast">${esc(state.gpsMsg)}</p>` : ''}
      <div class="navx-bar">
        <button type="button" class="navx-end" data-act="nav-end" aria-label="안내 종료">✕</button>
        <div class="navx-eta">
          <b class="num">${formatMin(remMin)}</b>
          <span>${arriveText(remMin)}${remKm ? ` · ${remKm}` : ''}</span>
          <small>${impact(chosen.saving).icon} ${impact(chosen.saving).short}</small>
        </div>
        ${last ? '<button type="button" class="btn primary navx-next" data-act="nav-next">도착</button>'
          : manual ? '<button type="button" class="btn navx-next" data-act="nav-next">다음 ›</button>' : ''}
      </div>`;
  }
}

// ── 도착 ──
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
// 내 숲: 아낀 양을 모아 "소나무 1그루의 1년치(9.8kg)"를 채울 때마다 나무가 한 그루 자라요.
function forestHTML(log) {
  const trees = Math.floor(log.g / TREE_YEAR_G);
  const part = ((log.g % TREE_YEAR_G) / TREE_YEAR_G) * 100;
  const shown = Math.min(trees, 20);
  return `<section class="forest">
    <h3>나의 숲 <small>${log.trips}번 이동 · 총 ${formatG(log.g)} 아낌</small></h3>
    <div class="trees" aria-hidden="true">${'🌳'.repeat(shown)}${trees > shown ? `<b>+${trees - shown}</b>` : ''}<span class="sprout">🌱</span></div>
    <div class="grow"><span style="width:${part.toFixed(1)}%"></span></div>
    <p>${trees ? `소나무 <b>${trees}그루</b>가 1년 동안 흡수하는 양이에요. ` : ''}다음 나무까지 <b class="num">${formatG(TREE_YEAR_G - (log.g % TREE_YEAR_G))}</b> 남았어요</p>
  </section>`;
}
function doneHTML() {
  const { chosen } = currentPlan();
  const log = state.lastLog || loadLog();
  return `${appBar('도착')}
    <main class="content">
      <div class="done">
        ${balloonsHTML(chosen.saving)}
        <h2>${esc(impact(chosen.saving).long)}</h2>
        <p class="big num">−${formatG(chosen.saving)} <small>CO₂</small></p>
        <p>혼자 자동차로 올 때보다 ${Math.round(chosen.savingPct)}% 줄였어요</p>
        ${state.lastEarn ? `<div class="earn"><b>+${state.lastEarn.total.toLocaleString()}P</b><span>탄소 포인트 · 절약 ${state.lastEarn.kgP}P + 거리 ${state.lastEarn.kmP}P (${state.lastEarn.ecoKm.toFixed(1)}km)</span><button type="button" data-act="open-rank">이달의 랭킹 보기 ›</button></div>` : ''}
      </div>
      ${forestHTML(log)}
    </main>
    ${cta('<button type="button" class="btn primary" data-act="restart">새 경로 찾기</button>')}`;
}

const VIEWS = { admin: adminHTML, rank: rankHTML, account: accountHTML, campaigns: campaignsHTML, campaign: campaignHTML, 'campaign-new': campaignNewHTML, calendar: calendarHTML, login: loginHTML, 'email-login': emailLoginHTML, signup: signupHTML, main: mainHTML, home: homeHTML, search: searchHTML, result: resultHTML, nav: navHTML, done: doneHTML };

// 화면 전체 그리기
function render() {
  const app = document.getElementById('app');
  const { chosen } = currentPlan();
  let screen = state.screen;
  if ((screen === 'nav' || screen === 'done') && !chosen) screen = state.screen = 'home';

  if (!state.user && !['login', 'email-login', 'signup'].includes(screen)) screen = state.screen = 'login';
  app.innerHTML = VIEWS[screen]();
  app.dataset.screen = screen;
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
}

// 다른 화면으로 이동
function go(screen, dir) {
  if (state.screen === 'nav' && screen !== 'nav') stopTracking();
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
    calendar: state.calReturn || 'main', rank: 'main', account: 'main', campaigns: 'main', campaign: state.campReturn || 'campaigns', 'campaign-new': state.campNewReturn || 'campaigns', admin: 'account', home: 'main', search: state.searchReturn === 'result' ? 'result' : 'home', result: 'home', nav: 'result', done: 'main',
    'email-login': 'login', signup: 'login',
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
  if (state.to && distM(state.me, state.to) < ARRIVE_M) { finishTrip(); return; }
  const s = chosen.steps[state.step];
  if (s && s.target && state.step < chosen.steps.length - 1 && distM(state.me, s.target) < (s.radius || 30)) state.step += 1;
  if (mapCtl) mapCtl.setMe(state.me, state.follow);
  updateNav();
}

// 도착: 아낀 양을 내 기록에 한 번만 더하고 도착 화면으로
function finishTrip() {
  const { chosen } = currentPlan();
  if (chosen && !state.recorded) {
    state.lastLog = saveTrip(chosen.saving);
    state.lastEarn = tripPoints(chosen);
    addPoints(state.lastEarn.total);
    addSavingToCampaigns(chosen.saving);
    state.recorded = true;
  }
  go('done');
}

function useMyLocation() {
  const s = state.search;
  if (!navigator.geolocation) { s.message = '이 브라우저는 위치 확인을 지원하지 않아요.'; return render(); }
  s.message = '현재 위치를 찾는 중이에요…';
  render();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      state.places.reverse(lat, lng).then((address) => pickPlace({ name: '내 위치', address, lat, lng }));
    },
    () => { s.message = '위치 권한이 없어서 현재 위치를 찾지 못했어요. 장소를 검색해 주세요.'; render(); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
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
    .then((user) => { state.user = user; saveUser(user, !draft || draft.remember !== false); state.auth = { busy: false, message: '' }; go('main'); setTimeout(showCampNotices, 400); })
    .catch((err) => { state.auth = { busy: false, message: err.message || '로그인하지 못했어요. 다시 시도해 주세요.', draft: draft || {} }; render(); });
}
function goAuth(screen) {
  state.auth = { busy: false, message: '' };
  go(screen);
}

// 버튼 클릭 (data-act 값으로 구분)
const actions = {
  'login-kakao': () => {
    const box = document.querySelector('#login-form [name="remember"]');
    const remember = box ? box.checked : true;
    try { sessionStorage.setItem('pureun-remember', remember ? '1' : '0'); } catch (e) { /* 무시 */ }
    runAuth(AUTH.kakao(), { remember });
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
  'to-login': () => { state.auth = { busy: false, message: '' }; go('login', 'back'); },
  home: () => go('home', 'back'),
  back: () => goBack(),
  'open-route': () => go('home'),
  soon: () => toast('준비 중인 기능이에요'),
  reload: () => window.location.reload(),
  profile: () => openProfile(),
  'open-main': () => { if (state.screen !== 'main') go('main', 'back'); },
  'open-rank': () => { if (state.screen !== 'rank') go('rank'); },
  'open-account': () => { if (state.screen !== 'account') go('account'); },
  logout: () => logout(),
  'avatar-reset': () => { saveAvatar(''); render(); toast('기본 이미지로 바꿨어요'); },
  'open-camps': () => { if (state.screen !== 'campaigns') go('campaigns'); },
  'open-camp': (el) => { state.campId = el.dataset.id; state.campReturn = ['main', 'account', 'admin'].includes(state.screen) ? state.screen : 'campaigns'; go('campaign'); },
  'open-admin': () => { state.adminTab = 'pending'; go('admin'); },
  'admin-tab': (el) => { state.adminTab = el.dataset.id; render(); },
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
  },
  'camp-join': (el) => {
    const list = campStore.load(); const c = list.find((x) => x.id === el.dataset.id); if (!c) return;
    c.joined = !c.joined; c.participants += c.joined ? 1 : -1; campStore.save(list);
    render(); toast(c.joined ? '참여했어요! 친환경 이동이 이 캠페인에 쌓여요' : '참여를 그만뒀어요');
  },
  'cn-tag': (el) => { saveDraftFromForm(); state.campDraft.tag = el.dataset.id; render(); },
  'cn-goal': (el) => { saveDraftFromForm(); state.campDraft.goalKg = Number(el.dataset.id); render(); },
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
  'kg-view': (el) => {
    state.kgView = el.dataset.id;
    const card = document.getElementById('kg-card');
    if (card) card.innerHTML = kgCardHTML(state.kgView, loadLog().g);
  },
  result: () => go('result'),
  'back-search': () => goBack(),
  'open-search-from': () => openSearch('from'),
  'open-search-to': () => openSearch('to'),
  pick: (el) => pickPlace(state.search.results[Number(el.dataset.i)]),
  mine: () => useMyLocation(),
  swap: () => { [state.from, state.to] = [state.to, state.from]; findRoutes(); render(); },
  'to-result': () => go('result'),
  tab: (el) => { state.level = el.dataset.id; state.chosenId = null; state.openDetail = null; refreshResult(); },
  select: (el) => { if (state.chosenId === el.dataset.id) return; state.chosenId = el.dataset.id; refreshResult(); },
  detail: (el) => { state.chosenId = el.dataset.id; state.openDetail = state.openDetail === el.dataset.id ? null : el.dataset.id; refreshResult(); },
  fit: () => { if (mapCtl) mapCtl.fit(); },
  'start-nav': (el) => {
    if (el.dataset.id) state.chosenId = el.dataset.id;
    state.step = 0; state.me = null; state.follow = true; state.recorded = false;
    go('nav'); startTracking(); updateNav();
    loadShapeFor(currentPlan().chosen); // 고른 경로의 실제 노선 모양 (하루 호출 수 절약)
  },
  'nav-end': () => go('result', 'back'),
  'nav-prev': () => { if (state.step > 0) { state.step -= 1; updateNav(); } else go('result'); },
  'nav-next': () => {
    const { chosen } = currentPlan();
    if (state.step >= chosen.steps.length - 1) finishTrip();
    else { state.step += 1; updateNav(); }
  },
  follow: () => { state.follow = !state.follow; if (mapCtl) mapCtl.setMe(state.me, state.follow); updateNav(); },
  restart: () => { state.to = null; state.raw = null; go('home'); },
};

const appEl = document.getElementById('app');

appEl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.stopPropagation(); fn(el); }
});

appEl.addEventListener('submit', (e) => {
  if (e.target.id === 'search-form') { e.preventDefault(); runSearch(); }
  if (e.target.id === 'camp-form') { e.preventDefault(); submitCampaign(); }
  if (e.target.id === 'name-form') {
    e.preventDefault();
    const name = String(new FormData(e.target).get('name') || '').trim();
    if (name.length < 2) { toast('닉네임은 2자 이상이에요'); return; }
    let remember = true;
    try { remember = !!localStorage.getItem(USER_KEY); } catch (er) { /* 무시 */ }
    state.user = { ...state.user, name };
    saveUser(state.user, remember);
    toast('닉네임을 저장했어요');
  }
  if (e.target.id === 'login-form' || e.target.id === 'signup-form') {
    e.preventDefault();
    const f = new FormData(e.target);
    const v = (k) => String(f.get(k) || '').trim();
    const draft = { email: v('email'), name: v('name') };
    if (e.target.id === 'login-form') {
      // 칸별로 먼저 확인 (참고 디자인처럼 틀린 칸에 빨간 테두리)
      const em = v('email'); const pw = String(f.get('pw') || '');
      draft.remember = !!f.get('remember');
      const fail = !em ? ['errEmailEmpty', 'email'] : !EMAIL_RE.test(em) ? ['errEmailFormat', 'email'] : !pw ? ['errPwEmpty', 'pw'] : pw.length < 8 ? ['errPwShort', 'pw'] : null;
      if (fail) { state.auth = { busy: false, errKey: fail[0], errField: fail[1], draft }; render(); const el = document.querySelector(`#login-form [name="${fail[1] === 'pw' ? 'pw' : 'email'}"]`); if (el) el.focus(); return; }
      runAuth(AUTH.email(em, pw), draft);
    }
    else runAuth(AUTH.signup(v('name'), v('email'), String(f.get('pw') || ''), String(f.get('pw2') || '')), draft);
  }
});

appEl.addEventListener('input', (e) => {
  if (e.target.id === 'search-input') { state.search.query = e.target.value; scheduleSearch(); }
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
  if (e.target.id === 'avatar-input') {
    readAvatar(e.target.files[0])
      .then((url) => { if (!saveAvatar(url)) throw new Error('저장 공간이 부족해요.'); render(); toast('프로필 사진을 바꿨어요'); })
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
    state.user = { provider: 'kakao', id: data.id, name: data.name };
    let remember = true;
    try { remember = sessionStorage.getItem('pureun-remember') !== '0'; sessionStorage.removeItem('pureun-remember'); } catch (e) { /* 무시 */ }
    saveUser(state.user, remember);
    state.screen = 'main';
  }
})();

render();
setTimeout(showCampNotices, 500);

serverCheck = checkServer();
serverCheck.then(() => { if (state.screen === 'login') render(); });
serverCheck.then(() => { if (state.naver || state.kakao) { updateReady(); if (state.screen !== 'nav') render(); } });

if (HAS_NAVER) {
  const slow = setTimeout(() => {
    if (state.naver || state.mapError) return;
    state.mapError = '지도를 12초 넘게 불러오지 못했어요. 인터넷 연결을 확인하고, 광고 차단 확장 프로그램이 있다면 이 주소에서 꺼 주세요.';
    if (['home', 'result', 'nav'].includes(state.screen)) render();
  }, 12000);
  loadNaverMaps()
    .then((naver) => { clearTimeout(slow); state.naver = naver; state.mapError = ''; updateReady(); if (state.screen !== 'nav') render(); })
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
