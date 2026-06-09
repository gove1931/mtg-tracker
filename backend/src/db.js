const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ===== イベント =====

async function createEvent({ eventType, gemCost, date }) {
  const name = `${date} ${eventType}`;
  const { rows } = await pool.query(
    `INSERT INTO events (name, type, date, gem_cost, gem_balance)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name`,
    [name, eventType, date, gemCost, -gemCost]
  );
  return { id: rows[0].id, name: rows[0].name };
}

async function getEvents() {
  const { rows } = await pool.query(
    `SELECT id, name, type, to_char(date, 'YYYY-MM-DD') AS date,
            gem_cost, total_runs, total_wins, gem_balance
     FROM events ORDER BY date DESC, created_at DESC`
  );
  return rows.map(rowToEvent);
}

async function updateEvent(id, { totalRuns, totalWins, gemBalance }) {
  await pool.query(
    `UPDATE events SET total_runs=$1, total_wins=$2, gem_balance=$3 WHERE id=$4`,
    [totalRuns, totalWins, gemBalance, id]
  );
}

// ===== 戦績 =====

async function createRun({ eventPageId, runIndex, wins, prizeType, prizeGem, prizeBoxCount }) {
  const { rows } = await pool.query(
    `INSERT INTO runs (event_id, run_index, wins, prize_type, prize_gem, prize_box_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [eventPageId, runIndex, wins, prizeType, prizeGem || 0, prizeBoxCount || 0]
  );
  return { id: rows[0].id };
}

async function getRunsByEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT id, run_index, wins, prize_type, prize_gem, prize_box_count
     FROM runs WHERE event_id=$1 ORDER BY run_index`,
    [eventId]
  );
  return rows.map(rowToRun);
}

// ===== 変換ヘルパー =====

function rowToEvent(r) {
  return {
    id:         r.id,
    name:       r.name,
    type:       r.type,
    date:       r.date,
    gemCost:    r.gem_cost,
    totalRuns:  r.total_runs,
    totalWins:  r.total_wins,
    gemBalance: r.gem_balance,
  };
}

function rowToRun(r) {
  return {
    id:            r.id,
    wins:          r.wins,
    prizeType:     r.prize_type,
    prizeGem:      r.prize_gem,
    prizeBoxCount: r.prize_box_count,
  };
}

module.exports = { createEvent, getEvents, updateEvent, createRun, getRunsByEvent };
