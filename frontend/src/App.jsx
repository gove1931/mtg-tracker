import { useState, useEffect, useCallback, useContext, createContext } from "react";

// ===== 定数 =====
// VITE_API_URL: Vercelの環境変数に設定（例: https://api.gove.dev）
const API_URL = import.meta.env.VITE_API_URL || "";

const toJSTDateString = () => {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
};

const DEFAULT_EVENT_TYPES = [
  { id: "ev-1", label: "アリーナダイレクト", english: "Arena Direct", gemCost: 4000, maxWins: 7, maxLosses: 3, boxType: null, boxName: "" },
  { id: "ev-2", label: "プレイイン", english: "Play-In", gemCost: 4000, maxWins: 4, maxLosses: 1, boxType: null, boxName: "" },
  { id: "ev-3", label: "リミテッドチャンピオンシップ予選", english: "Limited Championship Qualifier", gemCost: 6000, maxWins: 7, maxLosses: 3, boxType: null, boxName: "" },
];

function loadEventTypes() {
  try {
    const saved = localStorage.getItem("mtg-eventTypes");
    if (saved) {
      const types = JSON.parse(saved);
      return types.map(t => ({ gemCost: 0, maxWins: 7, maxLosses: 3, boxType: null, boxName: "", ...t }));
    }
  } catch {}
  return DEFAULT_EVENT_TYPES;
}

function saveEventTypesToStorage(types) {
  localStorage.setItem("mtg-eventTypes", JSON.stringify(types));
}

// PB BOX=20000G/箱、CB BOX=60000G/箱（20000G=15000円換算）
const BOX_GEM_VALUE = { "PB_BOX": 20000, "CB_BOX": 60000 };

// ジェム→円換算（20000ジェム=15000円）。収支ページの補助表示用
const YEN_PER_GEM = 15000 / 20000;
function formatYen(gem, withSign = true) {
  const yen = Math.round(gem * YEN_PER_GEM);
  const sign = withSign ? (yen > 0 ? "+" : yen < 0 ? "-" : "") : "";
  return `${sign}¥${Math.abs(yen).toLocaleString()}`;
}

// Run 1件の獲得ジェム（BOXは換算値）と収支
function runPrizeGem(r) {
  if (r.prizeType === "ジェム") return r.prizeGem || 0;
  if (r.prizeType === "PB_BOX" || r.prizeType === "CB_BOX")
    return BOX_GEM_VALUE[r.prizeType] * (r.prizeBoxCount || 1);
  return 0;
}
function runGemBalance(r) { return runPrizeGem(r) - (r.gemCost || 0); }

// Run配列の集計（Run数・勝敗・勝率・消費/獲得/収支）
function summarizeRuns(runs) {
  const wins = runs.reduce((s, r) => s + (r.wins || 0), 0);
  const losses = runs.reduce((s, r) => s + (r.losses || 0), 0);
  const cost = runs.reduce((s, r) => s + (r.gemCost || 0), 0);
  const prize = runs.reduce((s, r) => s + runPrizeGem(r), 0);
  return {
    count: runs.length, wins, losses, cost, prize, balance: prize - cost,
    winRate: (wins + losses) > 0 ? Math.round(wins / (wins + losses) * 100) : null,
  };
}

// Runのプレイ日時（UTC）→ JSTの "YYYY-MM-DD"
function runJSTDate(r) {
  const t = r.playedAt ? new Date(r.playedAt).getTime() : Date.now();
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 月 → 種別 の2段集計。[[ "YYYY-MM", [{ type, runs, ...summary }] ], ...] を新しい月順で返す
function groupRunsByMonthType(runs) {
  const months = {};
  for (const r of runs) {
    const m = runJSTDate(r).slice(0, 7);
    const t = r.eventType || "（種別なし）";
    ((months[m] ||= {})[t] ||= []).push(r);
  }
  return Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([m, byType]) => [
    m,
    Object.entries(byType)
      .map(([type, rs]) => ({ type, runs: rs, ...summarizeRuns(rs) }))
      .sort((a, b) => b.count - a.count),
  ]);
}

// Runのプライズ表示テキスト
function runPrizeText(r) {
  const prize = PRIZE_TYPES.find(p => p.id === r.prizeType);
  let t = prize?.label || "";
  if (r.prizeType === "ジェム") t += ` ${(r.prizeGem || 0).toLocaleString()}`;
  if (r.prizeType === "PB_BOX" || r.prizeType === "CB_BOX") t += ` ${r.prizeBoxCount || 1}箱`;
  if (r.hasRight) t += " 🏆";
  return `${prize?.icon || ""} ${t}`.trim();
}

const PRIZE_TYPES = [
  { id: "なし",   label: "なし",                   icon: "✕", color: "#555" },
  { id: "ジェム", label: "ジェム",                 icon: "💎", color: "#7ecfff" },
  { id: "PB_BOX", label: "プレイブースターBOX",    icon: "🎁", color: "#f78c6c" },
  { id: "CB_BOX", label: "コレクターブースターBOX", icon: "✨", color: "#c792ea" },
];

// ===== API関数 =====

// --- 新規フロー用（即時保存） ---
async function createEventInDB(eventType, gemCost, date, maxLosses, maxWins, boxType, boxName) {
  const res = await fetch(`${API_URL}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType, gemCost, date, maxLosses, maxWins,
      status: "in_progress", boxType: boxType || null, boxName: boxName || null }),
  });
  if (!res.ok) throw new Error("イベント作成に失敗しました");
  return (await res.json()).id;
}

// 種別を指定してRunを保存。同じ種別の進行中（期間）イベントがあればサーバー側で自動的に紐づく
async function createRunInDB(run, typeCfg) {
  const res = await fetch(`${API_URL}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType: typeCfg.label, gemCost: typeCfg.gemCost || 0,
      maxWins: typeCfg.maxWins || 7, maxLosses: typeCfg.maxLosses || 3,
      wins: run.wins, losses: run.losses || 0,
      prizeType: run.prizeType,
      prizeGem: run.prizeGem, prizeBoxCount: run.prizeBoxCount,
      hasRight: run.hasRight || false,
    }),
  });
  if (!res.ok) throw new Error("Run保存に失敗しました");
  return await res.json();
}

// 集計値はサーバー側でRunから再計算される
async function completeEventInDB(eventId) {
  const res = await fetch(`${API_URL}/api/events/${eventId}/complete`, { method: "PUT" });
  if (!res.ok) throw new Error("イベント完了に失敗しました");
}

async function fetchOpenEvents() {
  const res = await fetch(`${API_URL}/api/events/in-progress`);
  if (!res.ok) throw new Error("進行中イベントの取得に失敗しました");
  const data = await res.json();
  return Array.isArray(data) ? data : (data ? [data] : []);
}

async function fetchAllRuns() {
  const res = await fetch(`${API_URL}/api/runs`);
  if (!res.ok) throw new Error("Runの取得に失敗しました");
  return await res.json();
}

async function updateRunInDB(runId, run) {
  const res = await fetch(`${API_URL}/api/runs/${runId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wins: run.wins, losses: run.losses || 0,
      prizeType: run.prizeType,
      prizeGem: run.prizeGem, prizeBoxCount: run.prizeBoxCount,
      hasRight: run.hasRight || false,
    }),
  });
  if (!res.ok) throw new Error("Run修正に失敗しました");
}

// 途中のRunを削除すると runs.length+1 が既存の run_index と重複するため、最大値+1 を使う
function nextRunIndex(runs) {
  return Math.max(runs.length, ...runs.map(r => r.runIndex || 0)) + 1;
}


// --- 編集モード用（一括保存・従来通り） ---
async function createRunInNotion(run, eventPageId, runIndex) {
  await fetch(`${API_URL}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventPageId, runIndex,
      wins: run.wins, losses: run.losses || 0,
      prizeType: run.prizeType,
      prizeGem: run.prizeGem, prizeBoxCount: run.prizeBoxCount,
      hasRight: run.hasRight || false,
    }),
  });
}

// イベントの集計値をサーバー側で再計算させる
async function updateEventInNotion(eventPageId) {
  await fetch(`${API_URL}/api/events/${eventPageId}`, { method: "PUT" });
}

// ----- デッキリスト画像 -----
const imageUrl = (id, thumb = false) => `${API_URL}/api/images/${id}${thumb ? "/thumb" : ""}`;

// 画像ファイルを長辺 maxEdge px のJPEGに縮小して base64（ヘッダ無し）で返す
function resizeImage(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めませんでした")); };
    img.src = url;
  });
}

async function uploadRunImage(runId, file) {
  // 本体はカード名が読める解像度を残す（スマホのスクショは原寸のまま残るよう長辺2600px）
  const [data, thumb] = await Promise.all([resizeImage(file, 2600, 0.85), resizeImage(file, 320, 0.7)]);
  const res = await fetch(`${API_URL}/api/runs/${runId}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mime: "image/jpeg", data, thumb }),
  });
  if (!res.ok) throw new Error("画像の保存に失敗しました");
}

async function deleteRunImageFromDB(id) {
  const res = await fetch(`${API_URL}/api/images/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("画像の削除に失敗しました");
}

// Run保存後に画像の追加・削除を反映する
async function applyImageChanges(runId, images) {
  if (!images) return;
  for (const id of images.removed) await deleteRunImageFromDB(id);
  for (const f of images.added) await uploadRunImage(runId, f);
}

// 画像の拡大表示（どの画面からでも開けるようにContextで提供）
const ImageViewerContext = createContext(() => {});

function ImageViewer({ ids, onClose }) {
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.92)", overflowY: "auto", padding: "56px 12px 24px", WebkitOverflowScrolling: "touch" }}>
      <button onClick={onClose}
        style={{ position: "fixed", top: "calc(10px + env(safe-area-inset-top, 0px))", right: 12, zIndex: 1001, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, color: "#fff", fontSize: 14, padding: "8px 14px", cursor: "pointer" }}>
        ✕ 閉じる
      </button>
      {ids.map(id => (
        <img key={id} src={imageUrl(id)} alt="デッキリスト" onClick={e => e.stopPropagation()}
          style={{ display: "block", maxWidth: "100%", margin: "0 auto 16px", borderRadius: 6 }} />
      ))}
    </div>
  );
}

// Run一覧の行に出す「📷 N」ボタン（画像が無ければ何も出さない）
function RunImagesBadge({ r, pc }) {
  const openViewer = useContext(ImageViewerContext);
  const ids = r.imageIds || [];
  if (!ids.length) return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); openViewer(ids); }} title="デッキリストを表示"
      style={pc
        ? { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, color: "#2563eb", cursor: "pointer", fontSize: 12, padding: "2px 8px", flexShrink: 0 }
        : { background: "rgba(126,207,255,0.08)", border: "1px solid rgba(126,207,255,0.3)", borderRadius: 6, color: "#7ecfff", fontSize: 11, cursor: "pointer", padding: "4px 8px", flexShrink: 0 }}>
      📷{ids.length > 1 ? ` ${ids.length}` : ""}
    </button>
  );
}

// Run入力画面のデッキリスト画像欄。状態は { kept: 既存id[], removed: id[], added: File[] }
function DeckImagesField({ images, setImages, disabledNote, pc }) {
  const openViewer = useContext(ImageViewerContext);
  const [previews, setPreviews] = useState([]); // added と同じ並びの objectURL

  const addFiles = useCallback((files) => {
    const imgs = [...files].filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setImages(prev => ({ ...prev, added: [...prev.added, ...imgs] }));
    setPreviews(prev => [...prev, ...imgs.map(f => URL.createObjectURL(f))]);
  }, [setImages]);

  // PC: Ctrl+V でクリップボードの画像を貼り付け
  useEffect(() => {
    if (disabledNote) return;
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.items || [])]
        .filter(it => it.kind === "file" && it.type.startsWith("image/"))
        .map(it => it.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); addFiles(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles, disabledNote]);

  const removeKept = (id) => setImages(prev => ({ ...prev, kept: prev.kept.filter(x => x !== id), removed: [...prev.removed, id] }));
  const removeAdded = (i) => {
    URL.revokeObjectURL(previews[i]);
    setPreviews(prev => prev.filter((_, j) => j !== i));
    setImages(prev => ({ ...prev, added: prev.added.filter((_, j) => j !== i) }));
  };

  const thumbBox = { position: "relative", width: 72, height: 72, borderRadius: 8, overflow: "hidden", flexShrink: 0,
    border: pc ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.12)", background: pc ? "#f8fafc" : "rgba(255,255,255,0.04)" };
  const imgStyle = { width: "100%", height: "100%", objectFit: "cover", cursor: "pointer", display: "block" };
  const xBtn = { position: "absolute", top: 2, right: 2, width: 22, height: 22, borderRadius: 11, border: "none",
    background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 12, lineHeight: "22px", padding: 0, cursor: "pointer" };
  const hint = { fontSize: 11, color: pc ? "#94a3b8" : "#999", marginTop: 8 };

  return (
    <div className={pc ? "pcd-form-card" : "card"} style={pc ? { marginBottom: 16 } : undefined}>
      {pc ? <span className="pcd-form-label">デッキリスト画像</span> : <div className="section-label">デッキリスト画像</div>}
      {disabledNote ? <div style={hint}>{disabledNote}</div> : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {images.kept.map(id => (
              <div key={id} style={thumbBox}>
                <img src={imageUrl(id, true)} alt="" style={imgStyle} onClick={() => openViewer([id])} />
                <button style={xBtn} onClick={() => removeKept(id)} aria-label="画像を外す">✕</button>
              </div>
            ))}
            {previews.map((u, i) => (
              <div key={u} style={thumbBox}>
                <img src={u} alt="" style={imgStyle} />
                <button style={xBtn} onClick={() => removeAdded(i)} aria-label="画像を外す">✕</button>
              </div>
            ))}
            <label style={{ ...thumbBox, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer",
              color: pc ? "#64748b" : "#7ecfff", fontSize: 11, borderStyle: "dashed" }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>＋</span>画像
              <input type="file" accept="image/*" multiple hidden
                onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          <div style={hint}>{pc ? "スクリーンショットを Ctrl+V で貼り付けても追加できます。" : "スクリーンショットを選んで追加できます。"}変更は保存ボタンで反映されます。</div>
        </>
      )}
    </div>
  );
}

async function deleteRunFromDB(runId) {
  await fetch(`${API_URL}/api/runs/${runId}`, { method: "DELETE" });
}

async function deleteEventFromDB(eventId) {
  await fetch(`${API_URL}/api/events/${eventId}`, { method: "DELETE" });
}

// ===== HomeScreen =====
function fmtSigned(n) { return `${n >= 0 ? "+" : ""}${n.toLocaleString()}`; }

function RunRow({ r, label, onEdit }) {
  return (
    <div className="run-item">
      <span className="run-num" style={{ width: "auto", minWidth: 28 }}>{label}</span>
      <span className="run-wins">{r.wins}勝{r.losses != null ? `${r.losses}敗` : ""}</span>
      <span className="run-prize">{runPrizeText(r)}</span>
      <span style={{ marginLeft: "auto" }} />
      <RunImagesBadge r={r} />
      {onEdit && (
        <button onClick={() => onEdit(r)}
          style={{ background: "rgba(255,203,107,0.08)", border: "1px solid rgba(255,203,107,0.3)", borderRadius: 6, color: "#ffcb6b", fontSize: 11, cursor: "pointer", padding: "4px 8px", flexShrink: 0 }}>
          修正
        </button>
      )}
    </div>
  );
}

function HomeScreen({ runs, openEvents, onRecord, onOpenEvent, onEditRun, onStartPeriod, onHistory }) {
  const today = toJSTDateString();
  const todayRuns = runs.filter(r => runJSTDate(r) === today);
  const todaySum = summarizeRuns(todayRuns);
  return (
    <div className="screen">
      <button onClick={onRecord} style={{ width: "100%", padding: "22px 20px", background: "rgba(126,207,255,0.08)", border: "1px solid rgba(126,207,255,0.3)", borderRadius: 14, cursor: "pointer", textAlign: "left", marginBottom: 20 }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}>🎮</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Runを記録</div>
        <div style={{ fontSize: 12, color: "#ccc" }}>種別を選んで1Runずつ記録</div>
      </button>

      {openEvents.length > 0 && (
        <>
          <div className="section-label">進行中の期間イベント</div>
          {openEvents.map(ev => {
            const sum = summarizeRuns(runs.filter(r => r.eventId === ev.id));
            return (
              <button key={ev.id} className="card" onClick={() => onOpenEvent(ev)}
                style={{ width: "100%", textAlign: "left", cursor: "pointer", borderColor: "rgba(126,207,255,0.25)", display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#7ecfff", fontWeight: 600 }}>{ev.type}</div>
                    <div style={{ fontSize: 11, color: "#ccc", marginTop: 2 }}>{ev.date}〜 · {sum.count}Run · {sum.wins}勝{sum.losses}敗</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: sum.balance >= 0 ? "#68d9a4" : "#ff8080" }}>{fmtSigned(sum.balance)}G</div>
                </div>
              </button>
            );
          })}
          <div style={{ height: 8 }} />
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="section-label">今日のRun（{todayRuns.length}）</div>
        {todayRuns.length > 0 && (
          <div style={{ fontSize: 11, color: todaySum.balance >= 0 ? "#68d9a4" : "#ff8080" }}>{fmtSigned(todaySum.balance)}G</div>
        )}
      </div>
      {todayRuns.length === 0
        ? <div style={{ color: "#999", fontSize: 12, padding: "8px 0 16px" }}>まだ記録がありません</div>
        : <div className="run-list" style={{ marginBottom: 16 }}>
            {todayRuns.map(r => <RunRow key={r.id} r={r} label={r.eventType} onEdit={onEditRun} />)}
          </div>}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1, padding: "14px 10px", fontSize: 13 }} onClick={onStartPeriod}>🏁 期間イベントを開始</button>
        <button className="btn" style={{ flex: 1, padding: "14px 10px", fontSize: 13 }} onClick={onHistory}>📊 履歴を見る</button>
      </div>
    </div>
  );
}

// ===== TypePicker（Run入力画面上部の種別切替） =====
function TypePicker({ types, value, onChange, fixed, note, pc }) {
  const chip = (t) => {
    const active = t === value;
    return pc
      ? <button key={t} className={`pcd-preset-btn ${active ? "pcd-preset-active" : ""}`} onClick={() => onChange(t)}>{t}</button>
      : <button key={t} className={`btn ${active ? "btn-selected" : ""}`} style={{ padding: "8px 12px", fontSize: 12 }} onClick={() => onChange(t)}>{t}</button>;
  };
  const info = note
    ? <div style={{ fontSize: 11, color: pc ? "#4f46e5" : "#7ecfff", marginTop: 8, whiteSpace: "pre-line" }}>{note}</div>
    : null;
  if (pc) {
    return (
      <div className="pcd-form-card" style={{ marginBottom: 16 }}>
        <span className="pcd-form-label">種別</span>
        {fixed ? <div style={{ fontWeight: 600 }}>{value}</div> : <div className="pcd-preset-row" style={{ flexWrap: "wrap" }}>{types.map(chip)}</div>}
        {info}
      </div>
    );
  }
  return (
    <div className="card">
      <div className="section-label">種別</div>
      {fixed
        ? <div style={{ fontSize: 14, fontWeight: 600, color: "#7ecfff" }}>{value}</div>
        : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{types.map(chip)}</div>}
      {info}
    </div>
  );
}

// ===== 履歴（月別タブ） =====
function MonthlyView({ runs, sel, setSel, onEditRun }) {
  const groups = groupRunsByMonthType(runs);
  const [openMonths, setOpenMonths] = useState(() => new Set(groups.length ? [groups[0][0]] : []));
  const toggle = (k) => setOpenMonths(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  if (sel) {
    const g = groups.find(([m]) => m === sel.month)?.[1].find(x => x.type === sel.type);
    const rs = g ? [...g.runs].sort((a, b) => (a.playedAt || "").localeCompare(b.playedAt || "")) : [];
    const sum = summarizeRuns(rs);
    return (
      <div>
        <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={() => setSel(null)}>← 月別に戻る</button>
        <div className="section-label">{monthLabel(sel.month)}</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{sel.type}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div className="summary-card"><div className="summary-val">{sum.count}</div><div className="summary-key">Runs</div></div>
          <div className="summary-card"><div className="summary-val">{sum.wins}-{sum.losses}</div><div className="summary-key">勝敗</div></div>
          <div className="summary-card"><div className="summary-val" style={{ color: "#ffcb6b" }}>{sum.winRate !== null ? `${sum.winRate}%` : "—"}</div><div className="summary-key">勝率</div></div>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {[["総消費", -sum.cost, "#ff8080"], ["総獲得", sum.prize, "#68d9a4"], ["収支", sum.balance, sum.balance >= 0 ? "#68d9a4" : "#ff8080"]].map(([k, v, c]) => (
              <div key={k} style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: c }}>{fmtSigned(v)}</div>
                <div className="strip-yen">≈ {formatYen(v)}</div>
                <div style={{ fontSize: 9, color: "#bbb", marginTop: 2 }}>{k}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="section-label">Run一覧</div>
        <div className="run-list">
          {rs.map(r => <RunRow key={r.id} r={r} label={runJSTDate(r).slice(5).replace("-", "/")} onEdit={onEditRun} />)}
        </div>
      </div>
    );
  }

  if (!groups.length) return <div style={{ color: "#ccc", fontSize: 13, textAlign: "center", padding: "20px 0" }}>履歴がありません</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {groups.map(([m, types]) => {
        const isOpen = openMonths.has(m);
        const total = summarizeRuns(types.flatMap(t => t.runs));
        return (
          <div key={m}>
            <button onClick={() => toggle(m)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(126,207,255,0.06)", border: "1px solid rgba(126,207,255,0.18)",
                borderRadius: isOpen ? "10px 10px 0 0" : 10, padding: "12px 16px", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10, color: "#7ecfff" }}>{isOpen ? "▼" : "▶"}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e0e0e0" }}>{monthLabel(m)}</span>
                <span style={{ fontSize: 11, color: "#bbb" }}>{total.count}Run</span>
                {total.winRate !== null && <span style={{ fontSize: 11, color: "#ffcb6b" }}>{total.winRate}%</span>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: total.balance >= 0 ? "#68d9a4" : "#ff8080" }}>{fmtSigned(total.balance)}G</span>
            </button>
            {isOpen && (
              <div style={{ border: "1px solid rgba(126,207,255,0.18)", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                {types.map((t, i) => (
                  <button key={t.type} onClick={() => setSel({ month: m, type: t.type })}
                    style={{ width: "100%", textAlign: "left", padding: "12px 16px", background: "rgba(255,255,255,0.02)",
                      border: "none", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{t.type}</div>
                        <div style={{ fontSize: 11, color: "#bbb", marginTop: 2 }}>
                          {t.count}Run ・ {t.wins}勝{t.losses}敗{t.winRate !== null ? ` ・ ${t.winRate}%` : ""}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.balance >= 0 ? "#68d9a4" : "#ff8080" }}>{fmtSigned(t.balance)}G</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HistoryHub({ tab, setTab, runs, monthSel, setMonthSel, onBack, onEditEvent, onEditRun }) {
  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← ホーム</button>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["month", "月別"], ["event", "イベント"]].map(([k, l]) => (
          <button key={k} className={`btn ${tab === k ? "btn-selected" : ""}`} style={{ flex: 1, padding: "10px" }} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "month"
        ? <MonthlyView runs={runs} sel={monthSel} setSel={setMonthSel} onEditRun={onEditRun} />
        : <HistoryScreen embedded onEditEvent={onEditEvent} />}
    </div>
  );
}

// ===== RecordMenuScreen =====
function RecordMenuScreen({ onNewEvent, onBack, eventTypes, onManageTypes, isSyncing }) {
  const [showMore, setShowMore] = useState(false);
  const mainTypes = eventTypes.slice(0, 5);
  const moreTypes = eventTypes.slice(5);

  const renderTypeButton = (et) => {
    const hasConfig = et.gemCost > 0;
    return (
      <div key={et.id} style={{ marginBottom: 8 }}>
        <button className="btn" style={{ width: "100%", textAlign: "left", padding: "14px 16px" }}
          disabled={isSyncing}
          onClick={() => onNewEvent(et.label, et.gemCost || 0, et.boxType || null, et.boxName || "", et.maxLosses || 3, et.maxWins || 7)}>
          {et.english
            ? <>
                <span style={{ fontSize: 13, color: "#7ecfff", fontWeight: 700, display: "block", marginBottom: 2 }}>{et.english}</span>
                <span style={{ fontSize: 11, color: "#bbb", display: "block", marginBottom: 4 }}>{et.label}</span>
              </>
            : <span style={{ fontSize: 13, color: "#7ecfff", fontWeight: 700, display: "block", marginBottom: 4 }}>{et.label}</span>
          }
          <div style={{ fontSize: 11, color: hasConfig ? "#888" : "#ff8080" }}>
            {hasConfig
              ? `${et.gemCost.toLocaleString()}G · 最大 ${et.maxWins || 7}勝 ${et.maxLosses || 3}敗${et.boxType ? ` · ${et.boxType === "PB_BOX" ? "🎁 PB" : "✨ CB"}` : ""}`
              : "⚙ ジェムコストを設定してください（⚙ 管理から設定）"
            }
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← 戻る</button>
      <div style={{ fontSize: 12, color: "#ccc", lineHeight: 1.6, marginBottom: 16 }}>
        アリーナダイレクトなど、Run数をまとめて数えたいイベントを開始します。開始中は、同じ種別のRunが自動でこのイベントに追加されます。
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div className="section-label" style={{ marginBottom: 0 }}>期間イベントを開始</div>
        <button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={onManageTypes}>⚙ 管理</button>
      </div>
      {isSyncing && <div style={{ textAlign: "center", color: "#7ecfff", fontSize: 13, marginBottom: 12, padding: "8px", background: "rgba(126,207,255,0.06)", borderRadius: 8 }}>作成中...</div>}
      {mainTypes.map(et => renderTypeButton(et))}
      {moreTypes.length > 0 && (
        <>
          <button className="btn"
            style={{ width: "100%", marginBottom: 8, textAlign: "center", padding: "10px 16px", opacity: 0.7 }}
            onClick={() => setShowMore(v => !v)}>
            <span style={{ fontSize: 12, color: "#bbb" }}>{showMore ? "▲ 閉じる" : `▼ 他 ${moreTypes.length} 件`}</span>
          </button>
          {showMore && moreTypes.map(et => renderTypeButton(et))}
        </>
      )}
    </div>
  );
}

// ===== EventTypeManagerScreen =====
function EventTypeManagerScreen({ eventTypes, onSave, onBack }) {
  const [types, setTypes] = useState(eventTypes);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [editEnglish, setEditEnglish] = useState("");
  const [editGemCost, setEditGemCost] = useState("");
  const [editMaxWins, setEditMaxWins] = useState(7);
  const [editMaxLosses, setEditMaxLosses] = useState(3);
  const [editBoxType, setEditBoxType] = useState(null);
  const [editBoxName, setEditBoxName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newEnglish, setNewEnglish] = useState("");
  const [newGemCost, setNewGemCost] = useState("");
  const [newMaxWins, setNewMaxWins] = useState(7);
  const [newMaxLosses, setNewMaxLosses] = useState(3);
  const [newBoxType, setNewBoxType] = useState(null);
  const [newBoxName, setNewBoxName] = useState("");

  const gemPresets = [4000, 5000, 6000, 8000];
  const maxWinsPresets = [4, 7];
  const maxLossesPresets = [1, 2, 3];

  const moveUp = (i) => { if (i === 0) return; const next = [...types]; [next[i-1],next[i]]=[next[i],next[i-1]]; setTypes(next); };
  const moveDown = (i) => { if (i===types.length-1) return; const next=[...types]; [next[i],next[i+1]]=[next[i+1],next[i]]; setTypes(next); };

  const startEdit = (t) => {
    setEditingId(t.id); setEditLabel(t.label); setEditEnglish(t.english||"");
    setEditGemCost(String(t.gemCost||"")); setEditMaxWins(t.maxWins||7); setEditMaxLosses(t.maxLosses||3);
    setEditBoxType(t.boxType||null); setEditBoxName(t.boxName||"");
  };

  const saveEdit = () => {
    setTypes(prev => prev.map(t => t.id===editingId ? {
      ...t, label:editLabel.trim(), english:editEnglish.trim(),
      gemCost:Number(editGemCost)||0, maxWins:editMaxWins, maxLosses:editMaxLosses,
      boxType:editBoxType, boxName:editBoxType?editBoxName.trim():"",
    } : t));
    setEditingId(null);
  };

  const handleDelete = (id) => setTypes(prev => prev.filter(t => t.id !== id));

  const resetNew = () => { setNewLabel(""); setNewEnglish(""); setNewGemCost(""); setNewMaxWins(7); setNewMaxLosses(3); setNewBoxType(null); setNewBoxName(""); };

  const handleAdd = () => {
    if (!newLabel.trim()) return;
    setTypes(prev => [...prev, {
      id:`ev-${Date.now()}`, label:newLabel.trim(), english:newEnglish.trim(),
      gemCost:Number(newGemCost)||0, maxWins:newMaxWins, maxLosses:newMaxLosses,
      boxType:newBoxType, boxName:newBoxType?newBoxName.trim():"",
    }]);
    resetNew(); setShowAdd(false);
  };

  const handleSave = () => { onSave(types); onBack(); };

  const renderConfigFields = (gemCost, setGemCost, maxWins, setMaxWins, maxLosses, setMaxLosses, boxType, setBoxType, boxName, setBoxName) => (
    <>
      <div className="section-label" style={{ marginTop: 14 }}>消費ジェム（Run毎）</div>
      <div className="btn-grid mt-8" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        {gemPresets.map(p => (
          <button key={p} className={`btn ${Number(gemCost)===p?"btn-selected":""}`}
            style={{ fontSize: 12 }} onClick={() => setGemCost(String(p))}>{p.toLocaleString()}</button>
        ))}
      </div>
      <input className="input-field" type="number" placeholder="例: 6000" value={gemCost}
        onChange={e => setGemCost(e.target.value)} style={{ marginTop: 8 }} />
      <div className="section-label" style={{ marginTop: 14 }}>最大勝利数</div>
      <div style={{ display:"flex", gap:8 }}>
        {maxWinsPresets.map(n => (
          <button key={n} className={`btn ${maxWins===n?"btn-selected":""}`} style={{ flex:1 }} onClick={() => setMaxWins(n)}>{n}勝</button>
        ))}
        <input className="input-field" type="number" min="1" max="20" placeholder="他"
          style={{ flex:1, padding:"10px", textAlign:"center" }}
          value={maxWinsPresets.includes(maxWins)?"":String(maxWins)}
          onChange={e => { const v=parseInt(e.target.value); if(v>0) setMaxWins(v); }} />
      </div>
      <div className="section-label" style={{ marginTop: 14 }}>最大敗北数</div>
      <div style={{ display:"flex", gap:8 }}>
        {maxLossesPresets.map(n => (
          <button key={n} className={`btn ${maxLosses===n?"btn-selected":""}`} style={{ flex:1 }} onClick={() => setMaxLosses(n)}>{n}敗</button>
        ))}
      </div>
      <div className="section-label" style={{ marginTop: 14 }}>ボックスプライズ（任意）</div>
      <div style={{ display:"flex", gap:8, marginTop:8 }}>
        {[{k:null,l:"なし"},{k:"PB_BOX",l:"🎁 PB"},{k:"CB_BOX",l:"✨ CB"}].map(o => (
          <button key={String(o.k)} className={`btn ${boxType===o.k?"btn-selected":""}`}
            style={{ flex:1, fontSize:12 }}
            onClick={() => { setBoxType(o.k); if(!o.k) setBoxName(""); }}>{o.l}</button>
        ))}
      </div>
      {boxType && (
        <input className="input-field" type="text" placeholder="例: ストリクスヘイブンの秘密"
          value={boxName} onChange={e => setBoxName(e.target.value)} style={{ marginTop:8 }} />
      )}
    </>
  );

  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← 戻る</button>
      <div className="section-label">イベントタイプを管理</div>
      <div style={{ fontSize: 11, color: "#aaa", marginBottom: 16 }}>上から5件がメインに表示されます</div>

      {types.map((t, i) => (
        <div key={t.id} style={{ marginBottom: 8 }}>
          {editingId === t.id ? (
            <div className="card" style={{ margin: 0 }}>
              <input className="input-field" value={editLabel} onChange={e => setEditLabel(e.target.value)}
                placeholder="イベント名" style={{ marginBottom: 8 }} autoFocus />
              <input className="input-field" value={editEnglish} onChange={e => setEditEnglish(e.target.value)}
                placeholder="英語名（任意）" style={{ marginBottom: 8 }} />
              {renderConfigFields(editGemCost, setEditGemCost, editMaxWins, setEditMaxWins, editMaxLosses, setEditMaxLosses, editBoxType, setEditBoxType, editBoxName, setEditBoxName)}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => setEditingId(null)}>キャンセル</button>
                <button className="btn-primary" style={{ flex: 2, padding: "10px" }} onClick={saveEdit} disabled={!editLabel.trim()}>保存</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                <button className="btn" style={{ padding: "3px 7px", fontSize: 11, opacity: i===0?0.3:1 }}
                  onClick={() => moveUp(i)} disabled={i===0}>↑</button>
                <button className="btn" style={{ padding: "3px 7px", fontSize: 11, opacity: i===types.length-1?0.3:1 }}
                  onClick={() => moveDown(i)} disabled={i===types.length-1}>↓</button>
              </div>
              <div style={{ flex:1, padding:"10px 14px", background:"rgba(255,255,255,0.03)", border:`1px solid ${i<5?"rgba(126,207,255,0.15)":"rgba(255,255,255,0.07)"}`, borderRadius:8 }}>
                <div style={{ fontSize:13, color:i<5?"#7ecfff":"#bbb", fontWeight:600 }}>{t.english||t.label}</div>
                {t.english && <div style={{ fontSize:11, color:"#999", marginTop:1 }}>{t.label}</div>}
                <div style={{ fontSize:11, color:t.gemCost?"#aaa":"#ff8080", marginTop:3 }}>
                  {t.gemCost?`${t.gemCost.toLocaleString()}G · ${t.maxWins||7}勝/${t.maxLosses||3}敗`:"⚙ 未設定"}
                </div>
                {i===4 && <div style={{ fontSize:9, color:"#68d9a4", marginTop:3 }}>↑ ここまでメイン表示</div>}
              </div>
              <button className="btn" style={{ padding:"8px 10px", fontSize:12, flexShrink:0 }} onClick={() => startEdit(t)}>編集</button>
              <button className="btn" style={{ padding:"8px 10px", fontSize:12, color:"#ff8080", borderColor:"rgba(255,128,128,0.3)", flexShrink:0 }}
                onClick={() => handleDelete(t.id)}>✕</button>
            </div>
          )}
        </div>
      ))}

      {showAdd ? (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="section-label">新しいイベントタイプ</div>
          <input className="input-field" value={newLabel} onChange={e => setNewLabel(e.target.value)}
            placeholder="イベント名" style={{ marginBottom: 8 }} autoFocus />
          <input className="input-field" value={newEnglish} onChange={e => setNewEnglish(e.target.value)}
            placeholder="英語名（任意）" style={{ marginBottom: 8 }} />
          {renderConfigFields(newGemCost, setNewGemCost, newMaxWins, setNewMaxWins, newMaxLosses, setNewMaxLosses, newBoxType, setNewBoxType, newBoxName, setNewBoxName)}
          <div style={{ display:"flex", gap:8, marginTop:16 }}>
            <button className="btn" style={{ flex:1 }} onClick={() => { setShowAdd(false); resetNew(); }}>キャンセル</button>
            <button className="btn-primary" style={{ flex:2, padding:"10px" }} onClick={handleAdd} disabled={!newLabel.trim()}>追加</button>
          </div>
        </div>
      ) : (
        <button className="btn" style={{ width:"100%", marginTop:4, padding:"12px", color:"#68d9a4", borderColor:"rgba(104,217,164,0.3)" }}
          onClick={() => setShowAdd(true)}>+ イベントタイプを追加</button>
      )}

      <div className="divider" />
      <button className="btn-primary" onClick={handleSave}>変更を保存</button>
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

function HistoryScreen({ onBack, onEditEvent, embedded }) {
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
      <div className={embedded ? "" : "screen"}>
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
        <div style={{ fontSize: 11, color: "#ccc", marginBottom: 12 }}>{selectedEvent.date}</div>
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
        {(() => {
          const tw = selectedEvent.totalWins || 0;
          const tl = selectedEvent.totalLosses || 0;
          const wr = (tw + tl) > 0 ? Math.round(tw / (tw + tl) * 100) : null;
          return (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div className="summary-card">
                  <div className="summary-val">{selectedEvent.totalRuns || 0}</div>
                  <div className="summary-key">Runs</div>
                </div>
                <div className="summary-card">
                  <div className="summary-val">{tw + tl}</div>
                  <div className="summary-key">総対戦</div>
                </div>
                <div className="summary-card">
                  <div className="summary-val" style={{ color: "#ffcb6b" }}>{wr !== null ? `${wr}%` : "—"}</div>
                  <div className="summary-key">勝率</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div className="summary-card">
                  <div className="summary-val">{tw}</div>
                  <div className="summary-key">総勝利</div>
                </div>
                <div className="summary-card">
                  <div className={`summary-val ${balance >= 0 ? "gem-positive" : "gem-negative"}`}>
                    {balance >= 0 ? "+" : ""}{balance.toLocaleString()}
                  </div>
                  <div className="summary-yen">≈ {formatYen(balance)}</div>
                  <div className="summary-key">ジェム収支</div>
                </div>
              </div>
            </>
          );
        })()}
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
                  if (r.hasRight || r.prizeType === "予選ウィークエンド権利")
                    prizeText += (prizeText && prizeText !== "なし" ? " + " : "") + "🏆 権利";
                  if (r.prizeType === "予選ウィークエンド権利") prizeText = prizeText.replace("undefined", "").trim();
                  return (
                    <div key={i} className="run-item">
                      <span className="run-num">#{i + 1}</span>
                      <span className="run-wins">{r.wins}勝{r.losses != null ? `${r.losses}敗` : ""}</span>
                      <span className="run-prize">{prize?.icon} {prizeText}</span>
                      <span style={{ marginLeft: "auto" }} />
                      <RunImagesBadge r={r} />
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
    <div className={embedded ? "" : "screen"}>
      {!embedded && <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← 戻る</button>}
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
                              <div style={{ fontSize: 11, color: "#bbb", marginTop: 1 }}>{ev.totalRuns}Run ・ {(ev.totalWins||0)+(ev.totalLosses||0)}戦 {ev.totalWins}勝</div>
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

// ===== RunEntryScreen =====
function RunEntryScreen({ runIndex, header, initialRun, onSave, onDelete, onBack, boxType, boxName, maxWins = 7, maxLosses, previousRuns, isSyncing, imagesDisabledNote }) {
  const [images, setImages] = useState({ kept: initialRun?.imageIds || [], removed: [], added: [] });
  // initialRun があれば既存Runの修正モード（登録済みの値で初期化）
  const [wins, setWins] = useState(initialRun?.wins ?? null);
  const [losses, setLosses] = useState(initialRun?.losses ?? null);
  const [prizeType, setPrizeType] = useState(initialRun?.prizeType ?? null);
  const [prizeGem, setPrizeGem] = useState(initialRun?.prizeGem > 0 ? String(initialRun.prizeGem) : "");
  const [prizeBoxCount, setPrizeBoxCount] = useState(initialRun?.prizeBoxCount || null);
  const [hasRight, setHasRight] = useState(initialRun?.hasRight || false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  const hasPreviousRuns = previousRuns && previousRuns.length > 0;

  // 過去Runからジェム候補値を導出
  const gemCandidates = hasPreviousRuns ? [...new Set(
    previousRuns.filter(r => r.prizeType === "ジェム" && r.prizeGem > 0).map(r => r.prizeGem)
  )].sort((a, b) => a - b) : [];

  const visiblePrizes = PRIZE_TYPES.filter(pt => {
    if (pt.id === "PB_BOX") return boxType === "PB_BOX";
    if (pt.id === "CB_BOX") return boxType === "CB_BOX";
    return true;
  });

  const canSave = wins !== null && losses !== null && prizeType !== null &&
    (prizeType !== "ジェム" || prizeGem) &&
    (!(prizeType === "PB_BOX" || prizeType === "CB_BOX") || prizeBoxCount !== null);

  const handlePrizeType = (id) => { setAutoFilled(false); setPrizeType(id); setPrizeGem(""); setPrizeBoxCount(null); };
  const handleToggleRight = () => { setAutoFilled(false); setHasRight(prev => !prev); };

  const handleWins = (n) => {
    setWins(n);
    if (n < maxWins) {
      setLosses(maxLosses || 3);
    } else if (maxLosses <= 1) {
      setLosses(0);
    } else {
      setLosses(null);
    }
    const prev = previousRuns?.find(r => r.wins === n);
    if (prev) {
      setPrizeType(prev.prizeType);
      const gemVal = prev.prizeGem > 0 ? String(prev.prizeGem) : "";
      // ジェムで値が未設定の場合は候補が1件なら自動選択
      if (prev.prizeType === "ジェム" && !gemVal && gemCandidates.length === 1) {
        setPrizeGem(String(gemCandidates[0]));
      } else {
        setPrizeGem(gemVal);
      }
      setPrizeBoxCount(prev.prizeBoxCount || null);
      setHasRight(prev.hasRight || false);
      setAutoFilled(true);
    } else {
      setPrizeType(null); setPrizeGem(""); setPrizeBoxCount(null); setHasRight(false);
      setAutoFilled(false);
    }
  };

  // 勝利数ボタン列: 0〜maxWins を常に表示
  const winButtons = Array.from({ length: maxWins + 1 }, (_, n) => n);

  return (
    <div className="screen">
      <button className="btn" style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12 }} onClick={onBack}>← 戻る</button>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "Cinzel, serif", color: "#7ecfff", marginBottom: 20 }}>
        RUN{runIndex ? ` #${runIndex}` : ""}{initialRun && <span style={{ fontSize: 14, color: "#ffcb6b", marginLeft: 10, fontFamily: "inherit" }}>修正</span>}
      </div>
      {header}
      <div className="card">
        <div className="section-label">勝利数</div>
        <div className="wins-grid">
          {winButtons.map(n => (
            <button key={n} className={`win-btn ${wins === n ? "win-btn-selected" : ""}`}
              onClick={() => handleWins(n)}>{n}</button>
          ))}
        </div>
      </div>
      {wins === maxWins && maxLosses > 1 && (
        <div className="card">
          <div className="section-label">敗北数（{maxWins}勝時）</div>
          <div style={{ display: "flex", gap: 8 }}>
            {Array.from({ length: maxLosses }, (_, n) => n).map(n => (
              <button key={n} className={`win-btn ${losses === n ? "win-btn-selected" : ""}`}
                style={{ flex: 1 }} onClick={() => setLosses(n)}>{n}</button>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>プライズ</div>
          {autoFilled && (
            <div style={{ fontSize: 10, color: "#68d9a4", background: "rgba(104,217,164,0.08)", border: "1px solid rgba(104,217,164,0.25)", borderRadius: 6, padding: "3px 8px" }}>
              前回と同じ報酬を自動入力
            </div>
          )}
        </div>
        <div className="prize-grid" style={{ gridTemplateColumns: `repeat(${visiblePrizes.length}, 1fr)` }}>
          {visiblePrizes.map(pt => (
            <button key={pt.id} className="prize-btn"
              style={prizeType === pt.id ? { background: "rgba(126,207,255,0.1)", borderColor: "rgba(126,207,255,0.4)", color: "#fff" } : {}}
              onClick={() => handlePrizeType(pt.id)}>
              <span className="prize-icon">{pt.icon}</span>
              <span className="prize-label" style={{ fontSize: 9 }}>{pt.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={handleToggleRight}
          style={{
            marginTop: 8, width: "100%", padding: "10px 14px",
            background: hasRight ? "rgba(255,203,107,0.1)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${hasRight ? "rgba(255,203,107,0.5)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 8, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 8,
          }}>
          <span style={{ fontSize: 16 }}>🏆</span>
          <span style={{ fontSize: 12, color: hasRight ? "#ffcb6b" : "#aaa", fontWeight: hasRight ? 600 : 400 }}>
            権利獲得
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: hasRight ? "#ffcb6b" : "#555" }}>
            {hasRight ? "ON" : "OFF"}
          </span>
        </button>
        {prizeType === "ジェム" && (
          <div className="mt-12">
            {gemCandidates.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {gemCandidates.map(p => (
                  <button key={p} className={`btn ${Number(prizeGem) === p ? "btn-selected" : ""}`}
                    style={{ flex: "0 0 auto", padding: "6px 10px", fontSize: 12 }}
                    onClick={() => setPrizeGem(String(p))}>{p.toLocaleString()}</button>
                ))}
              </div>
            ) : null}
            <input className="input-field" type="number" placeholder="例: 5400" value={prizeGem}
              onChange={e => setPrizeGem(e.target.value)} />
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
      <DeckImagesField images={images} setImages={setImages} disabledNote={imagesDisabledNote} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" style={{ flex: 1, padding: "14px", fontSize: 14 }} onClick={onBack}>
          キャンセル
        </button>
        <button className="btn-primary" style={{ flex: 2 }} disabled={!canSave || isSyncing}
          onClick={() => onSave({ wins, losses, prizeType, prizeGem: Number(prizeGem) || 0, prizeBoxCount,
            hasRight,
            boxName: (prizeType === "PB_BOX" || prizeType === "CB_BOX") ? boxName : "" }, images)}>
          {isSyncing ? "保存中..." : initialRun ? "修正を保存" : "Runを保存"}
        </button>
      </div>
      {onDelete && (
        <button className="btn" disabled={isSyncing}
          style={{ width: "100%", marginTop: 16, padding: "12px", fontSize: 13, color: "#ff8080",
            borderColor: confirmDelete ? "rgba(255,128,128,0.6)" : "rgba(255,128,128,0.25)",
            background: confirmDelete ? "rgba(255,128,128,0.1)" : undefined }}
          onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}>
          {confirmDelete ? "本当に削除する（もう一度タップ）" : "このRunを削除"}
        </button>
      )}
    </div>
  );
}

// ===== EventSummaryScreen =====
function EventSummaryScreen({ event, onAddRun, onFinish, onBack, onDeleteRun, onEditRun, isSyncing }) {
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
      <div style={{ fontSize: 11, color: "#ccc", marginBottom: 12 }}>消費: {event.gemCost.toLocaleString()}ジェム/Run</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div className="summary-card">
          <div className="summary-val">{event.runs.length}</div>
          <div className="summary-key">Runs</div>
        </div>
        <div className="summary-card">
          <div className="summary-val">{totalWins + totalLosses}</div>
          <div className="summary-key">総対戦</div>
        </div>
        <div className="summary-card">
          <div className="summary-val" style={{ color: "#ffcb6b" }}>
            {winRate !== null ? `${winRate}%` : "—"}
          </div>
          <div className="summary-key">勝率</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div className="summary-card">
          <div className="summary-val">{totalWins}</div>
          <div className="summary-key">総勝利</div>
        </div>
        <div className="summary-card">
          <div className={`summary-val ${gemBalance >= 0 ? "gem-positive" : "gem-negative"}`}>
            {gemBalance >= 0 ? "+" : ""}{gemBalance.toLocaleString()}
          </div>
          <div className="summary-yen">≈ {formatYen(gemBalance)}</div>
          <div className="summary-key">ジェム収支</div>
        </div>
      </div>

      {event.runs.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#ff8080" }}>-{totalGemCost.toLocaleString()}</div>
              <div className="strip-yen">≈ {formatYen(-totalGemCost)}</div>
              <div style={{ fontSize: 9, color: "#bbb", textTransform: "uppercase", marginTop: 2 }}>総消費ジェム</div>
            </div>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.07)" }} />
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#68d9a4" }}>+{totalGemPrize.toLocaleString()}</div>
              <div className="strip-yen">≈ {formatYen(totalGemPrize)}</div>
              <div style={{ fontSize: 9, color: "#bbb", textTransform: "uppercase", marginTop: 2 }}>総獲得ジェム</div>
            </div>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.07)" }} />
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: gemBalance >= 0 ? "#68d9a4" : "#ff8080" }}>
                {gemBalance >= 0 ? "+" : ""}{gemBalance.toLocaleString()}
              </div>
              <div className="strip-yen">≈ {formatYen(gemBalance)}</div>
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
          if (r.hasRight || r.prizeType === "予選ウィークエンド権利")
            prizeText += (prizeText && prizeText !== "なし" ? " + " : "") + "🏆 権利";
          if (r.prizeType === "予選ウィークエンド権利") prizeText = prizeText.replace("undefined", "").trim();
          return (
            <div key={i} className="run-item">
              <span className="run-num">#{i + 1}</span>
              <span className="run-wins">{r.wins}勝{r.losses != null ? `${r.losses}敗` : ""}</span>
              <span className="run-prize">{prize?.icon} {prizeText}</span>
              <span style={{ marginLeft: "auto" }} />
              <RunImagesBadge r={r} />
              <button onClick={() => onEditRun(i)} disabled={isSyncing}
                style={{ background: "rgba(255,203,107,0.08)", border: "1px solid rgba(255,203,107,0.3)", borderRadius: 6, color: "#ffcb6b", fontSize: 11, cursor: "pointer", padding: "4px 8px", flexShrink: 0 }}>
                修正
              </button>
              {event.isEditing && (
                <button onClick={() => onDeleteRun(r)}
                  style={{ background: "none", border: "none", color: "#ff8080", fontSize: 16, cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>
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
        {isSyncing ? "保存中..." : event.isEditing ? "変更を保存" : "期間イベントを終了"}
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
  .summary-yen { font-size: 11px; color: #ccc; margin-top: 2px; }
  .strip-yen { font-size: 10px; color: #bbb; margin-top: 1px; }
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

  /* ===== PC デモ画面 ===== */
  .pcd-wrap { display: none; }

  @media (min-width: 860px) {
    .mobile-app { display: none; }

    .pcd-wrap {
      display: block; min-height: 100vh;
      background: #f4f6f9;
      color: #1e293b;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', sans-serif;
    }

    /* ナビゲーション */
    .pcd-nav {
      display: flex; align-items: center;
      background: #fff; border-bottom: 1px solid #e2e8f0;
      padding: 0 40px; height: 60px;
      position: sticky; top: 0; z-index: 100;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      gap: 40px;
    }
    .pcd-logo { font-size: 17px; font-weight: 700; color: #1e293b; letter-spacing: -0.02em; flex-shrink: 0; }
    .pcd-nav-links { display: flex; gap: 28px; flex: 1; }
    .pcd-nav-link { font-size: 13px; color: #64748b; cursor: pointer; padding: 4px 0; border-bottom: 2px solid transparent; transition: color 0.15s; }
    .pcd-nav-link:hover { color: #1e293b; }
    .pcd-nav-link-active { color: #1e293b; font-weight: 600; border-bottom-color: #4f46e5; }
    .pcd-nav-cta { background: #4f46e5; color: #fff; padding: 8px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; }

    /* メインコンテンツ */
    .pcd-main { padding: 36px 48px; }
    .pcd-page-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; }
    .pcd-page-title { font-size: 22px; font-weight: 700; color: #0f172a; }
    .pcd-page-sub { font-size: 13px; color: #94a3b8; }

    /* 統計カード */
    .pcd-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
    .pcd-stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 22px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .pcd-stat-val { font-size: 26px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
    .pcd-stat-val.pos { color: #16a34a; }
    .pcd-stat-val.neg { color: #dc2626; }
    .pcd-stat-key { font-size: 11px; color: #94a3b8; font-weight: 500; }

    /* アクションカード */
    .pcd-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 32px; }
    .pcd-action { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 26px; cursor: pointer; transition: all 0.15s; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .pcd-action:hover { border-color: #c7d2fe; box-shadow: 0 4px 12px rgba(79,70,229,0.09); }
    .pcd-action-primary { border-left: 4px solid #4f46e5; }
    .pcd-action-icon { font-size: 28px; margin-bottom: 10px; }
    .pcd-action-title { font-size: 15px; font-weight: 600; color: #0f172a; margin-bottom: 5px; }
    .pcd-action-desc { font-size: 12px; color: #94a3b8; line-height: 1.5; }

    /* イベント一覧テーブル */
    .pcd-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .pcd-section-title { font-size: 14px; font-weight: 600; color: #0f172a; }
    .pcd-section-link { font-size: 12px; color: #4f46e5; cursor: pointer; }
    .pcd-table { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .pcd-table-head {
      display: grid; grid-template-columns: 2fr 1fr 1.4fr 0.8fr 1fr;
      padding: 10px 20px; gap: 12px;
      background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .pcd-table-row {
      display: grid; grid-template-columns: 2fr 1fr 1.4fr 0.8fr 1fr;
      padding: 14px 20px; gap: 12px;
      border-bottom: 1px solid #f1f5f9; align-items: center;
      cursor: pointer; transition: background 0.1s;
    }
    .pcd-table-row:last-child { border-bottom: none; }
    .pcd-table-row:hover { background: #f8fafc; }
    .pcd-ev-name { font-size: 13px; font-weight: 500; color: #1e293b; }
    .pcd-ev-date { font-size: 12px; color: #94a3b8; }
    .pcd-ev-record { font-size: 12px; color: #475569; }
    .pcd-ev-wr { color: #f59e0b; font-weight: 600; }
    .pcd-ev-runs { font-size: 12px; color: #64748b; }
    .pcd-ev-balance { font-size: 13px; font-weight: 600; }
    .pcd-ev-balance.pos { color: #16a34a; }
    .pcd-ev-balance.neg { color: #dc2626; }
  }

  @media (min-width: 860px) {
    .pcd-loading { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; }
    .pcd-back-btn { background: none; border: 1px solid #e2e8f0; border-radius: 6px; color: #475569; cursor: pointer; font-size: 12px; padding: 7px 14px; transition: all 0.15s; display: inline-block; margin-bottom: 8px; }
    .pcd-back-btn:hover { background: #f1f5f9; color: #1e293b; }

    /* PC フォーム共通 */
    .pcd-form-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .pcd-form-section { margin-bottom: 20px; }
    .pcd-form-section:last-child { margin-bottom: 0; }
    .pcd-form-label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; display: block; }
    .pcd-form-empty { display: flex; align-items: center; justify-content: center; height: 200px; color: #94a3b8; font-size: 14px; background: #fff; border: 2px dashed #e2e8f0; border-radius: 10px; }
    .pcd-form-hint { font-size: 12px; color: #64748b; margin-top: 6px; }
    .pcd-input { width: 100%; border: 1px solid #e2e8f0; border-radius: 6px; color: #0f172a; font-size: 14px; padding: 9px 12px; outline: none; background: #fff; transition: border-color 0.15s; }
    .pcd-input:focus { border-color: #818cf8; box-shadow: 0 0 0 2px rgba(129,140,248,0.15); }
    .pcd-preset-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .pcd-preset-btn { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; color: #475569; cursor: pointer; font-size: 13px; padding: 7px 14px; transition: all 0.15s; white-space: nowrap; }
    .pcd-preset-btn:hover { border-color: #c7d2fe; }
    .pcd-preset-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pcd-preset-active { background: #eef2ff !important; border-color: #818cf8 !important; color: #4f46e5 !important; font-weight: 600; }
    .pcd-preset-lg { padding: 10px 20px; font-size: 16px; font-weight: 700; }
    .pcd-primary-btn { width: 100%; padding: 13px; background: #4f46e5; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
    .pcd-primary-btn:hover:not(:disabled) { background: #4338ca; }
    .pcd-primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pcd-ghost-btn { width: 100%; padding: 11px; background: #fff; border: 1px dashed #c7d2fe; border-radius: 8px; color: #4f46e5; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
    .pcd-ghost-btn:hover { background: #eef2ff; border-style: solid; }

    /* PC record: 2カラム（広い画面では3カラム） */
    .pcd-form-2col { display: grid; grid-template-columns: 260px 1fr; gap: 24px; align-items: start; }
    .pcd-preview-panel { display: none; }
    .pcd-type-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .pcd-type-btn { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; text-align: left; cursor: pointer; transition: all 0.15s; width: 100%; }
    .pcd-type-btn:hover { border-color: #c7d2fe; background: #f8fafc; }
    .pcd-type-btn-active { background: #eef2ff; border-color: #818cf8; }
    .pcd-type-name { font-size: 13px; font-weight: 600; color: #1e293b; }
    .pcd-type-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .pcd-manage-link { background: none; border: none; font-size: 12px; color: #4f46e5; cursor: pointer; padding: 8px 0; display: block; }
    .pcd-manage-link:hover { text-decoration: underline; }
    .pcd-resume-banner { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .pcd-resume-banner span { font-size: 13px; color: #1e40af; }
    .pcd-resume-banner button { background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; padding: 7px 14px; cursor: pointer; white-space: nowrap; }

    /* PC summary: 2カラム */
    .pcd-summary-layout { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }
    .pcd-summary-sidebar { position: sticky; top: 80px; }

    /* PC run entry: 2カラム（広い画面では3カラム） */
    .pcd-run-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
    .pcd-history-panel { display: none; }
    .pcd-wins-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .pcd-win-btn { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; color: #475569; cursor: pointer; font-size: 20px; font-weight: 700; padding: 14px 0; transition: all 0.15s; }
    .pcd-win-btn:hover { border-color: #c7d2fe; background: #eef2ff; }
    .pcd-win-btn-active { background: #eef2ff; border-color: #818cf8; color: #4f46e5; }
    .pcd-prize-grid { display: grid; gap: 8px; margin-bottom: 12px; }
    .pcd-prize-btn { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; padding: 12px 6px; transition: all 0.15s; }
    .pcd-prize-btn:hover { border-color: #c7d2fe; }
    .pcd-prize-btn-active { background: #eef2ff; border-color: #818cf8; }
    .pcd-prize-icon { font-size: 22px; margin-bottom: 4px; }
    .pcd-prize-label { color: #475569; font-size: 10px; text-align: center; line-height: 1.3; }
    .pcd-right-btn { width: 100%; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #64748b; transition: all 0.15s; margin-top: 8px; }
    .pcd-right-btn:hover { border-color: #c7d2fe; }
    .pcd-right-btn-active { background: #fefce8; border-color: #fbbf24; color: #92400e; font-weight: 600; }
    .pcd-autofill-badge { font-size: 11px; color: #16a34a; background: #dcfce7; border: 1px solid #86efac; border-radius: 5px; padding: 4px 10px; }

    /* 設定確認 / Run履歴 参照パネル（補助情報） */
    .pcd-preview-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .pcd-preview-row:last-child { border-bottom: none; }
    .pcd-preview-row span:first-child { color: #64748b; }
    .pcd-preview-row span:last-child { font-weight: 600; color: #0f172a; text-align: right; }
    .pcd-mini-row { display: flex; gap: 8px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
    .pcd-mini-row:last-child { border-bottom: none; }
    .pcd-mini-num { color: #94a3b8; min-width: 22px; flex-shrink: 0; margin-right: 4px; }
    .pcd-mini-wins { font-weight: 600; color: #1e293b; width: 60px; flex-shrink: 0; }
    .pcd-yen { display: block; text-align: right; font-size: 11px; font-weight: 400; color: #64748b; margin-top: 1px; }
    .pcd-mini-prize { color: #64748b; flex: 1; }
  }

  @media (min-width: 1180px) {
    .pcd-form-2col { grid-template-columns: 260px minmax(360px, 520px) 1fr; }
    .pcd-run-layout { grid-template-columns: 1fr 1fr minmax(260px, 320px); }
    .pcd-preview-panel, .pcd-history-panel { display: block; }
  }
`;

// ===== PCRecordSetup =====
function PCRecordSetup({ eventTypes, onNewEvent, setScreen, openEvents, onOpenEvent, isSyncing }) {
  return (
    <div>
      <div className="pcd-page-header">
        <div className="pcd-page-title">期間イベントを開始</div>
      </div>
      <div className="pcd-form-hint" style={{ marginBottom: 16, maxWidth: 560 }}>
        アリーナダイレクトなど、Run数をまとめて数えたいイベントを開始します。開始中は、同じ種別のRunが自動でこのイベントに追加されます。
      </div>
      {openEvents.map(ev => (
        <div key={ev.id} className="pcd-resume-banner">
          <span>進行中: {ev.type}（{ev.date}〜）</span>
          <button onClick={() => onOpenEvent(ev)}>開く →</button>
        </div>
      ))}
      {isSyncing && (
        <div style={{ marginBottom: 16, color: "#4f46e5", fontSize: 13, padding: "12px 16px", background: "#eef2ff", borderRadius: 8 }}>
          イベント作成中...
        </div>
      )}
      <div className="pcd-type-list" style={{ maxWidth: 480 }}>
        {eventTypes.map(et => {
          const hasConfig = et.gemCost > 0;
          return (
            <button key={et.id} className="pcd-type-btn" disabled={isSyncing}
              onClick={() => onNewEvent(et.label, et.gemCost||0, et.boxType||null, et.boxName||"", et.maxLosses||3, et.maxWins||7)}>
              <div className="pcd-type-name">{et.english || et.label}</div>
              {et.english && <div className="pcd-type-sub">{et.label}</div>}
              <div style={{ fontSize:11, color:hasConfig?"#64748b":"#ef4444", marginTop:4 }}>
                {hasConfig
                  ? `${et.gemCost.toLocaleString()}G · 最大 ${et.maxWins||7}勝 ${et.maxLosses||3}敗${et.boxType?` · ${et.boxType==="PB_BOX"?"🎁 PB":"✨ CB"}`:""}`
                  : "⚙ ジェムコストを設定してください"
                }
              </div>
            </button>
          );
        })}
      </div>
      <button className="pcd-manage-link" onClick={() => setScreen("manage-types")}>⚙ イベントタイプを管理</button>
    </div>
  );
}

// ===== PCEventTypeManager =====
function PCEventTypeManager({ eventTypes, onSave, setScreen }) {
  const [types, setTypes] = useState(eventTypes);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [editEnglish, setEditEnglish] = useState("");
  const [editGemCost, setEditGemCost] = useState("");
  const [editMaxWins, setEditMaxWins] = useState(7);
  const [editMaxLosses, setEditMaxLosses] = useState(3);
  const [editBoxType, setEditBoxType] = useState(null);
  const [editBoxName, setEditBoxName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newEnglish, setNewEnglish] = useState("");
  const [newGemCost, setNewGemCost] = useState("");
  const [newMaxWins, setNewMaxWins] = useState(7);
  const [newMaxLosses, setNewMaxLosses] = useState(3);
  const [newBoxType, setNewBoxType] = useState(null);
  const [newBoxName, setNewBoxName] = useState("");

  const gemPresets = [4000, 5000, 6000, 8000];
  const maxWinsPresets = [4, 7];
  const maxLossesPresets = [1, 2, 3];

  const moveUp = (i) => { if(i===0)return; const a=[...types]; [a[i-1],a[i]]=[a[i],a[i-1]]; setTypes(a); };
  const moveDown = (i) => { if(i===types.length-1)return; const a=[...types]; [a[i],a[i+1]]=[a[i+1],a[i]]; setTypes(a); };

  const startEdit = (t) => {
    setEditingId(t.id); setEditLabel(t.label); setEditEnglish(t.english||"");
    setEditGemCost(String(t.gemCost||"")); setEditMaxWins(t.maxWins||7); setEditMaxLosses(t.maxLosses||3);
    setEditBoxType(t.boxType||null); setEditBoxName(t.boxName||"");
  };

  const saveEdit = () => {
    setTypes(p=>p.map(t=>t.id===editingId?{
      ...t, label:editLabel.trim(), english:editEnglish.trim(),
      gemCost:Number(editGemCost)||0, maxWins:editMaxWins, maxLosses:editMaxLosses,
      boxType:editBoxType, boxName:editBoxType?editBoxName.trim():"",
    }:t));
    setEditingId(null);
  };

  const resetNew = () => { setNewLabel(""); setNewEnglish(""); setNewGemCost(""); setNewMaxWins(7); setNewMaxLosses(3); setNewBoxType(null); setNewBoxName(""); };

  const renderPCConfigFields = (gemCost, setGemCost, maxWins, setMaxWins, maxLosses, setMaxLosses, boxType, setBoxType, boxName, setBoxName) => (
    <>
      <div className="pcd-form-section" style={{ marginTop: 16 }}>
        <span className="pcd-form-label">消費ジェム（Run毎）</span>
        <div className="pcd-preset-row">
          {gemPresets.map(p => (
            <button key={p} className={`pcd-preset-btn ${Number(gemCost)===p?"pcd-preset-active":""}`}
              onClick={() => setGemCost(String(p))}>{p.toLocaleString()}</button>
          ))}
        </div>
        <input className="pcd-input" type="number" placeholder="例: 6000" value={gemCost} onChange={e=>setGemCost(e.target.value)} />
      </div>
      <div className="pcd-form-section">
        <span className="pcd-form-label">最大勝利数</span>
        <div className="pcd-preset-row">
          {maxWinsPresets.map(n => (
            <button key={n} className={`pcd-preset-btn ${maxWins===n?"pcd-preset-active":""}`} onClick={()=>setMaxWins(n)}>{n}勝</button>
          ))}
          <input className="pcd-input" type="number" min="1" max="20" placeholder="他" style={{width:72,flex:"none"}}
            value={maxWinsPresets.includes(maxWins)?"":String(maxWins)}
            onChange={e=>{const v=parseInt(e.target.value);if(v>0)setMaxWins(v);}} />
        </div>
      </div>
      <div className="pcd-form-section">
        <span className="pcd-form-label">最大敗北数</span>
        <div className="pcd-preset-row">
          {maxLossesPresets.map(n => (
            <button key={n} className={`pcd-preset-btn ${maxLosses===n?"pcd-preset-active":""}`} onClick={()=>setMaxLosses(n)}>{n}敗</button>
          ))}
        </div>
      </div>
      <div className="pcd-form-section">
        <span className="pcd-form-label">ボックスプライズ（任意）</span>
        <div className="pcd-preset-row">
          {[{k:null,l:"なし"},{k:"PB_BOX",l:"🎁 プレイ"},{k:"CB_BOX",l:"✨ コレクター"}].map(o=>(
            <button key={String(o.k)} className={`pcd-preset-btn ${boxType===o.k?"pcd-preset-active":""}`}
              onClick={()=>{setBoxType(o.k);if(!o.k)setBoxName("");}}>{o.l}</button>
          ))}
        </div>
        {boxType && <input className="pcd-input" type="text" placeholder="例: ストリクスヘイブンの秘密"
          value={boxName} onChange={e=>setBoxName(e.target.value)} style={{marginTop:8}} />}
      </div>
    </>
  );

  return (
    <div>
      <button className="pcd-back-btn" onClick={() => setScreen("record")}>← 記録に戻る</button>
      <div className="pcd-page-header">
        <div className="pcd-page-title">イベントタイプを管理</div>
        <div className="pcd-page-sub">上から5件がメインに表示されます</div>
      </div>
      <div style={{ maxWidth: 600 }}>
        <div className="pcd-table">
          {types.map((t, i) => (
            <div key={t.id}>
              {editingId === t.id ? (
                <div style={{ padding:16, borderBottom:"1px solid #f1f5f9" }}>
                  <input className="pcd-input" value={editLabel} onChange={e=>setEditLabel(e.target.value)} placeholder="イベント名" style={{marginBottom:8}} autoFocus />
                  <input className="pcd-input" value={editEnglish} onChange={e=>setEditEnglish(e.target.value)} placeholder="英語名（任意）" style={{marginBottom:8}} />
                  {renderPCConfigFields(editGemCost,setEditGemCost,editMaxWins,setEditMaxWins,editMaxLosses,setEditMaxLosses,editBoxType,setEditBoxType,editBoxName,setEditBoxName)}
                  <div style={{display:"flex",gap:8,marginTop:12}}>
                    <button className="pcd-preset-btn" style={{flex:1}} onClick={()=>setEditingId(null)}>キャンセル</button>
                    <button className="pcd-preset-btn pcd-preset-active" style={{flex:2}} onClick={saveEdit} disabled={!editLabel.trim()}>保存</button>
                  </div>
                </div>
              ) : (
                <div className="pcd-table-row" style={{gridTemplateColumns:"auto 1fr auto auto"}}>
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <button className="pcd-preset-btn" style={{padding:"2px 7px",fontSize:11}} onClick={()=>moveUp(i)} disabled={i===0}>↑</button>
                    <button className="pcd-preset-btn" style={{padding:"2px 7px",fontSize:11}} onClick={()=>moveDown(i)} disabled={i===types.length-1}>↓</button>
                  </div>
                  <div>
                    <div className="pcd-ev-name">{t.english||t.label}</div>
                    {t.english && <div style={{fontSize:11,color:"#94a3b8"}}>{t.label}</div>}
                    <div style={{fontSize:11,color:t.gemCost?"#64748b":"#ef4444",marginTop:2}}>
                      {t.gemCost?`${t.gemCost.toLocaleString()}G · ${t.maxWins||7}勝/${t.maxLosses||3}敗`:"⚙ 未設定"}
                    </div>
                    {i===4 && <div style={{fontSize:10,color:"#4f46e5",marginTop:2}}>↑ ここまでメイン表示</div>}
                  </div>
                  <button className="pcd-preset-btn" onClick={()=>startEdit(t)}>編集</button>
                  <button className="pcd-preset-btn" style={{color:"#ef4444",borderColor:"#fca5a5"}} onClick={()=>setTypes(p=>p.filter(x=>x.id!==t.id))}>削除</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {showAdd ? (
          <div className="pcd-form-card" style={{marginTop:12}}>
            <span className="pcd-form-label">新しいイベントタイプ</span>
            <input className="pcd-input" value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="イベント名" style={{marginBottom:8}} autoFocus />
            <input className="pcd-input" value={newEnglish} onChange={e=>setNewEnglish(e.target.value)} placeholder="英語名（任意）" style={{marginBottom:8}} />
            {renderPCConfigFields(newGemCost,setNewGemCost,newMaxWins,setNewMaxWins,newMaxLosses,setNewMaxLosses,newBoxType,setNewBoxType,newBoxName,setNewBoxName)}
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button className="pcd-preset-btn" style={{flex:1}} onClick={()=>{setShowAdd(false);resetNew();}}>キャンセル</button>
              <button className="pcd-primary-btn" style={{flex:2}} onClick={()=>{
                if(!newLabel.trim())return;
                setTypes(p=>[...p,{id:`ev-${Date.now()}`,label:newLabel.trim(),english:newEnglish.trim(),
                  gemCost:Number(newGemCost)||0,maxWins:newMaxWins,maxLosses:newMaxLosses,
                  boxType:newBoxType,boxName:newBoxType?newBoxName.trim():""}]);
                resetNew(); setShowAdd(false);
              }} disabled={!newLabel.trim()}>追加</button>
            </div>
          </div>
        ) : (
          <button className="pcd-ghost-btn" style={{marginTop:8}} onClick={()=>setShowAdd(true)}>+ イベントタイプを追加</button>
        )}
        <div style={{height:1,background:"#e2e8f0",margin:"16px 0"}} />
        <button className="pcd-primary-btn" onClick={()=>{onSave(types);setScreen("record");}}>変更を保存</button>
      </div>
    </div>
  );
}

// ===== PCEventSummary =====
function PCEventSummary({ event, onAddRun, onFinish, onBack, onDeleteRun, onEditRun, isSyncing }) {
  const totalWins = event.runs.reduce((s,r)=>s+r.wins,0);
  const totalLosses = event.runs.reduce((s,r)=>s+(r.losses||0),0);
  const winRate = (totalWins+totalLosses)>0 ? Math.round(totalWins/(totalWins+totalLosses)*100) : null;
  const totalGemPrize = event.runs.reduce((s,r)=>{
    if(r.prizeType==="ジェム") return s+r.prizeGem;
    if(r.prizeType==="PB_BOX"||r.prizeType==="CB_BOX") return s+(BOX_GEM_VALUE[r.prizeType]*(r.prizeBoxCount||1));
    return s;
  },0);
  const totalGemCost = event.gemCost * event.runs.length;
  const gemBalance = totalGemPrize - totalGemCost;

  return (
    <div>
      <button className="pcd-back-btn" onClick={onBack}>{event.isEditing?"← 履歴に戻る":"← ホーム"}</button>
      <div className="pcd-page-header">
        <div>
          <div className="pcd-page-sub">{event.isEditing?"編集中":"進行中"}</div>
          <div className="pcd-page-title">{event.type}</div>
        </div>
        <div className="pcd-page-sub">{event.date} · {event.gemCost.toLocaleString()}G/Run</div>
      </div>
      <div className="pcd-summary-layout">
        {/* Left: run list */}
        <div style={{ maxWidth: 640 }}>
          <div className="pcd-section-header"><div className="pcd-section-title">Run履歴</div></div>
          <div className="pcd-table">
            <div className="pcd-table-head" style={{gridTemplateColumns:event.isEditing?"52px 100px 1fr 56px 36px":"52px 100px 1fr 56px"}}>
              <span>#</span><span>成績</span><span>プライズ</span><span></span>{event.isEditing&&<span></span>}
            </div>
            {event.runs.length===0 ? (
              <div className="pcd-loading">まだRunがありません</div>
            ) : event.runs.map((r,i)=>{
              const prize=PRIZE_TYPES.find(p=>p.id===r.prizeType);
              let pt=prize?.label||"";
              if(r.prizeType==="ジェム") pt+=` ${r.prizeGem.toLocaleString()} G`;
              if(r.prizeType==="PB_BOX"||r.prizeType==="CB_BOX") pt+=` ${r.prizeBoxCount}箱 ≈${(BOX_GEM_VALUE[r.prizeType]*r.prizeBoxCount).toLocaleString()}G`;
              if(r.hasRight) pt+=" 🏆 権利";
              return (
                <div key={i} className="pcd-table-row" style={{gridTemplateColumns:event.isEditing?"52px 100px 1fr 56px 36px":"52px 100px 1fr 56px"}}>
                  <span style={{color:"#94a3b8",fontSize:12}}>#{i+1}</span>
                  <span style={{fontWeight:600,fontSize:13}}>{r.wins}勝{r.losses!=null?` ${r.losses}敗`:""}</span>
                  <span style={{color:"#475569",fontSize:13}}>{prize?.icon} {pt}</span>
                  <button onClick={()=>onEditRun(i)} disabled={isSyncing} style={{background:"none",border:"1px solid #fcd34d",borderRadius:6,color:"#d97706",cursor:"pointer",fontSize:12,padding:"2px 8px"}}>修正</button>
                  {event.isEditing&&<button onClick={()=>onDeleteRun(r)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:15,padding:0}}>×</button>}
                </div>
              );
            })}
          </div>
          <button className="pcd-ghost-btn" style={{marginTop:12}} onClick={onAddRun}>+ 次のRunを記録</button>
        </div>
        {/* Right: stats sidebar */}
        <div className="pcd-summary-sidebar">
          <div className="pcd-form-card">
            <span className="pcd-form-label" style={{marginBottom:16,display:"block"}}>集計</span>
            {[
              {label:"Runs",val:event.runs.length},
              {label:"総対戦",val:totalWins+totalLosses},
              {label:"総勝利",val:totalWins},
              {label:"勝率",val:winRate!==null?winRate+"%":"—"},
            ].map(s=>(
              <div key={s.label} style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <span style={{fontSize:13,color:"#64748b"}}>{s.label}</span>
                <span style={{fontSize:14,fontWeight:600,color:"#0f172a"}}>{s.val}</span>
              </div>
            ))}
            <div style={{height:1,background:"#e2e8f0",margin:"14px 0"}} />
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:13,color:"#64748b"}}>総消費</span>
              <span style={{fontSize:13,fontWeight:600,color:"#ef4444"}}>-{totalGemCost.toLocaleString()} G<span className="pcd-yen">≈ {formatYen(-totalGemCost)}</span></span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:13,color:"#64748b"}}>総獲得</span>
              <span style={{fontSize:13,fontWeight:600,color:"#16a34a"}}>+{totalGemPrize.toLocaleString()} G<span className="pcd-yen">≈ {formatYen(totalGemPrize)}</span></span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:20}}>
              <span style={{fontSize:13,color:"#64748b"}}>収支</span>
              <span style={{fontSize:17,fontWeight:700,color:gemBalance>=0?"#16a34a":"#ef4444"}}>
                {gemBalance>=0?"+":""}{gemBalance.toLocaleString()} G
                <span className="pcd-yen">≈ {formatYen(gemBalance)}</span>
              </span>
            </div>
            <button className="pcd-primary-btn" onClick={onFinish} disabled={isSyncing}>
              {isSyncing?"保存中...":event.isEditing?"変更を保存":"期間イベントを終了"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== PCRunEntry =====
function PCRunEntry({ runIndex, header, initialRun, onSave, onDelete, onBack, boxType, boxName, maxWins=7, maxLosses, previousRuns, isSyncing, imagesDisabledNote }) {
  const [images, setImages] = useState({ kept: initialRun?.imageIds || [], removed: [], added: [] });
  const [wins, setWins] = useState(initialRun?.wins ?? null);
  const [losses, setLosses] = useState(initialRun?.losses ?? null);
  const [prizeType, setPrizeType] = useState(initialRun?.prizeType ?? null);
  const [prizeGem, setPrizeGem] = useState(initialRun?.prizeGem>0 ? String(initialRun.prizeGem) : "");
  const [prizeBoxCount, setPrizeBoxCount] = useState(initialRun?.prizeBoxCount || null);
  const [hasRight, setHasRight] = useState(initialRun?.hasRight || false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  const hasPrev = previousRuns && previousRuns.length > 0;
  const gemCandidates = hasPrev ? [...new Set(previousRuns.filter(r=>r.prizeType==="ジェム"&&r.prizeGem>0).map(r=>r.prizeGem))].sort((a,b)=>a-b) : [];

  const visiblePrizes = PRIZE_TYPES.filter(pt=>{
    if(pt.id==="PB_BOX") return boxType==="PB_BOX";
    if(pt.id==="CB_BOX") return boxType==="CB_BOX";
    return true;
  });

  const canSave = wins!==null && losses!==null && prizeType!==null &&
    (prizeType!=="ジェム"||prizeGem) &&
    (!(prizeType==="PB_BOX"||prizeType==="CB_BOX")||prizeBoxCount!==null);

  const handleWins = (n) => {
    setWins(n);
    if(n<maxWins) setLosses(maxLosses||3);
    else if(maxLosses<=1) setLosses(0);
    else setLosses(null);
    const prev = previousRuns?.find(r=>r.wins===n);
    if(prev) {
      setPrizeType(prev.prizeType);
      const gv = prev.prizeGem>0?String(prev.prizeGem):"";
      setPrizeGem(prev.prizeType==="ジェム"&&!gv&&gemCandidates.length===1?String(gemCandidates[0]):gv);
      setPrizeBoxCount(prev.prizeBoxCount||null);
      setHasRight(prev.hasRight||false);
      setAutoFilled(true);
    } else {
      setPrizeType(null);setPrizeGem("");setPrizeBoxCount(null);setHasRight(false);setAutoFilled(false);
    }
  };

  const winButtons = Array.from({length:maxWins+1},(_,n)=>n);

  return (
    <div>
      <button className="pcd-back-btn" onClick={onBack}>← キャンセル</button>
      <div className="pcd-page-header">
        <div className="pcd-page-title">Run{runIndex ? ` #${runIndex}` : ""}{initialRun && <span style={{fontSize:14,color:"#d97706",marginLeft:10}}>修正</span>}</div>
        {autoFilled && <div className="pcd-autofill-badge">前回と同じ報酬を自動入力</div>}
      </div>
      {header}
      <div className="pcd-run-layout">
        {/* Left: wins + losses */}
        <div className="pcd-form-card">
          <span className="pcd-form-label">勝利数</span>
          <div className="pcd-wins-grid">
            {winButtons.map(n=>(
              <button key={n} className={`pcd-win-btn ${wins===n?"pcd-win-btn-active":""}`} onClick={()=>handleWins(n)}>{n}</button>
            ))}
          </div>
          {wins===maxWins && maxLosses>1 && (
            <div style={{marginTop:20}}>
              <span className="pcd-form-label">敗北数（{maxWins}勝時）</span>
              <div className="pcd-preset-row">
                {Array.from({length:maxLosses},(_,n)=>n).map(n=>(
                  <button key={n} className={`pcd-preset-btn pcd-preset-lg ${losses===n?"pcd-preset-active":""}`}
                    onClick={()=>setLosses(n)}>{n}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Right: prize */}
        <div className="pcd-form-card">
          <span className="pcd-form-label">プライズ</span>
          <div className="pcd-prize-grid" style={{gridTemplateColumns:`repeat(${visiblePrizes.length},1fr)`}}>
            {visiblePrizes.map(pt=>(
              <button key={pt.id} className={`pcd-prize-btn ${prizeType===pt.id?"pcd-prize-btn-active":""}`}
                onClick={()=>{setAutoFilled(false);setPrizeType(pt.id);setPrizeGem("");setPrizeBoxCount(null);}}>
                <span className="pcd-prize-icon">{pt.icon}</span>
                <span className="pcd-prize-label">{pt.label}</span>
              </button>
            ))}
          </div>
          <button className={`pcd-right-btn ${hasRight?"pcd-right-btn-active":""}`}
            onClick={()=>{setAutoFilled(false);setHasRight(p=>!p);}}>
            <span>🏆 権利獲得</span><span>{hasRight?"ON":"OFF"}</span>
          </button>
          {prizeType==="ジェム" && (
            <div style={{marginTop:16}}>
              {gemCandidates.length>0 && (
                <div className="pcd-preset-row" style={{marginBottom:8}}>
                  {gemCandidates.map(p=>(
                    <button key={p} className={`pcd-preset-btn ${Number(prizeGem)===p?"pcd-preset-active":""}`}
                      onClick={()=>setPrizeGem(String(p))}>{p.toLocaleString()}</button>
                  ))}
                </div>
              )}
              <input className="pcd-input" type="number" placeholder="例: 5400" value={prizeGem}
                onChange={e=>setPrizeGem(e.target.value)} />
            </div>
          )}
          {(prizeType==="PB_BOX"||prizeType==="CB_BOX") && (
            <div style={{marginTop:16}}>
              <span className="pcd-form-label">箱数</span>
              <div className="pcd-preset-row">
                {[1,2].map(n=>(
                  <button key={n} className={`pcd-preset-btn pcd-preset-lg ${prizeBoxCount===n?"pcd-preset-active":""}`}
                    onClick={()=>setPrizeBoxCount(n)}>{n}箱</button>
                ))}
              </div>
              {prizeBoxCount && <div style={{marginTop:8,fontSize:13,color:"#f78c6c"}}>≈ +{(BOX_GEM_VALUE[prizeType]*prizeBoxCount).toLocaleString()} G</div>}
              {boxName && <div style={{marginTop:6,fontSize:12,color:"#64748b"}}>{boxName}</div>}
            </div>
          )}
          <div style={{height:1,background:"#e2e8f0",margin:"20px 0"}} />
          <button className="pcd-primary-btn" disabled={!canSave || isSyncing}
            onClick={()=>onSave({wins,losses,prizeType,prizeGem:Number(prizeGem)||0,prizeBoxCount,hasRight,
              boxName:(prizeType==="PB_BOX"||prizeType==="CB_BOX")?boxName:""}, images)}>
            {isSyncing ? "保存中..." : initialRun ? "修正を保存" : "Runを保存"}
          </button>
          {onDelete && (
            <button className="pcd-ghost-btn" disabled={isSyncing}
              style={{marginTop:10,width:"100%",color:"#ef4444",borderColor:confirmDelete?"#ef4444":undefined}}
              onClick={()=>confirmDelete?onDelete():setConfirmDelete(true)}>
              {confirmDelete?"本当に削除する（もう一度クリック）":"このRunを削除"}
            </button>
          )}
        </div>
        {/* 補助情報: これまでのRun履歴 */}
        <div className="pcd-history-panel pcd-form-card">
          <span className="pcd-form-label">{header ? "同じ種別の直近Run" : "これまでのRun"}</span>
          {hasPrev ? (header ? previousRuns.slice(0,10) : previousRuns).map((r,i)=>{
            const prize=PRIZE_TYPES.find(p=>p.id===r.prizeType);
            let pt=prize?.label||"";
            if(r.prizeType==="ジェム") pt+=` ${r.prizeGem.toLocaleString()}G`;
            if(r.prizeType==="PB_BOX"||r.prizeType==="CB_BOX") pt+=` ${r.prizeBoxCount}箱`;
            if(r.hasRight) pt+=" 🏆";
            return (
              <div key={i} className="pcd-mini-row">
                <span className="pcd-mini-num">{header ? runJSTDate(r).slice(5).replace("-","/") : `#${i+1}`}</span>
                <span className="pcd-mini-wins">{r.wins}勝{r.losses!=null?` ${r.losses}敗`:""}</span>
                <span className="pcd-mini-prize">{prize?.icon} {pt}</span>
              </div>
            );
          }) : (
            <div className="pcd-form-hint">これが最初のRunです。</div>
          )}
        </div>
      </div>
      <div style={{marginTop:16}}>
        <DeckImagesField images={images} setImages={setImages} disabledNote={imagesDisabledNote} pc />
      </div>
    </div>
  );
}

// ===== PCEventDetail =====
function PCEventDetail({ event, runs, runsLoading, onBack, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const tw = event.totalWins || 0;
  const tl = event.totalLosses || 0;
  const wr = (tw + tl) > 0 ? Math.round(tw / (tw + tl) * 100) : null;
  const balance = event.gemBalance || 0;

  const handleDeleteClick = async () => {
    setIsDeleting(true);
    try { await onDelete(event); } finally { setIsDeleting(false); }
  };

  return (
    <div>
      <button className="pcd-back-btn" onClick={onBack}>← 履歴に戻る</button>
      <div className="pcd-page-header">
        <div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{event.type}</div>
          <div className="pcd-page-title">{event.name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="pcd-page-sub">{event.date}</div>
          <button className="pcd-preset-btn" onClick={() => onEdit(event, runs)}>編集</button>
          <button className="pcd-preset-btn" style={{ color: "#ef4444", borderColor: "#fca5a5" }} onClick={() => setConfirmDelete(true)}>削除</button>
        </div>
      </div>
      {confirmDelete && (
        <div style={{ marginBottom: 20, padding: "14px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10 }}>
          <div style={{ fontSize: 13, color: "#dc2626", marginBottom: 10 }}>このイベントを削除しますか？（Runデータも全て削除されます）</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pcd-preset-btn" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>キャンセル</button>
            <button className="pcd-preset-btn" style={{ flex: 1, color: "#ef4444", borderColor: "#fca5a5" }}
              disabled={isDeleting} onClick={handleDeleteClick}>
              {isDeleting ? "削除中..." : "削除する"}
            </button>
          </div>
        </div>
      )}
      <div className="pcd-stats" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {[
          { val: (balance >= 0 ? "+" : "") + balance.toLocaleString() + " G", cls: balance >= 0 ? "pos" : "neg", label: "ジェム収支", yen: formatYen(balance) },
          { val: wr !== null ? wr + "%" : "—", cls: "", label: "勝率" },
          { val: tw, cls: "", label: "総勝利" },
          { val: tw + tl, cls: "", label: "総対戦" },
          { val: event.totalRuns || 0, cls: "", label: "Run数" },
        ].map(s => (
          <div key={s.label} className="pcd-stat">
            <div className={`pcd-stat-val ${s.cls}`}>{s.val}</div>
            {s.yen && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>≈ {s.yen}</div>}
            <div className="pcd-stat-key">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="pcd-section-header">
        <div className="pcd-section-title">Run履歴</div>
      </div>
      {runsLoading ? (
        <div className="pcd-loading">取得中...</div>
      ) : (
        <div className="pcd-table">
          <div className="pcd-table-head" style={{ gridTemplateColumns: "52px 100px 1fr" }}>
            <span>#</span><span>成績</span><span>プライズ</span>
          </div>
          {runs.length === 0 ? (
            <div className="pcd-loading">Runデータなし</div>
          ) : runs.map((r, i) => {
            const prize = PRIZE_TYPES.find(p => p.id === r.prizeType);
            let prizeText = prize?.label || "";
            if (r.prizeType === "ジェム") prizeText += ` ${(r.prizeGem || 0).toLocaleString()} G`;
            if (r.prizeType === "PB_BOX" || r.prizeType === "CB_BOX") prizeText += ` ${r.prizeBoxCount}箱`;
            if (r.hasRight) prizeText += " 🏆 権利";
            return (
              <div key={i} className="pcd-table-row" style={{ gridTemplateColumns: "52px 100px 1fr" }}>
                <span style={{ color: "#94a3b8", fontSize: 12 }}>#{i + 1}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.wins}勝{r.losses != null ? ` ${r.losses}敗` : ""}</span>
                <span style={{ color: "#475569", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>{prize?.icon} {prizeText}<RunImagesBadge r={r} pc /></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===== PCDemo（実データ PC画面） =====
function PCRunTable({ runs, labelOf, onEditRun }) {
  return (
    <div className="pcd-table">
      <div className="pcd-table-head" style={{ gridTemplateColumns: "150px 90px 1fr 100px 56px" }}>
        <span></span><span>成績</span><span>プライズ</span><span style={{ textAlign: "right" }}>収支</span><span></span>
      </div>
      {runs.length === 0 ? <div className="pcd-loading">Runがありません</div> : runs.map(r => {
        const bal = runGemBalance(r);
        return (
          <div key={r.id} className="pcd-table-row" style={{ gridTemplateColumns: "150px 90px 1fr 100px 56px" }}>
            <span style={{ color: "#64748b", fontSize: 12 }}>{labelOf(r)}</span>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{r.wins}勝 {r.losses}敗</span>
            <span style={{ color: "#475569", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>{runPrizeText(r)}<RunImagesBadge r={r} pc /></span>
            <span className={`pcd-ev-balance ${bal >= 0 ? "pos" : "neg"}`} style={{ textAlign: "right" }}>{fmtSigned(bal)} G</span>
            <button onClick={() => onEditRun(r)} style={{ background: "none", border: "1px solid #fcd34d", borderRadius: 6, color: "#d97706", cursor: "pointer", fontSize: 12, padding: "2px 8px" }}>修正</button>
          </div>
        );
      })}
    </div>
  );
}

function PCMonthly({ runs, sel, setSel, onEditRun }) {
  const groups = groupRunsByMonthType(runs);
  if (sel) {
    const g = groups.find(([m]) => m === sel.month)?.[1].find(x => x.type === sel.type);
    const rs = g ? [...g.runs].sort((a, b) => (a.playedAt || "").localeCompare(b.playedAt || "")) : [];
    const sum = summarizeRuns(rs);
    return (
      <div>
        <button className="pcd-back-btn" onClick={() => setSel(null)}>← 月別に戻る</button>
        <div className="pcd-page-header">
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{monthLabel(sel.month)}</div>
            <div className="pcd-page-title">{sel.type}</div>
          </div>
        </div>
        <div className="pcd-stats" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          {[
            { val: fmtSigned(sum.balance) + " G", cls: sum.balance >= 0 ? "pos" : "neg", label: "ジェム収支", yen: formatYen(sum.balance) },
            { val: sum.winRate !== null ? sum.winRate + "%" : "—", cls: "", label: "勝率" },
            { val: `${sum.wins}-${sum.losses}`, cls: "", label: "勝敗" },
            { val: "-" + sum.cost.toLocaleString() + " G", cls: "neg", label: "総消費", yen: formatYen(-sum.cost) },
            { val: sum.count, cls: "", label: "Run数" },
          ].map(x => (
            <div key={x.label} className="pcd-stat">
              <div className={`pcd-stat-val ${x.cls}`}>{x.val}</div>
              {x.yen && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>≈ {x.yen}</div>}
              <div className="pcd-stat-key">{x.label}</div>
            </div>
          ))}
        </div>
        <PCRunTable runs={rs} labelOf={r => runJSTDate(r)} onEditRun={onEditRun} />
      </div>
    );
  }
  if (!groups.length) return <div className="pcd-loading">履歴がありません</div>;
  const cols = "1fr 90px 110px 80px 130px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {groups.map(([m, types]) => {
        const total = summarizeRuns(types.flatMap(t => t.runs));
        return (
          <div key={m} className="pcd-table">
            <div className="pcd-table-head" style={{ gridTemplateColumns: cols }}>
              <span style={{ color: "#0f172a", fontWeight: 700 }}>{monthLabel(m)}</span>
              <span>{total.count} Run</span><span>{total.wins}勝 {total.losses}敗</span>
              <span>{total.winRate !== null ? total.winRate + "%" : "—"}</span>
              <span className={`pcd-ev-balance ${total.balance >= 0 ? "pos" : "neg"}`}>{fmtSigned(total.balance)} G</span>
            </div>
            {types.map(t => (
              <div key={t.type} className="pcd-table-row" style={{ gridTemplateColumns: cols, cursor: "pointer" }}
                onClick={() => setSel({ month: m, type: t.type })}>
                <span className="pcd-ev-name">{t.type}</span>
                <span className="pcd-ev-runs">{t.count} Run</span>
                <span className="pcd-ev-record">{t.wins}勝 {t.losses}敗</span>
                <span className="pcd-ev-wr">{t.winRate !== null ? t.winRate + "%" : "—"}</span>
                <span className={`pcd-ev-balance ${t.balance >= 0 ? "pos" : "neg"}`}>{fmtSigned(t.balance)} G</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PCDemo({ screen, setScreen, refreshKey, eventTypes, runs, openEvents, activeEvent, entryKey, onRecord, onOpenEvent,
                  onNewEvent, onFinish, onDeleteRun, onEditRunIndex, onEditRun, runEntryProps, onAddRun, onSummaryBack,
                  isSyncing, onSaveEventTypes, onEditEvent, isLoading, historyTab, setHistoryTab, monthSel, setMonthSel }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventRuns, setEventRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/events`);
      const data = await res.json();
      setEvents(data.sort((a, b) => (b.date || "").localeCompare(a.date || "")));
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents, refreshKey]);

  const handleSelectEvent = async (ev) => {
    setSelectedEvent(ev); setEventRuns([]); setRunsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/runs/${ev.id}`);
      setEventRuns(await res.json());
    } catch { setEventRuns([]); }
    finally { setRunsLoading(false); }
  };

  const handleDeleteEvent = async (ev) => {
    await deleteEventFromDB(ev.id);
    setEvents(prev => prev.filter(e => e.id !== ev.id));
    setSelectedEvent(null);
  };

  const today = toJSTDateString();
  const thisMonth = today.slice(0, 7);
  const month = summarizeRuns(runs.filter(r => runJSTDate(r).startsWith(thisMonth)));
  const todayRuns = runs.filter(r => runJSTDate(r) === today);
  const [yr, mo] = thisMonth.split("-");

  const navActive = ["record", "summary", "manage-types"].includes(screen) ? "record"
    : screen === "history" ? "history" : screen === "run" ? "run" : "home";
  const navItems = [
    { label: "ホーム", key: "home" },
    { label: "期間イベント", key: "record" },
    { label: "履歴", key: "history" },
  ];

  const EventTable = ({ evs }) => {
    if (loading) return <div className="pcd-loading">読み込み中...</div>;
    if (!evs.length) return <div className="pcd-loading">データがありません</div>;
    return (
      <div className="pcd-table">
        <div className="pcd-table-head">
          <span>イベント</span><span>日付</span><span>成績</span><span>Run数</span><span>ジェム収支</span>
        </div>
        {evs.map(ev => {
          const tw = ev.totalWins || 0;
          const tl = ev.totalLosses || 0;
          const wr2 = (tw + tl) > 0 ? Math.round(tw / (tw + tl) * 100) : null;
          const bal = ev.gemBalance || 0;
          return (
            <div key={ev.id} className="pcd-table-row" onClick={() => handleSelectEvent(ev)} style={{ cursor: "pointer" }}>
              <span className="pcd-ev-name">{ev.type}</span>
              <span className="pcd-ev-date">{ev.date}</span>
              <span className="pcd-ev-record">
                {tw}勝 {tl}敗{wr2 !== null ? <><span> </span><span className="pcd-ev-wr">{wr2}%</span></> : ""}
              </span>
              <span className="pcd-ev-runs">{ev.totalRuns || 0} Run</span>
              <span className={`pcd-ev-balance ${bal >= 0 ? "pos" : "neg"}`}>{fmtSigned(bal)} G</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="pcd-wrap">
      <nav className="pcd-nav">
        <div className="pcd-logo">⚔ MTG Tracker</div>
        <div className="pcd-nav-links">
          {navItems.map(n => (
            <span key={n.key}
              className={`pcd-nav-link ${navActive === n.key ? "pcd-nav-link-active" : ""}`}
              onClick={() => { setSelectedEvent(null); setScreen(n.key); }}>
              {n.label}
            </span>
          ))}
        </div>
        <span className="pcd-nav-cta" onClick={onRecord}>＋ Runを記録</span>
      </nav>

      <main className="pcd-main">
        {screen === "home" && isLoading && <div className="pcd-loading">読み込み中...</div>}
        {screen === "home" && !isLoading && <>
          <div className="pcd-page-header">
            <div className="pcd-page-title">ダッシュボード</div>
            <div className="pcd-page-sub">{yr}年{parseInt(mo)}月</div>
          </div>
          <div className="pcd-stats">
            {[
              { val: fmtSigned(month.balance) + " G", cls: month.balance >= 0 ? "pos" : "neg", label: "今月のジェム収支" },
              { val: month.winRate !== null ? month.winRate + "%" : "—", cls: "", label: "今月の勝率" },
              { val: String(month.wins + month.losses), cls: "", label: "今月の総対戦数" },
              { val: String(month.count), cls: "", label: "今月のRun数" },
            ].map(x => (
              <div key={x.label} className="pcd-stat">
                <div className={`pcd-stat-val ${x.cls}`}>{x.val}</div>
                <div className="pcd-stat-key">{x.label}</div>
              </div>
            ))}
          </div>
          <div className="pcd-actions">
            <div className="pcd-action pcd-action-primary" onClick={onRecord}>
              <div className="pcd-action-icon">🎮</div>
              <div className="pcd-action-title">Runを記録</div>
              <div className="pcd-action-desc">種別を選んで1Runずつ記録</div>
            </div>
            <div className="pcd-action" onClick={() => setScreen("record")}>
              <div className="pcd-action-icon">🏁</div>
              <div className="pcd-action-title">期間イベントを開始</div>
              <div className="pcd-action-desc">アリーナダイレクト等のRunをまとめて集計</div>
            </div>
          </div>
          {openEvents.length > 0 && <>
            <div className="pcd-section-header"><div className="pcd-section-title">進行中の期間イベント</div></div>
            <div className="pcd-table" style={{ marginBottom: 24 }}>
              {openEvents.map(ev => {
                const sum = summarizeRuns(runs.filter(r => r.eventId === ev.id));
                return (
                  <div key={ev.id} className="pcd-table-row" style={{ cursor: "pointer" }} onClick={() => onOpenEvent(ev)}>
                    <span className="pcd-ev-name">{ev.type}</span>
                    <span className="pcd-ev-date">{ev.date}〜</span>
                    <span className="pcd-ev-record">{sum.wins}勝 {sum.losses}敗</span>
                    <span className="pcd-ev-runs">{sum.count} Run</span>
                    <span className={`pcd-ev-balance ${sum.balance >= 0 ? "pos" : "neg"}`}>{fmtSigned(sum.balance)} G</span>
                  </div>
                );
              })}
            </div>
          </>}
          <div className="pcd-section-header">
            <div className="pcd-section-title">今日のRun（{todayRuns.length}）</div>
            <span className="pcd-section-link" onClick={() => setScreen("history")}>履歴を見る →</span>
          </div>
          <PCRunTable runs={todayRuns} labelOf={r => r.eventType} onEditRun={onEditRun} />
        </>}

        {screen === "record" && (
          <PCRecordSetup eventTypes={eventTypes} onNewEvent={onNewEvent} setScreen={setScreen}
            openEvents={openEvents} onOpenEvent={onOpenEvent} isSyncing={isSyncing} />
        )}

        {screen === "manage-types" && (
          <PCEventTypeManager eventTypes={eventTypes} onSave={onSaveEventTypes} setScreen={setScreen} />
        )}

        {screen === "summary" && activeEvent && (
          <PCEventSummary
            event={activeEvent}
            onAddRun={onAddRun}
            onFinish={onFinish}
            onBack={onSummaryBack}
            onDeleteRun={onDeleteRun}
            onEditRun={onEditRunIndex}
            isSyncing={isSyncing}
          />
        )}

        {screen === "run" && runEntryProps && <PCRunEntry key={entryKey} {...runEntryProps} header={runEntryProps.pcHeader} />}

        {screen === "history" && !selectedEvent && <>
          <div className="pcd-page-header">
            <div className="pcd-page-title">履歴</div>
            <div className="pcd-preset-row">
              {[["month", "月別"], ["event", "イベント"]].map(([k, l]) => (
                <button key={k} className={`pcd-preset-btn ${historyTab === k ? "pcd-preset-active" : ""}`} onClick={() => setHistoryTab(k)}>{l}</button>
              ))}
            </div>
          </div>
          {historyTab === "month"
            ? <PCMonthly runs={runs} sel={monthSel} setSel={setMonthSel} onEditRun={onEditRun} />
            : <EventTable evs={events} />}
        </>}

        {screen === "history" && selectedEvent && (
          <PCEventDetail
            event={selectedEvent}
            runs={eventRuns}
            runsLoading={runsLoading}
            onBack={() => setSelectedEvent(null)}
            onEdit={onEditEvent}
            onDelete={handleDeleteEvent}
          />
        )}
      </main>
    </div>
  );
}

// ===== MAIN APP =====
function loadLastType() {
  try { return localStorage.getItem("mtg-lastRunType") || null; } catch { return null; }
}

export default function App() {
  const [runs, setRuns] = useState([]);              // 全Run（新しい順）
  const [openEvents, setOpenEvents] = useState([]);  // 進行中の期間イベント
  const [isLoading, setIsLoading] = useState(true);
  const [summaryEventId, setSummaryEventId] = useState(null); // サマリー表示中の期間イベント
  const [editingEvent, setEditingEvent] = useState(null);     // 履歴から編集中のイベント（ローカル編集→まとめて保存）
  // Run入力画面の状態: {mode:"new",type,fixed,returnTo} | {mode:"edit",run,returnTo} | {mode:"add-local"} | {mode:"edit-local",index}
  const [entry, setEntry] = useState(null);
  const [screen, setScreenRaw] = useState("home");
  const [eventTypes, setEventTypes] = useState(loadEventTypes);
  const [lastType, setLastType] = useState(loadLastType);
  const [historyTab, setHistoryTab] = useState("month");
  const [monthSel, setMonthSel] = useState(null);
  const [toast, setToast] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewerIds, setViewerIds] = useState(null); // 拡大表示中の画像id
  // 画面遷移のたびにRun入力状態を解除（ナビ経由で離れた場合も含む）。Run入力へ入る時は遷移後に再設定する
  const setScreen = useCallback((next) => { setEntry(null); setScreenRaw(next); }, []);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const reload = useCallback(async () => {
    const [rs, evs] = await Promise.all([fetchAllRuns(), fetchOpenEvents()]);
    setRuns(rs);
    setOpenEvents(evs);
  }, []);

  useEffect(() => {
    reload()
      .catch(() => showToast("データの取得に失敗しました", true))
      .finally(() => setIsLoading(false));
  }, [reload, showToast]);

  const handleSaveEventTypes = (types) => {
    setEventTypes(types);
    saveEventTypesToStorage(types);
  };

  // ----- 種別まわり -----
  const allTypes = [...new Set([
    ...openEvents.map(e => e.type),
    lastType,
    ...eventTypes.map(t => t.label),
    ...runs.map(r => r.eventType),
  ].filter(Boolean))];

  const typeCfg = (label) => {
    const ev = openEvents.find(e => e.type === label);
    if (ev) return { label, gemCost: ev.gemCost, maxWins: ev.maxWins || 7, maxLosses: ev.maxLosses || 3, boxType: ev.boxType, boxName: ev.boxName || "" };
    const et = eventTypes.find(t => t.label === label);
    if (et) return { label, gemCost: et.gemCost || 0, maxWins: et.maxWins || 7, maxLosses: et.maxLosses || 3, boxType: et.boxType || null, boxName: et.boxName || "" };
    const last = runs.find(r => r.eventType === label);
    if (last) return { label, gemCost: last.gemCost || 0, maxWins: last.maxWins || 7, maxLosses: last.maxLosses || 3, boxType: null, boxName: "" };
    return { label, gemCost: 0, maxWins: 7, maxLosses: 3, boxType: null, boxName: "" };
  };

  // ----- 期間イベント（サマリー表示 / 履歴編集） -----
  const summaryEvent = openEvents.find(e => e.id === summaryEventId);
  const activeEvent = editingEvent ?? (summaryEvent ? {
    type: summaryEvent.type, gemCost: summaryEvent.gemCost,
    boxType: summaryEvent.boxType || null, boxName: summaryEvent.boxName || "",
    date: summaryEvent.date, maxLosses: summaryEvent.maxLosses || 3, maxWins: summaryEvent.maxWins || 7,
    eventId: summaryEvent.id,
    runs: runs.filter(r => r.eventId === summaryEvent.id).sort((a, b) => (a.runIndex || 0) - (b.runIndex || 0)),
  } : null);

  const handleOpenEvent = (ev) => {
    setEditingEvent(null);
    setSummaryEventId(ev.id);
    setScreen("summary");
  };

  const handleNewEvent = async (type, gemCost, boxType, boxName, maxLosses, maxWins) => {
    setIsSyncing(true);
    try {
      const eventId = await createEventInDB(
        type, gemCost, toJSTDateString(), maxLosses || 3, maxWins || 7,
        boxType || null, boxName || null
      );
      await reload();
      setEditingEvent(null);
      setSummaryEventId(eventId);
      setScreen("summary");
    } catch {
      showToast("イベントの作成に失敗しました", true);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleEditEvent = (ev, evRuns) => {
    setEditingEvent({
      type: ev.type, gemCost: ev.gemCost, boxType: null, boxName: "", date: ev.date,
      maxLosses: ev.maxLosses || 3, maxWins: ev.maxWins || 7,
      runs: evRuns, isEditing: true, eventId: ev.id, deletedRunIds: [],
    });
    setScreen("summary");
  };

  const handleDeleteRunFromEdit = (run) => {
    setEditingEvent(prev => ({
      ...prev,
      runs: prev.runs.filter(r => r !== run),
      deletedRunIds: run.id ? [...(prev.deletedRunIds || []), run.id] : (prev.deletedRunIds || []),
    }));
  };

  const handleSummaryBack = () => {
    if (editingEvent) { setEditingEvent(null); setScreen("history"); }
    else setScreen("home");
  };

  const handleFinishEvent = async () => {
    if (!activeEvent) return;
    const isEditing = !!activeEvent.isEditing;
    setIsSyncing(true);
    try {
      if (isEditing) {
        for (const id of (activeEvent.deletedRunIds || []))
          await deleteRunFromDB(id);
        const existingRuns = activeEvent.runs.filter(r => r.id);
        const newRuns = activeEvent.runs.filter(r => !r.id);
        for (const r of existingRuns.filter(r => r.isModified))
          await updateRunInDB(r.id, r);
        const baseIndex = nextRunIndex(existingRuns) - 1;
        for (let i = 0; i < newRuns.length; i++)
          await createRunInNotion(newRuns[i], activeEvent.eventId, baseIndex + i + 1);
        await updateEventInNotion(activeEvent.eventId);
        showToast("✓ 更新しました！");
      } else {
        await completeEventInDB(activeEvent.eventId);
        showToast("✓ 期間イベントを終了しました");
      }
      await reload();
    } catch {
      showToast("エラーが発生しました", true);
      setIsSyncing(false);
      return;
    }
    setIsSyncing(false);
    setEditingEvent(null);
    setSummaryEventId(null);
    setRefreshKey(k => k + 1);
    setScreen(isEditing ? "history" : "home");
  };

  // ----- Run入力 -----
  const openRecord = (type = null, fixed = false, returnTo = "home") => {
    const t = type || lastType || allTypes[0] || null;
    setScreen("run");
    setEntry({ mode: "new", type: t, fixed, returnTo });
  };

  const handleStartEditRun = (run, returnTo) => {
    setScreen("run");
    setEntry({ mode: "edit", run, returnTo });
  };

  // サマリー画面の「修正」（インデックス指定）
  const handleSummaryEditRun = (index) => {
    if (editingEvent) { setScreen("run"); setEntry({ mode: "edit-local", index }); }
    else handleStartEditRun(activeEvent.runs[index], "summary");
  };

  const handleSummaryAddRun = () => {
    if (editingEvent) { setScreen("run"); setEntry({ mode: "add-local" }); }
    else openRecord(activeEvent.type, true, "summary");
  };

  const leaveEntry = () => {
    const back = entry?.returnTo || "summary";
    setScreen(back);
  };

  const handleSaveRun = async (runData, images) => {
    if (!entry) return;
    const hasImageChanges = images && (images.added.length || images.removed.length);
    if (entry.mode === "add-local") {
      setEditingEvent(prev => ({ ...prev, runs: [...prev.runs, runData] }));
      leaveEntry();
      return;
    }
    if (entry.mode === "edit-local") {
      // 画像は成績とは独立しているので、イベントの一括保存を待たずにすぐ反映する
      const target = editingEvent.runs[entry.index];
      let imageIds = target.imageIds;
      if (hasImageChanges && target.id) {
        setIsSyncing(true);
        try {
          await applyImageChanges(target.id, images);
          const fresh = await fetchAllRuns();
          setRuns(fresh);
          imageIds = fresh.find(r => r.id === target.id)?.imageIds ?? imageIds;
        } catch {
          showToast("画像の保存に失敗しました。再度お試しください。", true);
          return;
        } finally {
          setIsSyncing(false);
        }
      }
      setEditingEvent(prev => ({
        ...prev,
        runs: prev.runs.map((r, i) => i === entry.index ? { ...r, ...runData, imageIds, ...(r.id ? { isModified: true } : {}) } : r),
      }));
      leaveEntry();
      return;
    }
    setIsSyncing(true);
    try {
      if (entry.mode === "new") {
        const res = await createRunInDB(runData, typeCfg(entry.type));
        setLastType(entry.type);
        try { localStorage.setItem("mtg-lastRunType", entry.type); } catch { /* 保存できなくても動作に影響なし */ }
        try {
          await applyImageChanges(res.id, images);
          showToast(res.eventId ? "✓ Runを保存しました（期間イベントに追加）" : "✓ Runを保存しました");
        } catch {
          // Run自体は保存済み。画像だけ失敗した場合は「修正」から付け直せる
          showToast("Runは保存しましたが、画像の保存に失敗しました。「修正」から追加し直してください。", true);
        }
      } else {
        await updateRunInDB(entry.run.id, runData);
        await applyImageChanges(entry.run.id, images);
        showToast("✓ Runを修正しました");
      }
      await reload();
      setRefreshKey(k => k + 1);
      leaveEntry();
    } catch {
      showToast("Runの保存に失敗しました。再度お試しください。", true);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteEntryRun = async () => {
    if (entry.mode === "edit-local") {
      handleDeleteRunFromEdit(editingEvent.runs[entry.index]);
      leaveEntry();
      return;
    }
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_URL}/api/runs/${entry.run.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await reload();
      setRefreshKey(k => k + 1);
      showToast("✓ Runを削除しました");
      leaveEntry();
    } catch {
      showToast("Runの削除に失敗しました。再度お試しください。", true);
    } finally {
      setIsSyncing(false);
    }
  };

  // Run入力画面に渡すprops（スマホ・PC共通）
  let runEntryProps = null;
  let entryKey = "none";
  if (entry && (entry.mode === "new" || entry.mode === "edit")) {
    const isEdit = entry.mode === "edit";
    const type = isEdit ? entry.run.eventType : entry.type;
    const base = typeCfg(type);
    const cfg = isEdit
      ? { ...base, gemCost: entry.run.gemCost ?? base.gemCost, maxWins: entry.run.maxWins || base.maxWins, maxLosses: entry.run.maxLosses || base.maxLosses }
      : base;
    const attach = isEdit ? null : openEvents.find(e => e.type === type);
    const sameType = runs.filter(r => r.eventType === type && (!isEdit || r.id !== entry.run.id));
    const monthKey = toJSTDateString().slice(0, 7);
    const runIndex = isEdit ? null
      : attach ? runs.filter(r => r.eventId === attach.id).length + 1
      : sameType.filter(r => runJSTDate(r).startsWith(monthKey)).length + 1;
    const note = isEdit
      ? `${runJSTDate(entry.run)} のRun`
      : [
          `消費 ${(cfg.gemCost || 0).toLocaleString()}G / 最大 ${cfg.maxWins}勝${cfg.maxLosses}敗`,
          attach ? `→ 期間イベント「${attach.type}（${attach.date}〜）」に追加されます` : `今月 ${runIndex} 回目`,
        ].join("\n");
    const pickerProps = {
      types: allTypes, value: type, fixed: isEdit || entry.fixed, note,
      onChange: (t) => setEntry(prev => ({ ...prev, type: t })),
    };
    entryKey = isEdit ? `edit-${entry.run.id}` : `new-${type}`;
    runEntryProps = {
      runIndex, initialRun: isEdit ? entry.run : null,
      header: <TypePicker {...pickerProps} />, pcHeader: <TypePicker {...pickerProps} pc />,
      onSave: handleSaveRun, onDelete: isEdit ? handleDeleteEntryRun : null, onBack: leaveEntry,
      boxType: cfg.boxType, boxName: cfg.boxName || "", maxWins: cfg.maxWins, maxLosses: cfg.maxLosses,
      previousRuns: sameType, isSyncing,
    };
  } else if (entry && editingEvent) {
    const editingRun = entry.mode === "edit-local" ? editingEvent.runs[entry.index] : null;
    entryKey = editingRun ? `local-${entry.index}` : "local-new";
    runEntryProps = {
      runIndex: editingRun ? entry.index + 1 : editingEvent.runs.length + 1,
      initialRun: editingRun, header: null, pcHeader: null,
      onSave: handleSaveRun, onDelete: editingRun ? handleDeleteEntryRun : null, onBack: leaveEntry,
      boxType: editingEvent.boxType, boxName: editingEvent.boxName || "",
      maxWins: editingEvent.maxWins || 7, maxLosses: editingEvent.maxLosses || 3,
      previousRuns: editingRun ? editingEvent.runs.filter(r => r !== editingRun) : editingEvent.runs,
      isSyncing,
      imagesDisabledNote: editingRun?.id ? null : "画像はイベントを保存したあと、履歴（月別）の「修正」から追加できます。",
    };
  }

  const summaryProps = activeEvent && {
    event: activeEvent, onAddRun: handleSummaryAddRun, onFinish: handleFinishEvent, onBack: handleSummaryBack,
    onDeleteRun: handleDeleteRunFromEdit, onEditRun: handleSummaryEditRun, isSyncing,
  };

  return (
    <ImageViewerContext.Provider value={setViewerIds}>
      <style>{styles}</style>
      {/* スマホ: 既存のダークテーマ（PC時は非表示） */}
      <div className="mobile-app">
        <div className="app">
          <div className="bg-glow" />
          <div className="header">
            <div className="header-title">MTG Arena Tracker</div>
            <div className="header-sub">戦績管理</div>
          </div>
          {isLoading
            ? <div style={{ color: "#ccc", fontSize: 13, padding: "40px 0", textAlign: "center" }}>読み込み中...</div>
            : screen === "home" && <HomeScreen runs={runs} openEvents={openEvents} onRecord={() => openRecord()}
                onOpenEvent={handleOpenEvent} onEditRun={(r) => handleStartEditRun(r, "home")}
                onStartPeriod={() => setScreen("record")} onHistory={() => setScreen("history")} />}
          {screen === "record" && <RecordMenuScreen onNewEvent={handleNewEvent} onBack={() => setScreen("home")} eventTypes={eventTypes} onManageTypes={() => setScreen("manage-types")} isSyncing={isSyncing} />}
          {screen === "manage-types" && <EventTypeManagerScreen eventTypes={eventTypes} onSave={handleSaveEventTypes} onBack={() => setScreen("record")} />}
          {screen === "history" && <HistoryHub tab={historyTab} setTab={setHistoryTab} runs={runs} monthSel={monthSel} setMonthSel={setMonthSel}
            onBack={() => setScreen("home")} onEditEvent={handleEditEvent} onEditRun={(r) => handleStartEditRun(r, "history")} />}
          {screen === "run" && runEntryProps && <RunEntryScreen key={entryKey} {...runEntryProps} />}
          {screen === "summary" && summaryProps && <EventSummaryScreen {...summaryProps} />}
          {toast && <div className={`toast ${toast.isError ? "toast-error" : ""}`}>{toast.msg}</div>}
        </div>
      </div>
      {/* PC: ライトテーマ（スマホ時は非表示） */}
      <PCDemo
        screen={screen} setScreen={setScreen} refreshKey={refreshKey}
        eventTypes={eventTypes} runs={runs} openEvents={openEvents} activeEvent={activeEvent}
        entryKey={entryKey} runEntryProps={runEntryProps}
        onRecord={() => openRecord()} onOpenEvent={handleOpenEvent}
        onNewEvent={handleNewEvent} onFinish={handleFinishEvent} onDeleteRun={handleDeleteRunFromEdit}
        onEditRunIndex={handleSummaryEditRun} onEditRun={(r) => handleStartEditRun(r, screen === "history" ? "history" : "home")}
        onAddRun={handleSummaryAddRun} onSummaryBack={handleSummaryBack}
        isSyncing={isSyncing} onSaveEventTypes={handleSaveEventTypes}
        onEditEvent={handleEditEvent} isLoading={isLoading}
        historyTab={historyTab} setHistoryTab={setHistoryTab} monthSel={monthSel} setMonthSel={setMonthSel}
      />
      {viewerIds && <ImageViewer ids={viewerIds} onClose={() => setViewerIds(null)} />}
    </ImageViewerContext.Provider>
  );
}
