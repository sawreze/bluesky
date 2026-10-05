// 테스트 전용 서버: 앱 파일 + Vercel 함수(/api/data, /api/auth/*)를 진짜 Postgres 에 붙여서 돌려요
//  실행: TESTDB=pureun_e2e node test/devserver.cjs   → http://localhost:5199
process.env.DATABASE_URL = process.env.NO_DB ? '' : 'postgres://test';
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../api/_db.cjs');
db._makeSql = require('./pgshim.cjs');
const routes = {
  '/api/data': require('../api/data.js'),
  '/api/auth/login': require('../api/auth/login.js'),
  '/api/auth/signup': require('../api/auth/signup.js'),
};
const ROOT = path.join(__dirname, '..');
// 보안 헤더: 배포(vercel.json)와 똑같이
const SEC = Object.fromEntries((JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')).headers.find((h) => h.source === '/(.*)') || { headers: [] }).headers.map((h) => [h.key, h.value]));
const TYPES = { '.jpg': 'image/jpeg', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  Object.entries(SEC).forEach(([k, v]) => res.setHeader(k, v));
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ version: '2026.10.03-db', where: 'test', kakaoLogin: false })); }
  const fn = routes[u.pathname];
  if (fn) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      req.query = Object.fromEntries(u.searchParams);
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }
      res.status = (n) => { res.statusCode = n; return res; };
      res.json = (o) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      res.send = (b) => res.end(b);
      Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.statusCode = 500; res.end('{}'); });
    });
    return;
  }
  if (u.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"없음"}'); }
  const file = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT) || 5199, () => console.log('test server http://localhost:' + (Number(process.env.PORT) || 5199)));
