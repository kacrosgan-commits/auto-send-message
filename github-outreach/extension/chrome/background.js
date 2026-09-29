const API_BASE = 'http://127.0.0.1:3847';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'api' || typeof message.path !== 'string' || !message.path.startsWith('/api/')) {
    return undefined;
  }
  const method = typeof message.method === 'string' ? message.method : 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  fetch(`${API_BASE}${message.path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(message.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: message.body !== undefined ? JSON.stringify(message.body) : undefined,
    signal: controller.signal,
  }).then(async (response) => {
    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }
    sendResponse({ ok: true, status: response.status, data });
  }).catch(() => {
    sendResponse({ ok: false, error: 'offline' });
  }).finally(() => {
    clearTimeout(timer);
  });
  return true;
});
