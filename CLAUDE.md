# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

MTG Arena の戦績（Run）を記録・閲覧するモバイル向けWebアプリ。フロントエンドはReact+Vite、バックエンドはExpress、データストアはPostgreSQL（`backend/src/db.js`。`notion.js` は旧実装の残骸で未使用）。

**記録の単位はRun。** Runごとに種別（プレミアドラフト等）・消費ジェム・プレイ日時を持ち、種別を混ぜて連続記録できる。アリーナダイレクトのようにRun数をまとめて数えたいものだけ「期間イベント」（`events.status = in_progress`）として開始し、開始中は同じ種別のRunがサーバー側で自動的に紐づく。集計は「イベント単位」と「月×種別」（Runの`played_at`をJSTで月に丸める）。

## 開発コマンド

```powershell
# フロントエンド（localhost:5173）
cd frontend
npm run dev

# バックエンド（localhost:3001）
cd backend
npm run dev      # nodemon使用
npm start        # 本番起動

# ビルド
cd frontend && npm run build

# Lint
cd frontend && npm run lint
```

## 環境変数

`backend/.env` に `DATABASE_URL=postgresql://...` が必要。フロントエンド本番時は `VITE_API_URL`（未設定時は相対パス `/api/...`）。

## DBマイグレーション

`backend/migrations/*.sql` を `sudo -u postgres psql -d mtgtracker -f <file>` で手動適用する（マイグレーションツール無し）。適用前に `pg_dump` でバックアップを取ること。

## アーキテクチャ

### ディレクトリ構成

```
mtg-tracker/
├── frontend/        # React + Vite (ESM)
│   └── src/
│       ├── App.jsx      # アプリ全体（画面コンポーネント、スタイル、APIコール）
│       ├── constants.js # 定数定義（※現在 App.jsx 側で重複定義されており未使用）
│       └── main.jsx     # エントリポイント
└── backend/         # Express (CommonJS)
    └── src/
        ├── app.js       # サーバー起動・ルーティング登録
        ├── db.js        # PostgreSQL アクセス（全DB操作・イベント集計の再計算）
        ├── notion.js    # 旧Notion実装（未使用）
        └── routes/
            ├── events.js  # /api/events（一覧・進行中・作成・完了・削除）
            └── runs.js    # /api/runs（全件・イベント別・作成・修正・削除）
```

### データフロー

- Run保存: `POST /api/runs`（`eventType, gemCost, maxWins, maxLosses` + 成績）。同種別の進行中イベントがあれば自動で紐づく。履歴編集から追加する場合は `eventPageId` を渡し、種別・消費ジェムはイベント側から取る。
- Run修正/削除: `PUT/DELETE /api/runs/:id`。紐づくイベントの集計値（total_runs/wins/losses/gem_balance）はサーバーの `recomputeEventTotals` が毎回再計算する（クライアントは集計値を送らない）。
- 取得: `GET /api/runs`（全Run）、`GET /api/events/in-progress`（進行中イベントの**配列**）、`GET /api/events`（完了イベント）、`GET /api/runs/:eventId`。

### 画面遷移（screen state）

`App.jsx` の `screen` で制御。`home`（Runを記録 / 進行中の期間イベント / 今日のRun）→ `run`（上部の種別切替 + 勝敗入力。状態は `entry`）、`record`（期間イベント開始）→ `summary`、`history`（月別タブ / イベントタブ）。スマホ用コンポーネントとPC用（`PCDemo` 配下、`pcd-` クラス）が同じ state を共有する二重構成なので、画面変更は両方に入れること。

## デプロイ（home-server staging、実運用はこちら）

staging VM `root@100.127.165.83` の `/var/www/mtg-tracker` で `git pull origin main` → `cd frontend && npm run build` → `pm2 restart mtg-tracker-api`。URL: https://mtg-tracker-staging.goveapp.com （旧VPS・`deploy/` 配下の設定は旧環境用）。

## 既知の課題・メモ

- `frontend/src/constants.js` に定数が抽出されているが、`App.jsx` 側で同じ定数をインライン定義しており重複している（App.jsx が constants.js を import していない）
- `App.jsx` 内のスタイルはすべてテンプレートリテラルのインライン CSS（`<style>{styles}</style>`）で管理
