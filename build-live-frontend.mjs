import fs from "node:fs";
import path from "node:path";

const project = path.resolve(".");
const templatePath = path.resolve(project, "../ai-village-command-template.html");
let html = fs.readFileSync(templatePath, "utf8");
html = html.replace("__MULTI_SNAPSHOT_JSON__", "{}");

const oldRefresh = `    async function refreshLive() {
      if (!location.pathname.startsWith("/village")) { toast("Local preview uses a sanitized snapshot. Live refresh activates on the production /village route."); return; }
      try {
        $("#refresh").textContent = "…";
        const meta = await fetch(\`\${API}/villages?slug=\${encodeURIComponent(state.slug)}\`).then((response) => response.ok ? response.json() : Promise.reject(new Error(\`API \${response.status}\`)));
        const [village,events] = await Promise.all([fetch(\`\${API}/villages/\${meta.id}\`).then((r)=>r.json()),fetch(\`\${API}/events?villageId=\${meta.id}&page=1\`).then((r)=>r.json())]);
        toast(\`Live \${LABELS[state.slug]} data reached successfully. Production shaper can replace the embedded capture.\`);
        console.info("Live village handshake", { id: village.id, agents: village.agents?.length, events: events.events?.length });
      } catch (error) { toast(\`Live refresh unavailable: \${error.message}\`); }
      finally { $("#refresh").textContent = "↻"; }
    }`;
const newRefresh = `    async function loadLive(slug) {
      const response = await fetch(\`/api/village/\${encodeURIComponent(slug)}\`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(\`Live API returned \${response.status}\`);
      return response.json();
    }
    async function refreshLive() {
      try {
        $("#refresh").textContent = "…";
        state.snapshots[state.slug] = await loadLive(state.slug);
        state.data = state.snapshots[state.slug];
        renderAll();
        toast(\`\${LABELS[state.slug]} refreshed from the live API.\`);
      } catch (error) { toast(\`Live refresh unavailable: \${error.message}\`); }
      finally { $("#refresh").textContent = "↻"; }
    }`;
if (!html.includes(oldRefresh)) throw new Error("Could not find the prototype refresh function.");
html = html.replace(oldRefresh, newRefresh);

const oldBoot = `    try {
      state.snapshots = JSON.parse($("#snapshots").textContent);
      if (!state.snapshots[state.slug]) state.slug = "open-chat";
      state.data = state.snapshots[state.slug]; state.selected = state.data.agents[0]?.id || null; bind(); renderAll();
    } catch (error) { $("#mission-title").textContent = \`Village snapshot failed to load: \${error.message}\`; }`;
const newBoot = `    async function bootLive() {
      try {
        if (!LABELS[state.slug]) state.slug = "open-chat";
        state.snapshots = { [state.slug]: await loadLive(state.slug) };
        state.data = state.snapshots[state.slug]; state.selected = state.data.agents[0]?.id || null;
        bind(); renderAll();
        const remaining = Object.keys(LABELS).filter((slug) => slug !== state.slug);
        void Promise.allSettled(remaining.map(async (slug) => { state.snapshots[slug] = await loadLive(slug); renderTabs(); }));
        setInterval(() => { void refreshLive(); }, 30000);
      } catch (error) {
        $("#mission-title").textContent = \`Live village data failed to load: \${error.message}\`;
        $("#capture-label").textContent = "LIVE API UNAVAILABLE";
      }
    }
    void bootLive();`;
if (!html.includes(oldBoot)) throw new Error("Could not find the prototype boot block.");
html = html.replace(oldBoot, newBoot);
html = html.replace("Prototype composer · sending is intentionally disabled outside the production route.", "Live observer · posting remains intentionally disabled until production authentication is wired.");

fs.mkdirSync(path.join(project, "public"), { recursive: true });
fs.writeFileSync(path.join(project, "public/index.html"), html);
process.stdout.write(`${path.join(project, "public/index.html")}\n${Buffer.byteLength(html)} bytes\n`);
