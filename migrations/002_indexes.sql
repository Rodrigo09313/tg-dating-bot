-- migrations/002_indexes.sql
CREATE INDEX IF NOT EXISTS users_geom_gix ON users USING GIST(geom);
CREATE INDEX IF NOT EXISTS rq_geom_gix ON roulette_queue USING GIST(geom);
CREATE INDEX IF NOT EXISTS users_city_trgm_gin ON users USING GIN (city_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ua_user_action_ts_ix ON user_actions(user_id, action, ts DESC);
CREATE INDEX IF NOT EXISTS rq_joined_at_ix ON roulette_queue(joined_at);
CREATE INDEX IF NOT EXISTS rp_status_ix ON roulette_pairs(status);
CREATE INDEX IF NOT EXISTS cr_status_ix ON contact_requests(status);
CREATE INDEX IF NOT EXISTS cr_to_id_ix ON contact_requests(to_id);
