// Temps forts de chaque type de scène (relatifs au début de la scène, d = durée de la scène).
// Source unique : lu par le gabarit (animations) et par build.mjs (bruitages, durées minimales).
(function (root) {
  const spread = (n, from, to) => Array.from({ length: n }, (_, j) => (n === 1 ? from : from + ((to - from) * j) / (n - 1)));
  const items = (s) => (s.items || s.messages || s.slots || []).length;
  const B = {
    // Durée minimale (toutes les animations doivent avoir le temps de se jouer)
    min: {
      hook: () => 1.8, point: () => 1.8, versus: () => 2.4, number: () => 2.0, checklist: (s) => 1.0 + items(s) * 0.35,
      search: () => 2.4, leads: () => 2.4, chat: (s) => 0.8 + items(s) * 0.45, notifs: (s) => 0.8 + items(s) * 0.35,
      calendar: (s) => 1.0 + items(s) * 0.25, cta: (s) => (s.mode === "offer" ? 4.4 : 3.2),
    },
    // Instants des événements de la scène
    times: (s, d) => {
      const n = items(s), end = Math.max(0.9, d - 0.45);
      switch (s.type) {
        case "hook": return { words: 0.04, text2: Math.min(0.9, d * 0.42), shake: Math.min(0.9, d * 0.42) + 0.12 };
        case "point": return { kicker: 0.06, num: 0.1, shake: 0.2, words: 0.28, sub: Math.min(1.1, d * 0.5), bar: Math.min(1.3, d * 0.6) };
        case "checklist": return { kicker: 0.05, words: 0.1, card: 0.3, items: spread(n, 0.55, Math.min(end, 0.55 + n * 0.45)) };
        case "versus": return { words: 0.06, left: 0.3, right: Math.min(1.5, d * 0.5), shake: Math.min(1.5, d * 0.5) + 0.15 };
        case "number": return { kicker: 0.05, num: 0.08, count: 0.12, shake: 1.0, words: 0.5, note: 0.9 };
        case "search": return { words: 0.06, card: 0.25, type: 0.5, results: Math.min(1.3, d * 0.5), glow: Math.min(1.7, d * 0.65) };
        case "leads": return { words: 0.06, card: 0.25, items: spread(Math.min(3, n), 0.6, Math.min(end, 1.6)), notif: Math.min(end, 1.9) };
        case "chat": return { words: 0.06, card: 0.25, items: spread(n, 0.5, Math.min(end, 0.5 + n * 0.6)) };
        case "notifs": return { words: 0.06, items: spread(n, 0.35, Math.min(end, 0.35 + n * 0.45)) };
        case "calendar": return { words: 0.06, card: 0.25, items: spread(n, 0.6, Math.min(end, 0.6 + n * 0.3)) };
        case "cta": return s.mode === "offer" ? { mark: 0.12, name: 0.35, pill: 0.6, card: 1.0, o1: 1.35, o2: 2.1, pulse: 2.9 } : { mark: 0.12, words: 0.35, sub: 0.75, pill: 1.05, pulse: 2.2 };
        default: return {};
      }
    },
    // Bruitages : [son, instant, volume]
    cues: (s, d) => {
      const t = B.times(s, d), out = [];
      const add = (name, at, vol) => at != null && out.push([name, at, vol]);
      switch (s.type) {
        case "hook": add("impact", s.text2 ? t.text2 : 0.05, 0.45); break;
        case "point": add("impact", t.shake, 0.32); break;
        case "versus": add("impact", t.right, 0.38); break;
        case "number": add("riser", 0.1, 0.28); add("impact", t.shake, 0.38); break;
        case "search": add("typing", t.type, 0.38); add("pop", t.results, 0.32); break;
        case "leads": t.items.forEach((x) => add("pop", x, 0.28)); add("notif", t.notif, 0.45); break;
        case "chat": t.items.forEach((x, j) => add(j % 2 ? "pop" : "notif", x, j % 2 ? 0.28 : 0.32)); break;
        case "notifs": t.items.forEach((x) => add("notif", x, 0.3)); break;
        case "checklist": case "calendar": t.items.forEach((x) => add("pop", x, 0.26)); break;
        case "cta": s.mode === "offer" ? (add("impact", t.pill, 0.42), add("pop", t.o1, 0.28), add("pop", t.o2, 0.28)) : (add("pop", t.words, 0.28), add("impact", t.pill, 0.38)); break;
      }
      return out;
    },
  };
  root.PF_BEATS = B;
})(typeof window !== "undefined" ? window : globalThis);
