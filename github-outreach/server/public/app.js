const appRoot = document.querySelector('#app');

const state = {
  view: 'contacts',
  contacts: [],
  templates: [],
  variables: [],
  outreach: [],
  summary: null,
  auth: null,
  contact: null,
  selected: new Set(),
  filters: {
    q: '',
    status: '',
    searchKeyword: '',
    company: '',
    location: '',
    username: '',
    hasEmail: '',
    from: '',
    to: '',
  },
  templateId: '',
  banner: null,
  modal: null,
  busy: false,
  refreshLabel: '',
  timingDraft: {},
};

const VIEWS = [
  ['contacts', 'Contacts'],
  ['templates', 'Templates'],
  ['drafts', 'Drafts'],
  ['approved', 'Approved'],
  ['sent', 'Sent'],
  ['settings', 'Settings'],
];

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.modal && !state.busy) {
    state.modal = null;
    render();
  }
});

boot();

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('gmail') === 'connected') {
    state.banner = { type: 'ok', text: 'Gmail connected.' };
  } else if (params.get('gmail') === 'error') {
    state.banner = { type: 'error', text: params.get('message') || 'Google connection failed.' };
  }
  if (params.get('gmail')) history.replaceState({}, '', '/');
  render();
  await refreshAll();
}

let refreshTimer = 0;
function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshAll();
  }, 300);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleRefresh();
});
window.addEventListener('focus', scheduleRefresh);
window.setInterval(() => {
  if (document.visibilityState !== 'visible' || state.modal || state.busy) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
  refreshAll('poll');
}, 10000);

async function refreshAll(reason) {
  const manual = reason === 'manual';
  if (manual) {
    console.info('[Dashboard] Refresh clicked');
    state.refreshLabel = 'Refreshing...';
    render();
  }
  console.info('[Dashboard] GET /api/contacts');
  try {
    const [summary, contacts, templates, auth] = await Promise.all([
      api('/api/stats'),
      api(`/api/contacts${filterQuery()}`),
      api('/api/templates'),
      api('/api/auth/status'),
    ]);
    state.summary = summary;
    state.contacts = Array.isArray(contacts.contacts) ? contacts.contacts : [];
    console.info(`[Dashboard] Contacts received: ${state.contacts.length}`);
    state.templates = templates.templates;
    state.variables = templates.variables;
    state.auth = auth;
    if (!state.templateId && state.templates[0]) state.templateId = state.templates[0].id;
    if (state.view === 'drafts' || state.view === 'approved' || state.view === 'sent') {
      await loadOutreach();
    }
    if (state.view === 'contact' && state.contact) {
      state.contact = (await api(`/api/contacts/${state.contact.id}`)).contact;
    }
    if (manual) state.refreshLabel = 'Updated';
  } catch (error) {
    if (manual) state.refreshLabel = 'Refresh failed';
    state.banner = { type: 'error', text: error.message };
  }
  render();
  if (manual) {
    window.setTimeout(() => {
      if (state.refreshLabel === 'Updated' || state.refreshLabel === 'Refresh failed') {
        state.refreshLabel = '';
        render();
      }
    }, 1600);
  }
}

async function loadOutreach() {
  const status = state.view === 'drafts' ? 'DRAFTED' : state.view === 'approved' ? 'APPROVED' : 'SENT';
  state.outreach = (await api(`/api/outreach?status=${status}`)).outreach;
}

function filterQuery() {
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('The outreach server returned an unreadable response.');
    }
  }
  if (!response.ok) throw new Error(data.message || data.error || 'Request failed.');
  return data;
}

function render() {
  appRoot.replaceChildren(shell());
}

function shell() {
  return h('div', {}, [
    h('header', { class: 'app-header' }, [
      h('div', {}, [
        h('h1', {}, 'GitHub Outreach'),
        h('p', { class: 'subtitle' }, 'Public GitHub emails, reviewed locally, sent only after you approve.'),
      ]),
      h('div', { class: 'header-actions' }, [
        h('button', { class: 'btn', onclick: () => refreshAll('manual') }, state.refreshLabel || 'Refresh'),
        connectionPill(),
      ]),
    ]),
    h('main', { class: 'wrap' }, [
      summaryBar(),
      h('nav', { class: 'nav' }, VIEWS.map(([id, label]) =>
        h('button', {
          class: state.view === id ? 'active' : '',
          onclick: () => setView(id),
        }, label),
      )),
      state.auth?.testMode
        ? h('div', { class: 'warning' }, 'Test mode is on. Messages stay in Gmail Drafts and are not marked sent. Set OUTREACH_TEST_MODE=false in server/.env and restart.')
        : null,
      banner(),
      viewBody(),
      modal(),
    ]),
  ]);
}

function connectionPill() {
  if (!state.auth) return h('span', { class: 'muted' }, 'Checking Gmail…');
  if (!state.auth.configured) return h('span', { class: 'badge FAILED' }, 'Gmail not configured');
  if (!state.auth.connected) return h('span', { class: 'badge FAILED' }, 'Gmail is not connected');
  return h('span', { class: 'badge SENT' }, `Connected ${state.auth.email || ''}`);
}

function summaryBar() {
  const summary = state.summary || {};
  const items = [
    ['Contacts', summary.total],
    ['Ready', summary.ready],
    ['Drafted', summary.drafted],
    ['Approved', summary.approved],
    ['Sent', summary.sent],
    ['Failed', summary.failed],
    ['Do Not Contact', summary.doNotContact],
  ];
  return h('section', { class: 'summary' }, items.map(([label, value]) =>
    h('div', { class: 'stat' }, [h('span', {}, label), h('strong', {}, value ?? '–')]),
  ));
}

function banner() {
  if (!state.banner) return null;
  return h('div', { class: `banner ${state.banner.type === 'error' ? 'error' : 'ok'}` }, [
    h('span', {}, state.banner.text),
    h('button', { class: 'btn-ghost', onclick: () => { state.banner = null; render(); } }, 'Dismiss'),
  ]);
}

function viewBody() {
  if (state.view === 'contacts') return contactsView();
  if (state.view === 'contact') return contactView();
  if (state.view === 'templates') return templatesView();
  if (state.view === 'settings') return settingsView();
  return outreachView();
}

function contactsView() {
  const eligible = state.contacts.filter(canDraft);
  return h('section', {}, [
    h('div', { class: 'filters' }, [
      filterInput('q', 'Search name, username, email'),
      filterSelect('status', 'Status', ['', ...['NEW', 'DRAFTED', 'APPROVED', 'SENT', 'REPLIED', 'FAILED', 'OPTED_OUT', 'DO_NOT_CONTACT']]),
      filterInput('searchKeyword', 'Search keyword'),
      filterInput('company', 'Company'),
      filterInput('location', 'Location'),
      filterInput('username', 'GitHub username'),
      filterSelect('hasEmail', 'Public email', [['', 'Any email'], ['true', 'Has public email'], ['false', 'No public email']]),
      filterInput('from', 'From', 'date'),
      filterInput('to', 'To', 'date'),
      h('button', { class: 'btn', onclick: () => refreshAll() }, 'Apply'),
    ]),
    h('div', { class: 'toolbar' }, [
      h('select', {
        onchange: (event) => { state.templateId = event.target.value; },
      }, state.templates.map((template) =>
        h('option', { value: template.id, selected: template.id === state.templateId }, template.name),
      )),
      h('button', {
        class: 'btn-primary',
        disabled: selectedContacts().length === 0,
        onclick: () => openPreview(selectedContacts().map((contact) => contact.id)),
      }, 'Create Drafts'),
      h('span', { class: 'muted' }, `${selectedContacts().length} selected · ${eligible.length} ready to draft`),
    ]),
    state.contacts.length
      ? h('div', { class: 'table-wrap' }, [
          h('table', {}, [
            h('thead', {}, [
              h('tr', {}, [
                h('th', {}, [
                  h('input', {
                    type: 'checkbox',
                    checked: eligible.length > 0 && eligible.every((contact) => state.selected.has(contact.id)),
                    onchange: (event) => {
                      eligible.forEach((contact) => {
                        if (event.target.checked) state.selected.add(contact.id);
                        else state.selected.delete(contact.id);
                      });
                      render();
                    },
                  }),
                ]),
                h('th', {}, 'Name'),
                h('th', {}, 'GitHub'),
                h('th', {}, 'Email'),
                h('th', {}, 'Status'),
                h('th', {}, 'Added'),
                h('th', {}, 'Action'),
              ]),
            ]),
            h('tbody', {}, state.contacts.map(contactRow)),
          ]),
        ])
      : h('div', { class: 'empty card' }, 'No contacts yet. Add someone from GitHub user search.'),
  ]);
}

function contactRow(contact) {
  const draftable = canDraft(contact);
  return h('tr', {}, [
    h('td', {}, [
      h('input', {
        type: 'checkbox',
        disabled: !draftable,
        checked: state.selected.has(contact.id),
        title: draftable ? 'Select for draft creation' : 'This contact cannot receive a new draft',
        onchange: (event) => {
          if (event.target.checked) state.selected.add(contact.id);
          else state.selected.delete(contact.id);
          render();
        },
      }),
    ]),
    h('td', {}, [
      h('div', { class: 'name' }, contact.displayName || contact.username),
      h('div', { class: 'handle' }, `@${contact.username}`),
    ]),
    h('td', {}, h('a', { href: contact.githubUrl, target: '_blank', rel: 'noreferrer' }, contact.username)),
    h('td', {}, contact.email),
    h('td', {}, badge(contact.status)),
    h('td', {}, timeAgo(contact.createdAt)),
    h('td', {}, h('button', { class: 'btn', onclick: () => openContact(contact.id) }, 'Preview')),
  ]);
}

function contactView() {
  const contact = state.contact;
  if (!contact) return h('div', { class: 'empty card' }, 'Loading contact…');
  const blocked = contact.status === 'DO_NOT_CONTACT' || contact.status === 'OPTED_OUT';
  const latest = contact.outreaches?.[0];
  return h('section', { class: 'detail' }, [
    h('aside', { class: 'card profile-side' }, [
      contact.avatarUrl ? h('img', { src: contact.avatarUrl, alt: '' }) : null,
      h('div', { class: 'name' }, contact.displayName || contact.username),
      h('div', { class: 'handle' }, `@${contact.username}`),
      h('p', {}, badge(contact.status)),
      h('button', { class: 'btn-ghost', onclick: () => setView('contacts') }, 'Back to contacts'),
    ]),
    h('div', {}, [
      blocked ? h('div', { class: 'warning' }, 'This person is marked do-not-contact. Drafts and sending are disabled.') : null,
      h('div', { class: 'card' }, [
        infoLine('Name', contact.displayName || '—'),
        infoLine('Username', contact.username),
        infoLine('GitHub profile', contact.githubUrl),
        infoLine('Email', contact.email),
        infoLine('Bio', contact.bio || '—'),
        infoLine('Company', contact.company || '—'),
        infoLine('Location', contact.location || '—'),
        infoLine('Search keyword', contact.searchKeyword || '—'),
        infoLine('Date collected', formatDate(contact.createdAt)),
        infoLine('Current outreach status', contact.status),
        infoLine('Last contacted', contact.lastContactedAt ? formatDate(contact.lastContactedAt) : '—'),
        infoLine('Contact attempts', String(contact.contactAttempts)),
        latest?.failureReason ? infoLine('Last failure', latest.failureReason) : null,
      ]),
      h('div', { class: 'row-actions', style: 'margin-top:12px' }, [
        h('select', {
          disabled: blocked,
          onchange: (event) => { state.templateId = event.target.value; },
        }, state.templates.map((template) =>
          h('option', { value: template.id, selected: template.id === state.templateId }, template.name),
        )),
        h('button', {
          class: 'btn',
          disabled: blocked || !canDraft(contact),
          onclick: () => openPreview([contact.id]),
        }, 'Preview Message'),
        h('button', {
          class: 'btn-primary',
          disabled: blocked || !canDraft(contact),
          onclick: () => openPreview([contact.id]),
        }, 'Create Draft'),
        latest && (latest.status === 'DRAFTED' || latest.status === 'FAILED')
          ? h('button', { class: 'btn', onclick: () => approve(latest.id) }, latest.status === 'FAILED' ? 'Approve again' : 'Approve')
          : null,
        latest && latest.status === 'APPROVED'
          ? h('button', { class: 'btn-primary', onclick: () => confirmSend(latest) }, 'Send')
          : null,
        contact.status === 'SENT'
          ? h('button', { class: 'btn', onclick: () => markStatus(contact.id, 'REPLIED') }, 'Mark replied')
          : null,
        h('button', { class: 'btn-danger', disabled: blocked, onclick: () => markStatus(contact.id, 'DO_NOT_CONTACT') }, 'Mark Do Not Contact'),
        h('button', { class: 'btn-danger', disabled: blocked, onclick: () => markStatus(contact.id, 'OPTED_OUT') }, 'Mark opted out'),
        h('button', { class: 'btn-danger', onclick: () => removeContact(contact.id) }, 'Delete'),
      ]),
    ]),
  ]);
}

function templatesView() {
  return h('section', { class: 'split' }, [
    h('div', { class: 'card' }, [
      h('div', { class: 'toolbar' }, [
        h('strong', {}, 'Templates'),
        h('button', { class: 'btn-primary', onclick: () => openTemplate() }, 'Create'),
      ]),
      state.templates.length
        ? h('div', { class: 'table-wrap' }, [
            h('table', {}, [
              h('thead', {}, h('tr', {}, [h('th', {}, 'Name'), h('th', {}, 'Subject'), h('th', {}, 'Action')])),
              h('tbody', {}, state.templates.map((template) =>
                h('tr', {}, [
                  h('td', {}, template.name),
                  h('td', {}, template.subject),
                  h('td', {}, h('div', { class: 'row-actions' }, [
                    h('button', { class: 'btn', onclick: () => openTemplate(template) }, 'Edit'),
                    h('button', { class: 'btn', onclick: () => duplicateTemplate(template) }, 'Duplicate'),
                    h('button', { class: 'btn', onclick: () => previewTemplateSample(template) }, 'Preview'),
                    h('button', { class: 'btn-danger', onclick: () => removeTemplate(template.id) }, 'Delete'),
                  ])),
                ]),
              )),
            ]),
          ])
        : h('div', { class: 'empty' }, 'No templates yet.'),
    ]),
    h('aside', { class: 'card' }, [
      h('strong', {}, 'Variables'),
      h('p', { class: 'muted' }, 'Use {{first_name | default:"there"}} when a profile title should not be treated as a name.'),
      ...state.variables.map((name) => h('div', {}, `{{${name}}}`)),
    ]),
  ]);
}

function outreachView() {
  const title = state.view === 'drafts' ? 'Drafts' : state.view === 'approved' ? 'Approved' : 'Sent';
  const waiting = (state.summary?.drafted ?? 0) + (state.summary?.approved ?? 0);
  return h('section', { class: 'card' }, [
    h('div', { class: 'toolbar' }, [
      h('h2', {}, title),
      state.view === 'sent' ? null : h('button', {
        class: 'btn-primary',
        disabled: state.busy || waiting === 0,
        onclick: confirmApproveAndSendAll,
      }, waiting ? `Approve & send all (${waiting})` : 'Approve & send all'),
      state.view === 'sent' ? null : h('input', {
        id: 'test-recipient',
        type: 'email',
        placeholder: 'Test inbox',
        value: state.testRecipient ?? state.auth?.testRecipient ?? '',
        oninput: (event) => { state.testRecipient = event.target.value; },
      }),
      state.view === 'sent' ? null : h('button', {
        class: 'btn',
        disabled: state.busy || (!state.outreach.length && !state.templateId),
        onclick: confirmPlacementTest,
      }, 'Send test'),
    ]),
    h('p', { class: 'muted' }, state.view === 'sent'
      ? 'Sent messages stay in Gmail. This list only shows messages this app sent.'
      : 'Approve & send all handles every draft and every approved message. Send test delivers one copy to the address in the box.'),
    state.outreach.length
      ? h('div', { class: 'table-wrap' }, [
          h('table', {}, [
            h('thead', {}, h('tr', {}, ['To', 'Subject', 'Status', 'Created', 'Action'].map((label) => h('th', {}, label)))),
            h('tbody', {}, state.outreach.map((item) =>
              h('tr', {}, [
                h('td', {}, [
                  h('div', {}, item.contact.displayName || item.contact.username),
                  h('div', { class: 'handle' }, item.contact.email),
                ]),
                h('td', {}, item.subject),
                h('td', {}, badge(item.status)),
                h('td', {}, timeAgo(item.createdAt)),
                h('td', {}, h('div', { class: 'row-actions' }, outreachActions(item))),
              ]),
            )),
          ]),
        ])
      : h('div', { class: 'empty' }, `No ${title.toLowerCase()} yet.`),
  ]);
}

function outreachActions(item) {
  const actions = [h('button', { class: 'btn', onclick: () => openContact(item.contactId) }, 'Contact')];
  if (item.status === 'DRAFTED') actions.push(h('button', { class: 'btn-primary', onclick: () => approve(item.id) }, 'Approve'));
  if (item.status === 'FAILED') actions.push(h('button', { class: 'btn', onclick: () => approve(item.id) }, 'Approve again'));
  if (item.status === 'APPROVED') actions.push(h('button', { class: 'btn-primary', onclick: () => confirmSend(item) }, 'Send'));
  return actions;
}

function settingsView() {
  const auth = state.auth;
  return h('section', { class: 'split' }, [
    h('div', { class: 'card' }, [
      h('h2', {}, 'Gmail'),
      !auth
        ? h('p', {}, 'Checking connection…')
        : auth.configured
          ? auth.connected
            ? h('div', {}, [
                h('p', {}, `Connected as ${auth.email || 'your Google account'}.`),
                h('p', { class: 'muted' }, auth.expiresAt ? `Access expires ${formatDate(auth.expiresAt)} and refreshes automatically.` : ''),
                h('button', { class: 'btn-danger', onclick: disconnect }, 'Disconnect Gmail'),
              ])
            : h('div', {}, [
                h('p', {}, 'Gmail is not connected.'),
                h('a', { class: 'btn-primary', href: '/api/auth/google' }, 'Connect Gmail'),
              ])
          : h('div', { class: 'warning' }, 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to server/.env, then restart the server.'),
    ]),
    h('div', { class: 'card' }, [
      h('h2', {}, 'Send timing'),
      infoLine('Sends today', auth ? `${auth.sendsToday} / ${auth.maxSendsPerDay}` : '—'),
      infoLine('Max attempts per email', auth ? String(auth.maxContactAttempts) : '—'),
      field('Max sends per day (1–500)', h('input', {
        id: 'max-sends',
        type: 'number',
        min: '1',
        max: '500',
        value: timingValue('max-sends', String(auth?.maxSendsPerDay ?? 20)),
        oninput: (event) => { state.timingDraft['max-sends'] = event.target.value; },
      })),
      field('Seconds between sends (0–3600)', h('input', {
        id: 'send-gap',
        type: 'number',
        min: '0',
        max: '3600',
        value: timingValue('send-gap', String(auth?.minSecondsBetweenSends ?? 60)),
        oninput: (event) => { state.timingDraft['send-gap'] = event.target.value; },
      })),
      field('Test recipient', h('input', {
        id: 'test-recipient',
        type: 'email',
        placeholder: 'you@example.com',
        value: state.testRecipient ?? auth?.testRecipient ?? '',
        oninput: (event) => { state.testRecipient = event.target.value; },
      })),
      h('div', { class: 'row-actions' }, [
        h('button', { class: 'btn', onclick: saveSendSettings }, 'Save timing'),
        h('button', { class: 'btn', disabled: state.busy, onclick: confirmPlacementTest }, 'Send test'),
      ]),
      h('p', { class: 'muted' }, 'A batch of 100 waits this many seconds between each message. 500 messages at 60 seconds take about 8 hours. The test is one message to the address above.'),
    ]),
  ]);
}

function modal() {
  if (!state.modal) return null;
  if (state.modal.type === 'preview') return previewModal();
  if (state.modal.type === 'template') return templateModal();
  if (state.modal.type === 'confirm') return confirmModal();
  if (state.modal.type === 'progress') return progressModal();
  return null;
}

function previewModal() {
  const previews = state.modal.previews || [];
  const blocked = previews.some((preview) => preview.blocked || (preview.missing || []).length);
  const many = previews.length > 1;
  return overlay([
    h('h2', {}, many ? 'Review drafts' : 'Preview message'),
    many ? h('p', {}, `You are about to create ${previews.length} Gmail drafts.`) : h('p', { class: 'muted' }, 'This creates a Gmail draft. It does not send the email.'),
    h('p', { class: 'muted' }, 'Continue?'),
    blocked ? h('div', { class: 'warning' }, 'Highlighted messages still contain missing template values. They will not be drafted.') : null,
    state.modal.progress ? h('p', { class: 'progress' }, state.modal.progress) : null,
    many ? bulkPreviewTable(previews) : singlePreview(previews[0]),
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn', disabled: state.busy, onclick: () => { state.modal = null; render(); } }, 'Back'),
      h('button', {
        class: 'btn-primary',
        disabled: state.busy || blocked || !previews.length,
        onclick: () => createDrafts(previews),
      }, 'Create Gmail Draft'),
    ]),
  ]);
}

function singlePreview(preview) {
  if (!preview) return h('p', {}, 'Nothing to preview.');
  return h('div', {}, [
    labeledArea('TO', preview.to, true),
    field('SUBJECT', h('input', { id: 'preview-subject-0', value: preview.subject })),
    field('BODY', h('textarea', { id: 'preview-body-0' }, preview.body)),
  ]);
}

function bulkPreviewTable(previews) {
  return h('div', { class: 'table-wrap' }, [
    h('table', { class: 'preview-table' }, [
      h('thead', {}, h('tr', {}, [h('th', {}, 'Person'), h('th', {}, 'Opening')])),
      h('tbody', {}, previews.map((preview, index) =>
        h('tr', { class: (preview.missing || []).length ? 'highlight-row' : '' }, [
          h('td', {}, [
            h('div', { class: 'name' }, preview.name),
            h('div', { class: 'handle' }, preview.to),
            ...(preview.missing || []).map((item) => h('div', { class: 'missing' }, String(item))),
          ]),
          h('td', {}, [
            h('textarea', { id: `preview-body-${index}` }, preview.body),
            h('input', { id: `preview-subject-${index}`, value: preview.subject }),
          ]),
        ]),
      )),
    ]),
  ]);
}

function templateModal() {
  const draft = state.modal.draft;
  return overlay([
    h('h2', {}, draft.id ? 'Edit template' : 'Create template'),
    field('Name', h('input', { id: 'template-name', value: draft.name })),
    field('Subject', h('input', { id: 'template-subject', value: draft.subject })),
    field('Body', h('textarea', { id: 'template-body' }, draft.body)),
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn', onclick: () => { state.modal = null; render(); } }, 'Back'),
      h('button', { class: 'btn-primary', onclick: saveTemplate }, 'Save'),
    ]),
  ]);
}

function progressModal() {
  return overlay([
    h('h2', {}, state.modal.title),
    h('p', {}, state.modal.text),
  ]);
}

function confirmModal() {
  return overlay([
    h('h2', {}, state.modal.title),
    h('p', {}, state.modal.text),
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn', disabled: state.busy, onclick: () => { state.modal = null; render(); } }, 'Back'),
      h('button', { class: 'btn-primary', disabled: state.busy, onclick: state.modal.onConfirm }, state.modal.confirmLabel || 'Continue'),
    ]),
  ]);
}

function overlay(children) {
  return h('div', { class: 'overlay' }, [h('div', { class: 'modal', role: 'dialog' }, children)]);
}

async function setView(view) {
  state.view = view;
  state.modal = null;
  try {
    if (view === 'drafts' || view === 'approved' || view === 'sent') await loadOutreach();
    if (view === 'contacts' || view === 'settings' || view === 'templates') await refreshAll();
    else render();
  } catch (error) {
    state.banner = { type: 'error', text: error.message };
    render();
  }
}

async function openContact(id) {
  try {
    state.contact = (await api(`/api/contacts/${id}`)).contact;
    state.view = 'contact';
    render();
  } catch (error) {
    state.banner = { type: 'error', text: error.message };
    render();
  }
}

async function openPreview(contactIds) {
  if (!state.templateId) {
    state.banner = { type: 'error', text: 'Create a template before drafting.' };
    render();
    return;
  }
  if (!contactIds.length) return;
  try {
    const data = await api('/api/templates/preview', {
      method: 'POST',
      body: JSON.stringify({ templateId: state.templateId, contactIds }),
    });
    state.modal = { type: 'preview', previews: data.previews, progress: '' };
    render();
  } catch (error) {
    state.banner = { type: 'error', text: error.message };
    render();
  }
}

async function createDrafts(previews) {
  const messages = previews.map((preview, index) => ({
    contactId: preview.contactId,
    subject: document.querySelector(`#preview-subject-${index}`)?.value ?? preview.subject,
    body: document.querySelector(`#preview-body-${index}`)?.value ?? preview.body,
  }));
  if (messages.some((message) => /\{\{[\s\S]*?\}\}/.test(message.subject) || /\{\{[\s\S]*?\}\}/.test(message.body))) {
    state.banner = { type: 'error', text: 'Message still contains unresolved template values. Nothing was sent.' };
    render();
    return;
  }
  state.busy = true;
  const failures = [];
  for (let index = 0; index < messages.length; index += 1) {
    state.modal = { ...state.modal, progress: `Creating ${index + 1}/${messages.length}...` };
    render();
    try {
      await api(`/api/outreach/${messages[index].contactId}/draft`, {
        method: 'POST',
        body: JSON.stringify({
          templateId: state.templateId,
          subject: messages[index].subject,
          body: messages[index].body,
        }),
      });
    } catch (error) {
      failures.push(`${messages[index].contactId}: ${error.message}`);
    }
  }
  state.busy = false;
  state.modal = null;
  state.selected.clear();
  state.banner = failures.length
    ? { type: 'error', text: `Created ${messages.length - failures.length} of ${messages.length} drafts. ${failures[0]} Nothing was sent.` }
    : { type: 'ok', text: messages.length === 1 ? 'Gmail draft created. Nothing was sent.' : `Created ${messages.length} Gmail drafts. Nothing was sent.` };
  await refreshAll();
}

function confirmApproveAndSendAll() {
  const drafted = state.summary?.drafted ?? 0;
  const approved = state.summary?.approved ?? 0;
  const total = drafted + approved;
  if (!total) {
    state.banner = { type: 'error', text: 'There are no drafts or approved messages to send.' };
    render();
    return;
  }
  const gap = state.auth?.testMode ? 0 : (state.summary?.minSecondsBetweenSends ?? 60);
  const minutes = Math.max(1, Math.ceil(((Math.max(total, 1) - 1) * gap) / 60));
  const timing = gap === 0
    ? 'Messages go out one after another.'
    : `Messages go out one after another, ${gap} seconds apart, so ${total} messages take about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  const testNote = state.auth?.testMode
    ? ' Test mode is on, so Gmail will not deliver anything.'
    : '';
  state.modal = {
    type: 'confirm',
    title: 'Approve and send all',
    text: `Approve ${drafted} draft${drafted === 1 ? '' : 's'} and send ${total} message${total === 1 ? '' : 's'} from your Gmail account. ${timing}${testNote}`,
    confirmLabel: 'Approve & send all',
    onConfirm: () => { void runApproveAndSendAll(); },
  };
  render();
}

async function runApproveAndSendAll() {
  state.busy = true;
  showProgress('Approve and send all', 'Loading messages…');
  const sent = [];
  const failed = [];
  const skipped = [];
  try {
    const [drafted, approved] = await Promise.all([
      api('/api/outreach?status=DRAFTED'),
      api('/api/outreach?status=APPROVED'),
    ]);
    const draftIds = (drafted.outreach || []).map((row) => row.id);
    const toSend = (approved.outreach || []).map((row) => row.id);
    for (let index = 0; index < draftIds.length; index += 50) {
      const chunk = draftIds.slice(index, index + 50);
      showProgress('Approve and send all', `Approving ${Math.min(index + chunk.length, draftIds.length)} of ${draftIds.length}…`);
      const result = await api('/api/outreach/bulk-approve', {
        method: 'POST',
        body: JSON.stringify({ outreachIds: chunk }),
      });
      (result.outreach || []).forEach((row) => toSend.push(row.id));
      (result.skippedItems || []).forEach((row) => skipped.push(row.reason || 'Skipped'));
    }
    let stopped = false;
    for (let index = 0; index < toSend.length; index += 1) {
      if (stopped) {
        skipped.push('Daily send limit');
        continue;
      }
      showProgress('Approve and send all', `Sending ${index + 1} of ${toSend.length}…`);
      const outcome = await sendOneWithCooldown(toSend[index], (text) => {
        showProgress('Approve and send all', `Sending ${index + 1} of ${toSend.length}. ${text}`);
      });
      if (outcome.status === 'sent') sent.push(toSend[index]);
      else if (outcome.status === 'limit') {
        stopped = true;
        skipped.push(outcome.message);
      } else if (outcome.status === 'skipped') skipped.push(outcome.message);
      else failed.push(outcome.message);
    }
    const testNote = state.auth?.testMode ? ' Test mode: no email was delivered.' : '';
    state.banner = {
      type: failed.length ? 'error' : 'ok',
      text: `Sent ${sent.length}. Failed ${failed.length}. Skipped ${skipped.length}.${testNote}`,
    };
  } catch (error) {
    state.banner = { type: 'error', text: error.message };
  } finally {
    state.busy = false;
    state.modal = null;
    await refreshAll();
  }
}

async function saveSendSettings() {
  rememberTimingFromDom();
  const maxSendsPerDay = Number(state.timingDraft['max-sends']);
  const minSecondsBetweenSends = Number(state.timingDraft['send-gap']);
  const testRecipient = (state.testRecipient || '').trim();
  try {
    const saved = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ maxSendsPerDay, minSecondsBetweenSends, testRecipient }),
    });
    if (state.auth) {
      state.auth.maxSendsPerDay = saved.maxSendsPerDay;
      state.auth.minSecondsBetweenSends = saved.minSecondsBetweenSends;
      state.auth.testRecipient = saved.testRecipient;
    }
    state.timingDraft['max-sends'] = String(saved.maxSendsPerDay);
    state.timingDraft['send-gap'] = String(saved.minSecondsBetweenSends);
    state.testRecipient = saved.testRecipient;
    if (state.summary) {
      state.summary.maxSendsPerDay = saved.maxSendsPerDay;
      state.summary.minSecondsBetweenSends = saved.minSecondsBetweenSends;
    }
    state.banner = { type: 'ok', text: `Send timing saved. ${saved.minSecondsBetweenSends}s between messages, up to ${saved.maxSendsPerDay} a day.` };
    render();
  } catch (error) {
    state.banner = { type: 'error', text: error.message };
    render();
  }
}

function confirmPlacementTest() {
  const sample = state.outreach[0];
  if (!sample && !state.templateId) {
    state.banner = { type: 'error', text: 'Create a template or a draft before sending a placement test.' };
    render();
    return;
  }
  const to = rememberTestRecipient();
  if (!to) {
    state.banner = { type: 'error', text: 'Enter the email address that should receive the test.' };
    render();
    return;
  }
  state.modal = {
    type: 'confirm',
    title: 'Test inbox placement',
    text: `Send one copy only to ${to}. Then check Inbox and Spam there. Nobody else receives this message.`,
    confirmLabel: 'Send test',
    onConfirm: async () => {
      state.busy = true;
      render();
      try {
        const payload = sample
          ? { subject: sample.subject, body: sample.body }
          : { templateId: state.templateId };
        if (to) payload.to = to;
        const result = await api('/api/outreach/placement-test', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        state.modal = null;
        state.banner = { type: result.sent ? 'ok' : 'error', text: result.message };
      } catch (error) {
        state.banner = { type: 'error', text: error.message };
        state.modal = null;
      } finally {
        state.busy = false;
        render();
      }
    },
  };
  render();
}

function showProgress(title, text) {
  state.modal = { type: 'progress', title, text };
  render();
}

async function sendOneWithCooldown(id, onWait) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await api(`/api/outreach/${id}/send`, { method: 'POST', body: '{}' });
      return { status: 'sent' };
    } catch (error) {
      const message = error.message || 'Send failed.';
      const wait = /Wait (\d+)s/.exec(message);
      if (wait && attempt < 2) {
        const seconds = Number(wait[1]);
        onWait(`Waiting ${seconds}s before the next send…`);
        await delay((seconds + 1) * 1000);
        continue;
      }
      if (/Daily send limit/i.test(message)) return { status: 'limit', message };
      if (/already been sent|do-not-contact|opted out|Only approved|valid public email|maximum number/i.test(message)) {
        return { status: 'skipped', message };
      }
      return { status: 'failed', message };
    }
  }
  return { status: 'failed', message: 'Send failed.' };
}

function delay(ms) {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

async function approve(id) {
  state.modal = {
    type: 'confirm',
    title: 'Approve draft',
    text: 'Approve this message? It will not be sent until you click Send.',
    confirmLabel: 'Approve',
    onConfirm: async () => {
      state.busy = true;
      render();
      try {
        await api(`/api/outreach/${id}/approve`, { method: 'POST', body: '{}' });
        state.banner = { type: 'ok', text: 'Draft approved. It has not been sent.' };
        state.modal = null;
      } catch (error) {
        state.banner = { type: 'error', text: error.message };
        state.modal = null;
      } finally {
        state.busy = false;
      }
      await refreshAll();
    },
  };
  render();
}

function confirmSend(item) {
  state.modal = {
    type: 'confirm',
    title: 'Send approved message',
    text: `Send this email to ${item.contact?.email || item.to || 'the recipient'}? This sends one approved message from your Gmail account.`,
    confirmLabel: 'Send',
    onConfirm: async () => {
      state.busy = true;
      render();
      try {
        await api(`/api/outreach/${item.id}/send`, { method: 'POST', body: '{}' });
        state.banner = { type: 'ok', text: 'Message sent.' };
        state.modal = null;
      } catch (error) {
        state.banner = { type: 'error', text: error.message };
        state.modal = null;
      } finally {
        state.busy = false;
      }
      await refreshAll();
    },
  };
  render();
}

async function markStatus(id, status) {
  const label = status === 'DO_NOT_CONTACT'
    ? 'Mark this person do-not-contact? Drafts and sending will stay disabled.'
    : status === 'OPTED_OUT'
      ? 'Mark this person opted out? Drafts and sending will stay disabled.'
      : 'Mark this contact as replied?';
  state.modal = {
    type: 'confirm',
    title: 'Update contact',
    text: label,
    confirmLabel: 'Confirm',
    onConfirm: async () => {
      try {
        await api(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        state.banner = { type: 'ok', text: 'Contact updated.' };
        state.modal = null;
        await openContact(id);
        state.summary = await api('/api/stats');
        render();
      } catch (error) {
        state.banner = { type: 'error', text: error.message };
        state.modal = null;
        render();
      }
    },
  };
  render();
}

function removeContact(id) {
  state.modal = {
    type: 'confirm',
    title: 'Delete contact',
    text: 'Delete this contact and its local outreach history? This does not delete anything from Gmail.',
    confirmLabel: 'Delete',
    onConfirm: async () => {
      try {
        await api(`/api/contacts/${id}`, { method: 'DELETE' });
        state.contact = null;
        state.view = 'contacts';
        state.modal = null;
        state.banner = { type: 'ok', text: 'Contact deleted.' };
        await refreshAll();
      } catch (error) {
        state.banner = { type: 'error', text: error.message };
        state.modal = null;
        render();
      }
    },
  };
  render();
}

function openTemplate(template) {
  state.modal = {
    type: 'template',
    draft: template
      ? { id: template.id, name: template.name, subject: template.subject, body: template.body }
      : { id: '', name: '', subject: '', body: 'Hi {{first_name | default:"there"}},\n\n' },
  };
  render();
}

async function saveTemplate() {
  const payload = {
    name: valueOf('#template-name'),
    subject: valueOf('#template-subject'),
    body: valueOf('#template-body'),
  };
  try {
    if (state.modal.draft.id) {
      await api(`/api/templates/${state.modal.draft.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/api/templates', { method: 'POST', body: JSON.stringify(payload) });
    }
    state.modal = null;
    state.banner = { type: 'ok', text: 'Template saved.' };
    await refreshAll();
  } catch (error) {
    state.banner = { type: 'error', text: error.message };
    render();
  }
}

async function duplicateTemplate(template) {
  try {
    await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: `Copy of ${template.name}`.slice(0, 120),
        subject: template.subject,
        body: template.body,
      }),
    });
    state.banner = { type: 'ok', text: 'Template duplicated.' };
    await refreshAll();
  } catch (error) {
    state.banner = { type: 'error', text: error.message };
    render();
  }
}

async function previewTemplateSample(template) {
  state.templateId = template.id;
  const sample = state.contacts.find(canDraft) || state.contacts[0];
  if (!sample) {
    state.banner = { type: 'error', text: 'Add a contact before previewing a template.' };
    render();
    return;
  }
  await openPreview([sample.id]);
}

async function removeTemplate(id) {
  state.modal = {
    type: 'confirm',
    title: 'Delete template',
    text: 'Delete this template? Existing drafts keep their saved subject and body.',
    confirmLabel: 'Delete',
    onConfirm: async () => {
      try {
        await api(`/api/templates/${id}`, { method: 'DELETE' });
        state.modal = null;
        state.banner = { type: 'ok', text: 'Template deleted.' };
        await refreshAll();
      } catch (error) {
        state.banner = { type: 'error', text: error.message };
        state.modal = null;
        render();
      }
    },
  };
  render();
}

async function disconnect() {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    state.banner = { type: 'ok', text: 'Gmail disconnected.' };
    await refreshAll();
  } catch (error) {
    state.banner = { type: 'error', text: error.message };
    render();
  }
}

function selectedContacts() {
  return state.contacts.filter((contact) => state.selected.has(contact.id) && canDraft(contact));
}

function canDraft(contact) {
  return contact.status === 'NEW' || contact.status === 'FAILED';
}

function filterInput(key, placeholder, type = 'search') {
  return h('input', {
    type,
    placeholder,
    value: state.filters[key],
    onchange: (event) => { state.filters[key] = event.target.value; },
  });
}

function filterSelect(key, label, options) {
  const normalized = options.map((option) => (Array.isArray(option) ? option : [option, option || label]));
  return h('select', {
    onchange: (event) => { state.filters[key] = event.target.value; },
  }, normalized.map(([value, text]) => h('option', { value, selected: state.filters[key] === value }, text || label)));
}

function badge(status) {
  return h('span', { class: `badge ${status}` }, status);
}

function infoLine(label, value) {
  return h('p', {}, [h('span', { class: 'muted' }, `${label}: `), document.createTextNode(value)]);
}

function labeledArea(label, value) {
  return h('div', { class: 'field' }, [
    h('label', {}, label),
    h('div', { class: 'preview-block' }, value),
  ]);
}

function field(label, control) {
  return h('div', { class: 'field' }, [h('label', {}, label), control]);
}

function valueOf(selector) {
  return document.querySelector(selector)?.value?.trim() || '';
}

function timingValue(id, fallback) {
  return state.timingDraft[id] ?? fallback;
}

function rememberTimingFromDom() {
  const max = document.querySelector('#max-sends');
  const gap = document.querySelector('#send-gap');
  if (max) state.timingDraft['max-sends'] = max.value;
  if (gap) state.timingDraft['send-gap'] = gap.value;
  const field = document.querySelector('#test-recipient');
  if (field) state.testRecipient = field.value;
}

function rememberTestRecipient() {
  rememberTimingFromDom();
  return (state.testRecipient || '').trim();
}

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (key === 'disabled') node.disabled = Boolean(value);
    else if (key === 'selected') node.selected = Boolean(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  });
  const list = Array.isArray(children) ? children : [children];
  list.flat().forEach((child) => {
    if (child == null || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}
