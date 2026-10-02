// =====================================================================
//  푸른하늘 서버 (설치 필요 없음)
//
//  실행:  node server.js
//  접속:  http://localhost:5173
//  끄기:  Ctrl + C
//
//  하는 일
//  1. 앱 파일(index.html, app.js, style.css …)을 브라우저에 보내요.
//  2. 비밀키(Client Secret)가 필요한 네이버 API를 대신 불러줘요. (중계)
//     - /api/status            : 어떤 기능이 켜져 있는지
//     - /api/naver/directions  : 네이버 자동차 길찾기 (Directions 5)
//     - /api/naver/local       : 네이버 장소 이름 검색 (검색 API · 지역)
//     - /api/juso              : 행정안전부 도로명주소 검색 (건물명·도로명·지번)
//     비밀키는 private/keys.json 에만 있고, 브라우저로는 절대 보내지 않아요.
//
//  ※ index.html 을 더블클릭해서 열면(file://) 지도가 뜨지 않아요.
//    네이버는 등록한 주소(http://localhost:5173)에서만 지도를 보여줘요.
// =====================================================================
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 5173;
const APP_VERSION = '2026.10.02-review'; // app.js 의 APP_VERSION 과 같게
const ROOT = __dirname;
const PRIVATE_DIR = path.join(ROOT, 'private');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// 비밀키 읽기 (파일을 고치면 서버를 다시 켜지 않아도 다음 요청부터 반영)
function readKeys() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PRIVATE_DIR, 'keys.json'), 'utf8'));
  } catch (err) {
    return {};
  }
}
const has = (v) => typeof v === 'string' && v.trim().length > 0;

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

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

// ── 카카오 로그인 ──
//  1) 앱이 /api/kakao/start 로 보내면 → 카카오 로그인 화면으로 넘겨요
//  2) 카카오가 /auth/kakao?code=… 로 돌려보내면 → 비밀키로 토큰을 받고 닉네임을 읽어요
//  3) 앱 첫 화면(/#kakao=…)으로 돌려보내요. 카카오 토큰과 비밀키는 브라우저로 보내지 않아요.
//  필요한 키(private/keys.json): KAKAO_REST_API_KEY, KAKAO_CLIENT_SECRET
//  카카오 콘솔에 등록할 리다이렉트 URI: http://localhost:5173/auth/kakao
function kakaoRedirectUri(req, keys) {
  if (has(keys.KAKAO_REDIRECT_URI)) return keys.KAKAO_REDIRECT_URI.trim();
  return `http://${req.headers.host || `localhost:${PORT}`}/auth/kakao`;
}
function backToApp(res, data) {
  redirect(res, `/#kakao=${encodeURIComponent(JSON.stringify(data))}`);
}
async function kakaoCallback(req, res, query) {
  const keys = readKeys();
  const state = String(query.state || '').slice(0, 80);
  if (query.error) {
    const msg = query.error === 'access_denied' ? '카카오 로그인을 취소했어요.' : `카카오 로그인 오류: ${query.error_description || query.error}`;
    return backToApp(res, { ok: false, error: msg, state });
  }
  if (!query.code) return backToApp(res, { ok: false, error: '카카오에서 인가 코드를 받지 못했어요.', state });
  const params = {
    grant_type: 'authorization_code',
    client_id: keys.KAKAO_REST_API_KEY.trim(),
    redirect_uri: kakaoRedirectUri(req, keys),
    code: String(query.code),
  };
  if (has(keys.KAKAO_CLIENT_SECRET)) params.client_secret = keys.KAKAO_CLIENT_SECRET.trim();
  const tok = await postForm('https://kauth.kakao.com/oauth/token', params);
  if (tok.status !== 200 || !tok.json || !tok.json.access_token) {
    const code = tok.json && tok.json.error_code;
    const hint = {
      KOE010: '클라이언트 시크릿이 맞지 않아요. 카카오 콘솔의 값과 private/keys.json 의 KAKAO_CLIENT_SECRET 을 확인해 주세요.',
      KOE006: '리다이렉트 URI가 등록되지 않았어요. 카카오 콘솔에 http://localhost:5173/auth/kakao 를 등록해 주세요.',
      KOE320: '인가 코드가 만료됐어요. 다시 로그인해 주세요.',
    }[code] || `카카오 토큰 받기 실패(${tok.status}${code ? ` ${code}` : ''})`;
    console.log('  [카카오 로그인]', hint, String(tok.text || '').slice(0, 200));
    return backToApp(res, { ok: false, error: hint, state });
  }
  const me = await getJSON('https://kapi.kakao.com/v2/user/me', { Authorization: `Bearer ${tok.json.access_token}` });
  if (me.status !== 200 || !me.json) return backToApp(res, { ok: false, error: `카카오 사용자 정보를 읽지 못했어요(${me.status}).`, state });
  const acc = me.json.kakao_account || {};
  const name = (acc.profile && acc.profile.nickname) || (me.json.properties && me.json.properties.nickname) || '카카오 사용자';
  return backToApp(res, { ok: true, provider: 'kakao', id: String(me.json.id), name, state });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// 좌표 형식 확인: "경도,위도"
function validLngLat(s) {
  const m = /^(-?\d{1,3}(\.\d+)?),(-?\d{1,2}(\.\d+)?)$/.exec(String(s || ''));
  return !!m;
}

// ── 네이버 자동차 길찾기 (Directions 5) ──
// 새 주소(maps.apigw.ntruss.com)로 먼저 부르고, 안 되면 예전 주소로 한 번 더 시도해요.
async function naverDirections(query) {
  const keys = readKeys();
  if (!has(keys.NAVER_CLOUD_CLIENT_ID) || !has(keys.NAVER_CLOUD_CLIENT_SECRET)) {
    return [503, { error: 'private/keys.json 에 네이버 클라우드 Client ID와 Client Secret을 넣어 주세요.' }];
  }
  const { start, goal } = query;
  const option = ['trafast', 'tracomfort', 'traoptimal'].includes(query.option) ? query.option : 'traoptimal';
  if (!validLngLat(start) || !validLngLat(goal)) return [400, { error: '좌표 형식이 올바르지 않아요.' }];

  const headers = {
    'x-ncp-apigw-api-key-id': keys.NAVER_CLOUD_CLIENT_ID.trim(),
    'x-ncp-apigw-api-key': keys.NAVER_CLOUD_CLIENT_SECRET.trim(),
  };
  const qs = `start=${start}&goal=${goal}&option=${option}`;
  const hosts = ['https://maps.apigw.ntruss.com', 'https://naveropenapi.apigw.ntruss.com'];
  let last = null;
  for (const host of hosts) {
    try {
      last = await getJSON(`${host}/map-direction/v1/driving?${qs}`, headers);
      if (last.status === 200 && last.json) return [200, last.json];
    } catch (err) {
      last = { status: 502, text: err.message };
    }
  }
  const detail = last && last.json && last.json.error ? last.json.error.message || last.json.error.errorCode : last && last.text;
  const hint = last && (last.status === 401 || last.status === 403)
    ? ' 네이버 클라우드 Maps Application에서 Directions 5가 선택돼 있는지, Client ID·Secret이 맞는지 확인해 주세요.'
    : '';
  return [502, { error: `네이버 길찾기 응답 오류(${last ? last.status : '?'})${hint}`, detail: String(detail || '').slice(0, 300) }];
}

// ── 네이버 장소 이름 검색 (검색 API · 지역) ──
async function naverLocal(query) {
  const keys = readKeys();
  if (!has(keys.NAVER_SEARCH_CLIENT_ID) || !has(keys.NAVER_SEARCH_CLIENT_SECRET)) {
    return [503, { error: '네이버 검색 키가 아직 없어요.' }];
  }
  const q = String(query.query || '').slice(0, 100);
  if (!q.trim()) return [400, { error: '검색어가 비어 있어요.' }];
  const r = await getJSON(`https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=5&sort=random`, {
    'X-Naver-Client-Id': keys.NAVER_SEARCH_CLIENT_ID.trim(),
    'X-Naver-Client-Secret': keys.NAVER_SEARCH_CLIENT_SECRET.trim(),
  });
  if (r.status !== 200 || !r.json) return [502, { error: `네이버 검색 응답 오류(${r.status})`, detail: String(r.text || '').slice(0, 300) }];
  return [200, r.json];
}

// ── 행정안전부 도로명주소 검색 (건물명, 도로명, 지번으로 찾기) ──
// 실패해도 HTTP 200으로 오므로 results.common.errorCode 를 확인해요. 좌표는 주지 않아요.
async function jusoSearch(query) {
  const keys = readKeys();
  if (!has(keys.JUSO_CONFM_KEY)) return [503, { error: '도로명주소 승인키가 아직 없어요.' }];
  // 특수문자는 검색 오류를 일으켜서 빼요
  const q = String(query.keyword || '').replace(/[%=><'"`;\\[\]{}()|&^$*+?!#@~]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (q.length < 2) return [400, { error: '검색어를 두 글자 이상 입력해 주세요.' }];
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
  if (!results) return [502, { error: `도로명주소 검색 응답 오류(${r ? r.status : '?'})`, detail: String((r && r.text) || '').slice(0, 300) }];
  const common = results.common || {};
  if (String(common.errorCode) !== '0') {
    const msg = {
      E0001: '도로명주소 승인키가 맞지 않아요. private/keys.json 의 JUSO_CONFM_KEY를 확인해 주세요.',
      E0006: '검색어가 너무 넓어요. 시·구 이름이나 건물 이름을 더 붙여 주세요.',
      E0008: '검색어를 두 글자 이상 입력해 주세요.',
    }[common.errorCode] || `도로명주소 검색: ${common.errorMessage || common.errorCode}`;
    return [200, { items: [], error: msg }];
  }
  const items = (results.juso || []).map((j) => ({
    roadAddr: j.roadAddr, jibunAddr: j.jibunAddr, bdNm: j.bdNm, zipNo: j.zipNo,
    roadAddrPart1: j.roadAddrPart1,
  }));
  return [200, { items, total: Number(common.totalCount) || items.length }];
}

async function handleApi(req, res, url) {
  const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  try {
    if (url === '/api/status') {
      const k = readKeys();
      return sendJSON(res, 200, {
        version: APP_VERSION,
        naverDirections: has(k.NAVER_CLOUD_CLIENT_ID) && has(k.NAVER_CLOUD_CLIENT_SECRET),
        naverSearch: has(k.NAVER_SEARCH_CLIENT_ID) && has(k.NAVER_SEARCH_CLIENT_SECRET),
        jusoSearch: has(k.JUSO_CONFM_KEY),
        kakaoLogin: has(k.KAKAO_REST_API_KEY),
      });
    }
    if (url === '/api/kakao/start') {
      const k = readKeys();
      if (!has(k.KAKAO_REST_API_KEY)) return sendJSON(res, 503, { error: 'private/keys.json 에 KAKAO_REST_API_KEY 를 넣어 주세요.' });
      const qs = new URLSearchParams({
        client_id: k.KAKAO_REST_API_KEY.trim(),
        redirect_uri: kakaoRedirectUri(req, k),
        response_type: 'code',
        state: String(query.state || '').slice(0, 80),
      });
      return redirect(res, `https://kauth.kakao.com/oauth/authorize?${qs}`);
    }
    if (url === '/auth/kakao') return await kakaoCallback(req, res, query).catch((e) => backToApp(res, { ok: false, error: `카카오 로그인 중 문제가 생겼어요: ${e.message}`, state: String(query.state || '') }));
    if (url === '/api/naver/directions') { const [s, d] = await naverDirections(query); return sendJSON(res, s, d); }
    if (url === '/api/naver/local') { const [s, d] = await naverLocal(query); return sendJSON(res, s, d); }
    if (url === '/api/juso') { const [s, d] = await jusoSearch(query); return sendJSON(res, s, d); }
    return sendJSON(res, 404, { error: '없는 API 주소예요.' });
  } catch (err) {
    return sendJSON(res, 502, { error: '중계 중 문제가 생겼어요.', detail: err.message });
  }
}

http
  .createServer((req, res) => {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url.startsWith('/api/') || url === '/auth/kakao') return handleApi(req, res, url);

    if (url.endsWith('/')) url += 'index.html';
    const file = path.join(ROOT, path.normalize(url));
    const blocked =
      !file.startsWith(ROOT + path.sep) ||
      file.startsWith(PRIVATE_DIR) || // 비밀키 폴더는 절대 보내지 않음
      file === path.join(ROOT, 'server.js');
    if (blocked || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('없는 파일이에요');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    const k = readKeys();
    console.log(`\n  푸른하늘 ${APP_VERSION} 실행 중  →  http://localhost:${PORT}`);
    console.log(`  폴더: ${ROOT}`);
    console.log(`  네이버 자동차 길찾기 중계: ${has(k.NAVER_CLOUD_CLIENT_SECRET) ? '켜짐' : '꺼짐 (private/keys.json 확인)'}`);
    console.log(`  네이버 장소 이름 검색 중계: ${has(k.NAVER_SEARCH_CLIENT_SECRET) ? '켜짐' : '꺼짐 (검색 키 없음)'}`);
    console.log(`  도로명주소(행정안전부) 검색: ${has(k.JUSO_CONFM_KEY) ? '켜짐' : '꺼짐 (승인키 없음)'}`);
    console.log(`  카카오 로그인: ${has(k.KAKAO_REST_API_KEY) ? `켜짐 (리다이렉트 URI: http://localhost:${PORT}/auth/kakao)` : '꺼짐 → 체험용 로그인 (KAKAO_REST_API_KEY 없음)'}`);
    console.log('  (끄려면 Ctrl + C)\n');
  })
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`\n  [!] ${PORT}번 포트를 예전에 켠 푸른하늘이 이미 쓰고 있어요.`);
      console.log('      그대로 두면 브라우저에 "예전 버전" 앱이 떠요 (로그인 화면 없음).');
      console.log('      열려 있는 다른 검은 창을 모두 닫고(또는 Ctrl + C) START.bat 을 다시 실행해 주세요.\n');
    }
    else console.log(err);
  });
