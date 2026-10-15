-- Apply with Wrangler D1 migrations before serving the voting API.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  visitor_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (visitor_id, track_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS track_counts (
  track_id TEXT PRIMARY KEY,
  votes INTEGER NOT NULL CHECK (votes >= 0)
);

CREATE TABLE IF NOT EXISTS visitor_counts (
  visitor_id TEXT PRIMARY KEY,
  votes INTEGER NOT NULL CHECK (votes >= 0)
);

CREATE TABLE IF NOT EXISTS site_totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_votes INTEGER NOT NULL CHECK (total_votes >= 0),
  total_voters INTEGER NOT NULL CHECK (total_voters >= 0)
);

INSERT OR IGNORE INTO site_totals (id, total_votes, total_voters) VALUES (1, 0, 0);

-- Ignored duplicate inserts do not run this trigger. The vote and every
-- aggregate change share the same D1 transaction, including concurrent votes.
CREATE TRIGGER IF NOT EXISTS votes_after_insert
AFTER INSERT ON votes
BEGIN
  INSERT INTO track_counts (track_id, votes) VALUES (NEW.track_id, 1)
    ON CONFLICT (track_id) DO UPDATE SET votes = votes + 1;
  INSERT INTO visitor_counts (visitor_id, votes) VALUES (NEW.visitor_id, 1)
    ON CONFLICT (visitor_id) DO UPDATE SET votes = votes + 1;
  UPDATE site_totals
    SET total_votes = total_votes + 1,
        total_voters = total_voters + CASE
          WHEN (SELECT votes FROM visitor_counts WHERE visitor_id = NEW.visitor_id) = 1
          THEN 1 ELSE 0 END
    WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS votes_after_delete
AFTER DELETE ON votes
BEGIN
  UPDATE track_counts SET votes = votes - 1 WHERE track_id = OLD.track_id;
  DELETE FROM track_counts WHERE track_id = OLD.track_id AND votes = 0;
  UPDATE site_totals
    SET total_votes = total_votes - 1,
        total_voters = total_voters - CASE
          WHEN (SELECT votes FROM visitor_counts WHERE visitor_id = OLD.visitor_id) = 1
          THEN 1 ELSE 0 END
    WHERE id = 1;
  UPDATE visitor_counts SET votes = votes - 1 WHERE visitor_id = OLD.visitor_id;
  DELETE FROM visitor_counts WHERE visitor_id = OLD.visitor_id AND votes = 0;
END;

-- Moving an existing vote would bypass the insert/delete aggregate rules.
CREATE TRIGGER IF NOT EXISTS votes_prevent_update
BEFORE UPDATE ON votes
BEGIN
  SELECT RAISE(ABORT, 'Votes must be inserted or deleted, not updated');
END;
