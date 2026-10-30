export async function adminUser(request, context) {
  const contextUser = context?.clientContext?.user;
  if (contextUser) return contextUser;

  const authorization = request?.headers?.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;

  try {
    const identityUrl = new URL("/.netlify/identity/user", request.url);
    const response = await fetch(identityUrl, {
      headers: { authorization },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: "Administrator sign-in required." }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
