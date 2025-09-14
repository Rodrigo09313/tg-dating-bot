CREATE TABLE IF NOT EXISTS browse_seen (
  user_id      BIGINT NOT NULL,
  seen_user_id BIGINT NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT browse_seen_pk PRIMARY KEY (user_id, seen_user_id),
  CONSTRAINT browse_seen_user_fk  FOREIGN KEY (user_id)      REFERENCES users(tg_id) ON DELETE CASCADE,
  CONSTRAINT browse_seen_seen_fk  FOREIGN KEY (seen_user_id) REFERENCES users(tg_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS browse_seen_user_ts_idx ON browse_seen(user_id, ts DESC);
