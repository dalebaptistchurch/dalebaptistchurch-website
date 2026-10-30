import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { adminUser, unauthorized } from "./_admin-auth.mjs";

const STORE = "candy-guess-2026";
const ACTUAL_COUNT = 193;
const CLOSES_AT = Date.parse("2026-11-01T01:00:00Z");
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (value, maximum) => String(value ?? "").replace(/[<>&"']/g, "").trim().replace(/\s+/g, " ").slice(0, maximum);

async function entries(store) {
  const { blobs } = await store.list();
  const rows = await Promise.all(blobs.filter(x => x.key.startsWith("entry-")).map(x => store.get(x.key, { type: "json", consistency: "strong" })));
  return rows.filter(Boolean).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function publicState(rows) {
  const closed = Date.now() >= CLOSES_AT;
  const eligible = rows.filter(x => x.guess <= ACTUAL_COUNT).sort((a, b) => b.guess - a.guess || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const winner = closed && eligible[0] ? { name: eligible[0].name, guess: eligible[0].guess } : null;
  return { closed, actualCount: closed ? ACTUAL_COUNT : null, winner, entries: rows.map(x => ({ name: x.name, guess: x.guess })) };
}

export default async (request, context) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  try {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const rows = await entries(store);
      if (url.searchParams.get("admin") === "1") {
        if (!adminUser(context)) return unauthorized();
        return json({ ...publicState(rows), entries: rows });
      }
      return json(publicState(rows));
    }
    if (request.method === "POST") {
      if (Date.now() >= CLOSES_AT) return json({ error: "Guessing has closed." }, 409);
      const body = await request.json();
      if (clean(body.bot_field, 20)) return json({ ok: true });
      const name = clean(body.name, 80), phone = clean(body.phone, 30), guess = Number(body.guess);
      if (!name || !phone || !Number.isInteger(guess) || guess < 1 || guess > 9999) return json({ error: "Enter your name, mobile number, and a whole-number guess." }, 400);
      const existing = (await entries(store)).find(x => x.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US") && x.phone === phone);
      if (existing) return json({ error: "You already submitted a guess. Ask a contest administrator if it needs to be corrected." }, 409);
      const row = { id: randomUUID(), name, phone, guess, churchHome: body.churchHome === true || body.churchHome === "yes", createdAt: new Date().toISOString() };
      await store.setJSON(`entry-${row.id}`, row);
      return json({ ok: true, entry: { name, guess }, state: publicState(await entries(store)) });
    }
    if (request.method === "DELETE") {
      if (!adminUser(context)) return unauthorized();
      const id = clean(new URL(request.url).searchParams.get("id"), 80);
      if (!id) return json({ error: "Entry ID required." }, 400);
      await store.delete(`entry-${id}`);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("Candy guess error", error);
    return json({ error: "The contest is temporarily unavailable. Please try again." }, 500);
  }
};
