const { Router } = require("express");
const { createEvent, getEvents, getInProgressEvents, recomputeEventTotals, completeEvent, deleteEvent } = require("../db");

const router = Router();

router.get("/", async (req, res) => {
  try {
    const events = await getEvents();
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// /:id より前に登録する必要あり
router.get("/in-progress", async (req, res) => {
  try {
    // 進行中（期間）イベントは種別ごとに複数ありうるので配列で返す
    res.json(await getInProgressEvents());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", async (req, res) => {
  const { eventType, gemCost, date, maxLosses, maxWins, status, boxType, boxName } = req.body;
  if (!eventType || gemCost == null || !date)
    return res.status(400).json({ error: "eventType, gemCost, date は必須です" });
  try {
    const event = await createEvent({ eventType, gemCost, date, maxLosses, maxWins, status, boxType, boxName });
    res.status(201).json(event);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id/complete", async (req, res) => {
  // 集計値はサーバー側でRunから再計算する（bodyの値は使わない）
  try {
    await completeEvent(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    await recomputeEventTotals(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deleteEvent(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
