const { Router } = require("express");
const { createRun, updateRun, getRunsByEvent, getAllRuns, deleteRun, addRunImage } = require("../db");

const router = Router();

// 全Run（月別集計・今日のRun用）
router.get("/", async (req, res) => {
  try {
    res.json(await getAllRuns());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:eventId", async (req, res) => {
  try {
    const runs = await getRunsByEvent(req.params.eventId);
    res.json(runs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", async (req, res) => {
  const { eventPageId, eventType, gemCost, maxWins, maxLosses,
          wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight } = req.body;
  if (wins == null || !prizeType || (!eventPageId && !eventType))
    return res.status(400).json({ error: "wins, prizeType と eventPageId か eventType のどちらかは必須です" });
  try {
    const run = await createRun({ eventPageId, eventType, gemCost, maxWins, maxLosses,
                                  wins, losses, prizeType, prizeGem, prizeBoxCount, hasRight });
    res.status(201).json(run);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// デッキリスト画像の追加（base64のJPEG本体とサムネイル）
router.post("/:id/images", async (req, res) => {
  const { mime, data, thumb } = req.body;
  if (!data || !thumb || !/^image\/(jpeg|png|webp)$/.test(mime || ""))
    return res.status(400).json({ error: "mime, data, thumb は必須です" });
  try {
    const id = await addRunImage(req.params.id, { mime, data, thumb });
    if (!id) return res.status(404).json({ error: "Runが見つかりません" });
    res.status(201).json({ id });
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
