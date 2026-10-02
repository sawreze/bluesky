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
//     (중계 코드는 api-core.cjs — Netlify Functions 도 같은 파일을 써요)
//
//  ※ index.html 을 더블클릭해서 열면(file://) 지도가 뜨지 않아요.
//    네이버는 등록한 주소(http://localhost:5173)에서만 지도를 보여줘요.
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./api-core.cjs');

const PORT = 5173;
const APP_VERSION = '2026.10.02-search'; // app.js 의 APP_VERSION 과 같게
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

// API 중계는 api-core.cjs 에 있어요 (Netlify Functions 와 같은 코드)
async function handleApi(req, res, url) {
  const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  const origin = `http://${req.headers.host || `localhost:${PORT}`}`;
  const r = await api.handle({ path: url, query, keys: readKeys(), origin, version: APP_VERSION, where: 'local' });
  if (r.redirect) {
    res.writeHead(302, { Location: r.redirect, 'Cache-Control': 'no-store' });
    return res.end();
  }
  res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(r.json));
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
      file === path.join(ROOT, 'server.js') ||
      file === path.join(ROOT, 'api-core.cjs');
    if (blocked || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('없는 파일이에요');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    const k = readKeys();
    const has = api.has;
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
