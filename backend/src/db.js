const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// BOXプライズのジェム換算値（フロントの BOX_GEM_VALUE と同じ値）
const BOX_GEM_VALUE = { PB_BOX: 20000, CB_BOX: 60000 };

// ===== イベント =====
// イベント = 「期間イベント」（アリーナダイレクト等、Runをまとめて数えたいもの）と過去の記録単位。
// Runは単独でも記録でき、同じ種別の進行中イベントがあればそこに自動で紐づく。

async function createEvent({ eventType, gemCost, date, maxLosses, maxWins, status = "completed", boxType = null, boxName = null }) {
  const name = `${date} ${eventType}`;
  const { rows } = await pool.query(
    `INSERT INTO events (name, type, date, gem_cost, gem_balance, max_losses, max_wins, status, box_type, box_name)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9) RETURNING id, name`,
    [name, eventType, date, gemCost, maxLosses ?? 3, maxWins ?? 7, status, boxType, boxName]
  );
  return { id: rows[0].id, name: rows[0].name };
}

async function getEvents() {
  const { rows } = await pool.query(
    `SELECT id, name, type, to_char(date, 'YYYY-MM-DD') AS date,
            gem_cost, total_runs, total_wins, total_losses, gem_balance, max_losses, max_wins
     FROM events WHERE deleted_at IS NULL AND status = 'completed' ORDER BY date DESC, created_at DESC`
  );
  return rows.map(rowToEvent);
}

async function getInProgressEvents() {
  const { rows } = await pool.query(
    `SELECT id, name, type, to_char(date, 'YYYY-MM-DD') AS date,
            gem_cost, total_runs, total_wins, total_losses, gem_balance, max_losses, max_wins, box_type, box_name
     FROM events WHERE status = 'in_progress' AND deleted_at IS NULL
     ORDER BY created_at DESC`
  );
  return rows.map(rowToEvent);
}

// イベントの集計値をRunから再計算する（Runの追加・修正・削除のたびに呼ぶ）
async function recomputeEventTotals(eventId) {
  if (!eventId) return;
  await pool.query(
    `UPDATE events e SET
       total_runs   = s.cnt,
       total_wins   = s.wins,
       total_losses = s.losses,
       gem_balance  = s.balance
     FROM (
       SELECT count(r.id) AS cnt,
              COALESCE(sum(r.wins), 0) AS wins,
              COALESCE(sum(r.losses), 0) AS losses,
              COALESCE(sum(
                CASE r.prize_type
                  WHEN 'ジェム' THEN r.prize_gem
                  WHEN 'PB_BOX' THEN $2::int * GREATEST(r.prize_box_count, 1)
                  WHEN 'CB_BOX' THEN $3::int * GREATEST(r.prize_box_count, 1)
                  ELSE 0
                END - COALESCE(r.gem_cost, ev.gem_cost)
              ), 0) AS balance
       FROM events ev LEFT JOIN runs r ON r.event_id = ev.id
       WHERE ev.id = $1
     ) s
     WHERE e.id = $1`,
    [eventId, BOX_GEM_VALUE.PB_BOX, BOX_GEM_VALUE.CB_BOX]
  );
}

async function completeEvent(id) {
  await pool.query(`UPDATE events SET status='completed' WHERE id=$1`, [id]);
  await recomputeEventTotals(id);
}

async function deleteEvent(id) {
  await pool.query("UPDATE events SET deleted_at = NOW() WHERE id=$1", [id]);
}

// ===== 戦績（Run） =====

// eventPageId 指定時はそのイベントへ追加（履歴の編集から）。
// 未指定時は eventType の進行中イベントがあれば自動で紐づけ、無ければ単独Runとして保存。
async function createRun({ eventPageId, eventType, gemCost, maxWins, maxLosses,
                           wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight }) {
  let event = null;
  if (eventPageId) {
    const { rows } = await pool.query(
      `SELECT id, type, gem_cost, max_wins, max_losses FROM events WHERE id=$1 AND deleted_at IS NULL`,
      [eventPageId]
    );
    event = rows[0];
    if (!event) throw Object.assign(new Error("イベントが見つかりません"), { status: 404 });
  } else {
    const { rows } = await pool.query(
      `SELECT id, type, gem_cost, max_wins, max_losses FROM events
       WHERE type=$1 AND status='in_progress' AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [eventType]
    );
    event = rows[0] || null;
  }

  const type = event ? event.type : eventType;
  const cost = event ? event.gem_cost : (gemCost ?? 0);
  const mw = event ? (event.max_wins ?? 7) : (maxWins ?? 7);
  const ml = event ? (event.max_losses ?? 3) : (maxLosses ?? 3);
  let runIndex = 0;
  if (event) {
    const { rows } = await pool.query(
      `SELECT COALESCE(max(run_index), 0) + 1 AS next FROM runs WHERE event_id=$1`, [event.id]
    );
    runIndex = rows[0].next;
  }

  const { rows } = await pool.query(
    `INSERT INTO runs (event_id, run_index, wins, losses, prize_type, prize_gem, prize_box_count, has_right,
                       event_type, gem_cost, max_wins, max_losses, played_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()) RETURNING id`,
    [event?.id ?? null, runIndex, wins, losses ?? 0, prizeType, prizeGem || 0, prizeBoxCount || 0, hasRight ?? false,
     type, cost, mw, ml]
  );
  await recomputeEventTotals(event?.id);
  return { id: rows[0].id, eventId: event?.id ?? null, runIndex };
}

async function updateRun(id, { wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight }) {
  const { rows } = await pool.query(
    `UPDATE runs SET wins=$1, losses=$2, prize_type=$3, prize_gem=$4, prize_box_count=$5, has_right=$6
     WHERE id=$7 RETURNING event_id`,
    [wins, losses ?? 0, prizeType, prizeGem || 0, prizeBoxCount || 0, hasRight ?? false, id]
  );
  if (!rows.length) return 0;
  await recomputeEventTotals(rows[0].event_id);
  return 1;
}

async function deleteRun(id) {
  const { rows } = await pool.query("DELETE FROM runs WHERE id=$1 RETURNING event_id", [id]);
  if (rows.length) await recomputeEventTotals(rows[0].event_id);
}

const RUN_COLUMNS = `r.id, r.event_id, r.run_index, r.wins, r.losses, r.prize_type, r.prize_gem, r.prize_box_count,
  r.has_right, r.event_type, r.gem_cost, r.max_wins, r.max_losses, r.played_at,
  ARRAY(SELECT i.id FROM run_images i WHERE i.run_id = r.id ORDER BY i.created_at) AS image_ids`;

async function getRunsByEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT ${RUN_COLUMNS} FROM runs r WHERE r.event_id=$1 ORDER BY r.run_index, r.played_at`,
    [eventId]
  );
  return rows.map(rowToRun);
}

// 全Run（削除済みイベントに属するものは除く）。月別集計・今日のRun表示に使う
async function getAllRuns() {
  const { rows } = await pool.query(
    `SELECT ${RUN_COLUMNS}, e.name AS event_name, e.status AS event_status
     FROM runs r LEFT JOIN events e ON e.id = r.event_id
     WHERE r.event_id IS NULL OR e.deleted_at IS NULL
     ORDER BY r.played_at DESC`
  );
  return rows.map(r => ({ ...rowToRun(r), eventName: r.event_name, eventStatus: r.event_status }));
}

// ===== デッキリスト画像 =====
// data / thumb はクライアント側で縮小済みのJPEG（base64）

async function addRunImage(runId, { mime, data, thumb }) {
  const { rows } = await pool.query(
    `INSERT INTO run_images (run_id, mime, data, thumb)
     SELECT id, $2, decode($3, 'base64'), decode($4, 'base64') FROM runs WHERE id=$1
     RETURNING id`,
    [runId, mime, data, thumb]
  );
  return rows[0]?.id ?? null;
}

async function getRunImage(id, thumb) {
  const { rows } = await pool.query(
    `SELECT mime, ${thumb ? "thumb" : "data"} AS bytes FROM run_images WHERE id=$1`, [id]
  );
  return rows[0] || null;
}

async function deleteRunImage(id) {
  await pool.query("DELETE FROM run_images WHERE id=$1", [id]);
}

// ===== 変換ヘルパー =====

function rowToEvent(r) {
  return {
    id:          r.id,
    name:        r.name,
    type:        r.type,
    date:        r.date,
    gemCost:     r.gem_cost,
    totalRuns:   r.total_runs,
    totalWins:   r.total_wins,
    totalLosses: r.total_losses,
    gemBalance:  r.gem_balance,
    maxLosses:   r.max_losses,
    maxWins:     r.max_wins,
    boxType:     r.box_type  ?? null,
    boxName:     r.box_name  ?? null,
  };
}

function rowToRun(r) {
  return {
    id:            r.id,
    eventId:       r.event_id,
    runIndex:      r.run_index,
    wins:          r.wins,
    losses:        r.losses,
    prizeType:     r.prize_type,
    prizeGem:      r.prize_gem,
    prizeBoxCount: r.prize_box_count,
    hasRight:      r.has_right,
    eventType:     r.event_type,
    gemCost:       r.gem_cost,
    maxWins:       r.max_wins,
    maxLosses:     r.max_losses,
    playedAt:      r.played_at,
    imageIds:      r.image_ids || [],
  };
}

module.exports = {
  createEvent, getEvents, getInProgressEvents, completeEvent, deleteEvent, recomputeEventTotals,
  createRun, updateRun, getRunsByEvent, getAllRuns, deleteRun,
  addRunImage, getRunImage, deleteRunImage,
};
