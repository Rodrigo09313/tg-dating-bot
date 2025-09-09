CREATE TABLE IF NOT EXISTS contact_requests (
  id          BIGSERIAL PRIMARY KEY,
  from_id     BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  to_id       BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  context     TEXT   NOT NULL CHECK (context IN ('browse','roulette')),
  status      TEXT   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS cr_pair_pending_uq
ON contact_requests (LEAST(from_id,to_id), GREATEST(from_id,to_id))
WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS cr_to_idx   ON contact_requests (to_id,  status, created_at DESC);
CREATE INDEX IF NOT EXISTS cr_from_idx ON contact_requests (from_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS contacts (
  id          BIGSERIAL PRIMARY KEY,
  a_id        BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  b_id        BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contacts_self_chk CHECK (a_id <> b_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_pair_uq
ON contacts (LEAST(a_id,b_id), GREATEST(a_id,b_id));
CREATE INDEX IF NOT EXISTS contacts_a_idx ON contacts (a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_b_idx ON contacts (b_id, created_at DESC);
