# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

MTG Arena の戦績（イベント・Run）を記録・閲覧するモバイル向けWebアプリ。フロントエンドはReact+Vite、バックエンドはExpress、データストアはNotion API。

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

`backend/.env` に以下が必要：

```
NOTION_TOKEN=
EVENT_DB_ID=
RUN_DB_ID=
```

フロントエンド本番時は `VITE_API_URL` を Vite 環境変数として設定（未設定時は相対パス `/api/...` を使用）。

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
        ├── notion.js    # Notion API ラッパー（全DB操作）
        └── routes/
            ├── events.js  # GET/POST /api/events、PUT /api/events/:id
            └── runs.js    # GET /api/runs/:eventId、POST /api/runs
```

### データフロー

ゲーム記録はすべてクライアント（React state）で保持し、**「イベント終了」ボタン押下時のみ**バックエンドに同期する：

1. `POST /api/events` → Notion にイベントページ作成、`pageId` を返す
2. `POST /api/runs` を Run 数分ループ → 各 Run を Notion に作成
3. `PUT /api/events/:id` → イベントの集計値（totalRuns / totalWins / gemBalance）を更新

履歴表示時は `GET /api/events` → イベント一覧取得、選択後 `GET /api/runs/:eventId` で Run 詳細取得。

### 画面遷移（screen state）

`App.jsx` の `screen` 変数で制御するステートマシン：

```
home → record → setup → summary ⇆ run
home → history
```

`activeEvent` オブジェクトがイベント進行中の状態を保持（type / gemCost / boxType / runs[]）。

### Notion DBスキーマ

**イベントDB（EVENT_DB_ID）**: イベント名(title) / イベントタイプ(select) / 日付(date) / 消費ジェム(number) / 総Run数(number) / 総勝利数(number) / ジェム収支(number)

**戦績DB（RUN_DB_ID）**: Run名(title) / 勝利数(number) / プライズ種別(select) / プライズ(ジェム)(number) / プライズ(パック数)(number) / イベントID(relation → イベントDB)

## デプロイ（VPS）

- PM2名: `mtg-tracker-api`、URL: `http://163.44.125.213:3002`
- git remote `vps` → `ssh://root@163.44.125.213:2222/var/repo/mtg-tracker.git`
- デプロイコマンド: `git push vps main:main`（`master` ではなく `main:main` を指定すること）
- push すると post-receive フックが自動ビルド＆PM2 restart

## 既知の課題・メモ

- `frontend/src/constants.js` に定数が抽出されているが、`App.jsx` 側で同じ定数をインライン定義しており重複している（App.jsx が constants.js を import していない）
- `App.jsx` 内のスタイルはすべてテンプレートリテラルのインライン CSS（`<style>{styles}</style>`）で管理
- バックエンドの Notion→PostgreSQL 移行が今後の予定
