# MTG Tracker

MTG Arena のイベント戦績を記録・閲覧するモバイル向け Web アプリ。

## 概要

イベント（アリーナダイレクト・プレイイン・リミテッドチャンピオンシップ予選など）ごとに Run（1試合ドラフト）の結果を入力し、ジェム収支・勝率などを集計して確認できます。

**本番 URL**: `http://163.44.125.213:3002`（VPS 直接アクセス）

## スクリーンショット・画面遷移

```
home → record → setup → summary ⇆ run
home → history
```

| 画面 | 説明 |
|------|------|
| Home | 新規記録 / 履歴閲覧の選択。進行中イベントがあれば再開ボタン表示 |
| Record Menu | イベント種別を選択（アリーナダイレクト / プレイイン / 予選 / カスタム） |
| Event Setup | 消費ジェム・最大勝利数・最大敗北数・ボックス種別を設定してイベント開始 |
| Run Entry | 各 Run の勝敗・プライズを入力（同勝利数の過去 Run から自動入力） |
| Summary | Run 一覧・集計グリッド（Runs / 総対戦 / 勝率 / 総勝利 / ジェム収支） |
| History | 月別アコーディオンで過去イベント一覧。イベント詳細・削除が可能 |

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | React 19 + Vite 8（ESM） |
| バックエンド | Node.js 22 + Express 5（CommonJS） |
| データストア | PostgreSQL 16 |
| インフラ | ConoHa VPS（Ubuntu 24.04）+ Nginx + PM2 |

## ディレクトリ構成

```
mtg-tracker/
├── frontend/        # React + Vite
│   └── src/
│       ├── App.jsx      # 全画面コンポーネント・API 呼び出し・インライン CSS
│       ├── constants.js # 定数（未使用 — App.jsx 側でインライン定義）
│       └── main.jsx     # エントリポイント
└── backend/         # Express API サーバー
    └── src/
        ├── app.js       # サーバー起動・ルーティング登録
        ├── db.js        # PostgreSQL クエリ（pg）
        └── routes/
            ├── events.js  # /api/events
            └── runs.js    # /api/runs
```

## API エンドポイント

### イベント

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/events` | イベント一覧取得（日付降順） |
| POST | `/api/events` | イベント作成 |
| PUT | `/api/events/:id` | 集計値（totalRuns / totalWins / totalLosses / gemBalance）更新 |
| DELETE | `/api/events/:id` | イベント削除（Run も全削除） |

**POST body**: `{ eventType, gemCost, date, maxLosses }`

### Run

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/runs/:eventId` | 指定イベントの Run 一覧 |
| POST | `/api/runs` | Run 作成 |
| DELETE | `/api/runs/:id` | Run 削除 |

**POST body**: `{ eventPageId, runIndex, wins, losses, prizeType, prizeGem, prizeBoxCount }`

## データベーススキーマ

```sql
-- イベント
CREATE TABLE events (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  date        DATE NOT NULL,
  gem_cost    INTEGER NOT NULL,
  total_runs  INTEGER DEFAULT 0,
  total_wins  INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  gem_balance INTEGER NOT NULL,
  max_losses  INTEGER DEFAULT 3,
  max_wins    INTEGER DEFAULT 7,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Run（戦績）
CREATE TABLE runs (
  id              SERIAL PRIMARY KEY,
  event_id        INTEGER REFERENCES events(id) ON DELETE CASCADE,
  run_index       INTEGER NOT NULL,
  wins            INTEGER NOT NULL,
  losses          INTEGER DEFAULT 0,
  prize_type      TEXT NOT NULL,
  prize_gem       INTEGER DEFAULT 0,
  prize_box_count INTEGER DEFAULT 0
);
```

## データフロー

ゲーム記録はすべてクライアント（React state）で保持し、**「イベント終了」ボタン押下時のみ** バックエンドに同期します：

1. `POST /api/events` → イベント作成、`id` を返す
2. `POST /api/runs` を Run 数分ループ → 各 Run を DB に保存
3. `PUT /api/events/:id` → 集計値（totalRuns / totalWins / gemBalance）を更新

## ローカル開発

### 前提

- Node.js 22+
- PostgreSQL（接続文字列 `DATABASE_URL` を設定）

### セットアップ

```powershell
# バックエンド
cd backend
npm install

# backend/.env を作成
# DATABASE_URL=postgresql://user:password@localhost:5432/mtg_tracker

npm run dev   # localhost:3001 で起動

# フロントエンド（別ターミナル）
cd frontend
npm install
npm run dev   # localhost:5173 で起動
```

### 環境変数

**`backend/.env`**

```
DATABASE_URL=postgresql://user:password@localhost:5432/mtg_tracker
PORT=3001           # 省略時 3001
```

**フロントエンド（本番時）**

```
VITE_API_URL=https://your-api-host   # 未設定時は相対パス /api/... を使用
```

## ビルド

```powershell
cd frontend
npm run build   # dist/ に出力、base パス: /mtg-tracker/
```

## デプロイ（VPS）

- **PM2 名**: `mtg-tracker-api`
- **公開 URL**: `http://163.44.125.213:3002`
- **git remote**: `vps` → `ssh://root@163.44.125.213:2222/var/repo/mtg-tracker.git`

```powershell
git push vps main:main
```

push すると `post-receive` フックが自動ビルド & `pm2 restart` を実行します。

## プライズ種別・定数

| ID | 表示名 | ジェム換算 |
|----|--------|----------|
| `なし` | なし | — |
| `ジェム` | ジェム | 入力値 |
| `PB_BOX` | プレイブースターBOX | 20,000G/箱 |
| `CB_BOX` | コレクターブースターBOX | 60,000G/箱 |
| `予選ウィークエンド権利` | 予選権利 | — |

## 既知の課題

- `frontend/src/constants.js` が未使用（`App.jsx` でインライン定義が重複）
- スタイルはすべて `App.jsx` 内のテンプレートリテラル CSS（外部 CSS ファイルなし）
