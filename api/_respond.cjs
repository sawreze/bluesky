// =====================================================================
//  Vercel Functions 공용 도우미
//  api-core.cjs 는 그대로 쓰고, 여기서 Vercel의 (req, res) 모양에 맞게만 이어줘요.
//  파일 이름이 _ 로 시작하면 Vercel이 "이 파일은 API 경로 아님"으로 봐서
//  api/status.js 같은 진짜 경로 파일들만 각자 주소가 돼요.
// =====================================================================
const api = require('../api-core.cjs');

const APP_VERSION = '2026.10.03-campmain'; // app.js 의 APP_VERSION 과 같게

function readKeys() {
  const keys = {};
  for (const name of api.KEY_NAMES) keys[name] = process.env[name] || '';
  return keys;
}

// path: 이 경로가 처리할 고정 주소 (예: '/api/status', '/auth/kakao')
function makeHandler(path) {
  return async function handler(req, res) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const origin = `${proto}://${req.headers.host}`;
    const r = await api.handle({
      path,
      query: req.query || {},
      keys: readKeys(),
      origin,
      version: APP_VERSION,
      where: 'vercel',
    });
    res.setHeader('Cache-Control', 'no-store');
    if (r.redirect) {
      res.writeHead(302, { Location: r.redirect });
      return res.end();
    }
    res.status(r.status).json(r.json);
  };
}

module.exports = { makeHandler };
