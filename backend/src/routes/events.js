const { Router } = require("express");
const { createEvent, getEvents, updateEvent } = require("../db");

const router = Router();

router.get("/", async (req, res) => {
  try {
    const events = await getEvents();
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", async (req, res) => {
  const { eventType, gemCost, date, maxLosses } = req.body;
  if (!eventType || gemCost == null || !date)
    return res.status(400).json({ error: "eventType, gemCost, date は必須です" });
  try {
    const event = await createEvent({ eventType, gemCost, date, maxLosses });
    res.status(201).json(event);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", async (req, res) => {
  const { totalRuns, totalWins, gemBalance } = req.body;
  try {
    await updateEvent(req.params.id, { totalRuns, totalWins, gemBalance });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
