// Socle commun des reels Payment Flow (fabrique). Chargé avant le script du modèle.
// window.__PF_DATA (data.js) : textes écrits par Claude ; window.__PF_T (timing.js) : débuts de scène.
window.PF = (function () {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Texte sûr ; *mot* → mot en couleur d'accent
  // Espace insécable avant ? ! : ; (typographie française : la ponctuation ne part pas seule à la ligne)
  const nb = (s) => String(s ?? "").replace(/\s+([?!:;»])/g, "\u00A0$1").replace(/«\s+/g, "«\u00A0");
  const rich = (s) => esc(nb(s)).replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // Texte découpé en mots (animation mot par mot) ; *mot* → mot en couleur d'accent
  const words = (s) => {
    let em = false;
    return esc(nb(s)).split(/ +/).filter(Boolean).map((w) => {
      const open = w.startsWith("*"), close = w.endsWith("*") && (w.length > 1 || em);
      if (open) em = true;
      const cls = em ? "w em" : "w";
      if (close) em = false;
      return `<span class="${cls}">${w.replace(/\*/g, "")}</span>`;
    }).join(" ");
  };
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
    // Transitions éclair, quatre styles en alternance
    swap(from, to, t, k) {
      switch ((k || 0) % 4) {
        case 1:   // fouetté latéral
          tl.to(from, { x: -520, filter: "blur(22px)", opacity: 0, duration: 0.18, ease: "power3.in" }, t);
          tl.fromTo(to, { x: 620, filter: "blur(22px)", opacity: 0 }, { x: 0, filter: "blur(0px)", opacity: 1, duration: 0.28, ease: "expo.out" }, t + 0.08);
          break;
        case 2:   // plongée (zoom à travers)
          tl.to(from, { scale: 1.6, filter: "blur(18px)", opacity: 0, duration: 0.2, ease: "power2.in" }, t);
          tl.fromTo(to, { scale: 0.62, filter: "blur(14px)", opacity: 0 }, { scale: 1, filter: "blur(0px)", opacity: 1, duration: 0.3, ease: "expo.out" }, t + 0.1);
          break;
        case 3:   // flash
          tl.fromTo("#flash", { opacity: 0 }, { opacity: 0.55, duration: 0.06, ease: "none", yoyo: true, repeat: 1 }, t);
          tl.to(from, { opacity: 0, duration: 0.05, ease: "none" }, t + 0.05);
          tl.fromTo(to, { scale: 1.12, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.26, ease: "power4.out" }, t + 0.06);
          break;
        default:  // poussée verticale
          tl.to(from, { y: -300, filter: "blur(16px)", opacity: 0, duration: 0.2, ease: "power3.in" }, t);
          tl.fromTo(to, { y: 320, filter: "blur(16px)", opacity: 0 }, { y: 0, filter: "blur(0px)", opacity: 1, duration: 0.28, ease: "power3.out" }, t + 0.08);
      }
      // Le halo bat à chaque coupe
      tl.fromTo("#halo-beat", { opacity: 0.0, scale: 0.9 }, { opacity: 0.55, scale: 1.08, duration: 0.12, ease: "power2.out", yoyo: true, repeat: 1 }, t + 0.06);
    },
    // Mots qui tombent un par un, puis le mot d'accent qui claque
    words(sel, t, step) {
      tl.fromTo(`${sel} .w`, { opacity: 0, y: 70, rotationX: -70, scale: 0.8, transformPerspective: 900 },
        { opacity: 1, y: 0, rotationX: 0, scale: 1, transformPerspective: 900, duration: 0.3, ease: "back.out(2)", stagger: step || 0.055 }, t);
      const n = document.querySelectorAll(sel + " .w").length, after = t + n * (step || 0.055) + 0.2;
      if (document.querySelector(sel + " .em")) tl.fromTo(`${sel} .em`, { scale: 1 }, { scale: 1.16, duration: 0.14, ease: "power2.out", yoyo: true, repeat: 1 }, after);
    },
    shake(t, power) { tl.fromTo("#scenes", { x: 0, y: 0 }, { x: power || 10, y: -(power || 10) / 2, duration: 0.035, ease: "none", yoyo: true, repeat: 5, immediateRender: false }, t); },
    float(sel, t, d) { if (d > 0.6) tl.to(sel, { y: -14, duration: d / 2, ease: "sine.inOut", yoyo: true, repeat: 1 }, t); },
    progress() { tl.fromTo("#prog-fill", { scaleX: 0 }, { scaleX: 1, duration: END, ease: "none" }, 0); },
    drift(sel, t, d, k) { tl.fromTo(sel, { scale: 1, rotation: 0 }, { scale: 1.07, rotation: (k || 0) % 2 ? -0.8 : 0.8, duration: Math.max(0.3, d), ease: "none" }, t); },
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
  return { esc, rich, words, fill, stars, kit };
})();
