// LoreWeaver studio — frontend controller (vanilla ES modules, no build step).
const $ = (sel) => document.querySelector(sel);

const state = {
  worlds: [],
  activeWorld: null,
  lastProse: '',
};

// ---- API helpers ------------------------------------------------------------
const api = {
  async health() { return (await fetch('/api/health')).json(); },
  async worlds() { return (await fetch('/api/worlds')).json(); },
  async world(id) { return (await fetch(`/api/worlds/${id}`)).json(); },
  async createWorld(body) {
    const r = await fetch('/api/worlds', { method: 'POST', headers: json(), body: JSON.stringify(body) });
    return r.json();
  },
  async addLore(id, body) {
    const r = await fetch(`/api/worlds/${id}/lore`, { method: 'POST', headers: json(), body: JSON.stringify(body) });
    return r.json();
  },
  async weave(id, body) {
    const r = await fetch(`/api/worlds/${id}/weave`, { method: 'POST', headers: json(), body: JSON.stringify(body) });
    if (!r.ok) throw await r.json();
    return r.json();
  },
};
const json = () => ({ 'Content-Type': 'application/json' });

// ---- Boot -------------------------------------------------------------------
init().catch((e) => console.error(e));

async function init() {
  await refreshStatus();
  await loadWorlds();
  wireEvents();
}

async function refreshStatus() {
  try {
    const h = await api.health();
    const live = h.foundryIQ === 'live';
    $('#status-dot').className = `status-dot ${live ? 'live' : 'offline'}`;
    $('#status-text').textContent = live
      ? 'Foundry IQ: live agentic retrieval'
      : 'Foundry IQ: offline grounding';
    $('#status-text').title = `Narrator: ${h.narrator}`;
  } catch {
    $('#status-text').textContent = 'offline';
  }
}

async function loadWorlds() {
  state.worlds = await api.worlds();
  const sel = $('#world-select');
  sel.innerHTML = state.worlds.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  if (state.worlds.length) await selectWorld(state.worlds[0].id);
}

async function selectWorld(id) {
  state.activeWorld = await api.world(id);
  state.lastProse = '';
  $('#world-select').value = id;
  $('#world-premise').textContent = state.activeWorld.premise;
  renderLore();
  resetStory();
}

// ---- Rendering --------------------------------------------------------------
function renderLore() {
  const list = $('#lore-list');
  const lore = state.activeWorld?.lore ?? [];
  list.innerHTML = lore
    .map(
      (e) => `
      <li class="lore-item" title="${esc(e.body)}">
        <span class="lore-kind" data-kind="${e.kind}">${e.kind}</span>
        <div>
          <div class="lore-title">${esc(e.title)}</div>
          <div class="lore-body">${esc(truncate(e.body, 70))}</div>
        </div>
      </li>`,
    )
    .join('');
}

function resetStory() {
  $('#story-scroll').innerHTML = `
    <div class="empty-state" id="empty-state">
      <div class="empty-glyph">📖</div>
      <h2>Begin a grounded tale</h2>
      <p>Press <strong>Weave the opening</strong> and LoreWeaver will retrieve your world's canon,
         plan a scene, narrate it with inline citations, and offer branching choices.</p>
      <button class="primary-btn" id="open-btn">✦ Weave the opening</button>
    </div>`;
  $('#open-btn').addEventListener('click', () => weave(''));
  $('#composer').hidden = true;
  $('#trace').innerHTML = `<li class="trace-empty">The 4-stage reasoning pipeline appears here as you weave.</li>`;
  $('#citations').innerHTML = `<li class="trace-empty">Grounded sources for the current scene will be listed here.</li>`;
}

async function weave(prompt) {
  if (!state.activeWorld) return;
  setBusy(true);
  try {
    const scene = await api.weave(state.activeWorld.id, { prompt, previously: state.lastProse });
    appendScene(scene);
    state.lastProse = stripCites(scene.prose);
    renderTrace(scene.trace);
    renderCitations(scene.citations);
    $('#composer').hidden = false;
  } catch (err) {
    appendError(err?.error || 'Something went wrong weaving the scene.');
  } finally {
    setBusy(false);
  }
}

function appendScene(scene) {
  $('#empty-state')?.remove();
  const scroll = $('#story-scroll');
  const div = document.createElement('article');
  div.className = 'scene';
  const badge = scene.grounding.live
    ? `<span class="badge-live">● Foundry IQ live</span>`
    : `<span class="badge-offline">◆ grounded offline</span>`;
  div.innerHTML = `
    <h2 class="scene-title">${esc(scene.title)}</h2>
    <div class="scene-meta">
      ${badge}
      <span>${scene.citations.length} cited sources</span>
      <span>${scene.grounding.subQueries.length} sub-queries planned</span>
    </div>
    <div class="prose">${renderProse(scene.prose, scene.citations)}</div>
    <div class="choices">
      ${scene.choices
        .map(
          (c) => `<button class="choice-btn" data-intent="${esc(c.intent)}">
            <span class="choice-arrow">➤</span><span>${esc(c.label)}</span></button>`,
        )
        .join('')}
    </div>`;
  scroll.appendChild(div);
  div.querySelectorAll('.choice-btn').forEach((btn) =>
    btn.addEventListener('click', () => weave(btn.dataset.intent)),
  );
  wireCitationChips(div, scene.citations);
  div.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function appendError(msg) {
  $('#empty-state')?.remove();
  const div = document.createElement('div');
  div.className = 'scene';
  div.innerHTML = `<div class="world-premise" style="color:var(--warn)">⚠ ${esc(msg)}</div>`;
  $('#story-scroll').appendChild(div);
}

// Convert [L1] markers into interactive citation chips.
function renderProse(prose, citations) {
  const byRef = Object.fromEntries(citations.map((c) => [c.ref, c]));
  const html = esc(prose).replace(/\[(L\d+)\]/g, (_, ref) =>
    byRef[ref] ? `<span class="cite" data-ref="${ref}">${ref}</span>` : `[${ref}]`,
  );
  return html
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function wireCitationChips(scope, citations) {
  const byRef = Object.fromEntries(citations.map((c) => [c.ref, c]));
  const pop = $('#cite-popover');
  scope.querySelectorAll('.cite').forEach((chip) => {
    chip.addEventListener('mouseenter', (e) => {
      const c = byRef[chip.dataset.ref];
      if (!c) return;
      pop.innerHTML = `<strong>${esc(c.title)} · ${c.kind}</strong>${esc(c.snippet)}`;
      pop.hidden = false;
      const r = chip.getBoundingClientRect();
      pop.style.left = Math.min(r.left, window.innerWidth - 340) + 'px';
      pop.style.top = r.bottom + 8 + 'px';
    });
    chip.addEventListener('mouseleave', () => (pop.hidden = true));
  });
}

function renderTrace(trace) {
  const labels = { retrieve: 1, plan: 2, narrate: 3, branch: 4 };
  $('#trace').innerHTML = trace
    .map(
      (s) => `
      <li class="trace-step" data-stage="${s.stage}">
        <div class="trace-stage"><span class="stage-num">${labels[s.stage]}</span>${esc(s.label)}</div>
        <div class="trace-detail">${esc(s.detail)}</div>
      </li>`,
    )
    .join('');
}

function renderCitations(citations) {
  $('#citations').innerHTML = citations.length
    ? citations
        .map(
          (c) => `<li class="citation-item">
            <div><span class="citation-ref">${c.ref}</span><span class="citation-title">${esc(c.title)}</span></div>
            <div class="citation-snippet">${esc(c.snippet)}</div>
          </li>`,
        )
        .join('')
    : `<li class="trace-empty">No citations.</li>`;
}

// ---- Events -----------------------------------------------------------------
function wireEvents() {
  $('#world-select').addEventListener('change', (e) => selectWorld(e.target.value));
  $('#open-btn')?.addEventListener('click', () => weave(''));

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#prompt-input');
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    weave(v);
  });

  // New world dialog
  $('#new-world-btn').addEventListener('click', () => $('#world-dialog').showModal());
  $('#world-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    const f = new FormData(e.target);
    const world = await api.createWorld({
      name: f.get('name'),
      premise: f.get('premise'),
      tone: f.get('tone') || undefined,
    });
    await loadWorlds();
    await selectWorld(world.id);
    e.target.reset();
  });

  // Add lore dialog
  $('#add-lore-btn').addEventListener('click', () => {
    if (!state.activeWorld) return;
    $('#lore-dialog').showModal();
  });
  $('#lore-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    const f = new FormData(e.target);
    const updated = await api.addLore(state.activeWorld.id, {
      kind: f.get('kind'),
      title: f.get('title'),
      body: f.get('body'),
      tags: String(f.get('tags') || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    state.activeWorld = updated;
    renderLore();
    e.target.reset();
  });
}

function setBusy(busy) {
  document.querySelectorAll('.primary-btn').forEach((b) => (b.disabled = busy));
  const wb = $('#weave-btn');
  if (wb) wb.textContent = busy ? 'Weaving…' : 'Weave ✦';
}

// ---- utils ------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function stripCites(s) { return s.replace(/\[L\d+\]/g, '').replace(/\s{2,}/g, ' ').trim(); }
