// Socle commun des reels Payment Flow (fabrique). Chargé avant le script du modèle.
// window.__PF_DATA (data.js) : textes écrits par Claude ; window.__PF_T (timing.js) : débuts de scène.
window.PF = (function () {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Texte sûr ; *mot* → mot en couleur d'accent
  const rich = (s) => esc(s).replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const fill = (id, text) => { const el = document.getElementById(id); if (el) el.innerHTML = rich(text); };
  // Étoiles : générateur à graine fixe (rendu identique à chaque fois)
  const stars = () => {
    let a = 7;
    const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const box = document.getElementById("stars");
    for (let i = 0; i < 80; i++) {
      const s = document.createElement("div"), size = 2 + Math.floor(rnd() * 4);
      s.className = "star";
      s.style.cssText = `width:${size}px;height:${size}px;left:${Math.floor(rnd() * 1080)}px;top:${Math.floor(rnd() * 1920)}px;opacity:${(0.25 + rnd() * 0.6).toFixed(2)}`;
      box.appendChild(s);
    }
  };
  // Outils d'animation liés à la timeline du modèle
  const kit = (tl, END) => ({
    ambient() {
      tl.fromTo("#halo", { scale: 0.9, opacity: 0.8 }, { scale: 1.1, opacity: 1, duration: 1.45, ease: "sine.inOut", yoyo: true, repeat: Math.max(0, Math.floor(END / 1.45) - 1) }, 0);
      tl.fromTo("#ring", { rotation: 0, scale: 0.5, opacity: 0 }, { rotation: 0, scale: 1, opacity: 1, duration: 0.6, ease: "expo.out" }, 0.1);
      tl.to("#ring", { rotation: 90, duration: END - 0.7, ease: "none" }, 0.7);
      tl.fromTo("#stars", { y: 0 }, { y: -260, duration: END, ease: "none" }, 0);
    },
    swap(from, to, t) {
      tl.to(from, { y: -260, filter: "blur(16px)", opacity: 0, duration: 0.22, ease: "power3.in" }, t);
      tl.fromTo(to, { y: 300, filter: "blur(16px)", opacity: 0 }, { y: 0, filter: "blur(0px)", opacity: 1, duration: 0.3, ease: "power3.out" }, t + 0.1);
    },
    drift(sel, t, d) { tl.fromTo(sel, { scale: 1 }, { scale: 1.045, duration: Math.max(0.3, d), ease: "none" }, t); },
    pop(sel, t, ease) { tl.fromTo(sel, { opacity: 0, y: 50, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: ease || "power4.out" }, t); },
    slam(sel, t) { tl.fromTo(sel, { opacity: 0, scale: 1.35, filter: "blur(10px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.3, ease: "power4.out" }, t); },
    slide(sel, t, dir) { tl.fromTo(sel, { opacity: 0, x: (dir || -1) * 140 }, { opacity: 1, x: 0, duration: 0.28, ease: "expo.out" }, t); },
    fade(sel, t) { tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "sine.out" }, t); },
    card(sel, t) { tl.fromTo(sel, { opacity: 0, y: 220, rotationX: 22, scale: 0.9, transformPerspective: 1400 }, { opacity: 1, y: 0, rotationX: 0, scale: 1, transformPerspective: 1400, duration: 0.45, ease: "power4.out" }, t); },
    count(sel, from, to, t, dur, fmt) {
      const o = { v: from };
      tl.to(o, { v: to, duration: dur, ease: "power2.out", onUpdate: () => { document.querySelector(sel).textContent = fmt(o.v); } }, t);
    },
    fadeOut(sel) { tl.to(sel, { opacity: 0, duration: 0.3, ease: "power2.in" }, END - 0.35); },
  });
  return { esc, rich, fill, stars, kit };
})();
