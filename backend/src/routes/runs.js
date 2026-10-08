const { Router } = require("express");
const { createRun, updateRun, getRunsByEvent, deleteRun } = require("../db");

const router = Router();

router.get("/:eventId", async (req, res) => {
  try {
    const runs = await getRunsByEvent(req.params.eventId);
    res.json(runs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", async (req, res) => {
  const { eventPageId, runIndex, wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight } = req.body;
  if (!eventPageId || runIndex == null || wins == null || !prizeType)
    return res.status(400).json({ error: "eventPageId, runIndex, wins, prizeType は必須です" });
  try {
    const run = await createRun({ eventPageId, runIndex, wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight });
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", async (req, res) => {
  const { wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight } = req.body;
  if (wins == null || !prizeType)
    return res.status(400).json({ error: "wins, prizeType は必須です" });
  try {
    const count = await updateRun(req.params.id, { wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight });
    if (!count) return res.status(404).json({ error: "Runが見つかりません" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deleteRun(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
