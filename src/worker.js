const UPSTREAM = "https://theaidigest.org/village/api";
const ALLOWED_SLUGS = new Set(["actual-launch-1", "open-chat", "swarm"]);
const MAX_METADATA_BYTES = 512_000;
const MAX_VILLAGE_BYTES = 7_000_000;

function jsonResponse(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function readJsonLimited(response, maxBytes) {
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) throw new Error("Upstream response exceeded the safety limit");
  if (!response.body) throw new Error("Upstream response had no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel("response too large");
      throw new Error("Upstream response exceeded the safety limit");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

async function fetchJson(url, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("upstream timeout"), 12_000);
  try {
    return await readJsonLimited(await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } }), maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

const safeText = (value, limit = 900) => String(value ?? "")
  .replace(/\b10(?:\.\d{1,3}){3}\b/g, "[private address redacted]")
  .replace(/\b192\.168(?:\.\d{1,3}){2}\b/g, "[private address redacted]")
  .replace(/\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b/g, "[private address redacted]")
  .replace(/\b127(?:\.\d{1,3}){3}\b/g, "[local address redacted]")
  .slice(0, limit);

export function shapeVillage(village, datesPayload = {}, capturedAt = new Date().toISOString()) {
  const agents = (village.agents ?? []).filter((agent) => agent.isParticipating);
  const messages = [...(village.chatMessages ?? [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const rooms = (village.chatRooms ?? []).map((room) => ({
    id: room.id,
    name: safeText(room.name, 80),
    agentCount: agents.filter((agent) => agent.currentRoomId === room.id).length,
  }));
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const lastMessageByAgent = new Map();
  for (const message of messages) {
    if (message.agentSpeakerId && !lastMessageByAgent.has(String(message.agentSpeakerId))) lastMessageByAgent.set(String(message.agentSpeakerId), message);
  }
  const agentGoals = new Map();
  for (const goal of village.agentGoals ?? []) {
    const prior = agentGoals.get(String(goal.agentId));
    if (!prior || String(goal.createdAt ?? "") > String(prior.createdAt ?? "")) agentGoals.set(String(goal.agentId), goal);
  }
  const goals = [...(village.villageGoals ?? [])].sort((a, b) => String(b.startTime ?? b.createdAt).localeCompare(String(a.startTime ?? a.createdAt)));
  const currentGoal = goals.find((goal) => !goal.endTime) ?? goals[0] ?? null;
  const safeAgents = agents.map((agent) => {
    const message = lastMessageByAgent.get(String(agent.id));
    const goal = agentGoals.get(String(agent.id));
    return {
      id: agent.id,
      name: safeText(agent.name, 120),
      emoji: safeText(agent.emoji, 12),
      model: safeText(agent.modelString, 160),
      statusMessage: safeText(agent.statusMessage, 260),
      isPending: Boolean(agent.isPending),
      isUpdatingMemory: Boolean(agent.isUpdatingMemory),
      isPausedForGoogleSignIn: Boolean(agent.isPausedForGoogleSignIn),
      pausedUntil: agent.pausedUntil,
      inputTokens: Number(agent.inputTokensUsed ?? 0),
      outputTokens: Number(agent.outputTokensUsed ?? 0),
      money: agent.money,
      roomId: agent.currentRoomId,
      room: roomNames.get(agent.currentRoomId) ?? "unknown",
      assignedGoal: {
        name: safeText(goal?.name ?? goal?.shortName, 180),
        shortName: safeText(goal?.shortName ?? goal?.name, 140),
        description: safeText(goal?.description, 760),
      },
      session: null,
      lastMessage: message ? { content: safeText(message.content, 680), createdAt: message.createdAt, roomId: message.roomId } : null,
      lastEvent: message ? { type: "CHAT_MESSAGE", createdAt: message.createdAt } : null,
    };
  });
  const shaped = {
    meta: {
      source: "AI Village public read-only API via Cloudflare Worker",
      capturedAt,
      sourceUpdatedAt: village.updatedAt,
      windowDate: capturedAt.slice(0, 10),
      live: true,
      refreshSeconds: 30,
      safety: "Infrastructure addresses and runner URLs are excluded; private IPs are redacted from retained text.",
    },
    village: {
      id: village.id,
      slug: village.slug,
      schedule: village.schedule,
      isChatOpen: village.isChatOpen,
      activeAgentId: village.activeAgentId,
      currentGoal: currentGoal ? { id: currentGoal.id, goal: safeText(currentGoal.goal, 520), startTime: currentGoal.startTime, endTime: currentGoal.endTime } : null,
      goals: goals.slice(0, 80).map((goal) => ({ id: goal.id, goal: safeText(goal.goal, 520), startTime: goal.startTime, endTime: goal.endTime })),
      activeDates: datesPayload.dates ?? [],
      rooms,
    },
    counts: { agents: safeAgents.length, sessions: 0, messages: messages.length, events: 0, eventTypes: {} },
    agents: safeAgents,
    messages: messages.slice(0, 450).map((message) => ({
      id: message.id,
      agentId: message.agentSpeakerId ?? null,
      userId: message.userSpeakerId ?? null,
      speakerType: message.speakerType,
      content: safeText(message.content, 760),
      roomId: message.roomId,
      createdAt: message.createdAt,
    })),
    events: [],
  };
  return shaped;
}

async function fetchVillage(slug) {
  const metadata = await fetchJson(`${UPSTREAM}/villages?slug=${encodeURIComponent(slug)}`, MAX_METADATA_BYTES);
  if (!metadata?.id) throw new Error("Village metadata did not include an id");
  console.log(JSON.stringify({ event: "village_metadata_loaded", slug }));
  const [village, dates] = await Promise.all([
    fetchJson(`${UPSTREAM}/villages/${encodeURIComponent(metadata.id)}`, MAX_VILLAGE_BYTES),
    fetchJson(`${UPSTREAM}/villages/${encodeURIComponent(metadata.id)}/active-dates`, MAX_METADATA_BYTES),
  ]);
  console.log(JSON.stringify({ event: "village_payload_loaded", slug }));
  return shapeVillage(village, dates);
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: { allow: "GET, HEAD" } });
    if (url.pathname === "/health") return jsonResponse({ ok: true, service: "ai-village-live-observer" }, { headers: { "cache-control": "no-store" } });
    const match = url.pathname.match(/^\/api\/village\/([^/]+)$/);
    if (match) {
      const slug = decodeURIComponent(match[1]);
      if (!ALLOWED_SLUGS.has(slug)) return jsonResponse({ error: "Unknown village" }, { status: 404 });
      const cacheKey = new Request(`${url.origin}/api/village/${encodeURIComponent(slug)}`, { method: "GET" });
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      try {
        const data = await fetchVillage(slug);
        const response = jsonResponse(data, { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" } });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch (error) {
        console.error(JSON.stringify({ event: "village_fetch_failed", slug, message: error instanceof Error ? error.message : String(error) }));
        return jsonResponse({ error: "Live village data is temporarily unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
      }
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
