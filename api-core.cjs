// =====================================================================
//  푸른하늘 API 중계 (공통)
//
//  내 맥의 server.js 와 Netlify Functions(netlify/functions/api.mjs)가
//  둘 다 이 파일을 써요. 그래서 기능을 고치면 두 곳에 같이 반영돼요.
//
//  - /api/status            : 어떤 기능이 켜져 있는지
//  - /api/naver/directions  : 네이버 자동차 길찾기 (Directions 5)
//  - /api/naver/local       : 네이버 장소 이름 검색 (검색 API · 지역)
//  - /api/juso              : 행정안전부 도로명주소 검색
//  - /api/kakao/start       : 카카오 로그인 화면으로 보내기
//  - /auth/kakao            : 카카오 로그인 후 돌아오는 곳
//
//  비밀키는 keys 로만 받아요.
//   · 내 맥: private/keys.json
//   · Netlify: 프로젝트 설정 → Environment variables (이름은 keys.json 과 같아요)
//  비밀키는 브라우저로 절대 보내지 않아요.
// =====================================================================
const https = require('https');

const has = (v) => typeof v === 'string' && v.trim().length > 0;
const KEY_PLACE = '키 설정(맥: private/keys.json · Netlify: Environment variables)';

// 다른 서버에 GET 요청 보내기
function getJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) { /* JSON이 아닐 수 있음 */ }
        resolve({ status: res.statusCode, json, text: body });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('응답 시간이 너무 길어요')));
  });
}

// 다른 서버에 POST(form) 요청 보내기 — 카카오 토큰 받기용
function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 무시 */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('응답 시간이 너무 길어요')));
    req.end(body);
  });
}

const json = (status, data) => ({ status, json: data });
const redirect = (location) => ({ status: 302, redirect: location });

// ── 카카오 로그인 ──
//  카카오 콘솔에 등록할 리다이렉트 URI: <앱 주소>/auth/kakao
//   예) http://localhost:5173/auth/kakao , https://pureun-bluesky.netlify.app/auth/kakao
function kakaoRedirectUri(keys, origin) {
  if (has(keys.KAKAO_REDIRECT_URI)) return keys.KAKAO_REDIRECT_URI.trim();
  return `${origin}/auth/kakao`;
}
const backToApp = (data) => redirect(`/#kakao=${encodeURIComponent(JSON.stringify(data))}`);

async function kakaoCallback(keys, origin, query) {
  const state = String(query.state || '').slice(0, 80);
  if (query.error) {
    const msg = query.error === 'access_denied' ? '카카오 로그인을 취소했어요.' : `카카오 로그인 오류: ${query.error_description || query.error}`;
    return backToApp({ ok: false, error: msg, state });
  }
  if (!query.code) return backToApp({ ok: false, error: '카카오에서 인가 코드를 받지 못했어요.', state });
  if (!has(keys.KAKAO_REST_API_KEY)) return backToApp({ ok: false, error: `KAKAO_REST_API_KEY 가 없어요. ${KEY_PLACE}을 확인해 주세요.`, state });
  const redirectUri = kakaoRedirectUri(keys, origin);
  const params = {
    grant_type: 'authorization_code',
    client_id: keys.KAKAO_REST_API_KEY.trim(),
    redirect_uri: redirectUri,
    code: String(query.code),
  };
  if (has(keys.KAKAO_CLIENT_SECRET)) params.client_secret = keys.KAKAO_CLIENT_SECRET.trim();
  const tok = await postForm('https://kauth.kakao.com/oauth/token', params);
  if (tok.status !== 200 || !tok.json || !tok.json.access_token) {
    const code = tok.json && tok.json.error_code;
    const hint = {
      KOE010: `클라이언트 시크릿이 맞지 않아요. 카카오 콘솔의 값과 ${KEY_PLACE}의 KAKAO_CLIENT_SECRET 을 확인해 주세요.`,
      KOE006: `리다이렉트 URI가 등록되지 않았어요. 카카오 콘솔에 ${redirectUri} 를 등록해 주세요.`,
      KOE320: '인가 코드가 만료됐어요. 다시 로그인해 주세요.',
    }[code] || `카카오 토큰 받기 실패(${tok.status}${code ? ` ${code}` : ''})`;
    console.log('[카카오 로그인]', hint, String(tok.text || '').slice(0, 200));
    return backToApp({ ok: false, error: hint, state });
  }
  const me = await getJSON('https://kapi.kakao.com/v2/user/me', { Authorization: `Bearer ${tok.json.access_token}` });
  if (me.status !== 200 || !me.json) return backToApp({ ok: false, error: `카카오 사용자 정보를 읽지 못했어요(${me.status}).`, state });
  const acc = me.json.kakao_account || {};
  const name = (acc.profile && acc.profile.nickname) || (me.json.properties && me.json.properties.nickname) || '카카오 사용자';
  return backToApp({ ok: true, provider: 'kakao', id: String(me.json.id), name, state });
}

// 좌표 형식 확인: "경도,위도"
const validLngLat = (s) => /^(-?\d{1,3}(\.\d+)?),(-?\d{1,2}(\.\d+)?)$/.test(String(s || ''));

// ── 네이버 자동차 길찾기 (Directions 5) ──
async function naverDirections(keys, query) {
  if (!has(keys.NAVER_CLOUD_CLIENT_ID) || !has(keys.NAVER_CLOUD_CLIENT_SECRET)) {
    return json(503, { error: `${KEY_PLACE}에 NAVER_CLOUD_CLIENT_ID · NAVER_CLOUD_CLIENT_SECRET 을 넣어 주세요.` });
  }
  const { start, goal } = query;
  const option = ['trafast', 'tracomfort', 'traoptimal'].includes(query.option) ? query.option : 'traoptimal';
  if (!validLngLat(start) || !validLngLat(goal)) return json(400, { error: '좌표 형식이 올바르지 않아요.' });
  const headers = {
    'x-ncp-apigw-api-key-id': keys.NAVER_CLOUD_CLIENT_ID.trim(),
    'x-ncp-apigw-api-key': keys.NAVER_CLOUD_CLIENT_SECRET.trim(),
  };
  const qs = `start=${start}&goal=${goal}&option=${option}`;
  let last = null;
  for (const host of ['https://maps.apigw.ntruss.com', 'https://naveropenapi.apigw.ntruss.com']) {
    try {
      last = await getJSON(`${host}/map-direction/v1/driving?${qs}`, headers);
      if (last.status === 200 && last.json) return json(200, last.json);
    } catch (err) {
      last = { status: 502, text: err.message };
    }
  }
  const detail = last && last.json && last.json.error ? last.json.error.message || last.json.error.errorCode : last && last.text;
  const hint = last && (last.status === 401 || last.status === 403)
    ? ' 네이버 클라우드 Maps Application에서 Directions 5가 선택돼 있는지, Client ID·Secret이 맞는지 확인해 주세요.'
    : '';
  return json(502, { error: `네이버 길찾기 응답 오류(${last ? last.status : '?'})${hint}`, detail: String(detail || '').slice(0, 300) });
}

// ── 네이버 장소 이름 검색 (검색 API · 지역) ──
async function naverLocal(keys, query) {
  if (!has(keys.NAVER_SEARCH_CLIENT_ID) || !has(keys.NAVER_SEARCH_CLIENT_SECRET)) return json(503, { error: '네이버 검색 키가 아직 없어요.' });
  const q = String(query.query || '').slice(0, 100);
  if (!q.trim()) return json(400, { error: '검색어가 비어 있어요.' });
  const r = await getJSON(`https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=5&sort=random`, {
    'X-Naver-Client-Id': keys.NAVER_SEARCH_CLIENT_ID.trim(),
    'X-Naver-Client-Secret': keys.NAVER_SEARCH_CLIENT_SECRET.trim(),
  });
  if (r.status !== 200 || !r.json) return json(502, { error: `네이버 검색 응답 오류(${r.status})`, detail: String(r.text || '').slice(0, 300) });
  return json(200, r.json);
}

// ── 행정안전부 도로명주소 검색 ──
// 실패해도 HTTP 200으로 오므로 results.common.errorCode 를 확인해요. 좌표는 주지 않아요.
async function jusoSearch(keys, query) {
  if (!has(keys.JUSO_CONFM_KEY)) return json(503, { error: '도로명주소 승인키가 아직 없어요.' });
  const q = String(query.keyword || '').replace(/[%=><'"`;\\[\]{}()|&^$*+?!#@~]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (q.length < 2) return json(400, { error: '검색어를 두 글자 이상 입력해 주세요.' });
  const qs = `confmKey=${encodeURIComponent(keys.JUSO_CONFM_KEY.trim())}&currentPage=1&countPerPage=10&keyword=${encodeURIComponent(q)}&resultType=json`;
  let r = null;
  for (const host of ['https://business.juso.go.kr', 'https://www.juso.go.kr']) {
    try {
      r = await getJSON(`${host}/addrlink/addrLinkApi.do?${qs}`, {});
      if (r.status === 200 && r.json && r.json.results) break;
    } catch (err) {
      r = { status: 502, text: err.message };
    }
  }
  const results = r && r.json && r.json.results;
  if (!results) return json(502, { error: `도로명주소 검색 응답 오류(${r ? r.status : '?'})`, detail: String((r && r.text) || '').slice(0, 300) });
  const common = results.common || {};
  if (String(common.errorCode) !== '0') {
    const msg = {
      E0001: `도로명주소 승인키가 맞지 않아요. ${KEY_PLACE}의 JUSO_CONFM_KEY 를 확인해 주세요. (승인키에 등록한 사이트 주소도 확인)`,
      E0006: '검색어가 너무 넓어요. 시·구 이름이나 건물 이름을 더 붙여 주세요.',
      E0008: '검색어를 두 글자 이상 입력해 주세요.',
    }[common.errorCode] || `도로명주소 검색: ${common.errorMessage || common.errorCode}`;
    return json(200, { items: [], error: msg });
  }
  const items = (results.juso || []).map((j) => ({
    roadAddr: j.roadAddr, jibunAddr: j.jibunAddr, bdNm: j.bdNm, zipNo: j.zipNo, roadAddrPart1: j.roadAddrPart1,
  }));
  return json(200, { items, total: Number(common.totalCount) || items.length });
}

// 요청 하나 처리하기 → { status, json } 또는 { status: 302, redirect }
//  path: '/api/…' 또는 '/auth/kakao' · query: 주소 뒤 ?값들 · keys: 비밀키 · origin: 'https://…' · version: 앱 버전
async function handle({ path, query, keys, origin, version, where }) {
  try {
    if (path === '/api/status') {
      return json(200, {
        version,
        where,
        naverDirections: has(keys.NAVER_CLOUD_CLIENT_ID) && has(keys.NAVER_CLOUD_CLIENT_SECRET),
        naverSearch: has(keys.NAVER_SEARCH_CLIENT_ID) && has(keys.NAVER_SEARCH_CLIENT_SECRET),
        jusoSearch: has(keys.JUSO_CONFM_KEY),
        kakaoLogin: has(keys.KAKAO_REST_API_KEY),
      });
    }
    if (path === '/api/kakao/start') {
      if (!has(keys.KAKAO_REST_API_KEY)) return json(503, { error: `${KEY_PLACE}에 KAKAO_REST_API_KEY 를 넣어 주세요.` });
      const qs = new URLSearchParams({
        client_id: keys.KAKAO_REST_API_KEY.trim(),
        redirect_uri: kakaoRedirectUri(keys, origin),
        response_type: 'code',
        state: String(query.state || '').slice(0, 80),
      });
      return redirect(`https://kauth.kakao.com/oauth/authorize?${qs}`);
    }
    if (path === '/auth/kakao') {
      return await kakaoCallback(keys, origin, query)
        .catch((e) => backToApp({ ok: false, error: `카카오 로그인 중 문제가 생겼어요: ${e.message}`, state: String(query.state || '') }));
    }
    if (path === '/api/naver/directions') return await naverDirections(keys, query);
    if (path === '/api/naver/local') return await naverLocal(keys, query);
    if (path === '/api/juso') return await jusoSearch(keys, query);
    return json(404, { error: '없는 API 주소예요.' });
  } catch (err) {
    return json(502, { error: '중계 중 문제가 생겼어요.', detail: err.message });
  }
}

// 비밀키 이름 목록 (Netlify 환경변수 이름과 같아요)
const KEY_NAMES = ['NAVER_CLOUD_CLIENT_ID', 'NAVER_CLOUD_CLIENT_SECRET', 'NAVER_SEARCH_CLIENT_ID', 'NAVER_SEARCH_CLIENT_SECRET', 'JUSO_CONFM_KEY', 'KAKAO_REST_API_KEY', 'KAKAO_CLIENT_SECRET', 'KAKAO_REDIRECT_URI'];

module.exports = { handle, has, KEY_NAMES };
