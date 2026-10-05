// =====================================================================
//  앱 데이터 API — 주소 하나(/api/data?a=동작)로 모두 처리해요.
//  (Vercel 무료 요금제는 서버 함수 개수에 제한이 있어서 하나로 모았어요)
//
//  GET  a=sync                     내 정보 · 기록 요약 · 캠페인 목록 · 이달의 랭킹을 한 번에
//  GET  a=camp-rank&id=            캠페인 참여자 기여 랭킹
//  GET  a=img&k=a|c&id=            프로필 사진(a) · 캠페인 표지(c)
//  POST a=trip                     도착한 이동 저장 (+ 포인트, 캠페인 기여)
//  POST a=shop-buy                 포인트 상점에서 상품 교환
//  POST a=camp-save                캠페인 만들기 / 고쳐서 다시 신청
//  POST a=camp-del | camp-like | camp-join | camp-seen
//  POST a=camp-review              (관리자) 승인 · 반려
//  POST a=profile                  닉네임 · 프로필 사진
//  POST a=logout                   출입증 쿠키 지우기
//  POST a=demo-seed | demo-clear   (관리자) 예시 회원 100명 + 내 캘린더 시연 기록 넣기 · 지우기 (_seed.cjs)
//  POST a=admin-points             (관리자) 포인트 지급 · 삭제 (mode: grant | deduct)
//  POST a=admin-carbon             (관리자) 탄소 절약량 더하기 · 빼기 (mode: plus | minus)
//  GET  a=admin-users&q=           (관리자) 회원 검색 (q 비우면 차단된 회원 목록)
//  POST a=admin-block | admin-del-user (관리자) 회원 차단·해제 · 삭제
//
//  누구인지는 출입증 쿠키로만 확인해요. 포인트도 서버가 계산해요.
// =====================================================================
const PT_PER_KG = 10;          // 아낀 탄소 1kg당 포인트 (app.js 와 같게)
const PT_PER_KM = 1;           // 친환경 이동 1km당 포인트
const POPULAR_MIN_KG = 100;    // 캠페인 보상 대상: 목표가 이 이상인 캠페인
// 캠페인 보상 (캠페인이 끝날 때 = 목표 달성 7일 뒤, 최종 달성률로 한 번 정산)
//  달성률 100% / 120% / 150% / 200% 이상 → 만든 사람: 목표 kg × 2·3·4·5P, 참여자: 내가 아낀 kg × 10·12·15·20P
const REWARD_TIERS = [{ pct: 200, maker: 5, member: 20 }, { pct: 150, maker: 4, member: 15 }, { pct: 120, maker: 3, member: 12 }, { pct: 100, maker: 2, member: 10 }];
const MONTH_AWARDS = [1000, 500, 300]; // 이달의 절약왕 1·2·3등 보너스 (다음 달에 지급)
// 순위 포인트(이번 달 탄소 포인트)에서는 절약왕 보너스(monthly_award)와 상점 사용(shop)을 빼요
const SHOP_DAILY_MAX = 10;
const END_DAYS = 7;            // 목표 달성 후 이 날짜가 지나면 캠페인이 목록에서 내려가요
const CAR_G_PER_KM = 210;
const TAGS = ['transit', 'walk', 'bike', 'carfree', 'together'];
const CAMP_MODES = ['bus', 'subway', 'bike', 'walk'];
const TRIP_MODES = ['car', 'bus', 'subway', 'bike', 'walk'];
// ── 이동 기록 부정 적립 막기 ──
//  포인트가 상점에서 쓰이니까, 휴대폰이 보내는 거리·시간을 그대로 믿지 않고 말이 되는지 확인해요.
//  - 출발·도착 직선거리보다 이동 거리가 터무니없이 길면 X (길이 돌아가는 건 3배 + 3km까지 인정)
//  - 걸린 시간에 비해 너무 빠르면 X (수단별 최고 속도)
//  - 하루 기록 수 · 하루 친환경 이동 거리에 상한
//  - 같은 출발·도착을 짧은 시간에 또 보내면 X
const TRIP_LIMITS = { detour: 3, slackKm: 3, perDay: 20, kmPerDay: 150, repeatMin: 10, off: false };
const MAX_KMH = { walk: 15, bike: 40, bus: 90, subway: 120, car: 130 };
const kmBetween = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const MAX_COVER = 1500000;     // 표지 사진 (글자로 바꾼 크기) 최대 약 1.5MB
const MAX_AVATAR = 400000;

const SEED = require('./_seed.cjs');
class Bad extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new Bad(status, msg); };
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v) => Number(v) || 0;
const ms = (v) => (v ? new Date(v).getTime() : 0);
const intId = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) bad('잘못된 번호예요.'); return n; };
const isAdminRow = (u) => String((u && u.role) || '').trim() === 'admin';
const imgUrl = (k, id, v) => `/api/data?a=img&k=${k}&id=${id}&v=${encodeURIComponent(String(v || '0'))}`;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

function body(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

// 테스트에서 상한을 끄거나 바꿀 수 있게 (HTTP 로는 못 건드려요)
module.exports = Object.assign(makeData, { TRIP_LIMITS });
function makeData(db) {
  const sql = () => db.sql();

  // ── 내 기록 요약 ──
  async function summary(uid) {
    const [st] = await sql()`SELECT trip_count, saved_g, points FROM v_user_stats WHERE user_id = ${uid}`;
    const daily = await sql()`SELECT to_char(arrived_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d, SUM(saved_g) AS g, COUNT(*) AS n
      FROM trips WHERE user_id = ${uid} GROUP BY 1 ORDER BY 1`;
    // 이번 달 탄소 포인트(순위용): 절약왕 보너스·상점 사용은 빼고 모은 포인트만
    const months = await sql()`SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m, SUM(amount) AS p
      FROM point_transactions WHERE user_id = ${uid} AND reason NOT IN ('monthly_award', 'shop') GROUP BY 1`;
    // 최근 출발지·도착지 (실제로 이동한 기록에서, 장소별 가장 최근 15곳)
    const places = await sql()`SELECT name, lat, lng, MAX(at) AS at FROM (
        SELECT origin_name AS name, origin_lat AS lat, origin_lng AS lng, arrived_at AS at FROM trips WHERE user_id = ${uid}
        UNION ALL SELECT dest_name, dest_lat, dest_lng, arrived_at FROM trips WHERE user_id = ${uid}
      ) x WHERE name NOT IN ('내 위치', '현재 위치', '위치') GROUP BY name, lat, lng ORDER BY MAX(at) DESC LIMIT 15`;
    const log = { g: num(st && st.saved_g), trips: num(st && st.trip_count), days: daily.map((r) => r.d), daily: {} };
    daily.forEach((r) => { log.daily[r.d] = { g: num(r.g), n: num(r.n) }; });
    const monthPoints = {};
    months.forEach((r) => { monthPoints[r.m] = num(r.p); });
    const recentPlaces = places.map((r) => ({ name: r.name, lat: Number(r.lat), lng: Number(r.lng), at: ms(r.at) }));
    return { log, points: num(st && st.points), monthPoints, recentPlaces };
  }

  // ── 캠페인 목록 (게시 중인 것 + 내가 만든 것, 관리자는 전부) ──
  async function campaigns(me, onlyId = null) {
    const uid = me.id;
    const admin = isAdminRow(me);
    const rows = await sql()`
      SELECT c.id, c.creator_id, u.name AS creator, c.tag_code, c.mode_code, c.title, c.subtitle, c.body,
             (COALESCE(c.cover_url, '') <> '') AS has_cover, CASE WHEN c.cover_url LIKE 'assets/camp/%' THEN c.cover_url END AS static_cover, c.goal_kg, c.created_at, c.submitted_at,
             st.status, st.progress_g, st.participants, st.likes, s.reject_reason, s.reviewed_at, st.reached_at,
             (st.reached_at IS NOT NULL AND st.reached_at < now() - make_interval(days => ${END_DAYS})) AS ended,
             EXISTS (SELECT 1 FROM campaign_likes l WHERE l.campaign_id = c.id AND l.user_id = ${uid}) AS liked,
             EXISTS (SELECT 1 FROM campaign_participants p WHERE p.campaign_id = c.id AND p.user_id = ${uid}) AS joined,
             COALESCE((SELECT SUM(saved_g) FROM trips t WHERE t.campaign_id = c.id AND t.user_id = ${uid}), 0) AS my_g,
             (SELECT COUNT(*) FROM trips t WHERE t.campaign_id = c.id AND t.user_id = ${uid}) AS my_trips,
             EXISTS (SELECT 1 FROM point_transactions x WHERE x.campaign_id = c.id AND x.reason IN ('campaign_reward', 'campaign_bonus')) AS rewarded,
             COALESCE((SELECT SUM(amount) FROM point_transactions x WHERE x.campaign_id = c.id AND x.user_id = ${uid} AND x.reason IN ('campaign_reward', 'campaign_bonus')), 0) AS my_reward,
             lr.decision AS last_decision, lr.seen_at AS last_seen, lr.reviewed_at AS last_reviewed
      FROM campaigns c
      JOIN users u ON u.id = c.creator_id
      JOIN v_campaign_stats st ON st.campaign_id = c.id
      JOIN v_campaign_status s ON s.campaign_id = c.id
      LEFT JOIN LATERAL (
        SELECT decision, seen_at, reviewed_at FROM campaign_reviews r WHERE r.campaign_id = c.id ORDER BY reviewed_at DESC, id DESC LIMIT 1
      ) lr ON true
      -- 게시 중(종료 전)인 것 + 내가 만든 것 + 내가 참여했던 것(종료돼도 보여요), 관리자는 전부
      WHERE ((st.status = 'approved' AND (st.reached_at IS NULL OR st.reached_at >= now() - make_interval(days => ${END_DAYS})))
          OR c.creator_id = ${uid} OR ${admin}::boolean
          OR EXISTS (SELECT 1 FROM campaign_participants p WHERE p.campaign_id = c.id AND p.user_id = ${uid}))
        AND (${onlyId}::int IS NULL OR c.id = ${onlyId}::int)
      ORDER BY c.submitted_at DESC
      LIMIT 500`;
    return rows.map((r) => {
      const mine = Number(r.creator_id) === Number(uid);
      const unseen = mine && r.last_decision && !r.last_seen && ms(r.last_reviewed) >= ms(r.submitted_at);
      return {
        id: String(r.id), tag: r.tag_code, mode: r.mode_code, title: r.title, sub: r.subtitle || '', body: r.body || '',
        cover: r.static_cover || (r.has_cover ? imgUrl('c', r.id, ms(r.submitted_at)) : ''), // 추천 캠페인은 앱에 들어 있는 사진
        goalKg: num(r.goal_kg), progressG: num(r.progress_g), participants: num(r.participants), likes: num(r.likes),
        creator: r.creator, ownerId: mine ? '@me' : `@u${r.creator_id}`, mine,
        status: r.status, rejectReason: r.reject_reason || '',
        createdAt: ms(r.created_at), submittedAt: ms(r.submitted_at), reviewedAt: ms(r.reviewed_at),
        liked: !!r.liked, joined: !!r.joined, myG: num(r.my_g), myTrips: num(r.my_trips), rewarded: !!r.rewarded, myReward: num(r.my_reward),
        notice: unseen ? { type: r.last_decision, seen: false } : null,
        reachedAt: ms(r.reached_at), ended: !!r.ended,
      };
    });
  }

  // ── 이달의 절약왕 (한국 시간 기준 달) ──
  async function monthRank(uid, mKey) {
    const [{ m }] = mKey ? [{ m: mKey }] : await sql()`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m`;
    const rows = await sql()`
      SELECT u.id, u.name, left(md5(COALESCE(u.avatar_url, '')), 10) AS av, (COALESCE(u.avatar_url, '') <> '') AS has_av, SUM(p.amount) AS pts,
             (SELECT saved_g FROM v_user_stats v WHERE v.user_id = u.id) AS total_g
      FROM point_transactions p JOIN users u ON u.id = p.user_id
      WHERE to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${m} AND u.blocked_at IS NULL AND p.reason NOT IN ('monthly_award', 'shop')
      GROUP BY u.id ORDER BY pts DESC, u.name LIMIT 100`;
    const [mine] = await sql()`
      WITH t AS (SELECT p.user_id, SUM(p.amount) AS pts FROM point_transactions p JOIN users u ON u.id = p.user_id
                 WHERE to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${m} AND u.blocked_at IS NULL AND p.reason NOT IN ('monthly_award', 'shop') GROUP BY p.user_id)
      SELECT COALESCE((SELECT pts FROM t WHERE user_id = ${uid}), 0) AS pts,
             1 + (SELECT COUNT(*) FROM t WHERE pts > COALESCE((SELECT pts FROM t WHERE user_id = ${uid}), 0)) AS rank`;
    return {
      month: m,
      users: rows.map((r) => ({ id: `u${r.id}`, me: Number(r.id) === Number(uid), name: r.name, points: num(r.pts), g: num(r.total_g), photo: r.has_av ? imgUrl('a', r.id, r.av) : '' })),
      myPoints: num(mine && mine.pts),
      myRank: num(mine && mine.rank),
    };
  }

  function userOut(me) {
    const out = db.pub(me);
    out.avatar = me.avatar_url ? imgUrl('a', me.id, require('crypto').createHash('md5').update(me.avatar_url).digest('hex').slice(0, 10)) : '';
    return out;
  }

  // ── 캠페인 보상 정산: 끝난(목표 달성 7일 지난) 목표 100kg 이상 캠페인을 최종 달성률로 한 번만 ──
  //  지급 시각은 캠페인이 끝난 때(달성 + 7일) — 언제 정산되든 같은 달 포인트로 들어가요
  async function settleCampaigns() {
    const tier = (col) => `CASE ${REWARD_TIERS.map((t) => `WHEN ratio >= ${t.pct / 100} THEN ${t[col]}`).join(' ')} END`;
    await sql().query(`
      WITH due AS (
        SELECT st.campaign_id AS cid, c.creator_id, st.goal_kg, st.reached_at + make_interval(days => ${END_DAYS}) AS end_at,
               st.progress_g / (st.goal_kg * 1000.0) AS ratio
        FROM v_campaign_stats st JOIN campaigns c ON c.id = st.campaign_id
        WHERE st.status = 'approved' AND st.goal_kg >= ${POPULAR_MIN_KG} AND st.reached_at IS NOT NULL
          AND st.reached_at < now() - make_interval(days => ${END_DAYS})
          AND NOT EXISTS (SELECT 1 FROM point_transactions x WHERE x.campaign_id = c.id AND x.reason IN ('campaign_reward', 'campaign_bonus'))
      ), m AS (
        SELECT due.*, ${tier('maker')} AS cm, ${tier('member')} AS pm FROM due
      ), a AS (
        INSERT INTO point_transactions (user_id, amount, reason, campaign_id, created_at)
        SELECT creator_id, ROUND(goal_kg * cm)::int, 'campaign_reward', cid, end_at FROM m
        ON CONFLICT DO NOTHING RETURNING id
      )
      , b AS (
        INSERT INTO point_transactions (user_id, amount, reason, campaign_id, created_at)
        SELECT t.user_id, ROUND(SUM(t.saved_g) / 1000.0 * m.pm)::int, 'campaign_bonus', m.cid, m.end_at
        FROM trips t JOIN m ON m.cid = t.campaign_id
        GROUP BY t.user_id, m.cid, m.pm, m.end_at HAVING ROUND(SUM(t.saved_g) / 1000.0 * m.pm) > 0
        ON CONFLICT DO NOTHING RETURNING id
      )
      SELECT (SELECT COUNT(*) FROM a) AS makers, (SELECT COUNT(*) FROM b) AS members`);
  }
  // ── 이달의 절약왕 보너스: 달이 바뀐 뒤 처음 들어온 사람이 지난달 1·2·3등에게 한 번만 지급 ──
  async function awardLastMonth() {
    const [{ m, d }] = await sql()`SELECT to_char((now() AT TIME ZONE 'Asia/Seoul') - interval '1 month', 'YYYY-MM') AS m,
      to_char(date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul') - interval '1 month'), 'YYYY-MM-DD') AS d`;
    const [done] = await sql()`SELECT 1 AS x FROM point_transactions WHERE reason = 'monthly_award' AND award_month = ${d}::date LIMIT 1`;
    if (done) return;
    await sql()`INSERT INTO point_transactions (user_id, amount, reason, award_month)
      SELECT user_id, CASE rn WHEN 1 THEN ${MONTH_AWARDS[0]}::int WHEN 2 THEN ${MONTH_AWARDS[1]}::int ELSE ${MONTH_AWARDS[2]}::int END, 'monthly_award', ${d}::date FROM (
        SELECT p.user_id, ROW_NUMBER() OVER (ORDER BY SUM(p.amount) DESC, u.name) AS rn
        FROM point_transactions p JOIN users u ON u.id = p.user_id
        WHERE to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${m} AND u.blocked_at IS NULL AND p.reason NOT IN ('monthly_award', 'shop')
        GROUP BY p.user_id, u.name HAVING SUM(p.amount) > 0
      ) r WHERE rn <= ${MONTH_AWARDS.length}
      ON CONFLICT DO NOTHING`;
  }
  // 지난달 절약왕 (랭킹 화면 위에 보여 줘요)
  async function lastAwards(uid) {
    const rows = await sql()`SELECT p.user_id, u.name, p.amount, to_char(p.award_month, 'YYYY-MM') AS m
      FROM point_transactions p JOIN users u ON u.id = p.user_id
      WHERE p.reason = 'monthly_award' AND p.award_month = (SELECT MAX(award_month) FROM point_transactions WHERE reason = 'monthly_award')
      ORDER BY p.amount DESC`;
    return rows.map((r, i) => ({ rank: i + 1, name: r.name, points: num(r.amount), month: r.m, me: Number(r.user_id) === Number(uid) }));
  }

  // ── 포인트 상점 ──
  async function shopData(uid) {
    const [items, orders] = await Promise.all([
      sql()`SELECT code, category, name, sub, price_p, icon, voucher FROM shop_items WHERE active ORDER BY sort, code`,
      sql()`SELECT o.id, o.item_code, i.name, i.icon, i.voucher, o.price_p, o.coupon, o.created_at
        FROM shop_orders o JOIN shop_items i ON i.code = o.item_code WHERE o.user_id = ${uid} ORDER BY o.created_at DESC, o.id DESC LIMIT 50`,
    ]);
    return {
      items: items.map((r) => ({ code: r.code, cat: r.category, name: r.name, sub: r.sub, price: num(r.price_p), icon: r.icon, voucher: r.voucher })),
      orders: orders.map((r) => ({ id: String(r.id), code: r.item_code, name: r.name, icon: r.icon, voucher: r.voucher, price: num(r.price_p), coupon: r.coupon, at: ms(r.created_at) })),
    };
  }
  async function shopBuy(me, b) {
    const code = str(b.code, 40);
    const [item] = await sql()`SELECT code, name, icon, price_p, voucher FROM shop_items WHERE code = ${code} AND active`;
    if (!item) bad('지금은 교환할 수 없는 상품이에요.', 404);
    const [{ n }] = await sql()`SELECT COUNT(*) AS n FROM shop_orders WHERE user_id = ${me.id} AND created_at > now() - interval '1 day'`;
    if (num(n) >= SHOP_DAILY_MAX) bad(`하루에 ${SHOP_DAILY_MAX}번까지 교환할 수 있어요.`, 429);
    // 바코드 교환권은 숫자 12자리, 푸름이 굿즈샵 쿠폰은 PUREUM-XXXX-XXXX (헷갈리는 0·O·1·I 는 빼요)
    const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = require('crypto').randomBytes(12);
    const coupon = item.voucher === 'code'
      ? `PUREUM-${Array.from(bytes.slice(0, 8), (x, i) => (i === 4 ? '-' : '') + ABC[x % ABC.length]).join('')}`
      : Array.from(bytes, (x) => String(x % 10)).join('');
    // 잔액이 충분할 때만 교환 + 포인트 차감을 한 문장으로 (중간에 실패하면 아무것도 안 들어가요)
    const rows = await sql()`
      WITH bal AS (SELECT COALESCE(SUM(amount), 0) AS p FROM point_transactions WHERE user_id = ${me.id} AND reason <> 'rank_deduct'),
      o AS (
        INSERT INTO shop_orders (user_id, item_code, price_p, coupon)
        SELECT ${me.id}::int, ${item.code}::text, ${item.price_p}::int, ${coupon}::text FROM bal WHERE bal.p >= ${item.price_p}::int
        RETURNING id, created_at
      ), t AS (
        INSERT INTO point_transactions (user_id, amount, reason, order_id)
        SELECT ${me.id}::int, ${-num(item.price_p)}::int, 'shop', o.id FROM o
      )
      SELECT id, created_at FROM o`;
    if (!rows.length) bad('포인트가 부족해요.', 409);
    const [st] = await sql()`SELECT points FROM v_user_stats WHERE user_id = ${me.id}`;
    return { ok: true, points: num(st && st.points),
      order: { id: String(rows[0].id), code: item.code, name: item.name, icon: item.icon, voucher: item.voucher, price: num(item.price_p), coupon, at: ms(rows[0].created_at) } };
  }

  async function sync(me) {
    try { await settleCampaigns(); } catch (e) { console.error('[정산 오류]', e && e.message); }
    try { await awardLastMonth(); } catch (e) { console.error('[절약왕 보너스 오류]', e && e.message); }
    const soft = (p, fallback) => p.catch((e) => { console.error('[동기화 일부 오류]', e && e.message); return fallback; }); // 상점·보너스가 실패해도 나머지는 보여요
    const [s, camps, rank, shop, awards] = await Promise.all([summary(me.id), campaigns(me), monthRank(me.id),
      soft(shopData(me.id), { items: [], orders: [] }), soft(lastAwards(me.id), [])]);
    const out = { user: userOut(me), ...s, camps, rank, shop, lastAwards: awards };
    if (isAdminRow(me) && db.schemaErrors && db.schemaErrors.length) out.schemaErrors = db.schemaErrors; // 관리자에게만: DB 구조 바꾸기 실패한 문장
    if (isAdminRow(me)) { const d = await demoCounts(me.id); out.demoUsers = d.users; out.demoCal = d.cal; }
    return out;
  }

  // ── 예시 데이터 (관리자) ──
  // 넣기: 예시 회원 100명(없을 때만) + 관리자 본인 캘린더 시연 기록(없을 때만)
  async function demoCounts(uid) {
    const [r] = await sql()`SELECT (SELECT COUNT(*) FROM users WHERE provider = 'seed') AS u,
      (SELECT COUNT(*) FROM trips t JOIN users x ON x.id = t.user_id WHERE x.provider = 'seed') AS t,
      (SELECT COUNT(*) FROM trips WHERE user_id = ${uid} AND client_key LIKE 'demo-cal-%') AS c`;
    return { users: num(r.u), trips: num(r.t), cal: num(r.c) };
  }
  async function demoSeed(me) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const before = await demoCounts(me.id);
    if (before.users && before.cal) bad('예시 데이터가 이미 있어요. 먼저 지운 뒤 다시 넣어 주세요.', 409);
    if (!before.users) await sql().query(SEED.SEED_SQL);
    await sql().query(SEED.FEATURED_SQL); // 사진 있는 추천 캠페인 5개 (이미 있으면 건너뜀)
    if (!before.cal) await sql().query(SEED.calSql(me.id));
    return { ok: true, ...(await demoCounts(me.id)) };
  }
  async function demoClear(me) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const rows = await sql().query(`${SEED.CLEAR_SQL} RETURNING id`);
    const cal = await sql().query(`${SEED.CAL_CLEAR(me.id)} RETURNING id`);
    return { ok: true, removed: rows.length, calRemoved: cal.length };
  }

  // ── 관리자: 포인트 직접 지급 (받는 사람 닉네임, 비우면 나) ──
  // 받는 사람 찾기: 회원 번호(id) 또는 닉네임 (비우면 나)
  async function findTarget(me, b) {
    if (b.id) {
      const [u] = await sql()`SELECT id, name, role FROM users WHERE id = ${intId(b.id)}`;
      if (!u) bad('회원을 찾지 못했어요.', 404);
      return u;
    }
    const name = str(b.name, 40);
    if (!name) return me;
    const found = await sql()`SELECT id, name, role FROM users WHERE lower(trim(name)) = lower(${name}) ORDER BY id LIMIT 2`;
    if (!found.length) bad(`"${name}" 닉네임의 회원을 찾지 못했어요.`, 404);
    if (found.length > 1) bad(`"${name}" 닉네임이 여러 명이에요. 회원 관리에서 검색해서 골라 주세요.`, 409);
    return found[0];
  }
  // ── 관리자: 포인트 지급 · 삭제 ──
  async function adminPoints(me, b) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const amount = Math.round(num(b.amount));
    if (!(amount >= 1 && amount <= 1000000)) bad('1 ~ 1,000,000P 사이로 적어 주세요.');
    const target = await findTarget(me, b);
    const deduct = b.mode === 'deduct';
    let applied = amount;
    if (deduct) {
      // 보유 포인트에서 먼저 빼고, 모자라면 이번 달 탄소 포인트(순위용)에서 빼요
      //  (상점에서 다 써서 보유 포인트가 0P여도 이번 달 순위 포인트는 남아 있을 수 있어요. 보유 포인트는 0 아래로 안 내려가요)
      const [st] = await sql()`SELECT points FROM v_user_stats WHERE user_id = ${target.id}`;
      const [mp] = await sql()`SELECT COALESCE(SUM(amount), 0) AS p FROM point_transactions WHERE user_id = ${target.id}
        AND reason NOT IN ('monthly_award', 'shop')
        AND to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`;
      const fromBal = Math.min(amount, Math.max(0, num(st && st.points)));
      const fromRank = Math.min(amount - fromBal, Math.max(0, num(mp && mp.p) - fromBal));
      applied = fromBal + fromRank;
      if (applied <= 0) bad(`${target.name}님은 보유 포인트와 이번 달 탄소 포인트가 모두 0P라서 뺄 포인트가 없어요.`);
      if (fromBal > 0) await sql()`INSERT INTO point_transactions (user_id, amount, reason) VALUES (${target.id}, ${-fromBal}, 'admin_deduct')`;
      if (fromRank > 0) await sql()`INSERT INTO point_transactions (user_id, amount, reason) VALUES (${target.id}, ${-fromRank}, 'rank_deduct')`;
    } else {
      await sql()`INSERT INTO point_transactions (user_id, amount, reason) VALUES (${target.id}, ${amount}, 'admin_grant')`;
    }
    const [st] = await sql()`SELECT points FROM v_user_stats WHERE user_id = ${target.id}`;
    const [mt] = await sql()`SELECT COALESCE(SUM(amount), 0) AS p FROM point_transactions WHERE user_id = ${target.id}
      AND reason NOT IN ('monthly_award', 'shop')
      AND to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`;
    return { ok: true, name: target.name, me: Number(target.id) === Number(me.id), mode: deduct ? 'deduct' : 'grant', amount: applied,
      total: num(st && st.points), month: num(mt && mt.p) };
  }
  // ── 관리자: 탄소 절약량 조절 (kg, 더하기 · 빼기) ──
  async function adminCarbon(me, b) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const kg = Math.round(num(b.kg) * 10) / 10;
    if (!(kg >= 0.1 && kg <= 100000)) bad('0.1 ~ 100,000kg 사이로 적어 주세요.');
    const target = await findTarget(me, b);
    let g = kg * 1000;
    if (b.mode === 'minus') {
      const [st] = await sql()`SELECT saved_g FROM v_user_stats WHERE user_id = ${target.id}`;
      g = Math.min(g, Math.max(0, num(st && st.saved_g))); // 0kg 아래로는 안 내려가요
      if (g <= 0) bad(`${target.name}님은 뺄 절약량이 없어요.`);
      g = -g;
    }
    await sql()`INSERT INTO carbon_adjustments (user_id, amount_g, admin_id) VALUES (${target.id}, ${g}, ${me.id})`;
    const [st] = await sql()`SELECT saved_g FROM v_user_stats WHERE user_id = ${target.id}`;
    return { ok: true, name: target.name, me: Number(target.id) === Number(me.id), kg: Math.abs(g) / 1000, mode: g < 0 ? 'minus' : 'plus', totalKg: num(st && st.saved_g) / 1000 };
  }
  // ── 관리자: 회원 관리 (검색 · 차단 · 삭제) ──
  async function adminUsers(me, q) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const term = str(q.q, 40);
    const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = term
      ? await sql()`SELECT u.id, u.name, u.provider, u.email, u.role, u.blocked_at, u.created_at, v.points, v.saved_g, v.trip_count
          FROM users u JOIN v_user_stats v ON v.user_id = u.id
          WHERE u.name ILIKE ${like} OR u.email ILIKE ${like} ORDER BY (u.blocked_at IS NULL), u.name LIMIT 50`
      : await sql()`SELECT u.id, u.name, u.provider, u.email, u.role, u.blocked_at, u.created_at, v.points, v.saved_g, v.trip_count
          FROM users u JOIN v_user_stats v ON v.user_id = u.id WHERE u.blocked_at IS NOT NULL ORDER BY u.blocked_at DESC LIMIT 100`;
    const [cnt] = await sql()`SELECT COUNT(*) FILTER (WHERE blocked_at IS NOT NULL) AS b, COUNT(*) AS n FROM users`;
    return {
      ok: true, q: term, blockedCount: num(cnt.b), userCount: num(cnt.n),
      users: rows.map((r) => ({ id: String(r.id), name: r.name, provider: r.provider, email: r.email || '', admin: isAdminRow(r), me: Number(r.id) === Number(me.id),
        blocked: !!r.blocked_at, blockedAt: ms(r.blocked_at), joinedAt: ms(r.created_at), points: num(r.points), savedG: num(r.saved_g), trips: num(r.trip_count) })),
    };
  }
  async function guardTarget(me, id) {
    const [u] = await sql()`SELECT id, name, role FROM users WHERE id = ${intId(id)}`;
    if (!u) bad('회원을 찾지 못했어요.', 404);
    if (Number(u.id) === Number(me.id)) bad('내 계정은 차단하거나 지울 수 없어요.');
    if (isAdminRow(u)) bad('관리자 계정은 차단하거나 지울 수 없어요.', 403);
    return u;
  }
  async function adminBlock(me, b) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const u = await guardTarget(me, b.id);
    if (b.on) await sql()`UPDATE users SET blocked_at = COALESCE(blocked_at, now()) WHERE id = ${u.id}`;
    else await sql()`UPDATE users SET blocked_at = NULL WHERE id = ${u.id}`;
    return { ok: true, name: u.name, blocked: !!b.on };
  }
  async function adminDelUser(me, b) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const u = await guardTarget(me, b.id);
    await sql()`DELETE FROM users WHERE id = ${u.id}`; // 이동·포인트·캠페인·좋아요·참여가 함께 지워져요
    return { ok: true, name: u.name };
  }

  // ── 이동 저장 ──
  async function saveTrip(me, b) {
    const uid = me.id;
    const segs = (Array.isArray(b.segments) ? b.segments : []).slice(0, 30)
      .map((s, i) => ({ seq: i + 1, mode: String(s && s.mode), km: Math.round(Math.max(0, Math.min(500, num(s && s.km))) * 1000) / 1000 }))
      .filter((s) => TRIP_MODES.includes(s.mode));
    if (!segs.length) bad('이동 구간이 없어요.');
    segs.forEach((s, i) => { s.seq = i + 1; });
    const place = (p) => {
      const lat = num(p && p.lat), lng = num(p && p.lng);
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180) || (!lat && !lng)) bad('출발지·도착지 위치가 이상해요.');
      return { name: str(p.name, 80) || '위치', lat, lng };
    };
    const from = place(b.from), to = place(b.to);
    const minutes = Math.max(0, Math.min(1440, Math.round(num(b.minutes))));
    const totalKm = segs.reduce((a, s) => a + s.km, 0);
    const ecoKm = segs.filter((s) => s.mode !== 'car').reduce((a, s) => a + s.km, 0);
    // 아낀 탄소: 같은 길을 자동차로 갔을 때보다 줄어든 양. 너무 큰 값은 잘라요 (자동차로 두 배 돌아가는 것까지만 인정)
    const savedG = Math.round(Math.max(0, Math.min(num(b.savedG), Math.max(totalKm, 0.1) * CAR_G_PER_KM * 2)) * 10) / 10;
    const pts = Math.round((savedG / 1000) * PT_PER_KG) + Math.round(ecoKm * PT_PER_KM);
    const key = str(b.key, 64) || null;

    // 부정 적립 확인 (이미 저장된 기록을 다시 보낸 거면 건너뛰어요 — 아래에서 중복으로 처리)
    const again = key ? await sql()`SELECT 1 AS x FROM trips WHERE user_id = ${uid} AND client_key = ${key} LIMIT 1` : [];
    if (!TRIP_LIMITS.off && !again.length) {
      const L = TRIP_LIMITS;
      if (totalKm > kmBetween(from, to) * L.detour + L.slackKm) bad('출발지·도착지 사이 거리보다 이동 거리가 너무 길어요. 길찾기를 다시 해 주세요.');
      const needMin = segs.reduce((a, s) => a + (s.km / MAX_KMH[s.mode]) * 60, 0);
      if (minutes + 1 < needMin) bad('걸린 시간에 비해 이동 거리가 너무 길어요.');
      const [d] = await sql()`SELECT
          (SELECT COUNT(*) FROM trips WHERE user_id = ${uid}
             AND (arrived_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date) AS n,
          (SELECT COALESCE(SUM(s.km), 0) FROM trips t JOIN trip_segments s ON s.trip_id = t.id WHERE t.user_id = ${uid} AND s.mode_code <> 'car'
             AND (t.arrived_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date) AS km,
          (SELECT COUNT(*) FROM trips WHERE user_id = ${uid} AND arrived_at > now() - make_interval(mins => ${L.repeatMin})
             AND abs(origin_lat - ${from.lat}) < 0.001 AND abs(origin_lng - ${from.lng}) < 0.001
             AND abs(dest_lat - ${to.lat}) < 0.001 AND abs(dest_lng - ${to.lng}) < 0.001) AS dup`;
      if (num(d.n) >= L.perDay) bad(`이동 기록은 하루 ${L.perDay}번까지 저장돼요. 내일 다시 기록해 주세요.`, 429);
      if (num(d.km) + ecoKm > L.kmPerDay) bad(`친환경 이동은 하루 ${L.kmPerDay}km까지 인정돼요.`, 429);
      if (num(d.dup) > 0) bad(`같은 길을 ${L.repeatMin}분 안에 또 기록할 수 없어요.`, 429);
    }

    // 캠페인: 게시 중인 캠페인만, 처음이면 참여자로 등록
    let campId = null;
    if (b.campaignId != null && b.campaignId !== '') {
      const cid = Number(b.campaignId);
      if (Number.isInteger(cid) && cid > 0) {
        const [c] = await sql()`SELECT status, (reached_at IS NOT NULL AND reached_at < now() - make_interval(days => ${END_DAYS})) AS ended
          FROM v_campaign_stats WHERE campaign_id = ${cid}`;
        if (c && c.status === 'approved' && !c.ended) {
          await sql()`INSERT INTO campaign_participants (campaign_id, user_id) VALUES (${cid}, ${uid}) ON CONFLICT DO NOTHING`;
          campId = cid;
        }
      }
    }
    const before = campId ? await sql()`SELECT progress_g FROM v_campaign_stats WHERE campaign_id = ${campId}` : [];

    // 이동 + 구간 + 포인트를 한 문장으로 (중간에 실패하면 아무것도 안 들어가요)
    const rows = await sql()`
      WITH t AS (
        INSERT INTO trips (user_id, campaign_id, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, minutes, saved_g, client_key)
        VALUES (${uid}, ${campId}, ${from.name}, ${from.lat}, ${from.lng}, ${to.name}, ${to.lat}, ${to.lng}, ${minutes}, ${savedG}, ${key})
        ON CONFLICT (user_id, client_key) WHERE client_key IS NOT NULL DO NOTHING
        RETURNING id
      ), s AS (
        INSERT INTO trip_segments (trip_id, seq, mode_code, km)
        SELECT t.id, x.seq, x.mode, x.km FROM t, json_to_recordset(${JSON.stringify(segs)}::json) AS x(seq int, mode text, km numeric)
      ), p AS (
        INSERT INTO point_transactions (user_id, amount, reason, trip_id)
        SELECT ${uid}::int, ${pts}::int, 'trip', t.id FROM t WHERE ${pts}::int > 0
      )
      SELECT id FROM t`;
    if (!rows.length) return { ok: true, duplicate: true, points: 0 };

    const out = { ok: true, tripId: Number(rows[0].id), points: pts, savedG };
    if (campId) {
      const [c] = await sql()`SELECT st.goal_kg, st.progress_g, st.status, c.creator_id, c.title
        FROM v_campaign_stats st JOIN campaigns c ON c.id = st.campaign_id WHERE st.campaign_id = ${campId}`;
      out.campaign = { id: String(campId), beforeG: num(before[0] && before[0].progress_g), afterG: num(c.progress_g) };
      // 이번 이동으로 목표를 처음 넘겼으면 알려 줘요 (보상은 7일 뒤 최종 달성률로 정산)
      if (num(c.goal_kg) * 1000 > out.campaign.beforeG && num(c.progress_g) >= num(c.goal_kg) * 1000) {
        out.reached = { title: c.title, rewardable: num(c.goal_kg) >= POPULAR_MIN_KG };
      }
    }
    return out;
  }

  // ── 캠페인 만들기 / 고치기 ──
  async function saveCamp(me, b) {
    const tag = TAGS.includes(b.tag) ? b.tag : bad('분류를 골라 주세요.');
    const mode = CAMP_MODES.includes(b.mode) ? b.mode : bad('이동 수단을 골라 주세요.');
    const title = str(b.title, 60) || bad('캠페인 제목을 적어 주세요.');
    const sub = str(b.sub, 80);
    const text = str(b.body, 3000);
    if (text.length < 20) bad('캠페인 글을 20자 이상 적어 주세요.');
    const goal = Math.round(num(b.goalKg));
    if (!(goal >= 10 && goal <= 1000000)) bad('목표는 10kg 이상으로 정해 주세요.');
    // 표지: 새 사진(data:…)이면 바꾸고, 빈 값이면 지우고, 서버 주소 그대로면 그대로 둬요
    const cover = String(b.cover || '');
    let coverSql = 'keep';
    if (!cover) coverSql = '';
    else if (cover.startsWith('data:')) {
      if (cover.length > MAX_COVER || !DATA_URL_RE.test(cover)) bad('사진이 너무 크거나 형식이 맞지 않아요. 다른 사진으로 바꿔 주세요.');
      coverSql = cover;
    } else if (!cover.startsWith('/api/data?a=img&k=c') && !/^assets\/camp\/[\w-]+\.jpg$/.test(cover)) bad('사진 형식이 맞지 않아요.');

    if (b.id) {
      const id = intId(b.id);
      const rows = coverSql === 'keep'
        ? await sql()`UPDATE campaigns SET tag_code = ${tag}, mode_code = ${mode}, title = ${title}, subtitle = ${sub}, body = ${text},
            goal_kg = ${goal}, submitted_at = now() WHERE id = ${id} AND creator_id = ${me.id} RETURNING id`
        : await sql()`UPDATE campaigns SET tag_code = ${tag}, mode_code = ${mode}, title = ${title}, subtitle = ${sub}, body = ${text},
            goal_kg = ${goal}, cover_url = ${coverSql || null}, submitted_at = now() WHERE id = ${id} AND creator_id = ${me.id} RETURNING id`;
      if (!rows.length) bad('고칠 수 있는 캠페인이 아니에요.', 403);
      return { ok: true, id: String(id) };
    }
    const [{ n }] = await sql()`SELECT COUNT(*) AS n FROM campaigns WHERE creator_id = ${me.id} AND created_at > now() - interval '1 day'`;
    if (num(n) >= 10) bad('하루에 만들 수 있는 캠페인은 10개까지예요.', 429);
    const [c] = await sql()`INSERT INTO campaigns (creator_id, tag_code, mode_code, title, subtitle, body, cover_url, goal_kg)
      VALUES (${me.id}, ${tag}, ${mode}, ${title}, ${sub}, ${text}, ${coverSql === 'keep' ? null : coverSql || null}, ${goal}) RETURNING id`;
    await sql()`INSERT INTO campaign_participants (campaign_id, user_id) VALUES (${c.id}, ${me.id}) ON CONFLICT DO NOTHING`;
    return { ok: true, id: String(c.id) };
  }

  async function delCamp(me, b) {
    const id = intId(b.id);
    const rows = await sql()`DELETE FROM campaigns WHERE id = ${id} AND (creator_id = ${me.id} OR ${isAdminRow(me)}::boolean) RETURNING id`;
    if (!rows.length) bad('지울 수 있는 캠페인이 아니에요.', 403);
    return { ok: true };
  }

  async function likeCamp(me, b) {
    const id = intId(b.id);
    if (b.on) {
      const [c] = await sql()`SELECT status, (reached_at IS NOT NULL AND reached_at < now() - make_interval(days => ${END_DAYS})) AS ended
        FROM v_campaign_stats WHERE campaign_id = ${id}`;
      if (!c || c.status !== 'approved' || c.ended) bad('게시 중인 캠페인만 좋아요를 누를 수 있어요.');
      await sql()`INSERT INTO campaign_likes (campaign_id, user_id) VALUES (${id}, ${me.id}) ON CONFLICT DO NOTHING`;
    } else {
      await sql()`DELETE FROM campaign_likes WHERE campaign_id = ${id} AND user_id = ${me.id}`;
    }
    const [r] = await sql()`SELECT COUNT(*) AS n FROM campaign_likes WHERE campaign_id = ${id}`;
    return { ok: true, likes: num(r.n), liked: !!b.on };
  }

  // 캠페인 참여하기 버튼: 누르는 순간 참여자로 등록 (도착하면 그 이동이 캠페인에 더해져요)
  async function joinCamp(me, b) {
    const id = intId(b.id);
    const [c] = await sql()`SELECT status, (reached_at IS NOT NULL AND reached_at < now() - make_interval(days => ${END_DAYS})) AS ended
      FROM v_campaign_stats WHERE campaign_id = ${id}`;
    if (!c || c.status !== 'approved') bad('게시 중인 캠페인만 참여할 수 있어요.');
    if (c.ended) bad('종료된 캠페인이에요.');
    await sql()`INSERT INTO campaign_participants (campaign_id, user_id) VALUES (${id}, ${me.id}) ON CONFLICT DO NOTHING`;
    const [r] = await sql()`SELECT COUNT(*) AS n FROM campaign_participants WHERE campaign_id = ${id}`;
    return { ok: true, joined: true, participants: num(r.n) };
  }

  async function reviewCamp(me, b) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const id = intId(b.id);
    const decision = b.decision === 'approved' ? 'approved' : b.decision === 'rejected' ? 'rejected' : bad('승인 또는 반려를 골라 주세요.');
    const reason = str(b.reason, 500);
    if (decision === 'rejected' && !reason) bad('반려 사유를 골라 주세요.');
    const rows = await sql()`INSERT INTO campaign_reviews (campaign_id, reviewer_id, decision, reason)
      SELECT id, ${me.id}::int, ${decision}::text, ${decision === 'rejected' ? reason : null}::text FROM campaigns WHERE id = ${id} RETURNING id`;
    if (!rows.length) bad('캠페인을 찾지 못했어요.', 404);
    return { ok: true };
  }

  async function seenCamp(me, b) {
    const id = intId(b.id);
    await sql()`UPDATE campaign_reviews r SET seen_at = now() FROM campaigns c
      WHERE r.campaign_id = c.id AND c.id = ${id} AND c.creator_id = ${me.id} AND r.seen_at IS NULL`;
    return { ok: true };
  }

  async function campRank(me, q) {
    const id = intId(q.id);
    const [c] = await campaigns(me, id);
    if (!c) bad('캠페인을 찾지 못했어요.', 404);
    const rows = await sql()`
      SELECT r.user_id, r.name, r.contributed_g, r.rank, (COALESCE(u.avatar_url, '') <> '') AS has_av, left(md5(COALESCE(u.avatar_url, '')), 10) AS av,
             (SELECT saved_g FROM v_user_stats v WHERE v.user_id = r.user_id) AS total_g
      FROM v_campaign_ranking r JOIN users u ON u.id = r.user_id
      WHERE r.campaign_id = ${id} ORDER BY r.rank, r.name LIMIT 50`;
    const [mine] = await sql()`SELECT contributed_g, rank FROM v_campaign_ranking WHERE campaign_id = ${id} AND user_id = ${me.id}`;
    const toU = (r) => ({ id: `u${r.user_id}`, me: Number(r.user_id) === Number(me.id), name: r.name, g: num(r.contributed_g), tg: num(r.total_g), rank: num(r.rank), photo: r.has_av ? imgUrl('a', r.user_id, r.av) : '' });
    return { ok: true, id: String(id), users: rows.map(toU), me: mine ? { g: num(mine.contributed_g), rank: num(mine.rank) } : null, total: c.participants };
  }

  async function profile(me, b) {
    if (b.name !== undefined) {
      const name = str(b.name, 12);
      if (name.length < 2) bad('닉네임은 2자 이상이에요.');
      await sql()`UPDATE users SET name = ${name} WHERE id = ${me.id}`;
    }
    if (b.avatar !== undefined) {
      const av = String(b.avatar || '');
      if (av && (av.length > MAX_AVATAR || !DATA_URL_RE.test(av))) bad('사진이 너무 크거나 형식이 맞지 않아요.');
      await sql()`UPDATE users SET avatar_url = ${av || null} WHERE id = ${me.id}`;
    }
    return { ok: true, user: userOut(await db.store.byId(me.id)) };
  }

  async function image(q, res) {
    const id = intId(q.id);
    const rows = q.k === 'a' ? await sql()`SELECT avatar_url AS d FROM users WHERE id = ${id}`
      : q.k === 'c' ? await sql()`SELECT cover_url AS d FROM campaigns WHERE id = ${id}` : [];
    const m = rows[0] && DATA_URL_RE.exec(String(rows[0].d || ''));
    if (!m) return res.status(404).json({ error: '사진이 없어요.' });
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 사진이 바뀌면 주소(v=)가 바뀌어요
    return res.status(200).send(Buffer.from(m[2], 'base64'));
  }

  const POSTS = { 'shop-buy': shopBuy, 'demo-seed': demoSeed, 'demo-clear': demoClear, 'admin-points': adminPoints, 'admin-carbon': adminCarbon, 'admin-block': adminBlock, 'admin-del-user': adminDelUser, trip: saveTrip, 'camp-save': saveCamp, 'camp-del': delCamp, 'camp-like': likeCamp, 'camp-join': joinCamp, 'camp-review': reviewCamp, 'camp-seen': seenCamp, profile };

  return async function handler(req, res) {
    const q = req.query || {};
    const a = String(q.a || '');
    if (a !== 'img') res.setHeader('Cache-Control', 'no-store');
    if (!db.hasDb()) return res.status(503).json({ error: 'DB가 아직 연결되지 않았어요.', noDb: true });
    try {
      await db.init();
      if (a === 'img' && req.method === 'GET') return await image(q, res);
      if (a === 'logout') { db.clearSession(res); return res.status(200).json({ ok: true }); }
      const uid = db.sessionUid(req);
      const me = uid ? await db.store.byId(uid) : null;
      if (!me) { if (uid) db.clearSession(res); return res.status(401).json({ error: '다시 로그인해 주세요.', relogin: true }); }
      if (me.blocked_at) { db.clearSession(res); return res.status(403).json({ error: '관리자가 이용을 제한한 계정이에요.', blocked: true }); }
      if (req.method === 'GET') {
        if (a === 'sync') return res.status(200).json(await sync(me));
        if (a === 'camp-rank') return res.status(200).json(await campRank(me, q));
        if (a === 'admin-users') return res.status(200).json(await adminUsers(me, q));
        if (a === 'rank') return res.status(200).json(await monthRank(me.id, /^\d{4}-\d{2}$/.test(q.m || '') ? q.m : null));
      } else if (req.method === 'POST' && POSTS[a]) {
        return res.status(200).json(await POSTS[a](me, body(req)));
      }
      return res.status(404).json({ error: '없는 기능이에요.' });
    } catch (e) {
      if (e instanceof Bad) return res.status(e.status).json({ error: e.message });
      console.error('[데이터 API 오류]', a, e && e.message);
      return res.status(500).json({ error: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
    }
  };
};
