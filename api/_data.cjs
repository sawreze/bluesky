// =====================================================================
//  앱 데이터 API — 주소 하나(/api/data?a=동작)로 모두 처리해요.
//  (Vercel 무료 요금제는 서버 함수 개수에 제한이 있어서 하나로 모았어요)
//
//  GET  a=sync                     내 정보 · 기록 요약 · 캠페인 목록 · 이달의 랭킹을 한 번에
//  GET  a=camp-rank&id=            캠페인 참여자 기여 랭킹
//  GET  a=img&k=a|c&id=            프로필 사진(a) · 캠페인 표지(c)
//  POST a=trip                     도착한 이동 저장 (+ 포인트, 캠페인 기여, 인기 캠페인 보상)
//  POST a=camp-save                캠페인 만들기 / 고쳐서 다시 신청
//  POST a=camp-del | camp-like | camp-join | camp-seen
//  POST a=camp-review              (관리자) 승인 · 반려
//  POST a=profile                  닉네임 · 프로필 사진
//  POST a=logout                   출입증 쿠키 지우기
//  POST a=demo-seed | demo-clear   (관리자) 예시 회원 100명 + 내 캘린더 시연 기록 넣기 · 지우기 (_seed.cjs)
//  POST a=admin-points             (관리자) 포인트 직접 지급
//
//  누구인지는 출입증 쿠키로만 확인해요. 포인트도 서버가 계산해요.
// =====================================================================
const PT_PER_KG = 10;          // 아낀 탄소 1kg당 포인트 (app.js 와 같게)
const PT_PER_KM = 1;           // 친환경 이동 1km당 포인트
const POPULAR_MIN_KG = 100;    // 인기 캠페인이 되려면 목표가 이 이상
const REWARD_P_PER_KG = 10;    // 인기 캠페인 보상: 만든 사람은 목표 1kg당, 참여자는 내가 기여한 1kg당
const END_DAYS = 7;            // 목표 달성 후 이 날짜가 지나면 캠페인이 목록에서 내려가요
const CAR_G_PER_KM = 210;
const TAGS = ['transit', 'walk', 'bike', 'carfree', 'together'];
const CAMP_MODES = ['bus', 'subway', 'bike', 'walk'];
const TRIP_MODES = ['car', 'bus', 'subway', 'bike', 'walk'];
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

module.exports = function makeData(db) {
  const sql = () => db.sql();

  // ── 내 기록 요약 ──
  async function summary(uid) {
    const [st] = await sql()`SELECT trip_count, saved_g, points FROM v_user_stats WHERE user_id = ${uid}`;
    const daily = await sql()`SELECT to_char(arrived_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d, SUM(saved_g) AS g, COUNT(*) AS n
      FROM trips WHERE user_id = ${uid} GROUP BY 1 ORDER BY 1`;
    const months = await sql()`SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m, SUM(amount) AS p
      FROM point_transactions WHERE user_id = ${uid} GROUP BY 1`;
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
             (COALESCE(c.cover_url, '') <> '') AS has_cover, c.goal_kg, c.created_at, c.submitted_at,
             st.status, st.progress_g, st.participants, st.likes, s.reject_reason, s.reviewed_at, st.reached_at,
             (st.reached_at IS NOT NULL AND st.reached_at < now() - make_interval(days => ${END_DAYS})) AS ended,
             EXISTS (SELECT 1 FROM campaign_likes l WHERE l.campaign_id = c.id AND l.user_id = ${uid}) AS liked,
             EXISTS (SELECT 1 FROM campaign_participants p WHERE p.campaign_id = c.id AND p.user_id = ${uid}) AS joined,
             COALESCE((SELECT SUM(saved_g) FROM trips t WHERE t.campaign_id = c.id AND t.user_id = ${uid}), 0) AS my_g,
             (SELECT COUNT(*) FROM trips t WHERE t.campaign_id = c.id AND t.user_id = ${uid}) AS my_trips,
             EXISTS (SELECT 1 FROM point_transactions x WHERE x.campaign_id = c.id AND x.reason = 'campaign_reward') AS rewarded,
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
        cover: r.has_cover ? imgUrl('c', r.id, ms(r.submitted_at)) : '',
        goalKg: num(r.goal_kg), progressG: num(r.progress_g), participants: num(r.participants), likes: num(r.likes),
        creator: r.creator, ownerId: mine ? '@me' : `@u${r.creator_id}`, mine,
        status: r.status, rejectReason: r.reject_reason || '',
        createdAt: ms(r.created_at), submittedAt: ms(r.submitted_at), reviewedAt: ms(r.reviewed_at),
        liked: !!r.liked, joined: !!r.joined, myG: num(r.my_g), myTrips: num(r.my_trips), rewarded: !!r.rewarded,
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
      WHERE to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${m}
      GROUP BY u.id ORDER BY pts DESC, u.name LIMIT 100`;
    const [mine] = await sql()`
      WITH t AS (SELECT user_id, SUM(amount) AS pts FROM point_transactions
                 WHERE to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${m} GROUP BY user_id)
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

  async function sync(me) {
    const [s, camps, rank] = await Promise.all([summary(me.id), campaigns(me), monthRank(me.id)]);
    const out = { user: userOut(me), ...s, camps, rank };
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
  async function adminPoints(me, b) {
    if (!isAdminRow(me)) bad('관리자만 할 수 있어요.', 403);
    const amount = Math.round(num(b.amount));
    if (!(amount >= 1 && amount <= 1000000)) bad('1 ~ 1,000,000P 사이로 적어 주세요.');
    const name = str(b.name, 40);
    let target = me;
    if (name) {
      const found = await sql()`SELECT id, name FROM users WHERE lower(trim(name)) = lower(${name}) ORDER BY id LIMIT 2`;
      if (!found.length) bad(`"${name}" 닉네임의 회원을 찾지 못했어요.`, 404);
      if (found.length > 1) bad(`"${name}" 닉네임이 여러 명이에요. 더 정확한 닉네임으로 적어 주세요.`, 409);
      target = found[0];
    }
    await sql()`INSERT INTO point_transactions (user_id, amount, reason) VALUES (${target.id}, ${amount}, 'admin_grant')`;
    const [st] = await sql()`SELECT points FROM v_user_stats WHERE user_id = ${target.id}`;
    return { ok: true, name: target.name, me: Number(target.id) === Number(me.id), amount, total: num(st && st.points) };
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
      // 인기 캠페인 보상: 목표 100kg 이상을 100% 달성하는 순간 한 번만
      //  - 만든 사람: 목표 1kg당 10P
      //  - 참여자: 목표를 채우는 데 기여한 만큼 1kg당 10P (만든 사람도 직접 이동했으면 받아요)
      if (c.status === 'approved' && num(c.goal_kg) >= POPULAR_MIN_KG && num(c.progress_g) >= num(c.goal_kg) * 1000) {
        const amount = Math.round(num(c.goal_kg) * REWARD_P_PER_KG);
        const won = await sql()`INSERT INTO point_transactions (user_id, amount, reason, campaign_id)
          VALUES (${c.creator_id}, ${amount}, 'campaign_reward', ${campId})
          ON CONFLICT (campaign_id) WHERE reason = 'campaign_reward' DO NOTHING RETURNING user_id`;
        if (won.length) {
          if (Number(won[0].user_id) === Number(uid)) out.reward = { title: c.title, points: amount };
          const bonus = await sql()`INSERT INTO point_transactions (user_id, amount, reason, campaign_id)
            SELECT user_id, ROUND(SUM(saved_g) / 1000 * ${REWARD_P_PER_KG})::int, 'campaign_bonus', ${campId}::int
            FROM trips WHERE campaign_id = ${campId} GROUP BY user_id HAVING ROUND(SUM(saved_g) / 1000 * ${REWARD_P_PER_KG}) > 0
            ON CONFLICT (campaign_id, user_id) WHERE reason = 'campaign_bonus' DO NOTHING RETURNING user_id, amount`;
          const mine = bonus.find((x) => Number(x.user_id) === Number(uid));
          if (mine) out.bonus = { title: c.title, points: num(mine.amount) };
        }
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
    } else if (!cover.startsWith('/api/data?a=img&k=c')) bad('사진 형식이 맞지 않아요.');

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

  const POSTS = { 'demo-seed': demoSeed, 'demo-clear': demoClear, 'admin-points': adminPoints, trip: saveTrip, 'camp-save': saveCamp, 'camp-del': delCamp, 'camp-like': likeCamp, 'camp-join': joinCamp, 'camp-review': reviewCamp, 'camp-seen': seenCamp, profile };

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
      if (req.method === 'GET') {
        if (a === 'sync') return res.status(200).json(await sync(me));
        if (a === 'camp-rank') return res.status(200).json(await campRank(me, q));
        if (a === 'rank') return res.status(200).json(await monthRank(me.id, /^\d{4}-\d{2}$/.test(q.m || '') ? q.m : null));
      } else if (req.method === 'POST' && POSTS[a]) {
        return res.status(200).json(await POSTS[a](me, body(req)));
      }
      return res.status(404).json({ error: '없는 기능이에요.' });
    } catch (e) {
      if (e instanceof Bad) return res.status(e.status).json({ error: e.message });
      console.log('[데이터 API 오류]', a, e && e.message);
      return res.status(500).json({ error: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
    }
  };
};
