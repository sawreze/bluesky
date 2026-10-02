// =====================================================================
//  Netlify Functions: 푸른하늘 API 중계
//  내 맥의 server.js 와 같은 일을 Netlify 서버에서 해요 (코드는 api-core.cjs 공통).
//  비밀키는 Netlify → Project configuration → Environment variables 에 넣어요.
//  (이름: NAVER_CLOUD_CLIENT_ID, NAVER_CLOUD_CLIENT_SECRET, JUSO_CONFM_KEY,
//         KAKAO_REST_API_KEY, KAKAO_CLIENT_SECRET …  private/keys.json 과 같은 이름)
// =====================================================================
import api from '../../api-core.cjs';

const APP_VERSION = '2026.10.02-arrive'; // app.js 의 APP_VERSION 과 같게

export default async (req) => {
  const url = new URL(req.url);
  const keys = {};
  for (const name of api.KEY_NAMES) keys[name] = process.env[name] || '';
  const r = await api.handle({
    path: url.pathname.replace(/\/+$/, ''),
    query: Object.fromEntries(url.searchParams),
    keys,
    origin: url.origin,
    version: APP_VERSION,
    where: 'netlify',
  });
  if (r.redirect) return new Response(null, { status: 302, headers: { Location: r.redirect, 'Cache-Control': 'no-store' } });
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
};

export const config = { path: ['/api/*', '/auth/kakao'] };
