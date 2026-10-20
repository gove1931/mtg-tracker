-- Run単位で記録できるようにする（Runが種別・消費ジェム・プレイ日時を自前で持つ）
-- 既存Runはイベントとの紐付けを残したまま、イベント側の値を写して補完する
BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS gem_cost   integer,
  ADD COLUMN IF NOT EXISTS max_wins   integer,
  ADD COLUMN IF NOT EXISTS max_losses integer,
  ADD COLUMN IF NOT EXISTS played_at  timestamptz;

UPDATE runs r
SET event_type = e.type,
    gem_cost   = e.gem_cost,
    max_wins   = COALESCE(e.max_wins, 7),
    max_losses = COALESCE(e.max_losses, 3),
    played_at  = COALESCE(r.created_at, e.date::timestamptz)
FROM events e
WHERE r.event_id = e.id AND r.event_type IS NULL;

ALTER TABLE runs ALTER COLUMN played_at SET DEFAULT now();
ALTER TABLE runs ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE runs ALTER COLUMN run_index SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS runs_played_at_idx ON runs (played_at);

COMMIT;
