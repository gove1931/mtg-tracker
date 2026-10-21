const { Router } = require("express");
const { getRunImage, deleteRunImage } = require("../db");

const router = Router();

// 画像は内容が変わらない（差し替え = 削除して追加）のでブラウザに長期キャッシュさせる
async function sendImage(req, res, thumb) {
  try {
    const img = await getRunImage(req.params.id, thumb);
    if (!img) return res.status(404).json({ error: "画像が見つかりません" });
    res.set("Content-Type", img.mime);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(img.bytes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get("/:id", (req, res) => sendImage(req, res, false));
router.get("/:id/thumb", (req, res) => sendImage(req, res, true));

router.delete("/:id", async (req, res) => {
  try {
    await deleteRunImage(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
