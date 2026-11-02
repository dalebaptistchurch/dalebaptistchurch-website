import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { adminUser, unauthorized } from "./_admin-auth.mjs";

const STORE = "friendsgiving-rsvps-2026";
const CLOSES_AT = Date.parse("2026-11-23T02:30:00Z");
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const clean = (value, maximum) => String(value ?? "")
  .replace(/[<>&"']/g, "")
  .trim()
  .replace(/\s+/g, " ")
  .slice(0, maximum);

async function entries(store) {
  const { blobs } = await store.list();
  const rows = await Promise.all(
    blobs
      .filter((item) => item.key.startsWith("rsvp-"))
      .map((item) => store.get(item.key, { type: "json", consistency: "strong" })),
  );
  return rows.filter(Boolean).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export default async (request, context) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  try {
    const url = new URL(request.url);

    if (request.method === "GET") {
      if (url.searchParams.get("admin") !== "1" || !await adminUser(request, context)) return unauthorized();
      const rsvps = await entries(store);
      return json({ rsvps, count: rsvps.length });
    }

    if (request.method === "POST") {
      if (Date.now() >= CLOSES_AT) return json({ error: "Friendsgiving has ended." }, 409);
      const body = await request.json();
      if (clean(body.bot_field, 20)) return json({ ok: true });
      const name = clean(body.name, 80);
      if (!name) return json({ error: "Please enter your name." }, 400);
      const current = await entries(store);
      if (current.some((entry) => entry.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"))) {
        return json({ error: "That name is already on the RSVP list." }, 409);
      }
      const row = { id: randomUUID(), name, createdAt: new Date().toISOString() };
      await store.setJSON(`rsvp-${row.id}`, row);
      return json({ ok: true, rsvp: row });
    }

    if (request.method === "DELETE") {
      if (!await adminUser(request, context)) return unauthorized();
      const id = clean(url.searchParams.get("id"), 80);
      if (!id) return json({ error: "RSVP ID required." }, 400);
      await store.delete(`rsvp-${id}`);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("Friendsgiving RSVP error", error);
    return json({ error: "The RSVP list is temporarily unavailable. Please try again." }, 500);
  }
};
