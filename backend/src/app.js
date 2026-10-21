require("dotenv").config();
const express = require("express");
const cors = require("cors");
const eventsRouter = require("./routes/events");
const runsRouter = require("./routes/runs");
const imagesRouter = require("./routes/images");

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" })); // デッキリスト画像（base64）を受けるため

app.get("/health", (_, res) => res.json({ ok: true }));
app.use("/api/events", eventsRouter);
app.use("/api/runs", runsRouter);
app.use("/api/images", imagesRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
