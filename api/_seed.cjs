// =====================================================================
//  예시 데이터 (관리자 > 캠페인 검토 > 예시 데이터)
//  랭킹·캠페인이 사람이 많을 때 어떻게 보이는지 확인하려고 넣는 가상 회원 100명과 기록이에요.
//  - 가상 회원은 provider = 'seed' 로 표시해서 로그인할 수 없고, CLEAR 한 번으로 모두 지워져요.
//    (그 사람들의 이동·포인트·캠페인·좋아요·참여가 같이 지워지고, 진짜 회원 기록은 그대로)
//  - 이동은 최근 33일에 고르게, 최근일수록 많게. 포인트는 앱과 같은 식(1kg당 10P + 1km당 1P)
// =====================================================================
const NICKS = `버스타는고양이 출근길요정 지하철2호선러 뚜벅이민지 초코우유러버 퇴근하고싶다 자전거탄풍경 오늘도걷는중 mint_choco 하루만보
따릉이마스터 환승의달인 산책하는댕댕 green_jun 한강라이더 아아한잔 비오는날버스 새벽러너 정류장지킴이 탄소다이어터
nayeon_walk 광역버스타요 망원동주민 판교출근러 지구지킴이 별빛산책 귤까먹는곰 오늘의하늘 seoul_biker 마을버스7번
숲세권사는사람 걷기왕서준 혼밥러 데일리워커 포근한토끼 퇴근길노을 우산챙겨 bluesky_ha 강남역사람 느긋한거북이
녹색발자국 출퇴근러버 j_hyun02 고구마라떼 지하철책벌레 안양토박이 평촌맘 산본러 짱구는출근중 이어폰필수
코코넛워터 eco_dahye 한정거장전하차 오늘도무사히 계단오르기 버스맨앞자리 노을맛집탐방 바람따라 민트초코칩 소확행러
walk_with_me 펭귄걸음 새싹키우기 커피는아메리카노 다람쥐쳇바퀴 kim_subway 구름한스푼 텀블러들고다님 비건지향 동네한바퀴
하이킹러버 월요병극복 야근없는삶 hyeri.daily 레몬에이드 강아지산책중 청량한아침 따뜻한라떼 은행나무길 summer_bus
고양이집사 주말엔한강 내일은맑음 아침형인간 수원출퇴근 과천러 인덕원사람 이번역은범계 doyoon_bike 밤산책러
해피바이러스 초록초록해 플로깅하는날 무지개떡 버스카드어디갔지 mango_ssul 걷다보면 친환경챌린저 0.1톤줄이기 하늘보기`.split(/\s+/);

// 출발·도착 장소 (안양·군포·과천·서울 남부)
const PLACES = [
  ['안양역', 37.4016, 126.9227], ['범계역', 37.3897, 126.9508], ['평촌역', 37.3943, 126.9636], ['인덕원역', 37.4013, 126.9767],
  ['과천정부청사역', 37.4263, 126.9897], ['금정역', 37.3722, 126.9434], ['산본역', 37.3581, 126.9330], ['명학역', 37.3843, 126.9356],
  ['안양시청', 37.3943, 126.9568], ['평촌중앙공원', 37.3905, 126.9562], ['안양예술공원', 37.4193, 126.9160], ['사당역', 37.4765, 126.9816],
  ['강남역', 37.4979, 127.0276], ['서울대입구역', 37.4812, 126.9527], ['양재역', 37.4841, 127.0346], ['판교역', 37.3948, 127.1112],
];

// 캠페인: [제목, 부제, 분류, 수단, 목표kg, 만든 사람(번호), 며칠 전, 승인?, 참여 확률, 좋아요 확률, 본문]
const CAMPS = [
  ['출근은 버스로, 주 3회', '일주일에 세 번은 자동차 대신 버스', 'transit', 'bus', 500, 22, 44, true, 0.55, 0.45,
    '출근길 세 번만 버스를 타 봐요. 왕복 16km를 자동차 대신 버스로 다니면 하루 약 3kg의 탄소를 줄일 수 있어요. 버스 안에서 음악 듣고 책 읽는 시간도 덤이에요.'],
  ['한 정거장 일찍 내려 걷기', '하루 10분, 600m 더 걷기', 'walk', 'walk', 150, 53, 40, true, 0.45, 0.4,
    '집이나 회사 가는 길에 한 정거장만 먼저 내려서 걸어 보세요. 600m 정도라 10분이면 충분해요. 하루 1,000보가 저절로 채워지고 탄소도 줄어요.'],
  ['지하철로 주말 나들이', '주말 약속은 지하철 타고 가기', 'carfree', 'subway', 400, 3, 42, true, 0.5, 0.35,
    '주말에 친구 만나러 갈 때, 전시회 갈 때 지하철을 타 봐요. 주차 걱정도 없고 막히지도 않아요. 지하철은 1km에 1.5g 정도라 자동차의 100분의 1도 안 돼요.'],
  ['따릉이로 5km 출퇴근', '가까운 거리는 공공자전거로', 'bike', 'bike', 120, 11, 38, true, 0.3, 0.3,
    '5km 이내 출퇴근은 공공자전거가 가장 빠를 때가 많아요. 자전거는 탄소가 0g! 자전거도로 따라 달리면 아침 공기도 상쾌해요.'],
  ['친구랑 같이 대중교통 타기', '혼자보다 둘이, 둘보다 셋이', 'together', 'bus', 100, 25, 36, true, 0.5, 0.5,
    '같은 방향 가는 친구나 동료와 버스를 같이 타 봐요. 함께하면 더 오래 할 수 있어요. 목표 100kg, 우리 같이 채워요!'],
  ['비 오는 날도 버스로', '비 온다고 차 꺼내지 않기', 'transit', 'bus', 80, 17, 35, true, 0.25, 0.25,
    '비가 오면 자꾸 차 키에 손이 가죠. 우산 하나 챙기고 버스 타요. 비 오는 날 버스 창밖 풍경도 꽤 괜찮아요.'],
  ['점심시간 산책 챌린지', '밥 먹고 15분 걷기', 'walk', 'walk', 60, 34, 34, true, 0.3, 0.35,
    '점심 먹고 회사 근처를 15분만 걸어요. 소화도 되고 오후에 덜 졸려요. 가까운 식당은 걸어서 가는 것부터 시작해 보세요.'],
  ['퇴근길 지하철 독서 챌린지', '지하철에서 하루 20쪽 읽기', 'transit', 'subway', 150, 45, 1, false, 0, 0,
    '퇴근길에 운전 대신 지하철을 타고 책을 읽어요. 하루 20쪽이면 한 달에 책 두 권! 탄소도 줄이고 마음의 양식도 쌓아요.'],
];

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (a, f = q) => `ARRAY[${a.map(f).join(',')}]`;

const SEED_SQL = `DO $seed$
DECLARE
  nicks text[] := ${arr(NICKS)};
  pn text[] := ${arr(PLACES.map((p) => p[0]))};
  plat float8[] := ${arr(PLACES.map((p) => p[1]), String)};
  plng float8[] := ${arr(PLACES.map((p) => p[2]), String)};
  ct text[] := ${arr(CAMPS.map((c) => c[0]))};
  cs text[] := ${arr(CAMPS.map((c) => c[1]))};
  ctag text[] := ${arr(CAMPS.map((c) => c[2]))};
  cmode text[] := ${arr(CAMPS.map((c) => c[3]))};
  cgoal int[] := ${arr(CAMPS.map((c) => c[4]), String)};
  ccre int[] := ${arr(CAMPS.map((c) => c[5]), String)};
  cdays int[] := ${arr(CAMPS.map((c) => c[6]), String)};
  capr boolean[] := ${arr(CAMPS.map((c) => c[7]), String)};
  cjoin float8[] := ${arr(CAMPS.map((c) => c[8]), String)};
  clike float8[] := ${arr(CAMPS.map((c) => c[9]), String)};
  cb text[] := ${arr(CAMPS.map((c) => c[10]))};
  admin_id int; uid int; tid int; cid int; o int; d int; n int; i int; j int; k int;
  uids int[] := '{}'; cids int[] := '{}'; okc int[] := '{}';
  kind text; mkm numeric; wkm numeric; saved numeric; pts int; at timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE provider = 'seed') THEN RAISE EXCEPTION 'SEED_EXISTS'; END IF;
  PERFORM setseed(0.2026);
  SELECT id INTO admin_id FROM users WHERE trim(role) = 'admin' ORDER BY id LIMIT 1;

  -- 회원 100명 (가입은 34~73일 전)
  FOR i IN 1..array_length(nicks, 1) LOOP
    INSERT INTO users (provider, provider_id, name, created_at)
    VALUES ('seed', 'seed-' || lpad(i::text, 3, '0'), nicks[i], now() - make_interval(days => 34 + floor(random() * 40)::int))
    RETURNING id INTO uid;
    uids := uids || uid;
  END LOOP;

  -- 캠페인 (승인된 건 만든 지 5시간 뒤 승인, 1개는 검토 대기)
  FOR k IN 1..array_length(ct, 1) LOOP
    INSERT INTO campaigns (creator_id, tag_code, mode_code, title, subtitle, body, goal_kg, created_at, submitted_at)
    VALUES (uids[ccre[k]], ctag[k], cmode[k], ct[k], cs[k], cb[k], cgoal[k], now() - make_interval(days => cdays[k]), now() - make_interval(days => cdays[k]))
    RETURNING id INTO cid;
    cids := cids || cid;
    IF capr[k] THEN okc := okc || cid; END IF;
    INSERT INTO campaign_participants (campaign_id, user_id, joined_at) VALUES (cid, uids[ccre[k]], now() - make_interval(days => cdays[k]));
    IF capr[k] THEN
      INSERT INTO campaign_reviews (campaign_id, reviewer_id, decision, reviewed_at, seen_at)
      VALUES (cid, admin_id, 'approved', now() - make_interval(days => cdays[k]) + interval '5 hours', now());
    END IF;
  END LOOP;

  -- 참여 · 좋아요
  FOR i IN 1..array_length(uids, 1) LOOP
    FOR k IN 1..array_length(cids, 1) LOOP
      IF capr[k] AND random() < cjoin[k] THEN
        INSERT INTO campaign_participants (campaign_id, user_id, joined_at)
        VALUES (cids[k], uids[i], now() - make_interval(days => cdays[k] - 1)) ON CONFLICT DO NOTHING;
      END IF;
      IF capr[k] AND random() < clike[k] THEN
        INSERT INTO campaign_likes (campaign_id, user_id, liked_at)
        VALUES (cids[k], uids[i], now() - random() * make_interval(days => cdays[k] - 1)) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  -- 이동 기록: 사람마다 1~39번 (열심히 하는 사람은 적고, 가끔 하는 사람은 많게)
  FOR i IN 1..array_length(uids, 1) LOOP
    n := 1 + floor(38 * power(random(), 2.3))::int;
    FOR j IN 1..n LOOP
      IF random() < 0.42 THEN kind := 'bus'; mkm := 3 + random() * 12;
      ELSIF random() < 0.5 THEN kind := 'subway'; mkm := 4 + random() * 16;
      ELSIF random() < 0.55 THEN kind := 'walk'; mkm := 0.6 + random() * 2.6;
      ELSE kind := 'bike'; mkm := 1.5 + random() * 6.5;
      END IF;
      mkm := round(mkm, 1);
      wkm := CASE WHEN kind IN ('bus', 'subway') THEN round((0.2 + random() * 0.7)::numeric, 1) ELSE 0 END;
      -- 아낀 탄소 = 같은 길을 자동차로 갔을 때(길이 12% 더 긺) - 이번 이동 배출량
      saved := round(((mkm + wkm) * 1.12 * 210 - mkm * CASE kind WHEN 'bus' THEN 27.7 WHEN 'subway' THEN 1.53 ELSE 0 END)::numeric, 1);
      pts := round(saved / 1000 * 10)::int + round(mkm + wkm)::int;
      at := now() - power(random(), 2) * interval '33 days';
      o := 1 + floor(random() * array_length(pn, 1))::int;
      d := 1 + ((o - 1 + 1 + floor(random() * (array_length(pn, 1) - 1))::int) % array_length(pn, 1));
      cid := NULL;
      IF random() < 0.55 THEN
        SELECT p.campaign_id INTO cid FROM campaign_participants p JOIN campaigns c ON c.id = p.campaign_id
        WHERE p.user_id = uids[i] AND c.mode_code = kind AND c.id = ANY (okc) AND c.created_at < at
        ORDER BY random() LIMIT 1;
      END IF;
      INSERT INTO trips (user_id, campaign_id, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, minutes, saved_g, arrived_at)
      VALUES (uids[i], cid, pn[o], plat[o], plng[o], pn[d], plat[d], plng[d],
              round(CASE kind WHEN 'walk' THEN mkm * 14 WHEN 'bike' THEN mkm * 4 ELSE mkm * 2.6 + 8 END)::int + 5, saved, at)
      RETURNING id INTO tid;
      IF wkm > 0 THEN
        INSERT INTO trip_segments (trip_id, seq, mode_code, km) VALUES (tid, 1, 'walk', wkm), (tid, 2, kind, mkm);
      ELSE
        INSERT INTO trip_segments (trip_id, seq, mode_code, km) VALUES (tid, 1, kind, mkm);
      END IF;
      IF pts > 0 THEN
        INSERT INTO point_transactions (user_id, amount, reason, trip_id, created_at) VALUES (uids[i], pts, 'trip', tid, at);
      END IF;
    END LOOP;
  END LOOP;

  -- 인기 캠페인 보상 (목표 100kg 이상을 다 채운 캠페인의 만든 사람에게, 목표를 넘긴 그 이동 시각에)
  INSERT INTO point_transactions (user_id, amount, reason, campaign_id, created_at)
  SELECT c.creator_id, round(c.goal_kg * 10)::int, 'campaign_reward', c.id, x.reached_at
  FROM campaigns c
  JOIN LATERAL (
    SELECT min(arrived_at) AS reached_at FROM (
      SELECT arrived_at, SUM(saved_g) OVER (ORDER BY arrived_at, id) AS cum FROM trips WHERE campaign_id = c.id
    ) t WHERE t.cum >= c.goal_kg * 1000
  ) x ON x.reached_at IS NOT NULL
  WHERE c.id = ANY (okc) AND c.goal_kg >= 100
  ON CONFLICT (campaign_id) WHERE reason = 'campaign_reward' DO NOTHING;

  -- 참여자 보상 (목표를 채운 순간까지 기여한 만큼 1kg당 10P)
  INSERT INTO point_transactions (user_id, amount, reason, campaign_id, created_at)
  SELECT t.user_id, round(SUM(t.saved_g) / 1000 * 10)::int, 'campaign_bonus', r.campaign_id, r.created_at
  FROM point_transactions r JOIN trips t ON t.campaign_id = r.campaign_id AND t.arrived_at <= r.created_at
  WHERE r.reason = 'campaign_reward' AND r.campaign_id = ANY (okc)
  GROUP BY t.user_id, r.campaign_id, r.created_at HAVING round(SUM(t.saved_g) / 1000 * 10) > 0
  ON CONFLICT (campaign_id, user_id) WHERE reason = 'campaign_bonus' DO NOTHING;
END
$seed$`;

const CLEAR_SQL = `DELETE FROM users WHERE provider = 'seed'`;

// 관리자 본인의 캘린더 시연 기록: 올해 8월 1일부터 오늘까지 불규칙하게
//  하루 절약량이 캘린더 4단계(500g 미만 · 500g~2kg · 2~5kg · 5kg 이상)에 고루 퍼지게,
//  이동이 없는 날도 섞어요. client_key 'demo-cal-…' 로 표시해서 지울 때 이것만 지워요.
const calSql = (uid) => `DO $cal$
DECLARE
  pn text[] := ${arr(PLACES.map((p) => p[0]))};
  plat float8[] := ${arr(PLACES.map((p) => p[1]), String)};
  plng float8[] := ${arr(PLACES.map((p) => p[2]), String)};
  d date; today date; r float8; target numeric; n int; j int; part numeric;
  kind text; fac numeric; km numeric; wkm numeric; saved numeric; pts int; at timestamptz; o int; dd int; tid int; seq int := 0;
BEGIN
  today := (now() AT TIME ZONE 'Asia/Seoul')::date;
  PERFORM setseed(0.808);
  FOR d IN SELECT g::date FROM generate_series(make_date(extract(year FROM today)::int, 8, 1), today, interval '1 day') g LOOP
    IF random() < 0.32 THEN CONTINUE; END IF;              -- 쉬는 날
    r := random();                                        -- 그날 절약량 단계
    target := CASE WHEN r < 0.24 THEN 150 + random() * 330
                   WHEN r < 0.58 THEN 520 + random() * 1450
                   WHEN r < 0.84 THEN 2050 + random() * 2900
                   ELSE 5100 + random() * 3600 END;
    n := 1 + floor(random() * 3)::int;
    FOR j IN 1..n LOOP
      part := target / n;
      IF part < 600 THEN kind := CASE WHEN random() < 0.6 THEN 'walk' ELSE 'bike' END;
      ELSIF part < 2200 THEN kind := CASE WHEN random() < 0.7 THEN 'bus' ELSE 'bike' END;
      ELSE kind := CASE WHEN random() < 0.65 THEN 'subway' ELSE 'bus' END; END IF;
      fac := CASE kind WHEN 'bus' THEN 27.7 WHEN 'subway' THEN 1.53 ELSE 0 END;
      wkm := CASE WHEN kind IN ('bus', 'subway') THEN round((0.2 + random() * 0.5)::numeric, 1) ELSE 0 END;
      km := round(GREATEST(0.3, (part - wkm * 235.2) / (235.2 - fac))::numeric, 1);
      saved := round(((km + wkm) * 1.12 * 210 - km * fac)::numeric, 1);
      pts := round(saved / 1000 * 10)::int + round(km + wkm)::int;
      at := (d + make_interval(hours => 7 + floor(random() * 14)::int, mins => floor(random() * 60)::int)) AT TIME ZONE 'Asia/Seoul';
      IF at > now() THEN at := now() - make_interval(mins => 5 + floor(random() * 50)::int); END IF;
      o := 1 + floor(random() * array_length(pn, 1))::int;
      dd := 1 + ((o + floor(random() * (array_length(pn, 1) - 1))::int) % array_length(pn, 1));
      seq := seq + 1;
      INSERT INTO trips (user_id, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, minutes, saved_g, arrived_at, client_key)
      VALUES (${Number(uid)}, pn[o], plat[o], plng[o], pn[dd], plat[dd], plng[dd],
              round(CASE kind WHEN 'walk' THEN km * 14 WHEN 'bike' THEN km * 4 ELSE km * 2.6 + 8 END)::int + 5, saved, at, 'demo-cal-' || seq)
      RETURNING id INTO tid;
      IF wkm > 0 THEN INSERT INTO trip_segments (trip_id, seq, mode_code, km) VALUES (tid, 1, 'walk', wkm), (tid, 2, kind, km);
      ELSE INSERT INTO trip_segments (trip_id, seq, mode_code, km) VALUES (tid, 1, kind, km); END IF;
      IF pts > 0 THEN INSERT INTO point_transactions (user_id, amount, reason, trip_id, created_at) VALUES (${Number(uid)}, pts, 'trip', tid, at); END IF;
    END LOOP;
  END LOOP;
END
$cal$`;
const CAL_CLEAR = (uid) => `DELETE FROM trips WHERE user_id = ${Number(uid)} AND client_key LIKE 'demo-cal-%'`;

module.exports = { SEED_SQL, CLEAR_SQL, NICKS, calSql, CAL_CLEAR };
