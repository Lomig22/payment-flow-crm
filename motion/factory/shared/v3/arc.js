// Gabarit v3 (bureau de chantier) : règles partagées par le gabarit (images) et build.mjs (son).
//  - arc nuit → jour : la scène où le jour se lève (première scène « solution »)
//  - sous-titres : mots de la voix off, minutés au prorata de leur longueur (pauses aux ponctuations)
//  - chiffre de la voix (« quinze ») : l'instant où il est prononcé, pour le compteur du téléphone
(function (root) {
  const SOLUTION = ["leads", "notifs", "calendar", "versus", "checklist"];
  // Première scène solution après l'accroche (la recherche et le constat racontent le problème), sinon la fin
  const dawn = (scenes) => {
    const i = scenes.findIndex((s, k) => k > 0 && SOLUTION.includes(s.type));
    return i > 0 ? i : Math.max(1, scenes.length - 1);
  };

  // Mots de la voix off, avec leur poids (lettres + pause de ponctuation)
  // « quoi ? » : la ponctuation détachée reste collée au mot (espace insécable)
  const split = (text) => String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
    .reduce((out, w) => { if (out.length && /^[?!:;»]+$/.test(w)) out[out.length - 1] += " " + w; else if (out.length && /«$/.test(out[out.length - 1])) out[out.length - 1] += " " + w; else out.push(w); return out; }, []);
  const tokens = (text) => split(text).map((w) => {
    const pause = /[.!?…]$/.test(w) ? 5 : /[,;:]$/.test(w) ? 3 : 0;
    return { w, weight: Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + 1.5 + pause };
  });
  // Instant de chaque mot : de start à start + dur (durée réelle de la voix de la scène)
  const wordTimes = (text, start, dur) => {
    const tk = tokens(text), total = tk.reduce((n, t) => n + t.weight, 0) || 1;
    let acc = 0;
    return tk.map((t) => { const at = start + (acc / total) * dur; acc += t.weight; return { w: t.w, at: Math.round(at * 1000) / 1000 }; });
  };
  // Lignes de sous-titres : ~48 caractères (2 lignes en Jost 54 px), coupées de préférence aux ponctuations
  const chunks = (words, max) => {
    const out = []; let cur = [], len = 0;
    words.forEach((x, k) => {
      cur.push(x); len += x.w.length + 1;
      const next = words[k + 1];
      const punct = /[.!?…,;:]$/.test(x.w);
      if (!next || len >= (max || 48) || (punct && len >= 22) || /[.!?…]$/.test(x.w)) { out.push(cur); cur = []; len = 0; }
    });
    if (cur.length) out.push(cur);
    return out;
  };

  // Chiffres prononcés : « quinze » / « 15 » → 15
  const NUM = { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50, cent: 100 };
  const numberOf = (w) => {
    const c = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (/^\d{1,3}$/.test(c)) return Number(c);
    return NUM[c] || 0;
  };
  // Premier chiffre dit après le lever du jour (ou dans la scène notifs / leads) : le compteur du téléphone
  const counterCue = (scenes, T, VD, lead) => {
    const d = dawn(scenes);
    for (let i = d; i < scenes.length; i++) {
      if (!scenes[i].vo || !VD[i]) continue;
      // Seulement un chiffre de demandes / devis / appels (« quinze demandes de devis »), pas « trois photos »
      const ws = wordTimes(scenes[i].vo, T[i] + lead, VD[i]);
      for (let k = 0; k < ws.length; k++) {
        const n = numberOf(ws[k].w), after = ws.slice(k + 1, k + 4).map((x) => x.w).join(" ");
        if (n >= 2 && n <= 100 && /demande|devis|appel|client/i.test(after)) return { scene: i, at: ws[k].at, n };
      }
    }
    return null;
  };

  // Mots-clés colorés dans les sous-titres
  const KEY = /^(devis|demandes?|planning|chantiers?|clients?|appels?|téléphone|rempli[st]?|vide|nuit|jour|semaine|mois|gratuit|offert|audit|commentaire|devis\.)$/i;
  const isNumber = (w) => numberOf(w) > 0 || /\d/.test(w);
  const keyword = (w) => { const c = w.replace(/[^\p{L}\p{N}]/gu, ""); return isNumber(c) ? "nb" : KEY.test(c) ? "key" : ""; };

  root.PF_ARC = { dawn, wordTimes, chunks, counterCue, keyword, numberOf, SOLUTION };
})(typeof window !== "undefined" ? window : globalThis);
