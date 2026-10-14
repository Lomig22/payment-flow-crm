// Rendu d'un reel de la fabrique sur le VPS : demande au CRM le prochain reel (textes + liens des
// voix), l'assemble (build.mjs), le rend (HyperFrames), puis le dépose dans la file @paymentflow.
// Aucune clé d'API ici : seulement CRM_URL et CRON_SECRET (variables d'environnement).
// Usage : node render.mjs   (un reel par appel ; le cron le relance)
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CRM = process.env.CRM_URL ?? "https://payment-flow-crm-delta.vercel.app";
const KEY = process.env.CRON_SECRET;
const WORK = process.env.FACTORY_WORK ?? join(HERE, "work");
const HF = process.env.HYPERFRAMES ?? "hyperframes@0.8.157";
if (!KEY) { console.error("CRON_SECRET manquant"); process.exit(1); }

const api = async (method, query, body) => {
  const r = await fetch(`${CRM}/api/cron/agency-reels${query}`, {
    method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${query} : ${r.status} ${j.message ?? ""}`);
  return j;
};
const log = (...a) => console.log(new Date().toISOString(), ...a);

const { job } = await api("GET", "?action=next");
if (!job) { log("rien à rendre"); process.exit(0); }
const dir = join(WORK, job.id);
log("rendu", job.id, job.funnel, `${Object.keys(job.vo).length} voix`);
try {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "vo"), { recursive: true });
  cpSync(join(HERE, "template", "index.html"), join(dir, "index.html"));
  for (const f of ["base.css", "base.js"]) cpSync(join(HERE, "shared", f), join(dir, f));
  cpSync(join(HERE, "shared", "fonts"), join(dir, "fonts"), { recursive: true });
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ media: { autoProxy: true } }));
  writeFileSync(join(dir, "data.json"), JSON.stringify(job.data));
  for (const [i, url] of Object.entries(job.vo)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`voix ${i} : HTTP ${r.status}`);
    writeFileSync(join(dir, "vo", `${i}.mp3`), Buffer.from(await r.arrayBuffer()));
  }
  log("assemblage", execFileSync("node", [join(HERE, "build.mjs"), dir]).toString().trim());
  const out = join(dir, "reel.mp4");
  execFileSync("npx", ["--yes", HF, "render", "--quiet", "-o", out, "--fps", "30", "--workers", process.env.FACTORY_WORKERS ?? "2", "--crf", "20"], { cwd: dir, stdio: ["ignore", "inherit", "inherit"], timeout: 40 * 60_000 });
  const size = statSync(out).size;
  const { upload_url } = await api("POST", "", { action: "upload", id: job.id, size });
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", new Blob([readFileSync(out)], { type: "video/mp4" }), "reel.mp4");
  const up = await fetch(upload_url, { method: "PUT", headers: { "x-upsert": "true" }, body: form });
  if (!up.ok) throw new Error(`dépôt : HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
  await api("POST", "", { action: "done", id: job.id });
  log("déposé", job.id, `${Math.round(size / 1e5) / 10} Mo`);
  rmSync(dir, { recursive: true, force: true });
} catch (e) {
  log("échec", job.id, e.message);
  await api("POST", "", { action: "fail", id: job.id, error: e.message }).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
