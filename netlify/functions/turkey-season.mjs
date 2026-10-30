import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { adminUser, unauthorized } from "./_admin-auth.mjs";

const STORE = "turkey-season-2026";
const REGISTRATION_CLOSE = Date.parse("2026-11-05T06:00:00Z");
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (value, maximum) => String(value ?? "").replace(/[<>&"']/g, "").trim().replace(/\s+/g, " ").slice(0, maximum);
const playerKey = id => `player-${id}`;
const normalize = value => clean(value, 80).toLocaleLowerCase("en-US");
const hashPin = (pin, salt = randomBytes(16).toString("hex")) => ({ salt, hash: scryptSync(pin, salt, 32).toString("hex") });
const validPin = (pin, player) => { try { return timingSafeEqual(Buffer.from(hashPin(pin, player.pinSalt).hash, "hex"), Buffer.from(player.pinHash, "hex")); } catch { return false; } };
const publicPlayer = p => ({ id: p.id, name: p.name, approved: p.approved, disqualified: p.disqualified, suspendedUntil: p.suspendedUntil || null });

async function state(store) {
  return await store.get("state", { type: "json", consistency: "strong" }) || { turkeys: Object.fromEntries([1,2,3,4,5,6].map(n => [n, { active: true, holderId: null }])), endedAt: null, finalHolders: null, winners: {}, cooldowns: {} };
}
async function players(store) {
  const { blobs } = await store.list();
  const rows = await Promise.all(blobs.filter(x => x.key.startsWith("player-")).map(x => store.get(x.key, { type: "json", consistency: "strong" })));
  return rows.filter(Boolean).sort((a,b) => a.name.localeCompare(b.name));
}
async function findPlayer(store, name) { return (await players(store)).find(p => normalize(p.name) === normalize(name)); }
async function history(store) {
  const { blobs } = await store.list();
  const rows = await Promise.all(blobs.filter(x => x.key.startsWith("history-")).map(x => store.get(x.key, { type: "json", consistency: "strong" })));
  return rows.filter(Boolean).sort((a,b) => Date.parse(b.at) - Date.parse(a.at));
}
async function record(store, action) { const at = new Date().toISOString(); await store.setJSON(`history-${at}-${randomBytes(4).toString("hex")}`, { ...action, at }); }

export default async (request, context) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  try {
    const url = new URL(request.url), action = url.searchParams.get("action") || "status";
    if (request.method === "GET" && action === "status") {
      const s = await state(store);
      return json({ registrationOpen: Date.now() < REGISTRATION_CLOSE, ended: Boolean(s.endedAt), turkeyCount: Object.values(s.turkeys).filter(x => x.active).length });
    }
    if (request.method === "GET" && action === "admin") {
      if (!await adminUser(request, context)) return unauthorized();
      return json({ state: await state(store), players: (await players(store)).map(p => ({ ...publicPlayer(p), createdAt: p.createdAt })), history: await history(store) });
    }
    const body = request.method === "POST" ? await request.json() : {};
    if (request.method === "POST" && action === "register") {
      if (Date.now() >= REGISTRATION_CLOSE) return json({ error: "Registration closed when November 5 began." }, 409);
      if (clean(body.bot_field, 20)) return json({ ok: true });
      const name = clean(body.name, 80), pin = clean(body.pin, 4);
      if (!name || !/^\d{4}$/.test(pin)) return json({ error: "Enter your name and an exactly four-digit PIN." }, 400);
      if (await findPlayer(store, name)) return json({ error: "That name is already registered. Ask Doug if you need help with your PIN." }, 409);
      const id = randomBytes(10).toString("hex"), secured = hashPin(pin), player = { id, name, pinSalt: secured.salt, pinHash: secured.hash, approved: false, disqualified: false, suspendedUntil: null, failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString() };
      await store.setJSON(playerKey(id), player); await record(store, { type: "registered", playerId: id, playerName: name });
      return json({ ok: true, message: "Registration received. A youth leader must approve you before you can claim a turkey." });
    }
    if (request.method === "POST" && action === "claim") {
      const name = clean(body.name, 80), pin = clean(body.pin, 4), number = Number(body.turkey);
      if (!Number.isInteger(number) || number < 1 || number > 6) return json({ error: "Choose Turkey #1–6." }, 400);
      const player = await findPlayer(store, name);
      if (!player) return json({ error: "Name or PIN is incorrect." }, 401);
      if (player.lockedUntil && Date.now() < Date.parse(player.lockedUntil)) return json({ error: "Too many incorrect attempts. Try again in ten minutes." }, 429);
      if (!validPin(pin, player)) {
        player.failedAttempts = (player.failedAttempts || 0) + 1;
        if (player.failedAttempts >= 5) { player.failedAttempts = 0; player.lockedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString(); }
        await store.setJSON(playerKey(player.id), player);
        return json({ error: "Name or PIN is incorrect." }, 401);
      }
      if (player.failedAttempts || player.lockedUntil) { player.failedAttempts = 0; player.lockedUntil = null; await store.setJSON(playerKey(player.id), player); }
      if (!player.approved) return json({ error: "Your registration has not been approved yet." }, 403);
      if (player.disqualified) return json({ error: "You are not eligible to play." }, 403);
      if (player.suspendedUntil && Date.now() < Date.parse(player.suspendedUntil)) return json({ error: "You are currently suspended." }, 403);
      const s = await state(store);
      if (s.endedAt) return json({ error: "Turkey Season has ended." }, 409);
      if (!s.turkeys[number]?.active) return json({ error: "That turkey is no longer active." }, 409);
      if (Object.values(s.turkeys).some(t => t.holderId === player.id)) return json({ error: "You already possess a turkey." }, 409);
      const cooldown = s.cooldowns?.[number]?.[player.id];
      if (cooldown && Date.now() < Date.parse(cooldown)) return json({ error: "That turkey is still off-limits to you for one hour." }, 409);
      const previous = s.turkeys[number].holderId;
      s.turkeys[number].holderId = player.id;
      if (previous) { s.cooldowns[number] ||= {}; s.cooldowns[number][previous] = new Date(Date.now() + 60 * 60 * 1000).toISOString(); }
      await store.setJSON("state", s); await record(store, { type: "claimed", turkey: number, playerId: player.id, playerName: player.name, previousHolderId: previous });
      return json({ ok: true, message: `Turkey #${number} is now registered to ${player.name}.` });
    }
    if (request.method === "POST" && action === "admin") {
      if (!await adminUser(request, context)) return unauthorized();
      const s = await state(store), list = await players(store), command = clean(body.command, 30), id = clean(body.playerId, 40), player = list.find(p => p.id === id), number = Number(body.turkey);
      if (command === "approve" && player) player.approved = true;
      else if (command === "suspend" && player) { player.suspendedUntil = new Date(Date.now() + 3 * 86400000).toISOString(); Object.values(s.turkeys).forEach(t => { if (t.holderId === player.id) t.holderId = null; }); }
      else if (command === "disqualify" && player) { player.disqualified = true; Object.values(s.turkeys).forEach(t => { if (t.holderId === player.id) t.holderId = null; }); }
      else if (command === "reset-pin" && player && /^\d{4}$/.test(clean(body.pin,4))) { const secured=hashPin(clean(body.pin,4)); player.pinSalt=secured.salt; player.pinHash=secured.hash; }
      else if (command === "remove-turkey" && s.turkeys[number]) { s.turkeys[number].active=false; s.turkeys[number].holderId=null; }
      else if (command === "restore-turkey" && s.turkeys[number]) s.turkeys[number].active=true;
      else if (command === "assign" && s.turkeys[number] && player) { Object.values(s.turkeys).forEach(t => { if(t.holderId===player.id)t.holderId=null; }); s.turkeys[number].active=true; s.turkeys[number].holderId=player.id; }
      else if (command === "end") { s.endedAt=new Date().toISOString(); s.finalHolders=Object.fromEntries(Object.entries(s.turkeys).map(([n,t])=>[n,t.holderId])); }
      else if (command === "confirm-winner" && s.endedAt && s.finalHolders?.[number]) { s.winners ||= {}; s.winners[number] = true; }
      else return json({ error: "Invalid administrative action." }, 400);
      if (player) await store.setJSON(playerKey(player.id), player);
      await store.setJSON("state", s); await record(store, { type: `admin-${command}`, playerId: player?.id || null, playerName: player?.name || null, turkey: Number.isInteger(number) ? number : null });
      return json({ ok: true });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("Turkey Season error", error);
    return json({ error: "Turkey Season is temporarily unavailable. Please try again." }, 500);
  }
};
