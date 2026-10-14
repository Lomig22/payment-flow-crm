// ─── Exécuté DANS la page LinkedIn (doit rester autonome : aucune variable extérieure) ───
// Partagé par l'extension Chrome (importScripts) et le worker du VPS (page.evaluate) :
// modifier ce fichier modifie les deux.
// Repère les boutons par leur aria-label/texte (FR et EN) plutôt que par les classes CSS,
// qui changent souvent. Renvoie { result, detail?, slugs? } au format attendu par le CRM
// (/api/linkedin/ext/report).
async function pageAction(type, message) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const label = (el) => norm(el.getAttribute('aria-label') || el.innerText);
  const waitFor = async (fn, timeout = 15000) => {
    const t = Date.now();
    while (Date.now() - t < timeout) { const v = fn(); if (v) return v; await sleep(400); }
    return null;
  };
  // Boutons visibles seulement : la nouvelle fiche profil duplique ses boutons (copie masquée)
  const clickables = (root) => Array.from(root.querySelectorAll('button, a, [role="button"], [role="menuitem"]'))
    .filter((el) => el.getClientRects().length > 0);
  // Recherche dans la page ET dans les shadow DOM : depuis octobre 2026, LinkedIn y affiche
  // ses fenêtres (« Ajouter une note à votre invitation ? ») et la messagerie flottante
  const deepAll = (sel) => [document, ...Array.from(document.querySelectorAll('*')).filter((e) => e.shadowRoot).map((e) => e.shadowRoot)]
    .flatMap((r) => Array.from(r.querySelectorAll(sel)));
  const findDialog = () => deepAll('[role="dialog"], [role="alertdialog"], dialog[open]').find((x) => x.getClientRects().length > 0) || null;

  // Vérification de sécurité / captcha : blocage, déblocage manuel. Page de connexion : déconnecté.
  if (/\/checkpoint\//.test(location.pathname) || deepAll('iframe[src*="captcha"], iframe[title*="captcha" i], #captcha-internal').length) {
    return { result: 'verify', detail: 'Vérification de sécurité ou captcha LinkedIn' };
  }
  if (/\/(login|authwall|uas)/.test(location.pathname)) {
    return { result: 'auth', detail: 'Non connecté à LinkedIn' };
  }
  const bodyText = norm(document.body.innerText);
  if (/limite hebdomadaire d.invitations|weekly invitation limit/.test(bodyText)) {
    return { result: 'limit', detail: 'Limite hebdomadaire d’invitations LinkedIn atteinte' };
  }
  // Avertissement ou restriction : seulement dans les fenêtres et bandeaux de LinkedIn,
  // jamais dans le texte des publications
  const warningText = () => deepAll('[role="dialog"], [role="alertdialog"], [role="alert"]')
    .filter((x) => x.getClientRects().length > 0).map((x) => norm(x.innerText)).join(' ');
  const VERIFY = /v[ée]rifi(ez|er) votre identit[ée]|verify your identity|captcha|prouvez que vous n.[êe]tes pas un robot|confirm you.re not a robot/;
  const verified = warningText().match(VERIFY);
  if (verified) return { result: 'verify', detail: `LinkedIn demande une vérification : « ${verified[0]} »` };
  const WARNING = /activit[ée] inhabituelle|unusual activity|compte (a été |est )?(temporairement )?restreint|restreint votre compte|account (has been |is )?(temporarily )?restricted|automatis[ée]s? .*conditions|outils? d.automatisation|automation tools?/;
  const warned = warningText().match(WARNING);
  if (warned) return { result: 'warning', detail: `Avertissement LinkedIn : « ${warned[0]} »` };
  if (/limite (de|d.)\s*(messages|invitations)|reached the (weekly |monthly )?limit/.test(warningText())) {
    return { result: 'limit', detail: 'Limite LinkedIn atteinte' };
  }
  const visible = (el) => el.getClientRects().length > 0;
  const nameKey = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const isExpand = (el) => /^(…|\.\.\.)\s?(plus|more)$|^voir plus$|^see more$/.test(label(el));

  // ── Messagerie : conversations dont le dernier message vient d'un lead suivi ──
  // message = liste JSON des noms (« Prénom Nom ») des leads à surveiller
  if (type === 'inbox') {
    let names = [];
    try { names = JSON.parse(message || '[]').map(nameKey); } catch { names = []; }
    const list = await waitFor(() => document.querySelector('.msg-conversation-card, li.msg-conversation-listitem'), 20000);
    if (!list) return { result: 'error', detail: 'Liste des conversations introuvable' };
    await sleep(rand(1500, 2500));
    const cards = Array.from(document.querySelectorAll('.msg-conversation-card')).filter(visible).slice(0, 25);
    const hits = [];
    for (const card of cards) {
      const nameEl = card.querySelector('.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names, h3');
      const name = (nameEl ? nameEl.innerText : '').replace(/\s+/g, ' ').trim();
      const snippetEl = card.querySelector('.msg-conversation-card__message-snippet, .msg-conversation-card__message-snippet-body, p');
      const snippet = (snippetEl ? snippetEl.innerText : '').replace(/\s+/g, ' ').trim();
      if (!name || !names.includes(nameKey(name))) continue;
      if (/^(vous|you)\s*:/i.test(snippet)) continue;   // dernier message envoyé par Lomig
      hits.push({ card, name, snippet });
    }
    const replies = [];
    for (const h of hits) {
      // Ouverture de la conversation : lien et texte complet de la réponse
      (h.card.querySelector('a, [role="button"]') || h.card).click();
      await sleep(rand(2500, 4000));
      const theirs = Array.from(document.querySelectorAll('.msg-s-event-listitem--other')).filter(visible);
      const last = theirs.length ? theirs[theirs.length - 1] : null;
      const body = last && (last.querySelector('.msg-s-event-listitem__body, p') || last);
      replies.push({
        name: h.name,
        text: ((body && body.innerText) || h.snippet.replace(/^[^:]{1,40}:\s*/, '')).replace(/\s+/g, ' ').trim().slice(0, 2000),
        thread_url: /\/messaging\/thread\//.test(location.href) ? location.href.split('?')[0] : null,
      });
    }
    return { result: 'ok', replies };
  }

  // ── Invitations envoyées en attente (page « Gérer les invitations › Envoyées ») ──
  if (type === 'pending') {
    const tab = await waitFor(() => Array.from(document.querySelectorAll('button, a, span'))
      .find((e) => /^(personnes|people)\s*\(\s*[\d\s\u202f\u00a0.,]+\)$/i.test((e.innerText || '').trim())), 20000);
    if (!tab) return { result: 'error', detail: 'Compteur des invitations envoyées introuvable' };
    return { result: 'ok', count: Number((tab.innerText.match(/\(([^)]+)\)/) || [])[1].replace(/\D/g, '')) };
  }

  // ── Publications (page « Toute l'activité ») : les 5 dernières ──
  if (type === 'posts') {
    await waitFor(() => document.querySelector('main'), 20000);
    await sleep(rand(2500, 4000));
    for (let i = 0; i < 3; i++) { window.scrollBy(0, 1800); await sleep(rand(1200, 2000)); }
    window.scrollTo(0, 0);
    const main = document.querySelector('main') || document.body;
    for (const b of clickables(main).filter(isExpand).slice(0, 8)) { b.click(); await sleep(rand(300, 700)); }
    const cards = Array.from(document.querySelectorAll('[componentkey^="expanded"], [data-urn^="urn:li:activity"]'))
      .filter(visible).filter((c) => !(c.parentElement && c.parentElement.closest('[componentkey^="expanded"], [data-urn^="urn:li:activity"]')));
    const posts = cards.slice(0, 5).map((c) => {
      const raw = c.innerText.replace(/\s+/g, ' ').trim();
      const ageEl = Array.from(c.querySelectorAll('p, span')).map((e) => e.innerText.trim())
        .find((t) => t.length < 40 && /^\d+\s*(min|h|j|sem\.?|mois|ans?|d|w|mo|yr)\b/i.test(t));
      const link = c.querySelector('a[href*="/feed/update/"]');
      return {
        text: raw.replace(/^Post du fil d.actualit[ée]\s*/i, '').replace(/\s*\d[\d\s]*r[ée]actions?\b[\s\S]*$/i, '')
          .replace(/\s*J’aime Commenter Republier Envoyer[\s\S]*$/i, '').replace(/…\s?plus/g, '').slice(0, 3000),
        age: ageEl ? ageEl.split('•')[0].trim() : null,
        repost: /a republi[ée] ce contenu|reposted this/i.test(raw.slice(0, 200)),
        url: link ? link.href.split('?')[0] : null,
      };
    });
    return { result: 'ok', posts };
  }

  // ── Lecture de la page « Relations » (triée par date d'ajout) ──
  if (type === 'scan') {
    await waitFor(() => document.querySelector('main a[href*="/in/"]'), 20000);
    // Charger au moins 40 relations (les plus récentes d'abord) : défilement de la dernière carte et
    // bouton « Afficher plus de résultats », jusqu'à ce que la liste ne grandisse plus
    const countLinks = () => new Set(Array.from(document.querySelectorAll('main a[href*="/in/"]')).map((a) => a.getAttribute('href'))).size;
    for (let i = 0, last = -1; i < 12 && countLinks() < 40 && countLinks() !== last; i++) {
      last = countLinks();
      const links = document.querySelectorAll('main a[href*="/in/"]');
      if (links.length) links[links.length - 1].scrollIntoView({ block: 'end' });
      window.scrollTo(0, document.body.scrollHeight);
      const more = clickables(document.querySelector('main') || document).find((el) => /afficher plus de r[ée]sultats|show more results|voir plus|load more/.test(label(el)));
      if (more) more.click();
      await sleep(rand(1500, 2500));
    }
    const slugs = new Set();
    document.querySelectorAll('main a[href*="/in/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
      if (m) { try { slugs.add(decodeURIComponent(m[1]).toLowerCase()); } catch { slugs.add(m[1].toLowerCase()); } }
    });
    if (!slugs.size) return { result: 'error', detail: 'Aucune relation lue sur la page' };
    return { result: 'ok', slugs: Array.from(slugs) };
  }

  // ── Profil ──
  // En-tête du profil : la section de <main> qui porte le nom (h1, ou h2 depuis la refonte
  // d'octobre 2026) et le bouton « Plus »
  const isMore = (el) => /^(plus d.actions|more actions|plus|more)$/.test(label(el));
  const top = await waitFor(() => {
    const h = Array.from(document.querySelectorAll('main h1, main h2'))
      .find((x) => { const sec = x.closest('section'); return sec && clickables(sec).some(isMore); });
    return h && h.closest('section');
  }, 20000);
  if (!top) return { result: 'error', detail: 'Profil introuvable (page non chargée ou profil supprimé)' };
  await sleep(rand(1500, 3000));

  const degree = norm((top.querySelector('.dist-value') || {}).textContent);
  const topText = norm(top.innerText);
  const isFirst = /^1(er|st)$/.test(degree) || /·\s*1(er|st)\b/.test(topText);
  const isPending = () => clickables(top).some((el) => /^(en attente|pending)\b|retirer l.invitation|withdraw invitation/.test(label(el)));
  const isConnectLabel = (l) => /(invitez|inviter) .*rejoindre votre r[ée]seau|invite .* to connect|^se connecter$|^connect$/.test(l);

  // ── Lecture du profil : en-tête, Infos, Expérience ──
  if (type === 'profile') {
    for (let i = 0; i < 4; i++) { window.scrollBy(0, 1400); await sleep(rand(900, 1600)); }
    window.scrollTo(0, 0);
    const card = (...titles) => {
      const h = Array.from(document.querySelectorAll('main h2')).find((x) => titles.includes(norm(x.innerText)));
      return h ? (h.closest('section') || h.parentElement) : null;
    };
    const about = card('infos', 'about');
    const experience = card('expérience', 'experience');
    for (const c of [about, experience]) {
      if (c) for (const b of clickables(c).filter(isExpand).slice(0, 3)) { b.click(); await sleep(rand(400, 900)); }
    }
    const txt = (el) => (el ? el.innerText.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim() : '');
    // Open Profile : bouton « Message » visible sans être en relation (ni invitation en attente)
    const openProfile = !isFirst && !isPending() && clickables(top).some((el) => /^(envoyer un message|message)\b/.test(label(el)));
    return { result: 'ok', profile: { top: txt(top).slice(0, 1500), about: txt(about).slice(0, 4000), experience: txt(experience).slice(0, 4000), open_profile: openProfile } };
  }

  // ── Retrait d'une invitation restée en attente ──
  if (type === 'withdraw') {
    if (isFirst) return { result: 'already_connected' };
    const isPendingBtn = (el) => /^(en attente|pending)\b|retirer l.invitation|withdraw invitation/.test(label(el));
    let pend = clickables(top).find(isPendingBtn);
    if (!pend) {
      const more = clickables(top).find(isMore);
      if (more) {
        more.click();
        await sleep(rand(800, 1500));
        pend = clickables(document).find((el) => (el.getAttribute('role') === 'menuitem' || el.closest('[role="menu"]')) && isPendingBtn(el));
      }
    }
    if (!pend) return { result: 'not_pending' };
    pend.click();
    const dialog = await waitFor(findDialog, 8000);
    if (!dialog) return { result: 'error', detail: 'Fenêtre de retrait introuvable' };
    const confirm = clickables(dialog).find((el) => /^(retirer|withdraw)$/.test(label(el)));
    if (!confirm) return { result: 'error', detail: 'Bouton « Retirer » introuvable' };
    confirm.click();
    const done = await waitFor(() => !findDialog() && !clickables(top).some(isPendingBtn), 8000);
    return done ? { result: 'ok' } : { result: 'error', detail: 'Retrait non confirmé' };
  }

  if (type === 'invite') {
    if (isFirst) return { result: 'already_connected' };
    if (isPending()) return { result: 'pending' };

    let connect = clickables(top).find((el) => isConnectLabel(label(el)) || /custom-invite/.test(el.getAttribute('href') || ''));
    if (!connect) {
      // Bouton « Se connecter » caché dans le menu « Plus »
      const more = clickables(top).find(isMore);
      if (more) {
        more.click();
        await sleep(rand(800, 1500));
        // Invitation déjà envoyée : la nouvelle fiche ne l'indique que dans ce menu
        if (clickables(document).some((el) => /^(en attente|pending)\b|retirer l.invitation|withdraw invitation/.test(label(el)))) return { result: 'pending' };
        // Uniquement dans le menu ouvert : la page contient aussi des « Se connecter » d'autres profils
        connect = await waitFor(() => clickables(document)
          .find((el) => (el.getAttribute('role') === 'menuitem' || el.closest('[role="menu"]')) && isConnectLabel(label(el))), 4000);
      }
    }
    if (!connect) return { result: 'error', detail: 'Bouton « Se connecter » introuvable (profil restreint ?)' };
    connect.click();
    await sleep(rand(1500, 2500));

    const dialog = await waitFor(findDialog, 8000);
    if (!dialog) return { result: 'error', detail: 'Fenêtre d’invitation introuvable : invitation non envoyée' };

    const dText = norm(dialog.innerText);
    if (/limite hebdomadaire|weekly invitation limit/.test(dText)) return { result: 'limit', detail: 'Limite hebdomadaire d’invitations LinkedIn atteinte' };
    if (dialog.querySelector('input[type="email"]')) return { result: 'error', detail: 'LinkedIn demande l’e-mail du contact' };
    // Variante « avec note » : message = texte de la note (200 caractères max)
    if (message) {
      const addNote = clickables(dialog).find((el) => /^ajouter une note$|^add a note$/.test(label(el)));
      if (!addNote) return { result: 'error', detail: 'note_unavailable' };
      addNote.click();
      const area = await waitFor(() => { const d = findDialog(); const t = d && d.querySelector('textarea'); return t && t.getClientRects().length ? t : null; }, 6000);
      // Pas de zone de texte (offre Premium proposée à la place) : notes épuisées sur ce compte
      if (!area) return { result: 'error', detail: 'note_unavailable' };
      area.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, message.slice(0, 200));
      area.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(rand(1200, 2200));
      const box = findDialog();
      const sendNote = box && await waitFor(() => clickables(box).find((el) => /^envoyer$|^send$/.test(label(el)) && !el.disabled), 4000);
      if (!sendNote) return { result: 'error', detail: 'Bouton d’envoi de l’invitation avec note introuvable' };
      sendNote.click();
      await sleep(rand(1500, 2500));
      const sentWithNote = await waitFor(() => !findDialog() || isPending(), 8000);
      return sentWithNote ? { result: 'ok' } : { result: 'error', detail: 'Envoi de l’invitation avec note non confirmé' };
    }
    const send = clickables(dialog).find((el) => /envoyer sans note|send without a note|^envoyer$|^send$|^envoyer maintenant$|^send now$/.test(label(el)));
    if (!send) return { result: 'error', detail: 'Bouton d’envoi de l’invitation introuvable' };
    send.click();
    await sleep(rand(1500, 2500));
    // Fenêtre refermée après « Envoyer » = invitation partie
    const confirmed = await waitFor(() => !findDialog() || isPending() || /invitation envoy[ée]e|invitation sent/.test(norm(document.body.innerText)), 8000);
    return confirmed ? { result: 'ok' } : { result: 'error', detail: 'Envoi de l’invitation non confirmé (fenêtre restée ouverte)' };
  }

  if (type === 'dm' || type === 'followup' || type === 'check') {
    // La lecture des relations a déjà confirmé l'acceptation : on ne refuse que sur un
    // signe clair (invitation en attente ou bouton « Se connecter »), le badge « 1er » pouvant manquer.
    const hasConnect = clickables(top).some((el) => isConnectLabel(label(el)));
    if (!isFirst && (isPending() || hasConnect)) return { result: 'not_connected' };
    const msgBtn = clickables(top).find((el) => /^(envoyer un message|message)\b/.test(label(el)));
    if (!msgBtn) return { result: 'error', detail: 'Bouton « Message » introuvable' };
    msgBtn.click();

    const editor = await waitFor(() => {
      const all = deepAll('.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
      return all.length ? all[all.length - 1] : null;
    }, 15000);
    if (!editor) return { result: 'error', detail: 'Fenêtre de message introuvable' };
    await sleep(rand(2500, 4000));   // laisse l'historique de la conversation s'afficher

    const convo = editor.closest('.msg-overlay-conversation-bubble, .msg-convo-wrapper, [role="dialog"], aside, section') || editor.getRootNode();
    const existing = convo.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event').length;
    if (type === 'dm' && existing > 0) return { result: 'existing_thread', detail: `${existing} message(s) déjà dans la conversation` };

    if (type === 'followup' || type === 'check') {
      // On ne relance que si le premier DM est bien là et que la personne n'a rien écrit
      const items = await waitFor(() => {
        const li = convo.querySelectorAll('.msg-s-event-listitem');
        return li.length ? li : null;
      }, 8000);
      if (!items) return { result: 'error', detail: 'Conversation vide : premier DM introuvable, relance annulée' };
      const profileName = norm((top.querySelector('h1, h2') || {}).textContent);
      const fromThem = convo.querySelectorAll('.msg-s-event-listitem--other').length > 0 ||
        Array.from(convo.querySelectorAll('.msg-s-message-group__name, .msg-s-message-group__profile-link'))
          .some((el) => profileName && norm(el.textContent) === profileName);
      if (fromThem) {
        const theirs = Array.from(convo.querySelectorAll('.msg-s-event-listitem--other'));
        const last = theirs.length ? theirs[theirs.length - 1] : null;
        return { result: 'replied', reply_text: last ? last.innerText.replace(/\s+/g, ' ').trim().slice(0, 2000) : null };
      }
      // Dernière vérification : on regarde seulement, rien n'est envoyé
      if (type === 'check') return { result: 'no_reply' };
    }

    const lines = message.split('\n');
    editor.focus();
    lines.forEach((line, i) => {
      if (i > 0) document.execCommand('insertParagraph');
      if (line) document.execCommand('insertText', false, line);
    });
    if (!norm(editor.innerText)) {
      // Repli si execCommand est ignoré (onglet en arrière-plan)
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      editor.innerHTML = lines.map((l) => `<p>${l ? esc(l) : '<br>'}</p>`).join('');
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    await sleep(rand(1000, 2000));

    const form = editor.closest('form') || convo;
    const send = await waitFor(() => {
      const b = form.querySelector('button.msg-form__send-button, button[type="submit"]');
      return b && !b.disabled ? b : null;
    }, 6000);
    if (!send) return { result: 'error', detail: 'Bouton « Envoyer » inactif' };
    send.click();

    const sent = await waitFor(() => !norm(editor.innerText) ||
      convo.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event').length > existing, 10000);
    if (!sent) return { result: 'error', detail: type === 'followup' ? 'Envoi de la relance non confirmé' : 'Envoi du DM non confirmé' };
    await sleep(rand(1000, 2000));
    return { result: 'ok' };
  }

  return { result: 'error', detail: `Action inconnue : ${type}` };
}
