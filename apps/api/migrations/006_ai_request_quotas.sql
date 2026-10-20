CREATE TABLE ai_request_quotas (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX ai_request_quotas_usage_date_idx ON ai_request_quotas (usage_date);
