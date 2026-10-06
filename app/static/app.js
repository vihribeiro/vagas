/* Lista de vagas: busca, filtros, abas e o toggle Lista/Deslizar.
   O baralho do modo deslizar mora em swipe.js; aqui fica a navegação. */
const $ = (id) => document.getElementById(id);
const listEl = $("list");
const qEl = $("f-q");
const searchWrap = $("search-wrap");
const qClearEl = $("f-q-clear");
const sourceRow = $("source-row");
const sourcePills = $("source-pills");
const tabsEl = $("status-tabs");

const listControlsEl = $("list-controls");
const viewToggleEl = $("view-toggle");
const swipeSectionEl = $("swipe");

let debounce = null;
const state = { q: "", source: "", status: "" };
const knownSources = new Set();

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* Faixa do score, para o selo poder mudar de cor. 4.0+ é o que o career-ops
   trata como "vale a candidatura": o auto_pdf_score_threshold default dele é
   3.0 e o pre-screen nem roda no tier economy. */
function scoreTier(s) {
  const v = parseFloat(s);
  if (v >= 4.3) return "alta";
  if (v >= 3.6) return "media";
  if (v >= 3.0) return "baixa";
  return "fora";
}

/* as pílulas de origem recebem a cor direto na regra, sem JS */
function jobCard(j) {
  /* a stack decide se a vaga serve, então ela vai no card e não atrás de um
     clique — o notes chega do produtor (coluna infra do pipeline) */
  const stack = j.notes
    ? `<p class="stack">${esc(j.notes)}</p>`
    : "";
  /* score do agente ranqueador. Chega estruturado (j.score); o fallback via
     regex cobre um título legado que ainda viesse com `[4.4/5]`. */
  let badge = "";
  if (j.score != null && j.score !== "") {
    badge = `<span class="score" data-tier="${esc(scoreTier(j.score))}">${esc(Number(j.score).toFixed(1))}</span>`;
  } else {
    const sm = String(j.title || "").match(/\[(\d\.\d)\/5\]$/);
    if (sm) badge = `<span class="score" data-tier="${esc(scoreTier(sm[1]))}">${esc(sm[1])}</span>`;
  }
  const cleanTitle = String(j.title || "").replace(/\s*\[\d\.\d\/5\]$/, "");
  const reco = j.recommendation
    ? `<span class="reco reco-${esc(j.recommendation)}">${esc(I18N.t("reco_" + j.recommendation) || j.recommendation)}</span>`
    : "";
  return `
  <a class="job-item" href="/vagas/${j.id}" data-status="${esc(j.status)}">
    <h3>${esc(cleanTitle)}</h3>
    <p class="meta">${esc(j.company)}${j.location ? " · " + esc(j.location) : ""}</p>
    ${stack}
    <p class="foot">
      ${badge}${reco}
      <span class="src source-${esc(j.source || "other")}">${esc(j.source || I18N.t("source_other"))}</span>
    </p>
  </a>`;
}

/* ---------------------------------------------------------------- abas de status */
const TABS = [
  { value: "", key: "tab_all" },
  { value: "pending", key: "tab_pending" },
  { value: "applied", key: "tab_applied" },
  { value: "rejected", key: "tab_rejected" },
  { value: "dismissed", key: "tab_dismissed" },
];

function renderTabs(counts, total) {
  tabsEl.innerHTML = TABS.map((t) => {
    const n = t.value ? (counts[t.value] || 0) : total;
    const on = state.status === t.value;
    return `<button type="button" class="tab" data-status="${t.value}"
      aria-pressed="${on}">${I18N.t(t.key)}<span class="n">${n}</span></button>`;
  }).join("");
}

tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  state.status = btn.dataset.status;
  fetchJobs();
});

/* ---------------------------------------------------------------- pílulas de origem */
function renderSources(counts) {
  if (!knownSources.size) {
    sourceRow.hidden = true;
    return;
  }
  sourceRow.hidden = false;
  const items = [...knownSources].sort();
  sourcePills.innerHTML = items.map((s) => {
    const on = state.source === s;
    return `<button type="button" class="pill-src source-${esc(s)}"
      data-source="${esc(s)}" aria-pressed="${on}">
      <span class="dot"></span>${esc(s)}<span class="count">${counts[s] || 0}</span>
    </button>`;
  }).join("");
}

sourcePills.addEventListener("click", (e) => {
  const btn = e.target.closest(".pill-src");
  if (!btn) return;
  const s = btn.dataset.source;
  state.source = state.source === s ? "" : s;  // toque de novo desliga
  fetchJobs();
});

/* ---------------------------------------------------------------- busca */
function syncControls() {
  searchWrap.classList.toggle("has-value", Boolean(state.q));
}

qEl.addEventListener("input", () => {
  state.q = qEl.value.trim();
  syncControls();
  clearTimeout(debounce);
  debounce = setTimeout(fetchJobs, 300);
});

qClearEl.addEventListener("click", () => {
  qEl.value = "";
  state.q = "";
  syncControls();
  fetchJobs();
  qEl.focus();
});

/* ---------------------------------------------------------------- toggle Lista/Deslizar */
const VIEW_KEY = "vagas-view";

function setView(view) {
  const swipeMode = view === "swipe";
  viewToggleEl.querySelectorAll(".view-btn").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === view));
  });
  listControlsEl.hidden = swipeMode;
  tabsEl.hidden = swipeMode;
  listEl.hidden = swipeMode;
  swipeSectionEl.hidden = !swipeMode;
  localStorage.setItem(VIEW_KEY, view);
  if (swipeMode) {
    if (window.SwipeDeck) window.SwipeDeck.reload();
  } else {
    if (window.SwipeDeck) window.SwipeDeck.stop();
    fetchJobs();
  }
}

viewToggleEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-btn");
  if (btn) setView(btn.dataset.view);
});

/* ---------------------------------------------------------------- dados */
async function fetchJobs() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.source) params.set("source", state.source);
  if (state.status) params.set("status", state.status);

  listEl.setAttribute("aria-busy", "true");
  try {
    const res = await fetch("/api/v1/jobs?" + params.toString());
    if (res.status === 401) { location.href = "/login"; return; }
    const data = await res.json();
    render(data.jobs || []);
  } catch (err) {
    listEl.innerHTML =
      `<p class="empty"><strong>${I18N.t("app_offline_title")}</strong>${I18N.t("app_offline_body")}</p>`;
  } finally {
    listEl.setAttribute("aria-busy", "false");
  }
}

function render(jobs) {
  const byStatus = { pending: 0, applied: 0, rejected: 0, dismissed: 0 };
  const bySource = {};
  jobs.forEach((j) => {
    if (byStatus[j.status] !== undefined) byStatus[j.status]++;
    const s = j.source || "";
    if (s) bySource[s] = (bySource[s] || 0) + 1;
  });

  renderTabs(byStatus, jobs.length);

  // as origens nunca somem do menu ao trocar o filtro de status
  if (!state.source) jobs.forEach((j) => { if (j.source) knownSources.add(j.source); });
  else knownSources.add(state.source);
  renderSources(bySource);

  if (!jobs.length) {
    listEl.innerHTML =
      `<p class="empty"><strong>${I18N.t("app_empty_title")}</strong>${I18N.t("app_empty_body")}</p>`;
    return;
  }
  listEl.innerHTML = jobs.map(jobCard).join("");
}

/* ---------------------------------------------------------------- boot */
(async function boot() {
  // Padrão é o modo deslizar; a preferência salva (se já escolheu antes)
  // continua valendo.
  const saved = localStorage.getItem(VIEW_KEY);
  setView(saved === "list" ? "list" : "swipe");
})();

// registra o service worker (PWA)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}