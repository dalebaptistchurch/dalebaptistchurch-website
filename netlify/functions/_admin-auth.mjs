export function adminUser(context) {
  const user = context?.clientContext?.user;
  return user || null;
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: "Administrator sign-in required." }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
