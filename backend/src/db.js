const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ===== イベント =====

async function createEvent({ eventType, gemCost, date, maxLosses, maxWins }) {
  const name = `${date} ${eventType}`;
  const { rows } = await pool.query(
    `INSERT INTO events (name, type, date, gem_cost, gem_balance, max_losses, max_wins)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name`,
    [name, eventType, date, gemCost, -gemCost, maxLosses ?? 3, maxWins ?? 7]
  );
  return { id: rows[0].id, name: rows[0].name };
}

async function getEvents() {
  const { rows } = await pool.query(
    `SELECT id, name, type, to_char(date, 'YYYY-MM-DD') AS date,
            gem_cost, total_runs, total_wins, total_losses, gem_balance, max_losses, max_wins
     FROM events WHERE deleted_at IS NULL ORDER BY date DESC, created_at DESC`
  );
  return rows.map(rowToEvent);
}

async function updateEvent(id, { totalRuns, totalWins, totalLosses, gemBalance }) {
  await pool.query(
    `UPDATE events SET total_runs=$1, total_wins=$2, total_losses=$3, gem_balance=$4 WHERE id=$5`,
    [totalRuns, totalWins, totalLosses ?? 0, gemBalance, id]
  );
}

async function deleteRun(id) {
  await pool.query("DELETE FROM runs WHERE id=$1", [id]);
}

async function deleteEvent(id) {
  await pool.query("UPDATE events SET deleted_at = NOW() WHERE id=$1", [id]);
}

// ===== 戦績 =====

async function createRun({ eventPageId, runIndex, wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight }) {
  const { rows } = await pool.query(
    `INSERT INTO runs (event_id, run_index, wins, losses, prize_type, prize_gem, prize_box_count, has_right)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [eventPageId, runIndex, wins, losses ?? 0, prizeType, prizeGem || 0, prizeBoxCount || 0, hasRight ?? false]
  );
  return { id: rows[0].id };
}

async function getRunsByEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT id, run_index, wins, losses, prize_type, prize_gem, prize_box_count, has_right
     FROM runs WHERE event_id=$1 ORDER BY run_index`,
    [eventId]
  );
  return rows.map(rowToRun);
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
  };
}

function rowToRun(r) {
  return {
    id:            r.id,
    wins:          r.wins,
    losses:        r.losses,
    prizeType:     r.prize_type,
    prizeGem:      r.prize_gem,
    prizeBoxCount: r.prize_box_count,
    hasRight:      r.has_right,
  };
}

module.exports = { createEvent, getEvents, updateEvent, createRun, getRunsByEvent, deleteRun, deleteEvent };
