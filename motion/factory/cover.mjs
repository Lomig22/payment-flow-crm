// Couvertures standardisées des reels @paymentflow (VPS) : pour chaque reel programmé sans couverture,
// le CRM donne l'accroche ; on la met en page (cover/index.html), on prend l'image et on la dépose.
// Usage : node cover.mjs [nombre max]   (CRM_URL et CRON_SECRET en variables d'environnement)
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CRM = process.env.CRM_URL ?? "https://payment-flow-crm-delta.vercel.app";
const KEY = process.env.CRON_SECRET;
const HF = process.env.HYPERFRAMES ?? "hyperframes@0.8.157";
const MAX = Number(process.argv[2] ?? 20);
if (!KEY) { console.error("CRON_SECRET manquant"); process.exit(1); }

const api = async (method, query, body) => {
  const r = await fetch(`${CRM}/api/cron/agency-reels${query}`, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${query} : ${r.status} ${j.message ?? ""}`);
  return j;
};
const log = (...a) => console.log(new Date().toISOString(), "[couverture]", ...a);

for (let n = 0; n < MAX; n++) {
  const { cover } = await api("GET", "?action=cover_next");
  if (!cover) { log("aucune couverture à faire"); break; }
  const dir = join(HERE, "work", `cover-${cover.queue_id}`);
  try {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(join(HERE, "cover", "index.html"), join(dir, "index.html"));
    for (const f of ["base.css", "base.js", "logo.png"]) cpSync(join(HERE, "shared", f), join(dir, f));
    cpSync(join(HERE, "shared", "fonts"), join(dir, "fonts"), { recursive: true });
    writeFileSync(join(dir, "data.js"), `window.__PF_COVER = ${JSON.stringify({ tag: cover.tag, text: cover.text })};\n`);
    execFileSync("npx", ["--yes", HF, "snapshot", "--at", "0.5", "--no-end", "-o", "snap", "."], { cwd: dir, stdio: ["ignore", "ignore", "inherit"], timeout: 120_000 });
    const png = readdirSync(join(dir, "snap")).find((f) => f.endsWith(".png") && f.startsWith("frame"));
    if (!png) throw new Error("image non produite");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "snap", png), "-q:v", "3", join(dir, "cover.jpg")]);
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", new Blob([readFileSync(join(dir, "cover.jpg"))], { type: "image/jpeg" }), "cover.jpg");
    const up = await fetch(cover.upload_url, { method: "PUT", headers: { "x-upsert": "true" }, body: form });
    if (!up.ok) throw new Error(`dépôt : HTTP ${up.status}`);
    await api("POST", "", { action: "cover_done", id: cover.queue_id });
    log("faite", cover.queue_id, cover.text.slice(0, 50));
  } catch (e) {
    log("échec", cover.queue_id, e.message);
    break;   // nouvel essai au prochain passage
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
