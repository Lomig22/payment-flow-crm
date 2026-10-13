// Payment Flow — LinkedIn : exécute la séquence décidée par le CRM.
// Toutes les 2 min, demande au CRM la prochaine action (/api/linkedin/ext/queue), l'exécute
// dans un onglet LinkedIn ouvert en arrière-plan (ta session, ton navigateur), puis rend
// compte (/api/linkedin/ext/report). Plafonds, horaires et délais sont gérés par le CRM.

importScripts('pageAction.js');   // pageAction(), partagée avec le worker du VPS

const TICK_MINUTES = 2;
const BUSY_MS = 4 * 60_000;   // une action ne peut pas en chevaucher une autre

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('tick', { periodInMinutes: TICK_MINUTES }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('tick', { periodInMinutes: TICK_MINUTES }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'tick') tick(); });
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === 'run-now') { tick().then(() => reply(true)); return true; }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setStatus(text) {
  await chrome.storage.local.set({ lastStatus: { text, at: new Date().toISOString() } });
}

async function crm(path, init = {}) {
  const { crmUrl, extKey } = await chrome.storage.local.get(['crmUrl', 'extKey']);
  const res = await fetch(crmUrl.replace(/\/$/, '') + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-ext-key': extKey, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`CRM ${res.status} ${await res.text().catch(() => '')}`.slice(0, 200));
  return res.json();
}

async function tick() {
  const { crmUrl, extKey, paused } = await chrome.storage.local.get(['crmUrl', 'extKey', 'paused']);
  if (!crmUrl || !extKey) return setStatus('À configurer : adresse du CRM et clé');
  if (paused) return setStatus('En pause (extension)');

  const { busyUntil } = await chrome.storage.session.get('busyUntil');
  if (busyUntil && busyUntil > Date.now()) return;
  await chrome.storage.session.set({ busyUntil: Date.now() + BUSY_MS });

  try {
    const { next, reason } = await crm('/api/linkedin/ext/queue');
    if (!next) return setStatus(reason || 'Rien à faire');

    await setStatus(`En cours : ${next.type === 'scan' ? 'lecture des relations' : next.type === 'dm' ? 'envoi du DM' : next.type === 'followup' ? 'relance' : 'invitation'}`);
    let out;
    try {
      out = await runInLinkedinTab(next);
    } catch (e) {
      out = { result: 'error', detail: String(e && e.message || e) };
    }
    await crm('/api/linkedin/ext/report', {
      method: 'POST',
      body: JSON.stringify({ type: next.type, lead_id: next.lead_id, ...out }),
    });
    await setStatus(`${next.type} → ${out.result}${out.detail ? ` (${out.detail})` : ''}`);
  } catch (e) {
    await setStatus(`Erreur : ${String(e && e.message || e)}`);
  } finally {
    await chrome.storage.session.remove('busyUntil');
  }
}

async function runInLinkedinTab(next) {
  const tab = await chrome.tabs.create({ url: next.url, active: false });
  try {
    await waitTabComplete(tab.id, 45_000);
    await sleep(3000 + Math.random() * 3000);   // laisse LinkedIn finir de charger (contenu dynamique)
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageAction,
      args: [next.type, next.message || ''],
    });
    return res && res.result ? res.result : { result: 'error', detail: 'Pas de réponse de la page' };
  } finally {
    await sleep(1500);
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitTabComplete(tabId, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Page LinkedIn trop longue à charger')); }, timeout);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

