-- db/schema.sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Пользователи
CREATE TABLE IF NOT EXISTS users (
  tg_id              BIGINT PRIMARY KEY,
  username           TEXT,
  name               TEXT,
  age                INT,
  gender             CHAR(1) CHECK (gender IN ('m','f') ),
  seek               CHAR(1) CHECK (seek IN ('m','f','b') ),
  city_name          TEXT,
  geom               geometry(Point,4326),
  about              TEXT,
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','active','blocked','shadow')),
  state              TEXT,
  last_screen_msg_id BIGINT,
  last_screen_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индекс по гео (для browse/roulette в будущем)
CREATE INDEX IF NOT EXISTS users_geom_gix ON users USING GIST (geom);

-- Фото
CREATE TABLE IF NOT EXISTS photos (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  file_id  TEXT NOT NULL,
  pos      INT  NOT NULL,
  is_main  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Уникальные ограничения
CREATE UNIQUE INDEX IF NOT EXISTS photos_user_pos_uq   ON photos(user_id, pos);
CREATE UNIQUE INDEX IF NOT EXISTS photos_user_file_uq  ON photos(user_id, file_id);

-- На всякий случай триггер обновления updated_at (если ещё не был)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END
    $f$ LANGUAGE plpgsql;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'users_set_updated_at'
  ) THEN
    CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;
