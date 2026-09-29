// ==UserScript==
// @name         GitHub Outreach
// @namespace    http://localhost:3847
// @version      1.3.0
// @description  Show public GitHub profile emails and save them to a local outreach list
// @match        https://github.com/search*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      localhost
// @connect      localhost:3847
// @connect      127.0.0.1
// @connect      127.0.0.1:3847
// ==/UserScript==

(function () {
  'use strict';

  const API_BASE = 'http://localhost:3847';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_CONCURRENT = 2;
  const STYLE = `
    .gho-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; line-height: 18px; }
    .gho-email, .gho-btn, .gho-note { border: 1px solid var(--borderColor-default, #30363d); background: var(--bgColor-muted, #161b22); color: var(--fgColor-default, #f0f6fc); border-radius: 6px; }
    .gho-email, .gho-btn { padding: 2px 8px; cursor: pointer; }
    .gho-email:hover, .gho-btn:hover { background: var(--bgColor-emphasis, #21262d); }
    .gho-email.gho-empty, .gho-note { color: var(--fgColor-muted, #8b949e); cursor: default; }
    .gho-btn.gho-added { color: var(--fgColor-success, #3fb950); }
    .gho-note { padding: 2px 8px; }
    #gho-panel { position: fixed; right: 16px; bottom: 16px; width: 280px; z-index: 80; background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #f0f6fc); border: 1px solid var(--borderColor-default, #30363d); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.28); font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #gho-panel header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; cursor: grab; border-bottom: 1px solid var(--borderColor-muted, #30363d); font-weight: 600; }
    #gho-panel.gho-collapsed header { border-bottom: 0; }
    #gho-panel.gho-collapsed .gho-panel-body { display: none; }
    .gho-panel-body { padding: 10px 12px 12px; }
    .gho-stat { display: flex; justify-content: space-between; color: var(--fgColor-muted, #8b949e); margin: 2px 0; }
    .gho-stat strong { color: var(--fgColor-default, #f0f6fc); font-weight: 600; }
    .gho-offline { color: var(--fgColor-danger, #f85149); margin: 6px 0; }
    .gho-online { color: var(--fgColor-success, #3fb950); margin: 6px 0; }
    .gho-select { display: inline-flex; align-items: center; gap: 4px; color: var(--fgColor-muted, #8b949e); }
    #gho-toolbar { margin: 0 0 12px; padding: 12px; border: 1px solid var(--borderColor-default, #30363d); border-radius: 12px; background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #f0f6fc); }
    #gho-toolbar h2 { margin: 0 0 8px; font-size: 14px; }
    .gho-toolbar-row, .gho-toolbar-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
    .gho-toolbar-row label { display: inline-flex; gap: 6px; align-items: center; }
    #gho-toolbar select, #gho-toolbar button, #gho-actionbar button, #gho-modal button { border: 1px solid var(--borderColor-default, #30363d); background: var(--bgColor-muted, #161b22); color: var(--fgColor-default, #f0f6fc); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
    #gho-toolbar .gho-primary, #gho-actionbar .gho-primary, #gho-modal .gho-primary { background: #238636; border-color: #238636; color: #fff; }
    #gho-actionbar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 81; display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--borderColor-default, #30363d); background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #f0f6fc); box-shadow: 0 8px 24px rgba(0,0,0,.28); }
    #gho-modal { position: fixed; right: 16px; top: 16px; width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; z-index: 82; padding: 14px; border-radius: 12px; border: 1px solid var(--borderColor-default, #30363d); background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #f0f6fc); box-shadow: 0 8px 24px rgba(0,0,0,.35); }
    #gho-modal h3 { margin: 0 0 8px; font-size: 16px; }
    .gho-preview { border-top: 1px solid var(--borderColor-muted, #30363d); padding: 8px 0; }
    .gho-test { color: #d29922; margin: 0 0 8px; }
    .gho-open, .gho-icon-btn { border: 1px solid #2f81f7; background: #2f81f7; color: #fff; border-radius: 6px; padding: 5px 10px; width: 100%; margin-top: 8px; cursor: pointer; }
    .gho-icon-btn { width: auto; margin: 0; padding: 0 8px; background: transparent; color: var(--fgColor-default, #f0f6fc); border-color: var(--borderColor-default, #30363d); }
  `;

  GM_addStyle(STYLE);

  const profiles = new Map();
  const savedEmails = new Set();
  let serverOnline = null;
  let serverStats = null;
  let scheduled = 0;
  let observerTimer = 0;
  const queue = [];
  let activeFetches = 0;
  let lastStartedAt = 0;
  let pumping = false;

  const panelCounts = { publicEmail: 0, results: 0 };
  const selected = new Set();
  const contactsByEmail = new Map();
  let testMode = true;
  let templates = [];
  let batchRunning = false;

  function isUserSearch() {
    const url = new URL(location.href);
    return url.pathname === '/search' && url.searchParams.get('type') === 'users';
  }

  function searchKeyword() {
    return new URL(location.href).searchParams.get('q') || '';
  }

  function scheduleScan() {
    window.clearTimeout(observerTimer);
    observerTimer = window.setTimeout(scan, 250);
  }

  function scan() {
    if (!isUserSearch()) {
      document.querySelector('#gho-panel')?.remove();
      return;
    }
    ensurePanel();
    const list = document.querySelector('[data-testid="results-list"]');
    if (!list) return;
    const cards = findCards(list);
    panelCounts.results = cards.length;
    panelCounts.publicEmail = 0;
    cards.forEach((card) => {
      const parsed = parseCard(card);
      if (!parsed) return;
      profiles.set(parsed.username, { ...(profiles.get(parsed.username) || {}), ...parsed, card });
      const cached = readCache(parsed.username);
      if (cached) {
        applyProfile(parsed.username, cached);
        return;
      }
      if (card.querySelector('.gho-row')) return;
      renderRow(card, { status: 'loading' });
      enqueue(() => loadProfile(parsed.username));
    });
    countPublicEmails();
    applyVisibility();
    ensureToolbar();
    updateSelectionBar();
    updatePanel();
    queueLookup();
  }

  function findCards(list) {
    const cards = [];
    list.querySelectorAll('.search-title').forEach((title) => {
      let node = title;
      while (node.parentElement && node.parentElement !== list) node = node.parentElement;
      if (!cards.includes(node)) cards.push(node);
    });
    return cards;
  }

  function parseCard(card) {
    const title = card.querySelector('.search-title');
    if (!title) return null;
    const link = [...title.querySelectorAll('a[href]')].find((anchor) => /^\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/?$/.test(anchor.getAttribute('href') || ''));
    if (!link) return null;
    const username = (link.getAttribute('href') || '').replace(/\//g, '');
    if (!/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))$/.test(username)) return null;
    const nameNode = title.querySelector('[class*="titleName"]') || title.querySelector('a');
    const loginNode = title.querySelector('[class*="titleLoginText"]');
    const image = card.querySelector('img[data-testid="github-avatar"], img[src*="avatars.githubusercontent.com"]');
    return {
      username,
      displayName: cleanText(nameNode) || username,
      login: cleanText(loginNode) || username,
      avatarUrl: image ? image.src : null,
      githubUrl: `https://github.com/${username}`,
    };
  }

  function enqueue(task) {
    queue.push(task);
    pump();
  }

  function pump() {
    if (pumping) return;
    pumping = true;
    while (activeFetches < MAX_CONCURRENT && queue.length > 0) {
      const task = queue.shift();
      const now = Date.now();
      if (!lastStartedAt) lastStartedAt = now;
      else lastStartedAt = Math.max(now, lastStartedAt + 300 + Math.floor(Math.random() * 201));
      const wait = lastStartedAt - now;
      activeFetches += 1;
      window.setTimeout(() => {
        Promise.resolve()
          .then(task)
          .catch(() => undefined)
          .finally(() => {
            activeFetches -= 1;
            pumping = false;
            pump();
          });
      }, wait);
    }
    pumping = false;
  }

  async function loadProfile(username, force) {
    if (!force) {
      const cached = readCache(username);
      if (cached) {
        applyProfile(username, cached);
        return;
      }
    }
    try {
      const html = await fetchProfileHtml(username);
      const profile = parseProfile(html, username);
      const record = { ...profile, timestamp: Date.now() };
      writeCache(username, record);
      applyProfile(username, record);
      if (profile.email) console.info(`[Github] Public email detected: ${username}`);
    } catch (error) {
      const current = profiles.get(username);
      if (current) current.error = true;
      if (current?.card) renderRow(current.card, { status: 'error', message: 'GitHub profile could not be checked.' });
      applyVisibility();
      updateToolbarCounts();
    }
  }

  async function fetchProfileHtml(username, attempt) {
    const response = await fetch(`https://github.com/${username}`, {
      credentials: 'include',
      headers: { Accept: 'text/html' },
    });
    if (response.status === 429 && !attempt) {
      const retryAfter = Number(response.headers.get('retry-after') || '5');
      await sleep(Math.min(Math.max(retryAfter, 1), 30) * 1000);
      return fetchProfileHtml(username, true);
    }
    if (!response.ok) throw new Error('profile fetch failed');
    if (response.url.includes('/login') || response.url.includes('/session')) {
      throw new Error('login wall');
    }
    return response.text();
  }

  function parseProfile(html, username) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, iframe, object').forEach((node) => node.remove());
    const title = doc.querySelector('title')?.textContent || '';
    if (/sign in to github/i.test(title)) throw new Error('login wall');
    if (/not found/i.test(title) && !doc.querySelector('.vcard-names, [itemprop="name"]')) {
      throw new Error('missing profile');
    }
    if (!doc.querySelector('.vcard-names, [itemprop="name"], .vcard-details')) {
      throw new Error('markup changed');
    }
    const displayName = cleanText(doc.querySelector('.vcard-fullname, h1 [itemprop="name"]'));
    return {
      email: extractPublicEmail(doc),
      displayName: displayName || profiles.get(username)?.displayName || username,
      bio: cleanText(doc.querySelector('.user-profile-bio, .p-note[data-bio-text]')),
      company: cleanDetail(doc.querySelector('[itemprop="worksFor"] .p-org, [itemprop="worksFor"] a')),
      location: cleanDetail(doc.querySelector('[itemprop="homeLocation"] .p-locality, [itemprop="homeLocation"]')),
      avatarUrl: doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || profiles.get(username)?.avatarUrl || null,
      checked: true,
    };
  }

  function extractPublicEmail(doc) {
    const selectors = [
      '[itemprop="email"] a[href^="mailto:"]',
      '.vcard-details a[href^="mailto:"]',
      'li.vcard-detail a[href^="mailto:"]',
      '.js-profile-editable-area a[href^="mailto:"]',
    ];
    for (const selector of selectors) {
      for (const link of doc.querySelectorAll(selector)) {
        const email = normalizeEmail(emailFromMailto(link.getAttribute('href')));
        if (isPersonalEmail(email)) return email;
      }
    }
    const labelled = doc.querySelector('[itemprop="email"]');
    const aria = labelled?.getAttribute('aria-label') || '';
    const match = aria.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match && isPersonalEmail(normalizeEmail(match[0]))) return normalizeEmail(match[0]);
    return null;
  }

  function applyProfile(username, profile) {
    const current = profiles.get(username);
    if (!current?.card) return;
    profiles.set(username, { ...current, ...profile, error: false });
    if (!profile.checked && profile.email === undefined) return;
    renderRow(current.card, {
      status: profile.email ? 'email' : 'empty',
      email: profile.email,
      saved: profile.email ? savedEmails.has(profile.email) : false,
    });
    countPublicEmails();
    applyVisibility();
    updateToolbarCounts();
    updatePanel();
    if (profile.email) queueLookup();
  }

  function renderRow(card, view) {
    const title = card.querySelector('.search-title');
    const anchor = title?.closest('h3') || title;
    if (!anchor) return;
    card.querySelector('.gho-row')?.remove();
    const row = document.createElement('div');
    row.className = 'gho-row';

    if (view.status === 'loading') {
      row.append(note('📧 Checking public profile…'));
    } else if (view.status === 'error') {
      row.append(note(view.message || 'GitHub profile could not be checked.'));
      row.append(button('Retry', () => refreshUser(cardUsername(card))));
    } else if (view.status === 'empty') {
      const badge = document.createElement('span');
      badge.className = 'gho-email gho-empty';
      badge.textContent = '📧 No public email';
      row.append(badge);
      row.append(button('Refresh', () => refreshUser(cardUsername(card))));
    } else if (view.status === 'email') {
      const username = cardUsername(card);
      const contact = contactsByEmail.get(String(view.email || '').toLowerCase());
      const blocked = contact?.status === 'DO_NOT_CONTACT' || contact?.status === 'OPTED_OUT';
      if (!blocked) {
        const label = document.createElement('label');
        label.className = 'gho-select';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = selected.has(username);
        box.addEventListener('change', () => {
          if (box.checked) selected.add(username);
          else selected.delete(username);
          updateToolbarCounts();
          updateSelectionBar();
          updatePanel();
        });
        label.append(box, document.createTextNode(' Select'));
        row.append(label);
      }
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'gho-email';
      badge.textContent = `📧 ${view.email}`;
      badge.title = 'Copy email';
      badge.addEventListener('click', () => copyEmail(badge, view.email));
      row.append(badge);
      const outreach = document.createElement('button');
      outreach.type = 'button';
      outreach.className = contact ? 'gho-btn gho-added' : 'gho-btn';
      outreach.textContent = outreachLabel(contact);
      outreach.disabled = Boolean(contact);
      if (!contact) outreach.addEventListener('click', () => addOutreach(username, outreach, row));
      row.append(outreach);
      row.append(button('Refresh', () => refreshUser(username)));
    }
    anchor.insertAdjacentElement('afterend', row);
  }

  function addOutreach(username, buttonNode, row) {
    console.info(`[GitHub Outreach] Add clicked: ${username}`);
    const profile = profiles.get(username);
    if (!profile?.email) {
      console.error('[GitHub Outreach] Backend request failed: public email was not available for this profile');
      showAddFailed(row, buttonNode, username, 'Add failed');
      return;
    }
    const payload = {
      username: profile.username || username,
      displayName: profile.displayName || profile.username || username,
      email: profile.email,
      githubUrl: profile.githubUrl || `https://github.com/${profile.username || username}`,
      avatarUrl: profile.avatarUrl || null,
      bio: profile.bio || null,
      location: profile.location || null,
      company: profile.company || null,
      searchKeyword: searchKeyword() || null,
      source: 'github',
    };
    buttonNode.disabled = true;
    buttonNode.textContent = 'Adding…';
    console.info(`[GitHub Outreach] Adding contact: ${payload.username}`);
    request('POST', '/api/contacts', payload).then(async (result) => {
      if (![200, 201].includes(result.status) || result.data?.success !== true) {
        const error = new Error(result.data?.message || result.data?.error || 'Add failed');
        error.status = result.status;
        error.body = result.data;
        throw error;
      }
      const email = String(result.data.contact?.email || payload.email).trim().toLowerCase();
      const listed = await api('GET', '/api/contacts');
      const found = (listed.contacts || []).some((contact) => String(contact.email || '').toLowerCase() === email);
      if (!found) {
        console.error('[GitHub Outreach] Backend request failed: Contact verification failed');
        showAddFailed(row, buttonNode, username, 'Contact verification failed');
        return;
      }
      savedEmails.add(email);
      contactsByEmail.set(email, result.data.contact || { email, status: 'NEW' });
      buttonNode.className = 'gho-btn gho-added';
      buttonNode.textContent = '✓ Added';
      buttonNode.disabled = true;
      row.querySelector('.gho-retry')?.remove();
      if (result.data.duplicate || result.data.created === false) {
        console.info('[GitHub Outreach] Contact already exists');
        setNote(row, 'Already in outreach');
      } else {
        console.info('[GitHub Outreach] Contact added successfully');
        row.querySelector('.gho-note')?.remove();
      }
      serverOnline = true;
      refreshStats();
      updatePanel();
    }).catch((error) => {
      console.error(`[GitHub Outreach] Backend request failed: ${error?.message || 'Request failed'}`);
      if (error?.status) console.error(`[GitHub Outreach] POST status: ${error.status}`);
      if (error?.body) console.error('[GitHub Outreach] POST response:', error.body);
      showAddFailed(row, buttonNode, username, 'Add failed');
      if (error?.message === 'offline') {
        serverOnline = false;
        updatePanel();
      }
    });
  }

  function showAddFailed(row, buttonNode, username, message) {
    buttonNode.disabled = false;
    buttonNode.className = 'gho-btn';
    buttonNode.textContent = '+ Outreach';
    setNote(row, message);
    if (!row.querySelector('.gho-retry')) {
      const retry = button('Retry', () => addOutreach(username, buttonNode, row));
      retry.classList.add('gho-retry');
      row.append(retry);
    }
  }

  function copyEmail(badge, email) {
    const original = badge.textContent;
    const done = () => {
      badge.textContent = '✓ Copied';
      window.setTimeout(() => { badge.textContent = original; }, 1000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(email).then(done).catch(() => fallbackCopy(email, done));
    } else {
      fallbackCopy(email, done);
    }
  }

  function fallbackCopy(email, done) {
    const input = document.createElement('textarea');
    input.value = email;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    done();
  }

  function refreshUser(username) {
    if (!username) return;
    GM_setValue(cacheKey(username), '');
    const profile = profiles.get(username);
    if (profile?.card) renderRow(profile.card, { status: 'loading' });
    enqueue(() => loadProfile(username, true));
  }

  function queueLookup() {
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(lookupSaved, 300);
  }

  function lookupSaved() {
    const emails = [...profiles.values()].map((profile) => profile.email).filter(Boolean);
    if (!emails.length) return;
    const query = encodeURIComponent([...new Set(emails)].slice(0, 100).join(','));
    api('GET', `/api/contacts/lookup?emails=${query}`).then((data) => {
      serverOnline = true;
      (data.contacts || []).forEach((contact) => {
        const email = String(contact.email || '').toLowerCase();
        if (!email) return;
        savedEmails.add(email);
        contactsByEmail.set(email, contact);
      });
      profiles.forEach((profile) => {
        if (profile.email && profile.card) {
          renderRow(profile.card, { status: 'email', email: profile.email, saved: savedEmails.has(profile.email) });
        }
      });
      countPublicEmails();
      applyVisibility();
      updateToolbarCounts();
      updatePanel();
    }).catch((error) => {
      console.error(`[GitHub Outreach] Backend request failed: ${error?.message || 'lookup failed'}`);
    });
  }

  function checkHealth() {
    return api('GET', '/api/health').then((data) => {
      if (!data?.ok || data.status !== 'online') {
        throw new Error('Health check failed');
      }
      if (serverOnline !== true) console.info('[GitHub Outreach] Backend online');
      serverOnline = true;
      testMode = data.testMode !== false;
      updatePanel();
      refreshStats();
    }).catch((error) => {
      serverOnline = false;
      serverStats = null;
      console.error(`[GitHub Outreach] Backend request failed: ${error?.message || 'offline'}`);
      updatePanel();
    });
  }

  function refreshStats() {
    api('GET', '/api/stats').then((stats) => {
      serverStats = stats;
      if (serverOnline !== false) updatePanel();
    }).catch((error) => {
      console.error(`[GitHub Outreach] Backend request failed: ${error?.message || 'stats failed'}`);
    });
  }

  function ensurePanel() {
    let panel = document.querySelector('#gho-panel');
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'gho-panel';
    const collapsed = GM_getValue('gho-collapsed', false);
    if (collapsed) panel.classList.add('gho-collapsed');
    const header = document.createElement('header');
    const title = document.createElement('span');
    title.textContent = 'GitHub Outreach';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gho-icon-btn';
    toggle.textContent = collapsed ? '+' : '–';
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      panel.classList.toggle('gho-collapsed');
      const isCollapsed = panel.classList.contains('gho-collapsed');
      toggle.textContent = isCollapsed ? '+' : '–';
      GM_setValue('gho-collapsed', isCollapsed);
    });
    header.append(title, toggle);
    makeDraggable(panel, header);
    const body = document.createElement('div');
    body.className = 'gho-panel-body';
    panel.append(header, body);
    document.body.append(panel);
    restorePosition(panel);
    updatePanel();
    checkHealth();
  }

  function updatePanel() {
    const panel = document.querySelector('#gho-panel');
    const body = panel?.querySelector('.gho-panel-body');
    if (!body) return;
    body.replaceChildren();
    body.append(stat('Public email', String(panelCounts.publicEmail)));
    body.append(stat('Selected', String(visibleSelected().length)));
    body.append(stat('Added', serverStats ? String(serverStats.total) : '—'));
    body.append(stat('Drafted', serverStats ? String(serverStats.drafted) : '—'));
    body.append(stat('Sent', serverStats ? String(serverStats.sent) : '—'));
    if (serverOnline === true) {
      const online = document.createElement('div');
      online.className = 'gho-online';
      online.textContent = 'Outreach server online';
      body.append(online);
    }
    if (serverOnline === false) {
      const offline = document.createElement('div');
      offline.className = 'gho-offline';
      offline.textContent = 'Outreach server offline';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'gho-open';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => {
        checkHealth();
        lookupSaved();
      });
      body.append(offline, retry);
      return;
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'gho-open';
    open.textContent = 'Open Outreach';
    open.addEventListener('click', () => window.open(API_BASE, '_blank', 'noopener'));
    body.append(open);
  }

  function countPublicEmails() {
    panelCounts.publicEmail = [...profiles.values()].filter((profile) => profile.email && profile.card?.isConnected).length;
  }

  function stat(label, value) {
    const row = document.createElement('div');
    row.className = 'gho-stat';
    const name = document.createElement('span');
    name.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = value;
    row.append(name, strong);
    return row;
  }

  function makeDraggable(panel, handle) {
    let drag = null;
    handle.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      const left = Math.max(8, event.clientX - drag.dx);
      const top = Math.max(8, event.clientY - drag.dy);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      GM_setValue('gho-position', JSON.stringify({ left: panel.style.left, top: panel.style.top }));
    });
  }

  function restorePosition(panel) {
    try {
      const saved = JSON.parse(GM_getValue('gho-position', '') || 'null');
      if (saved?.left && saved?.top) {
        panel.style.left = saved.left;
        panel.style.top = saved.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
    } catch {
      /* keep the default corner */
    }
  }

  function api(method, path, body) {
    return request(method, path, body).then((result) => result.data);
  }

  function request(method, path, body) {
    if (typeof GM_xmlhttpRequest !== 'function') {
      return Promise.reject(new Error('GM_xmlhttpRequest is not available. Reinstall the userscript with the GM_xmlhttpRequest grant.'));
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `${API_BASE}${path}`,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        data: body !== undefined ? JSON.stringify(body) : undefined,
        timeout: 8000,
        onload(response) {
          let data = {};
          const raw = response.responseText || '';
          try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
          const status = response.status || 0;
          if (method === 'POST') {
            console.info(`[GitHub Outreach] POST status: ${status}`);
            console.info('[GitHub Outreach] POST response:', data);
          }
          if (status >= 200 && status < 300) {
            resolve({ status, data });
            return;
          }
          const error = new Error(data.message || data.error || `HTTP ${status}`);
          error.status = status;
          error.body = data;
          reject(error);
        },
        onerror() { reject(new Error('offline')); },
        ontimeout() { reject(new Error('offline')); },
      });
    });
  }

  function readCache(username) {
    try {
      const raw = GM_getValue(cacheKey(username), '');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.timestamp || Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeCache(username, value) {
    GM_setValue(cacheKey(username), JSON.stringify(value));
  }

  function cacheKey(username) {
    return `gho-profile:${username.toLowerCase()}`;
  }

  function cardUsername(card) {
    const link = card?.querySelector('.search-title a[href]');
    return (link?.getAttribute('href') || '').replace(/\//g, '');
  }

  function note(text) {
    const node = document.createElement('span');
    node.className = 'gho-note';
    node.textContent = text;
    return node;
  }

  function setNote(row, text) {
    let node = row.querySelector('.gho-note');
    if (!node) {
      node = note(text);
      row.append(node);
    } else {
      node.textContent = text;
    }
  }

  function button(text, onClick) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'gho-btn';
    node.textContent = text;
    node.addEventListener('click', onClick);
    return node;
  }

  function emailFromMailto(href) {
    if (!href) return '';
    const raw = href.replace(/^mailto:/i, '').split('?')[0];
    try { return decodeURIComponent(raw); } catch { return raw; }
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isPersonalEmail(email) {
    if (!email || email.length > 320) return false;
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return false;
    return !email.endsWith('@users.noreply.github.com') && !email.endsWith('@noreply.github.com');
  }

  function cleanText(node) {
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function cleanDetail(node) {
    return cleanText(node).replace(/^(home location|location|organization|company)\s+/i, '');
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function outreachLabel(contact) {
    if (!contact) return '+ Outreach';
    const labels = {
      NEW: '✓ Added',
      DRAFTED: 'Drafted',
      APPROVED: 'Approved',
      SENT: 'Sent',
      FAILED: 'Failed',
      DO_NOT_CONTACT: 'Do Not Contact',
      OPTED_OUT: 'Opted Out',
      REPLIED: 'Replied',
    };
    return labels[contact.status] || contact.status;
  }

  function storedFlag(key) {
    return localStorage.getItem(key) === 'true';
  }

  function pageProfiles() {
    return [...profiles.values()].filter((profile) => profile.card?.isConnected);
  }

  function applyVisibility() {
    const emailOnly = storedFlag('githubOutreach.publicEmailOnly');
    const hideContacted = storedFlag('githubOutreach.hideContacted');
    pageProfiles().forEach((profile) => {
      const status = profile.email ? contactsByEmail.get(String(profile.email).toLowerCase())?.status : '';
      const contacted = ['SENT', 'DO_NOT_CONTACT', 'OPTED_OUT', 'DRAFTED', 'APPROVED'].includes(status);
      const hide = (emailOnly && profile.checked && !profile.email)
        || (emailOnly && profile.error)
        || (hideContacted && contacted);
      profile.card.style.display = hide ? 'none' : '';
    });
  }

  function selectableProfiles() {
    return pageProfiles().filter((profile) => {
      if (!profile.email || profile.card.style.display === 'none') return false;
      const status = contactsByEmail.get(String(profile.email).toLowerCase())?.status;
      return status !== 'DO_NOT_CONTACT' && status !== 'OPTED_OUT';
    });
  }

  function addedOnPage() {
    return pageProfiles().filter((profile) => profile.email && contactsByEmail.has(String(profile.email).toLowerCase())).length;
  }

  function ensureToolbar() {
    const list = document.querySelector('[data-testid="results-list"]');
    if (!list?.parentElement) return;
    let bar = document.querySelector('#gho-toolbar');
    if (!bar) {
      bar = document.createElement('section');
      bar.id = 'gho-toolbar';
      bar.dataset.ready = '1';
      list.parentElement.insertBefore(bar, list);
      const title = document.createElement('h2');
      title.textContent = 'GitHub Outreach';
      const toggles = document.createElement('div');
      toggles.className = 'gho-toolbar-row';
      toggles.append(
        toggleControl('Public Email Only', 'githubOutreach.publicEmailOnly'),
        toggleControl('Hide Contacted', 'githubOutreach.hideContacted'),
      );
      const templateRow = document.createElement('div');
      templateRow.className = 'gho-toolbar-row';
      const templateLabel = document.createElement('label');
      templateLabel.textContent = 'Template: ';
      const select = document.createElement('select');
      select.id = 'gho-template';
      select.addEventListener('change', () => {
        localStorage.setItem('githubOutreach.templateId', select.value);
      });
      templateLabel.append(select);
      templateRow.append(templateLabel);
      const actions = document.createElement('div');
      actions.className = 'gho-toolbar-actions';
      actions.append(
        actionButton('Select All With Email', selectAllWithEmail),
        actionButton('Clear', clearSelection),
        actionButton('Run Outreach', () => startBatch('run'), 'gho-primary'),
      );
      const counts = document.createElement('div');
      counts.id = 'gho-toolbar-counts';
      counts.className = 'gho-toolbar-row';
      bar.append(title, toggles, templateRow, actions, counts);
      loadTemplates();
    } else if (bar.nextElementSibling !== list) {
      list.parentElement.insertBefore(bar, list);
    }
    updateToolbarCounts();
  }

  function toggleControl(label, key) {
    const wrap = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = storedFlag(key);
    input.addEventListener('change', () => {
      localStorage.setItem(key, input.checked ? 'true' : 'false');
      applyVisibility();
      updateToolbarCounts();
      updateSelectionBar();
    });
    wrap.append(input, document.createTextNode(` ${label}`));
    return wrap;
  }

  function actionButton(text, onClick, className) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    if (className) node.className = className;
    node.addEventListener('click', onClick);
    return node;
  }

  function updateToolbarCounts() {
    const node = document.querySelector('#gho-toolbar-counts');
    if (!node) return;
    const withEmail = pageProfiles().filter((profile) => profile.email).length;
    node.textContent = `Detected: ${panelCounts.results}    With Public Email: ${withEmail}    Selected: ${visibleSelected().length}    Added: ${addedOnPage()}`;
  }

  function loadTemplates() {
    api('GET', '/api/templates').then((data) => {
      templates = data.templates || [];
      const select = document.querySelector('#gho-template');
      if (!select) return;
      select.replaceChildren();
      templates.forEach((template) => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = template.name;
        select.append(option);
      });
      const stored = localStorage.getItem('githubOutreach.templateId');
      if (stored && templates.some((template) => template.id === stored)) select.value = stored;
      else if (select.value) localStorage.setItem('githubOutreach.templateId', select.value);
    }).catch((error) => {
      console.error(`[GitHub Outreach] Backend request failed: ${error?.message || 'templates failed'}`);
    });
  }

  function selectAllWithEmail() {
    selectableProfiles().forEach((profile) => selected.add(profile.username));
    redrawRows();
  }

  function clearSelection() {
    selected.clear();
    redrawRows();
  }

  function redrawRows() {
    pageProfiles().forEach((profile) => {
      if (!profile.checked && !profile.error) return;
      const view = profile.error
        ? { status: 'error', message: 'GitHub profile could not be checked.' }
        : profile.email
          ? { status: 'email', email: profile.email, saved: savedEmails.has(profile.email) }
          : { status: 'empty' };
      renderRow(profile.card, view);
    });
    applyVisibility();
    updateToolbarCounts();
    updateSelectionBar();
    updatePanel();
  }

  function updateSelectionBar() {
    let bar = document.querySelector('#gho-actionbar');
    const visible = visibleSelected();
    if (visible.length === 0) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'gho-actionbar';
      document.body.append(bar);
    }
    bar.replaceChildren();
    const count = document.createElement('strong');
    count.textContent = `${visible.length} selected`;
    bar.append(
      count,
      actionButton('Add to Outreach', () => startBatch('add')),
      actionButton('Create Drafts', () => startBatch('draft')),
      actionButton('Run Outreach', () => startBatch('run'), 'gho-primary'),
      actionButton('Clear', clearSelection),
    );
  }

  function visibleSelected() {
    return selectableProfiles().filter((profile) => selected.has(profile.username));
  }

  function selectedPayloads() {
    return visibleSelected()
      .map((profile) => ({
        username: profile.username,
        displayName: profile.displayName || profile.username,
        email: profile.email,
        githubUrl: profile.githubUrl || `https://github.com/${profile.username}`,
        avatarUrl: profile.avatarUrl || null,
        bio: profile.bio || null,
        location: profile.location || null,
        company: profile.company || null,
        searchKeyword: searchKeyword() || null,
        source: 'github',
      }));
  }

  function startBatch(mode) {
    if (batchRunning) return;
    const payloads = selectedPayloads();
    if (!payloads.length) {
      openModal('Nothing to add', 'Select a visible result with a public email.');
      return;
    }
    const templateId = localStorage.getItem('githubOutreach.templateId') || document.querySelector('#gho-template')?.value;
    if (mode !== 'add' && !templateId) {
      openModal('Choose a template', 'Pick a template before creating drafts.');
      return;
    }
    batchRunning = true;
    runBatch(mode, payloads, templateId).catch((error) => {
      console.error(`[GitHub Outreach] Backend request failed: ${error?.message || 'batch failed'}`);
      openModal('Batch failed', error?.message || 'The batch could not be completed.');
    }).finally(() => {
      batchRunning = false;
      lookupSaved();
      refreshStats();
    });
  }

  async function runBatch(mode, payloads, templateId) {
    const saved = [];
    for (let index = 0; index < payloads.length; index += 1) {
      openModal('Preparing contacts', `Preparing contacts ${index + 1} / ${payloads.length}`);
      const result = await request('POST', '/api/contacts/bulk', { contacts: [payloads[index]] });
      const contact = result.data?.contacts?.[0];
      if (result.data?.success && contact) {
        contactsByEmail.set(String(contact.email).toLowerCase(), contact);
        savedEmails.add(String(contact.email).toLowerCase());
        const status = contact.status;
        if (status === 'DO_NOT_CONTACT' || status === 'OPTED_OUT' || status === 'SENT') continue;
        saved.push(contact);
      }
    }
    redrawRows();
    if (mode === 'add') {
      openModal('Contacts saved', `Added or updated ${saved.length} contact${saved.length === 1 ? '' : 's'}.`);
      return;
    }
    const drafts = [];
    const failures = [];
    for (let index = 0; index < saved.length; index += 1) {
      openModal('Creating drafts', `Creating drafts ${index + 1} / ${saved.length}`);
      const result = await request('POST', '/api/outreach/bulk-draft', {
        contactIds: [saved[index].id],
        templateId,
      });
      (result.data?.outreach || []).forEach((row) => drafts.push(row));
      (result.data?.failures || []).forEach((row) => failures.push(row));
    }
    showPreview(drafts, failures, mode === 'run');
  }

  function showPreview(drafts, failures, allowSend) {
    const modal = ensureModal();
    modal.replaceChildren();
    if (testMode) {
      const banner = document.createElement('p');
      banner.className = 'gho-test';
      banner.textContent = 'TEST MODE — no email was sent.';
      modal.append(banner);
    }
    const title = document.createElement('h3');
    title.textContent = 'Ready to Send';
    const summary = document.createElement('p');
    summary.textContent = `Recipients: ${drafts.length}`;
    modal.append(title, summary);
    drafts.forEach((row) => {
      const block = document.createElement('div');
      block.className = 'gho-preview';
      const name = document.createElement('strong');
      name.textContent = row.contact?.displayName || row.contact?.username || 'Contact';
      const email = document.createElement('div');
      email.textContent = row.contact?.email || '';
      const subject = document.createElement('div');
      subject.textContent = row.subject || '';
      block.append(name, email, subject);
      modal.append(block);
    });
    if (failures.length) {
      const failed = document.createElement('p');
      failed.textContent = `Failed drafts: ${failures.length}`;
      modal.append(failed);
    }
    const actions = document.createElement('div');
    actions.className = 'gho-toolbar-actions';
    actions.append(actionButton('Cancel', () => modal.remove()));
    actions.append(actionButton('Back to Preview', () => showPreview(drafts, failures, allowSend)));
    if (allowSend && drafts.length) {
      const send = actionButton(`Approve & Send ${drafts.length}`, () => approveAndSend(drafts), 'gho-primary');
      actions.append(send);
    }
    modal.append(actions);
  }

  async function approveAndSend(drafts) {
    const ids = drafts.map((row) => row.id).filter(Boolean);
    openModal('Approving', `Approving ${ids.length} draft${ids.length === 1 ? '' : 's'}`);
    await request('POST', '/api/outreach/bulk-approve', { outreachIds: ids });
    const sent = [];
    const failed = [];
    const skipped = [];
    for (let index = 0; index < ids.length; index += 1) {
      const name = drafts[index]?.contact?.displayName || drafts[index]?.contact?.username || 'Contact';
      openModal(`Sending ${index + 1} / ${ids.length}`, name);
      const result = await request('POST', '/api/outreach/bulk-send', { outreachIds: [ids[index]] });
      (result.data?.sent || []).forEach((row) => sent.push(row));
      (result.data?.failed || []).forEach((row) => failed.push(row));
      (result.data?.skipped || []).forEach((row) => skipped.push(row));
    }
    showResults(sent, failed, skipped, drafts);
  }

  function showResults(sent, failed, skipped, drafts) {
    const modal = ensureModal();
    modal.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = 'Completed';
    const banner = document.createElement('p');
    banner.className = 'gho-test';
    banner.textContent = testMode ? 'TEST MODE — no email was sent.' : 'Batch send finished.';
    const lines = document.createElement('p');
    lines.textContent = `Sent: ${sent.length}    Failed: ${failed.length}    Skipped: ${skipped.length}`;
    modal.append(title, banner, lines);
    const actions = document.createElement('div');
    actions.className = 'gho-toolbar-actions';
    if (failed.length) {
      actions.append(actionButton('Retry Failed', async () => {
        const failedIds = failed.map((row) => row.outreachId).filter(Boolean);
        await request('POST', '/api/outreach/bulk-approve', { outreachIds: failedIds });
        const retryDrafts = drafts.filter((row) => failedIds.includes(row.id));
        await approveAndSend(retryDrafts);
      }));
    }
    actions.append(actionButton('Close', () => modal.remove()));
    modal.append(actions);
    refreshStats();
    lookupSaved();
  }

  function openModal(titleText, bodyText) {
    const modal = ensureModal();
    modal.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = titleText;
    modal.append(title);
    if (bodyText) {
      const body = document.createElement('p');
      body.textContent = bodyText;
      modal.append(body);
    }
  }

  function ensureModal() {
    let modal = document.querySelector('#gho-modal');
    if (!modal) {
      modal = document.createElement('section');
      modal.id = 'gho-modal';
      document.body.append(modal);
    }
    return modal;
  }

  const observer = new MutationObserver((mutations) => {
    const externalChange = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (node.nodeType !== 1) return false;
        return !(node.classList?.contains('gho-row') || node.id === 'gho-panel' || node.closest?.('#gho-panel, .gho-row'));
      }),
    );
    if (externalChange) scheduleScan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleScan);
  document.addEventListener('turbo:render', scheduleScan);
  scheduleScan();
})();
