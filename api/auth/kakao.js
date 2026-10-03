// 공개 주소는 /auth/kakao (vercel.json 의 rewrites 가 여기로 보내요)
//  카카오 로그인이 성공하면 여기서 바로 회원 DB에 기록하고 출입증 쿠키를 줘요.
//  (앱이 "나 몇 번 회원이야"라고 따로 알려 주는 방식은 쓰지 않아요 — 남이 흉내 낼 수 있어서)
const db = require('../_db.cjs');

async function afterKakao(location) {
  const m = /^\/#kakao=(.+)$/.exec(location);
  if (!m || !db.hasDb()) return location;
  let data;
  try { data = JSON.parse(decodeURIComponent(m[1])); } catch (e) { return location; }
  if (!data || !data.ok) return location;
  return { data };
}

const handler = require('../_respond.cjs').makeHandler('/auth/kakao', async (location, req, res) => {
  const r = await afterKakao(location);
  if (typeof r === 'string') return r;
  const data = r.data;
  try {
    const u = await db.store.upsertSocial('kakao', String(data.id), String(data.name || '카카오 사용자').slice(0, 40));
    db.setSession(res, u.id, !String(data.state || '').endsWith('.r0')); // 앱이 "로그인 유지 안 함"이면 state 끝에 .r0
    Object.assign(data, db.pub(u));
  } catch (e) {
    console.log('[카카오 회원 기록 오류]', e && e.message);
    return `/#kakao=${encodeURIComponent(JSON.stringify({ ok: false, error: '회원 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', state: data.state }))}`;
  }
  return `/#kakao=${encodeURIComponent(JSON.stringify(data))}`;
});
module.exports = handler;
