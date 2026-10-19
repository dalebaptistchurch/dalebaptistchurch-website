import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "thanksgiving-2026-signups";
const CATEGORIES = new Set(["Side Dish", "Dessert"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clean(value, maximum) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function signupKey(name) {
  return `signup-${createHash("sha256").update(name.toLocaleLowerCase("en-US")).digest("hex")}`;
}

async function allSignups(store) {
  const { blobs } = await store.list();
  const values = await Promise.all(
    blobs.filter(({ key }) => key.startsWith("signup-")).map(({ key }) => store.get(key, { type: "json", consistency: "strong" })),
  );

  return values
    .filter(Boolean)
    .sort((a, b) => a.category.localeCompare(b.category) || a.item.localeCompare(b.item) || a.name.localeCompare(b.name));
}

export default async (request) => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  try {
    if (request.method === "GET") {
      return json({ signups: await allSignups(store) });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const body = await request.json();
    if (clean(body.bot_field, 20)) return json({ ok: true, signups: await allSignups(store) });

    const name = clean(body.name, 80);
    const item = clean(body.item, 120);
    const category = clean(body.category, 20);

    if (!name || !item || !CATEGORIES.has(category)) {
      return json({ error: "Please provide your name, choose a category, and enter what you are bringing." }, 400);
    }

    const key = signupKey(name);
    const existing = await store.get(key, { type: "json", consistency: "strong" });
    const signup = {
      name,
      item,
      category,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await store.setJSON(key, signup);
    return json({ ok: true, signup, signups: await allSignups(store) });
  } catch (error) {
    console.error("Thanksgiving signup error", error);
    return json({ error: "We could not save that signup right now. Please try again in a moment." }, 500);
  }
};
