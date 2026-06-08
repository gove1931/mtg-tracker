const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const EVENT_DB_ID = process.env.EVENT_DB_ID;
const RUN_DB_ID = process.env.RUN_DB_ID;

// ===== イベントDB =====

async function createEvent({ eventType, gemCost, date }) {
  const eventName = `${date} ${eventType}`;
  const page = await notion.pages.create({
    parent: { database_id: EVENT_DB_ID },
    properties: {
      "イベント名":    { title: [{ text: { content: eventName } }] },
      "イベントタイプ": { select: { name: eventType } },
      "日付":          { date: { start: date } },
      "消費ジェム":    { number: gemCost },
      "総Run数":       { number: 0 },
      "総勝利数":      { number: 0 },
      "ジェム収支":    { number: -gemCost },
    },
  });
  return { id: page.id, name: eventName };
}

async function getEvents() {
  const res = await notion.databases.query({
    database_id: EVENT_DB_ID,
    sorts: [{ property: "日付", direction: "descending" }],
  });
  return res.results.map(pageToEvent);
}

async function updateEvent(pageId, { totalRuns, totalWins, gemBalance }) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "総Run数":    { number: totalRuns },
      "総勝利数":   { number: totalWins },
      "ジェム収支": { number: gemBalance },
    },
  });
}

// ===== 戦績DB =====

async function createRun({ eventPageId, runIndex, wins, prizeType, prizeGem, prizeBoxCount }) {
  const page = await notion.pages.create({
    parent: { database_id: RUN_DB_ID },
    properties: {
      "Run名":      { title: [{ text: { content: `Run ${runIndex}` } }] },
      "勝利数":     { number: wins },
      "プライズ種別": { select: { name: prizeType } },
      "プライズ(ジェム)":   { number: prizeGem || 0 },
      "プライズ(パック数)": { number: prizeBoxCount || 0 },
      "イベントID": { relation: [{ id: eventPageId }] },
    },
  });
  return { id: page.id };
}

async function getRunsByEvent(eventPageId) {
  const res = await notion.databases.query({
    database_id: RUN_DB_ID,
    filter: { property: "イベントID", relation: { contains: eventPageId } },
  });
  return res.results.map(pageToRun);
}

// ===== プロパティ変換ヘルパー =====

function prop(page, key) {
  return page.properties?.[key];
}

function pageToEvent(page) {
  return {
    id:         page.id,
    name:       prop(page, "イベント名")?.title?.[0]?.plain_text || "",
    type:       prop(page, "イベントタイプ")?.select?.name || "",
    date:       prop(page, "日付")?.date?.start || "",
    gemCost:    prop(page, "消費ジェム")?.number || 0,
    totalRuns:  prop(page, "総Run数")?.number || 0,
    totalWins:  prop(page, "総勝利数")?.number || 0,
    gemBalance: prop(page, "ジェム収支")?.number || 0,
  };
}

function pageToRun(page) {
  return {
    id:            page.id,
    name:          prop(page, "Run名")?.title?.[0]?.plain_text || "",
    wins:          prop(page, "勝利数")?.number || 0,
    prizeType:     prop(page, "プライズ種別")?.select?.name || "なし",
    prizeGem:      prop(page, "プライズ(ジェム)")?.number || 0,
    prizeBoxCount: prop(page, "プライズ(パック数)")?.number || 0,
  };
}

module.exports = { createEvent, getEvents, updateEvent, createRun, getRunsByEvent };
