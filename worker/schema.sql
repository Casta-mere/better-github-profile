-- One row per (pseudonymous id, ISO week). Counting is always by distinct id, never by hits.
CREATE TABLE IF NOT EXISTS pings (
  id TEXT NOT NULL,
  week TEXT NOT NULL,
  theme TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY (id, week)
);
