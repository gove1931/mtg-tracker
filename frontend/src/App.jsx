import { useState, useEffect, useCallback } from "react";

// ===== 定数 =====
// VITE_API_URL: Vercelの環境変数に設定（例: https://api.gove.dev）
const API_URL = import.meta.env.VITE_API_URL || "";

const EVENT_TYPES = [
  { id: "アリーナダイレクト", label: "アリーナダイレクト", english: "Arena Direct" },
  { id: "プレイイン", label: "プレイイン", english: "Play-In" },
  { id: "リミテッドチャンピオンシップ予選", label: "リミテッドチャンピオンシップ予選", english: "Limited Championship Qualifier" },
];

// PB BOX=20000G/箱、CB BOX=60000G/箱（20000G=15000円換算）
const BOX_GEM_VALUE = { "PB_BOX": 20000, "CB_BOX": 60000 };

const PRIZE_TYPES = [
  { id: "なし",    label: "なし",                    icon: "✕", color: "#555" },
  { id: "ジェム",  label: "ジェム",                  icon: "💎", color: "#7ecfff" },
  { id: "PB_BOX",  label: "プレイブースターBOX",      icon: "🎁", color: "#f78c6c" },
  { id: "CB_BOX",  label: "コレクターブースターBOX",  icon: "✨", color: "#c792ea" },
  { id: "予選ウィークエンド権利", label: "予選権利",   icon: "🏆", color: "#ffcb6b" },
];

// ===== API関数 =====
async function createEventInNotion(eventType, gemCost, date, maxLosses) {
  const res = await fetch(`${API_URL}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType, gemCost, date, maxLosses }),
  });
  const data = await res.json();
  return data.id || null;
}

async function createRunInNotion(run, eventPageId, runIndex) {
  await fetch(`${API_URL}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventPageId, runIndex,
      wins: run.wins, losses: run.losses || 0,
      prizeType: run.prizeType,
      prizeGem: run.prizeGem, prizeBoxCount: run.prizeBoxCount,
    }),
  });
}

async function updateEventInNotion(eventPageId, totalRuns, totalWins, totalLosses, gemBalance) {
  await fetch(`${API_URL}/api/events/${eventPageId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalRuns, totalWins, totalLosses, gemBalance }),
  });
}

async function deleteRunFromDB(runId) {
  await fetch(`${API_URL}/api/runs/${runId}`, { method: "DELETE" });
}

async function deleteEventFromDB(eventId) {
  await fetch(`${API_URL}/api/events/${eventId}`, { method: "DELETE" });
}

// ===== HomeScreen =====
function HomeScreen({ onRecord, onHistory, activeEvent, onResumeEvent }) {
  return (
    <div className="screen">
      {activeEvent && (
        <>
          <div className="section-label">進行中のイベント</div>
          <div className="card" style={{ borderColor: "rgba(126,207,255,0.25)", marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "#7ecfff", marginBottom: 4 }}>{activeEvent.type}</div>
            <div style={{ fontSize: 11, color: "#ccc", marginBottom: 12 }}>
              消費: {activeEvent.gemCost.toLocaleString()}ジェム　Run数: {activeEvent.runs.length}
            </div>
            <button className="btn-primary" onClick={onResumeEvent}>続きから記録する</button>
          </div>
          <div className="divider" />
        </>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
        <button onClick={onRecord} style={{ width: "100%", padding: "28px 20px", background: "rgba(126,207,255,0.06)", border: "1px solid rgba(126,207,255,0.2)", borderRadius: 14, cursor: "pointer", textAlign: "left" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🎮</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>ゲームを記録する</div>
          <div style={{ fontSize: 12, color: "#ccc" }}>新しいイベントを開始してRunを記録</div>
        </button>
        <button onClick={onHistory} style={{ width: "100%", padding: "28px 20px", background: "rgba(104,217,164,0.05)", border: "1px solid rgba(104,217,164,0.18)", borderRadius: 14, cursor: "pointer", textAlign: "left" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>過去の履歴を見る</div>
          <div style={{ fontSize: 12, color: "#ccc" }}>DBから戦績を取得して表示</div>
        </button>
      </div>
    </div>
  );
}

// ===== RecordMenuScreen =====
function RecordMenuScreen({ onNewEvent, onBack, activeEvent, onResumeEvent }) {
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");

  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← 戻る</button>
      {activeEvent && (
        <>
          <div className="section-label">進行中のイベント</div>
          <div className="card" style={{ borderColor: "rgba(126,207,255,0.2)", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "#7ecfff", marginBottom: 4 }}>{activeEvent.type}</div>
            <div style={{ fontSize: 11, color: "#ccc", marginBottom: 12 }}>
              消費: {activeEvent.gemCost.toLocaleString()}ジェム　Run数: {activeEvent.runs.length}
            </div>
            <button className="btn-primary" onClick={onResumeEvent}>続きから記録する</button>
          </div>
          <div className="divider" />
        </>
      )}
      <div className="section-label">新しいイベント</div>
      {EVENT_TYPES.map(et => (
        <button key={et.id} className="btn"
          style={{ width: "100%", marginBottom: 8, textAlign: "left", padding: "14px 16px" }}
          onClick={() => onNewEvent(et.id)}>
          <span style={{ fontSize: 13, color: "#7ecfff", fontWeight: 700, display: "block", marginBottom: 3 }}>{et.english}</span>
          <span style={{ fontSize: 11, color: "#bbb" }}>{et.label}</span>
        </button>
      ))}
      {!showCustom ? (
        <button className="btn"
          style={{ width: "100%", marginBottom: 8, textAlign: "left", padding: "14px 16px" }}
          onClick={() => setShowCustom(true)}>
          <span style={{ fontSize: 13, color: "#7ecfff", fontWeight: 700, display: "block", marginBottom: 3 }}>Other</span>
          <span style={{ fontSize: 11, color: "#bbb" }}>その他</span>
        </button>
      ) : (
        <div className="card" style={{ marginBottom: 8 }}>
          <div className="section-label">イベント名を入力</div>
          <input className="input-field" type="text" placeholder="例: スペシャルイベント"
            value={customName} onChange={e => setCustomName(e.target.value)} autoFocus />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn" style={{ flex: 1 }}
              onClick={() => { setShowCustom(false); setCustomName(""); }}>キャンセル</button>
            <button className="btn-primary" style={{ flex: 2, padding: "10px" }}
              disabled={!customName.trim()}
              onClick={() => { if (customName.trim()) onNewEvent(customName.trim()); }}>
              作成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== HistoryScreen =====
function groupByMonth(events) {
  const map = {};
  for (const ev of events) {
    const key = (ev.date || "").slice(0, 7);
    if (!map[key]) map[key] = [];
    map[key].push(ev);
  }
  return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
}

function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${y}年${parseInt(m)}月`;
}

function HistoryScreen({ onBack, onEditEvent }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [openMonths, setOpenMonths] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => { fetchHistory(); }, []);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/events`);
      const data = await res.json();
      const sorted = data.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      setEvents(sorted);
      // 最新月だけ最初から開く
      if (sorted.length > 0) {
        const latestKey = (sorted[0].date || "").slice(0, 7);
        setOpenMonths(new Set([latestKey]));
      }
    } catch (e) { setEvents([]); }
    finally { setLoading(false); }
  };

  const fetchRuns = async (eventId) => {
    setRunsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/runs/${eventId}`);
      const data = await res.json();
      setRuns(data);
    } catch (e) { setRuns([]); }
    finally { setRunsLoading(false); }
  };

  const handleSelectEvent = (ev) => { setSelectedEvent(ev); setRuns([]); setConfirmDelete(false); fetchRuns(ev.id); };

  const handleDeleteEvent = async () => {
    setIsDeleting(true);
    try {
      await deleteEventFromDB(selectedEvent.id);
      setEvents(prev => prev.filter(e => e.id !== selectedEvent.id));
      setSelectedEvent(null);
      setConfirmDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleMonth = (key) => {
    setOpenMonths(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  if (selectedEvent) {
    const balance = selectedEvent.gemBalance || 0;
    return (
      <div className="screen">
        <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }}
          onClick={() => setSelectedEvent(null)}>← 一覧に戻る</button>
        <div className="section-label">{selectedEvent.type}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{selectedEvent.name}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={() => onEditEvent(selectedEvent, runs)}>編集</button>
            <button className="btn" style={{ padding: "6px 12px", fontSize: 12, color: "#ff8080", borderColor: "rgba(255,128,128,0.3)" }}
              onClick={() => setConfirmDelete(true)}>削除</button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#ccc", marginBottom: 16 }}>
          {selectedEvent.date} ・ 総対戦: {(selectedEvent.totalWins || 0) + (selectedEvent.totalLosses || 0)}戦
        </div>
        {confirmDelete && (
          <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(255,128,128,0.08)", border: "1px solid rgba(255,128,128,0.3)", borderRadius: 10 }}>
            <div style={{ fontSize: 13, color: "#ff8080", marginBottom: 10 }}>このイベントを削除しますか？（Runデータも全て削除されます）</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ flex: 1, fontSize: 13 }} onClick={() => setConfirmDelete(false)}>キャンセル</button>
              <button className="btn" style={{ flex: 1, fontSize: 13, color: "#ff8080", borderColor: "rgba(255,128,128,0.4)" }}
                disabled={isDeleting} onClick={handleDeleteEvent}>
                {isDeleting ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        )}
        <div className="event-summary" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
          <div className="summary-card"><div className="summary-val">{selectedEvent.totalRuns || 0}</div><div className="summary-key">Runs</div></div>
          <div className="summary-card"><div className="summary-val">{selectedEvent.totalWins || 0}</div><div className="summary-key">総勝利</div></div>
          <div className="summary-card">
            <div className={`summary-val ${balance >= 0 ? "gem-positive" : "gem-negative"}`}>
              {balance >= 0 ? "+" : ""}{balance.toLocaleString()}
            </div>
            <div className="summary-key">ジェム収支</div>
          </div>
          <div className="summary-card">
            <div className="summary-val" style={{ color: "#ffcb6b" }}>
              {runs.length > 0 && (runs.reduce((s, r) => s + r.wins, 0) + runs.reduce((s, r) => s + (r.losses || 0), 0)) > 0
                ? `${Math.round(runs.reduce((s, r) => s + r.wins, 0) / (runs.reduce((s, r) => s + r.wins, 0) + runs.reduce((s, r) => s + (r.losses || 0), 0)) * 100)}%`
                : "—"}
            </div>
            <div className="summary-key">勝率</div>
          </div>
        </div>
        <div className="section-label">Run履歴</div>
        {runsLoading ? (
          <div style={{ color: "#ccc", fontSize: 13, padding: "20px 0", textAlign: "center" }}>取得中...</div>
        ) : (
          <div className="run-list">
            {runs.length === 0
              ? <div style={{ color: "#ccc", fontSize: 13, textAlign: "center", padding: "16px 0" }}>Runデータなし</div>
              : runs.map((r, i) => {
                  const prize = PRIZE_TYPES.find(p => p.id === r.prizeType);
                  let prizeText = prize?.label || "";
                  if (r.prizeType === "ジェム") prizeText += ` ${(r.prizeGem || 0).toLocaleString()}`;
                  if (r.prizeType === "PB_BOX" || r.prizeType === "CB_BOX")
                    prizeText += ` ${r.prizeBoxCount}箱 ≈${(BOX_GEM_VALUE[r.prizeType] * r.prizeBoxCount).toLocaleString()}G`;
                  return (
                    <div key={i} className="run-item">
                      <span className="run-num">#{i + 1}</span>
                      <span className="run-wins">{r.wins}勝{r.losses != null ? `${r.losses}敗` : ""}</span>
                      <span className="run-prize">{prize?.icon} {prizeText}</span>
                    </div>
                  );
                })
            }
          </div>
        )}
      </div>
    );
  }

  const groups = groupByMonth(events);

  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← 戻る</button>
      <div className="section-label">過去のイベント</div>
      {loading ? (
        <div style={{ color: "#ccc", fontSize: 13, padding: "20px 0", textAlign: "center" }}>取得中...</div>
      ) : groups.length === 0 ? (
        <div style={{ color: "#ccc", fontSize: 13, textAlign: "center", padding: "20px 0" }}>履歴がありません</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups.map(([key, monthEvents]) => {
            const isOpen = openMonths.has(key);
            const monthBalance = monthEvents.reduce((s, ev) => s + (ev.gemBalance || 0), 0);
            const monthWins = monthEvents.reduce((s, ev) => s + (ev.totalWins || 0), 0);
            const monthLosses = monthEvents.reduce((s, ev) => s + (ev.totalLosses || 0), 0);
            const monthWinRate = (monthWins + monthLosses) > 0
              ? Math.round(monthWins / (monthWins + monthLosses) * 100)
              : null;
            return (
              <div key={key}>
                {/* 月ヘッダー */}
                <button onClick={() => toggleMonth(key)}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "rgba(126,207,255,0.06)", border: "1px solid rgba(126,207,255,0.18)",
                    borderRadius: isOpen ? "10px 10px 0 0" : 10, padding: "12px 16px", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 10, color: "#7ecfff" }}>{isOpen ? "▼" : "▶"}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#e0e0e0" }}>{monthLabel(key)}</span>
                    <span style={{ fontSize: 11, color: "#bbb" }}>{monthEvents.length}件</span>
                    {monthWinRate !== null && (
                      <span style={{ fontSize: 11, color: "#ffcb6b" }}>{monthWinRate}%</span>
                    )}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: monthBalance >= 0 ? "#68d9a4" : "#ff8080" }}>
                    {monthBalance >= 0 ? "+" : ""}{monthBalance.toLocaleString()}G
                  </span>
                </button>
                {/* イベント一覧 */}
                {isOpen && (
                  <div style={{ border: "1px solid rgba(126,207,255,0.18)", borderTop: "none",
                    borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                    {monthEvents.map((ev, i) => {
                      const bal = ev.gemBalance || 0;
                      return (
                        <button key={ev.id}
                          style={{ width: "100%", textAlign: "left", padding: "12px 16px", background: "rgba(255,255,255,0.02)",
                            border: "none", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none", cursor: "pointer" }}
                          onClick={() => handleSelectEvent(ev)}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <div style={{ fontSize: 10, color: "#7ecfff", marginBottom: 2 }}>{ev.type}</div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{ev.date}</div>
                              <div style={{ fontSize: 11, color: "#bbb", marginTop: 1 }}>{ev.totalRuns}Run / {(ev.totalWins||0)+(ev.totalLosses||0)}戦 {ev.totalWins}勝</div>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: bal >= 0 ? "#68d9a4" : "#ff8080" }}>
                              {bal >= 0 ? "+" : ""}{bal.toLocaleString()}G
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===== EventSetupScreen =====
function EventSetupScreen({ eventType, onStart, onBack }) {
  const [gemCost, setGemCost] = useState("");
  const [maxLosses, setMaxLosses] = useState(3);
  const [boxType, setBoxType] = useState(null);
  const [boxName, setBoxName] = useState("");
  const presets = [4000, 5000, 6000, 8000];

  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← 戻る</button>
      <div className="section-label">イベント設定</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{eventType}</div>
      <div className="card">
        <div className="section-label">消費ジェム（Run毎）</div>
        <input className="input-field" type="number" placeholder="例: 6000" value={gemCost}
          onChange={e => setGemCost(e.target.value)} />
        <div className="btn-grid btn-grid-2 mt-8">
          {presets.map(p => (
            <button key={p} className={`btn ${gemCost == p ? "btn-selected" : ""}`}
              onClick={() => setGemCost(String(p))}>{p.toLocaleString()}</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="section-label">何敗で終了か</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[1, 2, 3].map(n => (
            <button key={n} className={`btn ${maxLosses === n ? "btn-selected" : ""}`}
              style={{ flex: 1, padding: "12px", fontSize: 15, fontWeight: 700 }}
              onClick={() => setMaxLosses(n)}>{n}敗</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="section-label">ボックスプライズの種類（任意）</div>
        <div className="btn-grid mt-8" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <button className={`btn ${boxType === null ? "btn-selected" : ""}`}
            style={{ fontSize: 13, padding: "10px 4px", whiteSpace: "nowrap" }}
            onClick={() => { setBoxType(null); setBoxName(""); }}>なし</button>
          <button className={`btn ${boxType === "PB_BOX" ? "btn-selected" : ""}`}
            style={{ fontSize: 13, padding: "10px 4px", whiteSpace: "nowrap" }}
            onClick={() => setBoxType("PB_BOX")}>🎁 プレイ</button>
          <button className={`btn ${boxType === "CB_BOX" ? "btn-selected" : ""}`}
            style={{ fontSize: 13, padding: "10px 4px", whiteSpace: "nowrap" }}
            onClick={() => setBoxType("CB_BOX")}>✨ コレクター</button>
        </div>
        {boxType && (
          <div className="mt-8">
            <input className="input-field" type="text"
              placeholder="例: ストリクスヘイブンの秘密 日本語版"
              value={boxName} onChange={e => setBoxName(e.target.value)} />
            <div style={{ fontSize: 11, color: "#ccc", marginTop: 6 }}>
              換算: {boxType === "PB_BOX" ? "20,000" : "60,000"}ジェム/箱
            </div>
          </div>
        )}
      </div>
      <button className="btn-primary mt-16"
        disabled={!gemCost || isNaN(Number(gemCost))}
        onClick={() => onStart(Number(gemCost), boxType, boxName.trim(), maxLosses)}>
        イベント開始
      </button>
    </div>
  );
}

// ===== RunEntryScreen =====
function RunEntryScreen({ runIndex, onSave, onBack, boxType, boxName, maxLosses }) {
  const [wins, setWins] = useState(null);
  const [losses, setLosses] = useState(null);
  const [prizeType, setPrizeType] = useState(null);
  const [prizeGem, setPrizeGem] = useState("");
  const [prizeBoxCount, setPrizeBoxCount] = useState(null);
  const gemPresets = [500, 1000, 2500, 3000, 4500, 5400, 6000, 8100, 10800];

  const visiblePrizes = PRIZE_TYPES.filter(pt => {
    if (pt.id === "PB_BOX") return boxType === "PB_BOX";
    if (pt.id === "CB_BOX") return boxType === "CB_BOX";
    return true;
  });

  const canSave = wins !== null && losses !== null && prizeType !== null &&
    (prizeType !== "ジェム" || prizeGem) &&
    (!(prizeType === "PB_BOX" || prizeType === "CB_BOX") || prizeBoxCount !== null);

  const handlePrizeType = (id) => { setPrizeType(id); setPrizeGem(""); setPrizeBoxCount(null); };

  const handleWins = (n) => {
    setWins(n);
    if (n < 7) {
      setLosses(maxLosses || 3);
    } else {
      setLosses(null);
    }
  };

  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← 戻る</button>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "Cinzel, serif", color: "#7ecfff", marginBottom: 20 }}>
        RUN #{runIndex}
      </div>
      <div className="card">
        <div className="section-label">勝利数</div>
        <div className="wins-grid">
          {[0,1,2,3,4,5,6,7].map(n => (
            <button key={n} className={`win-btn ${wins === n ? "win-btn-selected" : ""}`}
              onClick={() => handleWins(n)}>{n}</button>
          ))}
        </div>
      </div>
      {wins === 7 && (
        <div className="card">
          <div className="section-label">敗北数（7勝時）</div>
          <div style={{ display: "flex", gap: 8 }}>
            {Array.from({ length: maxLosses || 3 }, (_, n) => (
              <button key={n} className={`win-btn ${losses === n ? "win-btn-selected" : ""}`}
                style={{ flex: 1 }}
                onClick={() => setLosses(n)}>{n}</button>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div className="section-label">プライズ</div>
        <div className="prize-grid">
          {visiblePrizes.map(pt => (
            <button key={pt.id} className="prize-btn"
              style={prizeType === pt.id ? { background: "rgba(126,207,255,0.1)", borderColor: "rgba(126,207,255,0.4)", color: "#fff" } : {}}
              onClick={() => handlePrizeType(pt.id)}>
              <span className="prize-icon">{pt.icon}</span>
              <span className="prize-label" style={{ fontSize: 9 }}>{pt.label}</span>
            </button>
          ))}
        </div>
        {prizeType === "ジェム" && (
          <div className="mt-12">
            <input className="input-field" type="number" placeholder="例: 5400" value={prizeGem}
              onChange={e => setPrizeGem(e.target.value)} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {gemPresets.map(p => (
                <button key={p} className={`btn ${prizeGem == p ? "btn-selected" : ""}`}
                  style={{ flex: "0 0 auto", padding: "6px 10px", fontSize: 12 }}
                  onClick={() => setPrizeGem(String(p))}>{p.toLocaleString()}</button>
              ))}
            </div>
          </div>
        )}
        {(prizeType === "PB_BOX" || prizeType === "CB_BOX") && (
          <div className="mt-12">
            <div className="section-label">箱数</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2].map(n => (
                <button key={n} className={`btn ${prizeBoxCount === n ? "btn-selected" : ""}`}
                  style={{ flex: 1, padding: "12px", fontSize: 16, fontWeight: 700 }}
                  onClick={() => setPrizeBoxCount(n)}>{n}箱</button>
              ))}
            </div>
            {prizeBoxCount && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(247,140,108,0.08)", borderRadius: 8, border: "1px solid rgba(247,140,108,0.2)" }}>
                <div style={{ fontSize: 10, color: "#ccc" }}>ジェム換算値（暫定）</div>
                <div style={{ fontSize: 13, color: "#f78c6c", fontWeight: 600 }}>
                  ≈ +{(BOX_GEM_VALUE[prizeType] * prizeBoxCount).toLocaleString()} ジェム
                </div>
              </div>
            )}
            {boxName && <div style={{ marginTop: 8, fontSize: 12, color: "#ccc" }}>{boxName}</div>}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" style={{ flex: 1, padding: "14px", fontSize: 14 }} onClick={onBack}>
          キャンセル
        </button>
        <button className="btn-primary" style={{ flex: 2 }} disabled={!canSave}
          onClick={() => onSave({ wins, losses, prizeType, prizeGem: Number(prizeGem) || 0, prizeBoxCount,
            boxName: (prizeType === "PB_BOX" || prizeType === "CB_BOX") ? boxName : "" })}>
          Runを保存
        </button>
      </div>
    </div>
  );
}

// ===== EventSummaryScreen =====
function EventSummaryScreen({ event, onAddRun, onFinish, onBack, onDeleteRun, isSyncing }) {
  const totalWins = event.runs.reduce((s, r) => s + r.wins, 0);
  const totalLosses = event.runs.reduce((s, r) => s + (r.losses || 0), 0);
  const winRate = (totalWins + totalLosses) > 0
    ? Math.round(totalWins / (totalWins + totalLosses) * 100)
    : null;
  const totalGemPrize = event.runs.reduce((s, r) => {
    if (r.prizeType === "ジェム") return s + r.prizeGem;
    if (r.prizeType === "PB_BOX" || r.prizeType === "CB_BOX")
      return s + (BOX_GEM_VALUE[r.prizeType] * (r.prizeBoxCount || 1));
    return s;
  }, 0);
  const totalGemCost = event.gemCost * event.runs.length;
  const gemBalance = totalGemPrize - totalGemCost;
  const hasBoxPrize = event.runs.some(r => r.prizeType === "PB_BOX" || r.prizeType === "CB_BOX");

  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>
        {event.isEditing ? "← 履歴に戻る" : "← ホーム"}
      </button>
      <div className="section-label">{event.isEditing ? "イベント編集中" : "イベント進行中"}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{event.type}</div>
      <div style={{ fontSize: 11, color: "#ccc", marginBottom: 16 }}>
        消費: {event.gemCost.toLocaleString()}ジェム/Run ・ 総対戦: {totalWins + totalLosses}戦
      </div>

      <div className="event-summary" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
        <div className="summary-card"><div className="summary-val">{event.runs.length}</div><div className="summary-key">Runs</div></div>
        <div className="summary-card"><div className="summary-val">{totalWins}</div><div className="summary-key">総勝利</div></div>
        <div className="summary-card">
          <div className={`summary-val ${gemBalance >= 0 ? "gem-positive" : "gem-negative"}`}>
            {gemBalance >= 0 ? "+" : ""}{gemBalance.toLocaleString()}
          </div>
          <div className="summary-key">ジェム収支</div>
        </div>
        <div className="summary-card">
          <div className="summary-val" style={{ color: "#ffcb6b" }}>
            {winRate !== null ? `${winRate}%` : "—"}
          </div>
          <div className="summary-key">勝率</div>
        </div>
      </div>

      {event.runs.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#ff8080" }}>-{totalGemCost.toLocaleString()}</div>
              <div style={{ fontSize: 9, color: "#bbb", textTransform: "uppercase", marginTop: 2 }}>総消費ジェム</div>
            </div>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.07)" }} />
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#68d9a4" }}>+{totalGemPrize.toLocaleString()}</div>
              <div style={{ fontSize: 9, color: "#bbb", textTransform: "uppercase", marginTop: 2 }}>総獲得ジェム</div>
            </div>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.07)" }} />
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: gemBalance >= 0 ? "#68d9a4" : "#ff8080" }}>
                {gemBalance >= 0 ? "+" : ""}{gemBalance.toLocaleString()}
              </div>
              <div style={{ fontSize: 9, color: "#bbb", textTransform: "uppercase", marginTop: 2 }}>差し引き</div>
            </div>
          </div>
          {hasBoxPrize && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "#ccc", textAlign: "center" }}>
              ※ BOXは暫定換算値（PB=20,000 / CB=60,000ジェム/箱）で計算
            </div>
          )}
        </div>
      )}

      <div className="section-label">Run履歴</div>
      <div className="run-list">
        {event.runs.map((r, i) => {
          const prize = PRIZE_TYPES.find(p => p.id === r.prizeType);
          let prizeText = prize?.label || "";
          if (r.prizeType === "ジェム") prizeText += ` ${r.prizeGem.toLocaleString()}`;
          if (r.prizeType === "PB_BOX" || r.prizeType === "CB_BOX") {
            prizeText += ` ${r.prizeBoxCount}箱`;
            if (r.boxName) prizeText += ` (${r.boxName})`;
            prizeText += ` ≈${(BOX_GEM_VALUE[r.prizeType] * r.prizeBoxCount).toLocaleString()}G`;
          }
          return (
            <div key={i} className="run-item">
              <span className="run-num">#{i + 1}</span>
              <span className="run-wins">{r.wins}勝{r.losses != null ? `${r.losses}敗` : ""}</span>
              <span className="run-prize">{prize?.icon} {prizeText}</span>
              {event.isEditing && (
                <button onClick={() => onDeleteRun(r)}
                  style={{ marginLeft: "auto", background: "none", border: "none", color: "#ff8080", fontSize: 16, cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="divider" />
      <button className="btn-primary mt-8" onClick={onAddRun}>+ 次のRunを記録</button>
      <button className="btn mt-8"
        style={{ width: "100%", padding: "14px", color: "#ffcb6b", borderColor: "rgba(255,203,107,0.3)", marginTop: 8 }}
        onClick={onFinish} disabled={isSyncing}>
        {isSyncing ? "保存中..." : event.isEditing ? "変更を保存" : "イベント終了 → DBに保存"}
      </button>
    </div>
  );
}

// ===== スタイル =====
const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

  .app { max-width: 430px; margin: 0 auto; min-height: 100vh; position: relative; padding-bottom: 40px; }
  .bg-glow { position: fixed; top: -100px; left: 50%; transform: translateX(-50%); width: 400px; height: 400px; background: radial-gradient(circle, rgba(126,207,255,0.04) 0%, transparent 70%); pointer-events: none; z-index: 0; }

  .header { padding: 20px 20px 12px; position: relative; z-index: 1; }
  .header-title { font-size: 18px; font-weight: 700; color: #7ecfff; letter-spacing: 0.05em; }
  .header-sub { font-size: 11px; color: #aaa; margin-top: 2px; letter-spacing: 0.08em; }

  .status-bar { margin: 0 20px 8px; padding: 8px 12px; background: rgba(126,207,255,0.06); border: 1px solid rgba(126,207,255,0.15); border-radius: 8px; font-size: 11px; color: #7ecfff; display: flex; align-items: center; gap: 8px; position: relative; z-index: 1; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #7ecfff; animation: pulse 1.5s infinite; flex-shrink: 0; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  .screen { padding: 16px 20px 40px; position: relative; z-index: 1; }

  .card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 16px; margin-bottom: 12px; }

  .section-label { font-size: 10px; color: #bbb; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px; }

  .divider { height: 1px; background: rgba(255,255,255,0.06); margin: 16px 0; }

  .btn { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #e0e0e0; cursor: pointer; font-size: 14px; padding: 10px 14px; transition: all 0.15s; }
  .btn:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.18); }
  .btn-selected { background: rgba(126,207,255,0.12) !important; border-color: rgba(126,207,255,0.4) !important; color: #7ecfff !important; }
  .btn-primary { width: 100%; padding: 16px; background: rgba(126,207,255,0.1); border: 1px solid rgba(126,207,255,0.3); border-radius: 10px; color: #7ecfff; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .btn-primary:hover:not(:disabled) { background: rgba(126,207,255,0.16); }
  .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

  .btn-grid { display: grid; gap: 8px; }
  .btn-grid-2 { grid-template-columns: 1fr 1fr; }

  .mt-8 { margin-top: 8px; }
  .mt-12 { margin-top: 12px; }
  .mt-16 { margin-top: 16px; }

  .input-field { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #e0e0e0; font-size: 15px; padding: 12px 14px; outline: none; }
  .input-field:focus { border-color: rgba(126,207,255,0.35); }
  .input-field::placeholder { color: #888; }

  .wins-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .win-btn { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #e0e0e0; cursor: pointer; font-size: 22px; font-weight: 700; padding: 16px 0; transition: all 0.15s; }
  .win-btn-selected { background: rgba(126,207,255,0.12); border-color: rgba(126,207,255,0.4); color: #7ecfff; }

  .prize-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .prize-btn { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; padding: 10px 4px; transition: all 0.15s; }
  .prize-icon { font-size: 18px; margin-bottom: 4px; }
  .prize-label { color: #ccc; font-size: 9px; text-align: center; line-height: 1.2; }

  .event-summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 12px; }
  .summary-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 12px; text-align: center; }
  .summary-val { font-size: 22px; font-weight: 700; }
  .summary-key { font-size: 9px; color: #bbb; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
  .gem-positive { color: #68d9a4; }
  .gem-negative { color: #ff8080; }

  .run-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .run-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; font-size: 13px; }
  .run-num { font-size: 10px; color: #aaa; width: 24px; flex-shrink: 0; }
  .run-wins { font-weight: 600; color: #e0e0e0; width: 52px; flex-shrink: 0; }
  .run-prize { color: #ddd; font-size: 12px; flex: 1; }

  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: rgba(104,217,164,0.15); border: 1px solid rgba(104,217,164,0.4); border-radius: 10px; color: #68d9a4; font-size: 14px; padding: 12px 24px; white-space: nowrap; z-index: 999; }
  .toast-error { background: rgba(255,128,128,0.12); border-color: rgba(255,128,128,0.35); color: #ff8080; }
`;

// ===== MAIN APP =====
export default function App() {
  const [screen, setScreen] = useState("home");
  const [activeEvent, setActiveEvent] = useState(null);
  const [selectedEventType, setSelectedEventType] = useState(null);
  const [toast, setToast] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleNewEvent = (type) => { setSelectedEventType(type); setScreen("setup"); };

  const handleEventStart = (gemCost, boxType, boxName, maxLosses) => {
    setActiveEvent({
      type: selectedEventType, gemCost,
      boxType: boxType || null, boxName: boxName || "",
      date: new Date().toISOString().split("T")[0],
      runs: [], notionPageId: null,
      maxLosses: maxLosses || 3,
    });
    setScreen("summary");
  };

  const handleSaveRun = (runData) => {
    setActiveEvent(prev => ({ ...prev, runs: [...prev.runs, runData] }));
    setScreen("summary");
  };

  const handleDeleteRunFromEdit = (run) => {
    setActiveEvent(prev => ({
      ...prev,
      runs: prev.runs.filter(r => r !== run),
      deletedRunIds: run.id ? [...(prev.deletedRunIds || []), run.id] : (prev.deletedRunIds || []),
    }));
  };

  const handleEditEvent = (ev, runs) => {
    setActiveEvent({
      type: ev.type,
      gemCost: ev.gemCost,
      boxType: null,
      boxName: "",
      date: ev.date,
      maxLosses: ev.maxLosses || 3,
      runs: runs,
      isEditing: true,
      eventId: ev.id,
      deletedRunIds: [],
    });
    setScreen("summary");
  };

  const handleFinishEvent = async () => {
    if (!activeEvent) return;
    const isEditing = activeEvent.isEditing;
    setIsSyncing(true);
    try {
      const totalWins = activeEvent.runs.reduce((s, r) => s + r.wins, 0);
      const totalLosses = activeEvent.runs.reduce((s, r) => s + (r.losses || 0), 0);
      const totalGemPrize = activeEvent.runs.reduce((s, r) => {
        if (r.prizeType === "ジェム") return s + r.prizeGem;
        if (r.prizeType === "PB_BOX" || r.prizeType === "CB_BOX")
          return s + (BOX_GEM_VALUE[r.prizeType] * (r.prizeBoxCount || 1));
        return s;
      }, 0);
      const gemBalance = totalGemPrize - activeEvent.gemCost * activeEvent.runs.length;

      if (isEditing) {
        for (const id of (activeEvent.deletedRunIds || []))
          await deleteRunFromDB(id);
        const existingRuns = activeEvent.runs.filter(r => r.id);
        const newRuns = activeEvent.runs.filter(r => !r.id);
        for (let i = 0; i < newRuns.length; i++)
          await createRunInNotion(newRuns[i], activeEvent.eventId, existingRuns.length + i + 1);
        await updateEventInNotion(activeEvent.eventId, activeEvent.runs.length, totalWins, totalLosses, gemBalance);
        showToast("✓ 更新しました！");
      } else {
        const eventPageId = await createEventInNotion(activeEvent.type, activeEvent.gemCost, activeEvent.date, activeEvent.maxLosses || 3);
        if (eventPageId) {
          for (let i = 0; i < activeEvent.runs.length; i++)
            await createRunInNotion(activeEvent.runs[i], eventPageId, i + 1);
          await updateEventInNotion(eventPageId, activeEvent.runs.length, totalWins, totalLosses, gemBalance);
          showToast("✓ 保存しました！");
        } else { showToast("保存に失敗しました", true); }
      }
    } catch (e) { showToast("エラーが発生しました", true); }
    finally {
      setIsSyncing(false);
      setActiveEvent(null);
      setScreen(isEditing ? "history" : "home");
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <div className="bg-glow" />
        <div className="header">
          <div className="header-title">MTG Arena Tracker</div>
          <div className="header-sub">戦績管理</div>
        </div>
        {activeEvent && screen !== "setup" && (
          <div className="status-bar">
            <div className="dot" />{activeEvent.type} — Run {activeEvent.runs.length}
          </div>
        )}
        {screen === "home" && <HomeScreen onRecord={() => setScreen("record")} onHistory={() => setScreen("history")} onResumeEvent={() => setScreen("summary")} activeEvent={activeEvent} />}
        {screen === "record" && <RecordMenuScreen onNewEvent={handleNewEvent} onBack={() => setScreen("home")} activeEvent={activeEvent} onResumeEvent={() => setScreen("summary")} />}
        {screen === "history" && <HistoryScreen onBack={() => setScreen("home")} onEditEvent={handleEditEvent} />}
        {screen === "setup" && <EventSetupScreen eventType={selectedEventType} onStart={handleEventStart} onBack={() => setScreen("home")} />}
        {screen === "run" && activeEvent && <RunEntryScreen runIndex={activeEvent.runs.length + 1} onSave={handleSaveRun} onBack={() => setScreen("summary")} boxType={activeEvent.boxType} boxName={activeEvent.boxName || ""} maxLosses={activeEvent.maxLosses || 3} />}
        {screen === "summary" && activeEvent && <EventSummaryScreen event={activeEvent} onAddRun={() => setScreen("run")} onFinish={handleFinishEvent} onBack={() => { if (activeEvent.isEditing) { setActiveEvent(null); setScreen("history"); } else setScreen("home"); }} onDeleteRun={handleDeleteRunFromEdit} isSyncing={isSyncing} />}
        {toast && <div className={`toast ${toast.isError ? "toast-error" : ""}`}>{toast.msg}</div>}
      </div>
    </>
  );
}
