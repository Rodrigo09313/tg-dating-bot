-- migrations/001_init.sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  tg_id BIGINT PRIMARY KEY,
  username TEXT,
  name TEXT,
  age INT CHECK (age BETWEEN 18 AND 80),
  gender CHAR(1) CHECK (gender IN ('m','f')),
  seek   CHAR(1) CHECK (seek IN ('m','f','b')),
  city_name TEXT,
  geom geometry(Point, 4326),
  about TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','active','blocked','shadow')),
  state TEXT,
  last_screen_msg_id BIGINT,
  last_screen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  pos SMALLINT NOT NULL CHECK (pos BETWEEN 1 AND 3),
  is_main BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS photos_user_pos_uq ON photos(user_id, pos);

CREATE TABLE IF NOT EXISTS browse_seen (
  user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  seen_user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, seen_user_id)
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id BIGSERIAL PRIMARY KEY,
  from_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  to_id   BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  context TEXT NOT NULL CHECK (context IN ('browse','roulette')),
  status  TEXT NOT NULL CHECK (status IN ('pending','accepted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  a_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  b_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_pair_uq
  ON contacts (LEAST(a_id,b_id), GREATEST(a_id,b_id));

CREATE TABLE IF NOT EXISTS roulette_queue (
  user_id BIGINT PRIMARY KEY REFERENCES users(tg_id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  geom geometry(Point,4326),
  locked_by BIGINT,
  locked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS roulette_pairs (
  id BIGSERIAL PRIMARY KEY,
  u1 BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  u2 BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  target_id   BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('browse','roulette','request')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_actions (
  user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
