// ==UserScript==
// @name         GitHub Outreach
// @namespace    http://localhost:3847
// @version      1.1.0
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

  const API = 'http://localhost:3847';
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
    #gho-panel { position: fixed; right: 16px; bottom: 16px; width: 260px; z-index: 80; background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #f0f6fc); border: 1px solid var(--borderColor-default, #30363d); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.28); font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #gho-panel header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; cursor: grab; border-bottom: 1px solid var(--borderColor-muted, #30363d); font-weight: 600; }
    #gho-panel.gho-collapsed header { border-bottom: 0; }
    #gho-panel.gho-collapsed .gho-panel-body { display: none; }
    .gho-panel-body { padding: 10px 12px 12px; }
    .gho-stat { display: flex; justify-content: space-between; color: var(--fgColor-muted, #8b949e); margin: 2px 0; }
    .gho-stat strong { color: var(--fgColor-default, #f0f6fc); font-weight: 600; }
    .gho-offline { color: var(--fgColor-danger, #f85149); margin: 6px 0; }
    .gho-online { color: var(--fgColor-success, #3fb950); margin: 6px 0; }
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
      else lastStartedAt = Math.max(now, lastStartedAt + 200 + Math.floor(Math.random() * 301));
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
      if (current?.card) renderRow(current.card, { status: 'error', message: 'GitHub profile could not be checked.' });
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
    profiles.set(username, { ...current, ...profile });
    if (!profile.checked && profile.email === undefined) return;
    renderRow(current.card, {
      status: profile.email ? 'email' : 'empty',
      email: profile.email,
      saved: profile.email ? savedEmails.has(profile.email) : false,
    });
    countPublicEmails();
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
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'gho-email';
      badge.textContent = `📧 ${view.email}`;
      badge.title = 'Copy email';
      badge.addEventListener('click', () => copyEmail(badge, view.email));
      row.append(badge);
      const outreach = document.createElement('button');
      outreach.type = 'button';
      outreach.className = view.saved ? 'gho-btn gho-added' : 'gho-btn';
      outreach.textContent = view.saved ? '✓ Added' : '+ Outreach';
      outreach.disabled = Boolean(view.saved);
      if (!view.saved) outreach.addEventListener('click', () => addOutreach(cardUsername(card), outreach, row));
      row.append(outreach);
      row.append(button('Refresh', () => refreshUser(cardUsername(card))));
    }
    anchor.insertAdjacentElement('afterend', row);
  }

  function addOutreach(username, buttonNode, row) {
    const profile = profiles.get(username);
    if (!profile?.email) return;
    buttonNode.disabled = true;
    buttonNode.textContent = 'Adding…';
    console.info(`[GitHub Outreach] Adding contact: ${username}`);
    api('POST', '/api/contacts', {
      username: profile.username,
      displayName: profile.displayName || profile.username,
      email: profile.email,
      githubUrl: profile.githubUrl,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio || null,
      location: profile.location || null,
      company: profile.company || null,
      searchKeyword: searchKeyword(),
      source: 'github',
    }).then((result) => {
      savedEmails.add(profile.email);
      buttonNode.className = 'gho-btn gho-added';
      buttonNode.textContent = '✓ Added';
      buttonNode.disabled = true;
      if (result?.duplicate) {
        console.info('[GitHub Outreach] Contact already exists');
        setNote(row, 'Already in outreach');
      } else {
        console.info('[GitHub Outreach] Contact added successfully');
      }
      serverOnline = true;
      refreshStats();
      updatePanel();
    }).catch((error) => {
      buttonNode.disabled = false;
      buttonNode.textContent = '+ Outreach';
      const message = error?.message || 'Request failed';
      console.error(`[GitHub Outreach] Backend request failed: ${message}`);
      setNote(row, message === 'offline' ? 'Outreach server offline' : message);
      if (message === 'offline') {
        serverOnline = false;
        updatePanel();
      }
    });
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
      (data.contacts || []).forEach((contact) => savedEmails.add(contact.email));
      profiles.forEach((profile) => {
        if (profile.email && profile.card) {
          renderRow(profile.card, { status: 'email', email: profile.email, saved: savedEmails.has(profile.email) });
        }
      });
      countPublicEmails();
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
    body.append(stat('Selected', serverStats ? String(serverStats.total) : '—'));
    body.append(stat('Public email', String(panelCounts.publicEmail)));
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
    open.addEventListener('click', () => window.open(API, '_blank', 'noopener'));
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
    const url = `${API}${path}`;
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (typeof GM_xmlhttpRequest === 'function') {
      return gmRequest(method, url, headers, body).catch(() => pageRequest(method, url, headers, body));
    }
    return pageRequest(method, url, headers, body);
  }

  function gmRequest(method, url, headers, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data: body ? JSON.stringify(body) : undefined,
        timeout: 8000,
        onload: (response) => {
          let data = {};
          try { data = response.responseText ? JSON.parse(response.responseText) : {}; } catch { data = {}; }
          if (response.status >= 200 && response.status < 300) resolve(data);
          else reject(new Error(data.error || `HTTP ${response.status || 0}`));
        },
        onerror: () => reject(new Error('offline')),
        ontimeout: () => reject(new Error('offline')),
      });
    });
  }

  function pageRequest(method, url, headers, body) {
    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (response) => {
      let data = {};
      try { data = await response.json(); } catch { data = {}; }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }).catch((error) => {
      if (error instanceof TypeError) throw new Error('offline');
      throw error;
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
