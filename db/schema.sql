-- =====================================================================
--  푸른하늘 DB 설계 (PostgreSQL / Neon)
--  제3정규형(3NF): 모든 칸은 그 표의 기본키에만 기대고,
--  계산으로 구할 수 있는 값(누적 kg, 참여자 수, 좋아요 수, 포인트 잔액 등)은 저장하지 않고 뷰(VIEW)로 계산해요.
--  여러 번 실행해도 안전해요 (IF NOT EXISTS / ON CONFLICT DO NOTHING).
--  이 파일을 고치면 `node db/build-schema.cjs` → 배포하면 서버가 바뀐 걸 알아채고 다시 실행해요.
-- =====================================================================

-- 1) 이동 수단 (참조표) — 탄소배출계수 출처: 서울시 자료(그린피스 코리아 인용)
CREATE TABLE IF NOT EXISTS transport_modes (
  code          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  co2_g_per_km  NUMERIC(8,2) NOT NULL CHECK (co2_g_per_km >= 0)
);
INSERT INTO transport_modes (code, label, co2_g_per_km) VALUES
  ('car', '자동차', 210), ('bus', '버스', 27.7), ('subway', '지하철', 1.53), ('bike', '자전거', 0), ('walk', '도보', 0)
ON CONFLICT (code) DO NOTHING;

-- 2) 캠페인 분류 (참조표)
CREATE TABLE IF NOT EXISTS campaign_tags (
  code          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  default_mode  TEXT NOT NULL REFERENCES transport_modes(code)
);
INSERT INTO campaign_tags (code, label, default_mode) VALUES
  ('transit', '대중교통', 'bus'), ('walk', '걷기', 'walk'), ('bike', '자전거', 'bike'),
  ('carfree', '차 없는 날', 'subway'), ('together', '함께하기', 'bus')
ON CONFLICT (code) DO NOTHING;

-- 3) 회원
CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  provider     TEXT NOT NULL DEFAULT 'email',
  provider_id  TEXT,
  email        TEXT,
  name         TEXT NOT NULL,
  pw_hash      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
-- blocked_at: 관리자가 이용을 막은 시각 (비어 있으면 정상 회원). 차단된 회원은 로그인할 수 없어요.
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email)) WHERE provider = 'email';
CREATE UNIQUE INDEX IF NOT EXISTS users_social_uq ON users (provider, provider_id) WHERE provider_id IS NOT NULL;

-- 4) 캠페인 (현재 승인 상태·누적량·참여자 수·좋아요 수는 저장하지 않고 뷰로 계산)
CREATE TABLE IF NOT EXISTS campaigns (
  id            SERIAL PRIMARY KEY,
  creator_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_code      TEXT NOT NULL REFERENCES campaign_tags(code),
  mode_code     TEXT NOT NULL REFERENCES transport_modes(code) CHECK (mode_code IN ('bus', 'subway', 'bike', 'walk')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  subtitle      TEXT,
  body          TEXT NOT NULL DEFAULT '',
  cover_url     TEXT,
  goal_kg       NUMERIC(10,1) NOT NULL CHECK (goal_kg > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now()  -- 검토 신청(재신청) 시각
);
CREATE INDEX IF NOT EXISTS campaigns_creator_idx ON campaigns (creator_id);

-- 5) 관리자 검토 기록 (승인/반려 이력 — 다시 신청하면 기록이 쌓여요)
CREATE TABLE IF NOT EXISTS campaign_reviews (
  id            SERIAL PRIMARY KEY,
  campaign_id   INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  reviewer_id   INT REFERENCES users(id) ON DELETE SET NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason        TEXT,
  reviewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at       TIMESTAMPTZ,  -- 만든 사람이 결과 알림을 본 시각
  CHECK (decision = 'approved' OR reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS campaign_reviews_campaign_idx ON campaign_reviews (campaign_id, reviewed_at DESC);

-- 6) 캠페인 참여 (회원 N : 캠페인 N)
CREATE TABLE IF NOT EXISTS campaign_participants (
  campaign_id   INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS campaign_participants_user_idx ON campaign_participants (user_id);

-- 7) 캠페인 좋아요 (회원 N : 캠페인 N)
CREATE TABLE IF NOT EXISTS campaign_likes (
  campaign_id   INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  liked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);

-- 8) 이동 기록 (한 번 길찾기해서 도착한 것)
--    saved_g: 같은 출발·도착을 자동차로 갔을 때보다 아낀 탄소. 구간만으로는 계산할 수 없어서(자동차 경로가 따로 있어서) 저장해요.
--    campaign_id: 캠페인 참여로 이동했으면 그 캠페인. 참여한 캠페인만 넣을 수 있게 (campaign_id, user_id)로 참여 표를 참조해요.
CREATE TABLE IF NOT EXISTS trips (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id   INT,
  origin_name   TEXT NOT NULL,
  origin_lat    DOUBLE PRECISION NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lng    DOUBLE PRECISION NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
  dest_name     TEXT NOT NULL,
  dest_lat      DOUBLE PRECISION NOT NULL CHECK (dest_lat BETWEEN -90 AND 90),
  dest_lng      DOUBLE PRECISION NOT NULL CHECK (dest_lng BETWEEN -180 AND 180),
  minutes       INT NOT NULL CHECK (minutes >= 0),
  saved_g       NUMERIC(12,1) NOT NULL DEFAULT 0 CHECK (saved_g >= 0),
  arrived_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, user_id) REFERENCES campaign_participants (campaign_id, user_id) ON DELETE SET NULL (campaign_id)
);
-- client_key: 앱이 이동마다 붙이는 고유 번호. 인터넷이 끊겨 다시 보내도 같은 이동이 두 번 저장되지 않게 해요.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS client_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS trips_client_key_uq ON trips (user_id, client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS trips_user_idx ON trips (user_id, arrived_at DESC);
CREATE INDEX IF NOT EXISTS trips_campaign_idx ON trips (campaign_id) WHERE campaign_id IS NOT NULL;

-- 9) 이동 구간 (한 이동 = 여러 구간: 도보 → 버스 → 지하철 …). 구간 배출량 = km × 이동 수단 계수 (저장 안 함)
CREATE TABLE IF NOT EXISTS trip_segments (
  trip_id       INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seq           SMALLINT NOT NULL CHECK (seq >= 1),
  mode_code     TEXT NOT NULL REFERENCES transport_modes(code),
  km            NUMERIC(8,3) NOT NULL CHECK (km >= 0),
  PRIMARY KEY (trip_id, seq)
);

-- 10) 탄소 포인트 내역 (잔액·월별 합계는 저장하지 않고 합계로 계산)
CREATE TABLE IF NOT EXISTS point_transactions (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        INT NOT NULL CHECK (amount > 0),
  reason        TEXT NOT NULL,
  trip_id       INT UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  campaign_id   INT REFERENCES campaigns(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 사유별 규칙 (예전 규칙은 지우고 다시 만들어요 — 여러 번 실행해도 같은 결과)
--   trip           이동 포인트        → 이동(trip_id)만
--   campaign_reward 인기 캠페인 보상   → 만든 사람, 캠페인당 1번
--   campaign_bonus  인기 캠페인 참여 보상 → 목표 달성까지 기여한 참여자, 캠페인·회원당 1번
--   admin_grant     관리자가 직접 지급
ALTER TABLE point_transactions DROP CONSTRAINT IF EXISTS point_transactions_reason_check;
ALTER TABLE point_transactions DROP CONSTRAINT IF EXISTS point_transactions_check;
ALTER TABLE point_transactions DROP CONSTRAINT IF EXISTS point_reason_ck;
ALTER TABLE point_transactions ADD CONSTRAINT point_reason_ck CHECK (
     (reason = 'trip' AND trip_id IS NOT NULL AND campaign_id IS NULL)
  OR (reason IN ('campaign_reward', 'campaign_bonus') AND campaign_id IS NOT NULL AND trip_id IS NULL)
  OR (reason IN ('admin_grant', 'admin_deduct') AND trip_id IS NULL AND campaign_id IS NULL));
-- 금액: 관리자 차감(admin_deduct)만 음수, 나머지는 모두 양수
ALTER TABLE point_transactions DROP CONSTRAINT IF EXISTS point_transactions_amount_check;
ALTER TABLE point_transactions DROP CONSTRAINT IF EXISTS point_amount_ck;
ALTER TABLE point_transactions ADD CONSTRAINT point_amount_ck CHECK ((reason = 'admin_deduct' AND amount < 0) OR (reason <> 'admin_deduct' AND amount > 0));
CREATE INDEX IF NOT EXISTS point_transactions_user_idx ON point_transactions (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS point_reward_once_uq ON point_transactions (campaign_id) WHERE reason = 'campaign_reward';
CREATE UNIQUE INDEX IF NOT EXISTS point_bonus_once_uq ON point_transactions (campaign_id, user_id) WHERE reason = 'campaign_bonus';

-- 11) 탄소 절약량 조절 (관리자가 더하거나 뺀 기록 · 이동 기록과 따로 남겨서 언제 누가 바꿨는지 알 수 있어요)
CREATE TABLE IF NOT EXISTS carbon_adjustments (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_g      NUMERIC(12,1) NOT NULL CHECK (amount_g <> 0),
  admin_id      INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carbon_adjustments_user_idx ON carbon_adjustments (user_id);

-- ===================== 계산용 뷰 (저장 안 하고 그때그때 계산) =====================

-- 이동별 배출량·거리
CREATE OR REPLACE VIEW v_trip_totals AS
SELECT t.id AS trip_id, t.user_id, t.campaign_id, t.arrived_at, t.saved_g,
       COALESCE(SUM(s.km), 0) AS total_km,
       COALESCE(SUM(s.km * m.co2_g_per_km), 0) AS emission_g
FROM trips t
LEFT JOIN trip_segments s ON s.trip_id = t.id
LEFT JOIN transport_modes m ON m.code = s.mode_code
GROUP BY t.id;

-- 캠페인 현재 상태: 마지막 검토가 마지막 신청 이후면 그 결과, 아니면 '검토 대기'
CREATE OR REPLACE VIEW v_campaign_status AS
SELECT c.id AS campaign_id,
       CASE WHEN r.reviewed_at IS NOT NULL AND r.reviewed_at >= c.submitted_at THEN r.decision ELSE 'pending' END AS status,
       CASE WHEN r.reviewed_at >= c.submitted_at AND r.decision = 'rejected' THEN r.reason END AS reject_reason, -- 다시 신청하면 예전 사유는 안 보여요
       r.reviewed_at
FROM campaigns c
LEFT JOIN LATERAL (
  SELECT decision, reason, reviewed_at FROM campaign_reviews WHERE campaign_id = c.id ORDER BY reviewed_at DESC, id DESC LIMIT 1
) r ON true;

-- 캠페인 집계: 누적 아낀 탄소, 달성률, 참여자 수, 좋아요 수
-- reached_at: 누적이 목표를 처음 넘은 이동의 도착 시각 (저장하지 않고 이동 기록에서 계산)
--   목표 달성 후 7일이 지나면 캠페인이 목록에서 내려가요 (앱 서버가 이 값으로 판단)
CREATE OR REPLACE VIEW v_campaign_stats AS
SELECT c.id AS campaign_id, c.title, c.goal_kg, st.status,
       COALESCE((SELECT SUM(saved_g) FROM trips WHERE campaign_id = c.id), 0) AS progress_g,
       ROUND(COALESCE((SELECT SUM(saved_g) FROM trips WHERE campaign_id = c.id), 0) / (c.goal_kg * 10), 1) AS progress_pct,
       (SELECT COUNT(*) FROM campaign_participants WHERE campaign_id = c.id) AS participants,
       (SELECT COUNT(*) FROM campaign_likes WHERE campaign_id = c.id) AS likes,
       (SELECT MIN(t.arrived_at) FROM (
          SELECT arrived_at, SUM(saved_g) OVER (ORDER BY arrived_at, id) AS cum FROM trips WHERE campaign_id = c.id
        ) t WHERE t.cum >= c.goal_kg * 1000) AS reached_at
FROM campaigns c
JOIN v_campaign_status st ON st.campaign_id = c.id;

-- 캠페인 참여자 기여 랭킹
CREATE OR REPLACE VIEW v_campaign_ranking AS
SELECT p.campaign_id, p.user_id, u.name,
       COALESCE(SUM(t.saved_g), 0) AS contributed_g,
       RANK() OVER (PARTITION BY p.campaign_id ORDER BY COALESCE(SUM(t.saved_g), 0) DESC) AS rank
FROM campaign_participants p
JOIN users u ON u.id = p.user_id
LEFT JOIN trips t ON t.campaign_id = p.campaign_id AND t.user_id = p.user_id
GROUP BY p.campaign_id, p.user_id, u.name;

-- 회원별 요약: 이동 횟수, 총 아낀 탄소, 포인트 잔액
CREATE OR REPLACE VIEW v_user_stats AS
SELECT u.id AS user_id, u.name,
       (SELECT COUNT(*) FROM trips WHERE user_id = u.id) AS trip_count,
       COALESCE((SELECT SUM(saved_g) FROM trips WHERE user_id = u.id), 0)
         + COALESCE((SELECT SUM(amount_g) FROM carbon_adjustments WHERE user_id = u.id), 0) AS saved_g, -- 이동 + 관리자 조절
       COALESCE((SELECT SUM(amount) FROM point_transactions WHERE user_id = u.id), 0) AS points
FROM users u;
