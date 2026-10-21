-- Runごとのデッキリスト画像（1Runに複数枚）。画像本体はDBに持たせ、pg_dumpのバックアップに含める
CREATE TABLE IF NOT EXISTS run_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  thumb      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_images_run_id_idx ON run_images (run_id);
ALTER TABLE run_images OWNER TO mtgtracker;
