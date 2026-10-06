/* Currículo: leitura por módulos, cópia por campo/entrada/módulo, edição
   no lugar e importação a partir de um PDF.

   A cópia é o objetivo da tela, então ela nunca depende de rede: os dados já
   estão no DOM e o texto sai do próprio elemento. */
const $ = (id) => document.getElementById(id);

const modulesEl = $("cv-modules");
const importEl = $("cv-import");
const statusEl = $("cv-status");
const fileEl = $("cv-file");
const fileLabelEl = $("cv-file-label");
const toastEl = $("cv-toast");

let modules = [];
let pendingImport = null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function setStatus(msg, tone) {
  statusEl.hidden = !msg;
  statusEl.className = "cv-status" + (tone ? " tone-" + tone : "");
  statusEl.innerHTML = msg;
}

/* ---------------------------------------------------------------- copiar */
const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
  '<path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/></svg>';

/* navigator.clipboard só existe em contexto seguro. Acessando o homelab por
   http na rede local, cai no textarea + execCommand. */
async function copyText(text) {
  const value = (text || "").trim();
  if (!value) { toast("Nada para copiar ainda"); return; }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, value.length);
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("execCommand falhou");
    }
    toast("Copiado");
  } catch (err) {
    toast("Não consegui copiar — selecione e copie à mão");
  }
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => { toastEl.hidden = true; }, 200);
  }, 1800);
}

/* ---------------------------------------------------------------- texto */
function fieldText(it) {
  return it.value || "";
}

function entryText(it) {
  const lines = [it.title, it.org, it.context, it.period, it.body, it.links];
  return lines.filter((l) => (l || "").trim()).join("\n");
}

function moduleText(mod) {
  if (mod.kind === "text") return fieldText(mod.items[0] || {});
  return mod.items
    .map((it) => (mod.kind === "fields" ? fieldText(it) : entryText(it)))
    .filter((t) => t.trim())
    .join("\n\n");
}

/* ---------------------------------------------------------------- gaveta */
/* No celular a coluna de módulos vira uma gaveta que desliza da esquerda.
   O botão de abrir mora na topbar; o scrim fecha. */
const navEl = $("cv-nav");
const navListEl = $("cv-nav-list");
const navToggleEl = document.querySelector("[data-cv-nav]");
const scrimEl = document.querySelector("[data-cv-scrim]");

function setNav(open) {
  navEl.classList.toggle("open", open);
  navEl.setAttribute("aria-hidden", String(!open));
  if (navToggleEl) navToggleEl.setAttribute("aria-expanded", String(open));
  if (open) {
    scrimEl.hidden = false;
    requestAnimationFrame(() => scrimEl.classList.add("show"));
  } else {
    scrimEl.classList.remove("show");
    setTimeout(() => { scrimEl.hidden = true; }, 220);
  }
}

if (navToggleEl) {
  navToggleEl.addEventListener("click", () => setNav(!navEl.classList.contains("open")));
}
if (scrimEl) {
  scrimEl.addEventListener("click", () => setNav(false));
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && navEl.classList.contains("open")) setNav(false);
});

/* ---------------------------------------------------------------- render */
function navItem(mod) {
  const whole = moduleText(mod);
  return `
    <li class="cv-nav-item">
      <button type="button" class="cv-nav-link" data-goto="${esc(mod.key)}">${esc(mod.label)}</button>
      ${whole
        ? `<button type="button" class="cv-nav-copy" data-copy="${esc(whole)}"
             data-what="${esc(mod.label)}" aria-label="Copiar ${esc(mod.label)}">${COPY_ICON}</button>`
        : ""}
    </li>`;
}

function renderNav() {
  navListEl.innerHTML = modules.map(navItem).join("");
  spyModules();
}

/* marca na coluna o módulo que está passando pela tela */
let spyObserver = null;
function spyModules() {
  if (!("IntersectionObserver" in window)) return;
  if (spyObserver) spyObserver.disconnect();
  const blocks = [...modulesEl.querySelectorAll("[data-module]")];

  const set = (key) => {
    navListEl.querySelectorAll(".cv-nav-item").forEach((li) => {
      const link = li.querySelector("[data-goto]");
      li.classList.toggle("is-current", link && link.dataset.goto === key);
    });
  };

  spyObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) set(en.target.dataset.module);
    }
  }, { rootMargin: "-20% 0px -70% 0px", threshold: 0 });
  blocks.forEach((b) => spyObserver.observe(b));
}

navListEl.addEventListener("click", (e) => {
  const cp = e.target.closest("[data-copy]");
  if (cp) { copyText(cp.dataset.copy); return; }

  const goto = e.target.closest("[data-goto]");
  if (goto) {
    const block = modulesEl.querySelector(`[data-module="${goto.dataset.goto}"]`);
    if (block) block.scrollIntoView({ behavior: "smooth", block: "start" });
    setNav(false);
  }
});

function copyBtn(text, what) {
  return `<button type="button" class="copy-btn" data-copy="${esc(text)}"
    data-what="${esc(what)}" aria-label="Copiar ${esc(what)}">${COPY_ICON}</button>`;
}

function fieldRow(it) {
  const value = it.value || "";
  return `
    <div class="cv-field${value ? "" : " is-empty"}">
      <span class="cv-field-label">${esc(it.label || "Campo")}</span>
      <span class="cv-field-value">${esc(value) || '<em>a preencher</em>'}</span>
      ${copyBtn(value, it.label || "campo")}
    </div>`;
}

function entryCard(it) {
  return `
    <li class="cv-entry">
      <div class="cv-entry-head">
        <div class="cv-entry-titles">
          <h4>${esc(it.title) || '<em>Sem título</em>'}</h4>
          ${it.org ? `<p class="cv-entry-org">${esc(it.org)}</p>` : ""}
          ${it.context ? `<p class="cv-entry-context">${esc(it.context)}</p>` : ""}
        </div>
        ${copyBtn(entryText(it), it.title || "entrada")}
      </div>
      ${it.period ? `<p class="cv-entry-period">${esc(it.period)}</p>` : ""}
      ${it.body ? `<p class="cv-entry-body">${esc(it.body)}</p>` : ""}
      ${it.links ? `<p class="cv-entry-links">${esc(it.links)}</p>` : ""}
    </li>`;
}

function moduleBlock(mod) {
  let inner;
  if (mod.kind === "text") {
    const it = mod.items[0] || {};
    inner = `
      <p class="cv-prose${it.value ? "" : " is-empty"}">${esc(it.value) || "Resumo ainda não importado."}</p>`;
  } else if (mod.kind === "fields") {
    inner = mod.items.length
      ? `<div class="cv-fields">${mod.items.map(fieldRow).join("")}</div>`
      : `<p class="cv-none">Sem itens.</p>`;
  } else {
    inner = mod.items.length
      ? `<ul class="cv-entries">${mod.items.map(entryCard).join("")}</ul>`
      : `<p class="cv-none">Sem itens.</p>`;
  }

  const whole = moduleText(mod);
  return `
    <section class="cv-module" data-module="${esc(mod.key)}">
      <header class="cv-module-head">
        <h3>${esc(mod.label)}</h3>
        ${whole ? copyBtn(whole, mod.label) : ""}
      </header>
      ${inner}
      <button type="button" class="cv-edit-btn" data-edit="${esc(mod.key)}">Editar</button>
    </section>`;
}

function render(list) {
  modules = list || [];
  if (!modules.length) {
    modulesEl.innerHTML =
      '<p class="empty"><strong>Currículo vazio</strong>Importe um PDF para começar.</p>';
    modulesEl.setAttribute("aria-busy", "false");
    return;
  }
  modulesEl.innerHTML = modules.map(moduleBlock).join("");
  modulesEl.setAttribute("aria-busy", "false");
  renderNav();
}

/* ---------------------------------------------------------------- salvar */
/* Só o módulo aberto em edição tem input no DOM — a visão normal é texto, não
   campos. Ler o DOM inteiro devolveria lista vazia para todos os outros módulos
   e o PUT apagaria o currículo quase todo, então cada módulo é lido do input
   se estiver em edição e da memória se não estiver. */
function collect() {
  const out = {};
  modules.forEach((mod) => {
    const block = modulesEl.querySelector(`[data-module="${mod.key}"]`);
    const body = block
      ? block.querySelector(".cv-fields, .cv-entries, .cv-prose")
      : null;

    if (!body || body.dataset.editing !== "1") {
      out[mod.key] = mod.items;
      return;
    }

    if (mod.kind === "text") {
      const ta = body.querySelector("[data-slot]");
      out[mod.key] = [{ label: "", value: ta ? ta.value.trim() : "" }];
      return;
    }

    if (mod.kind === "fields") {
      out[mod.key] = [...body.querySelectorAll("[data-field]")].map((wrap) => {
        const i = wrap.querySelector('[data-slot$=".label"]');
        const v = wrap.querySelector('[data-slot$=".value"]');
        return { label: i ? i.value.trim() : "", value: v ? v.value.trim() : "" };
      });
      return;
    }

    out[mod.key] = [...body.querySelectorAll("[data-entry]")].map((wrap) => {
      const item = {};
      ["title", "org", "context", "period", "body", "links"].forEach((slot) => {
        const el = wrap.querySelector(`[data-slot$=".${slot}"]`);
        item[slot] = el ? el.value.trim() : "";
      });
      return item;
    });
  });
  return out;
}

async function save() {
  const payload = collect();
  setStatus("Salvando", "info");
  try {
    const res = await fetch("/api/v1/cv", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modules: payload }),
    });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(err.detail || "Falha ao salvar", "err");
      return;
    }
    const data = await load();
    setStatus("Salvo", "ok");
    toast("Currículo salvo");
    render(data.modules);
  } catch (err) {
    setStatus("Sem conexão para salvar", "err");
  }
}

/* ---------------------------------------------------------------- edição */
function editRow(mod, it, i) {
  return `
    <div class="cv-edit-row" data-field data-index="${i}">
      <label class="visually-hidden" for="l-${esc(mod.key)}-${i}">Rótulo</label>
      <input id="l-${esc(mod.key)}-${i}" class="cv-in" data-slot="${esc(mod.key)}.${i}.label"
        value="${esc(it.label)}" placeholder="Rótulo">
      <label class="visually-hidden" for="v-${esc(mod.key)}-${i}">Valor</label>
      <input id="v-${esc(mod.key)}-${i}" class="cv-in cv-in-wide" data-slot="${esc(mod.key)}.${i}.value"
        value="${esc(it.value)}" placeholder="Valor">
    </div>`;
}

function editEntry(mod, it, i) {
  const row = (slot, label, value, textarea) => `
    <label class="cv-edit-field">
      <span class="cv-edit-label">${esc(label)}</span>
      ${textarea
        ? `<textarea class="cv-in" rows="3" data-slot="${esc(mod.key)}.${i}.${slot}">${esc(value)}</textarea>`
        : `<input class="cv-in" data-slot="${esc(mod.key)}.${i}.${slot}" value="${esc(value)}">`}
    </label>`;
  return `
    <li class="cv-edit-entry" data-entry data-index="${i}">
      <div class="cv-edit-head">
        <strong>${esc(it.title) || "Nova entrada"}</strong>
        <button type="button" class="cv-del" data-del="${esc(mod.key)}.${i}">Remover</button>
      </div>
      ${row("title", "Título", it.title)}
      ${row("org", "Organização", it.org)}
      ${row("context", "Contexto", it.context)}
      ${row("period", "Período", it.period)}
      ${row("body", "Descrição", it.body, true)}
      ${row("links", "Links", it.links)}
    </li>`;
}

function startEdit(key) {
  const mod = modules.find((m) => m.key === key);
  if (!mod) return;
  const block = modulesEl.querySelector(`[data-module="${key}"]`);
  if (!block) return;

  const body = block.querySelector(".cv-fields, .cv-entries, .cv-prose");
  if (body && body.dataset.editing === "1") return;

  if (mod.kind === "text") {
    const it = mod.items[0] || { label: "", value: "" };
    body.className = "cv-prose is-editing";
    body.dataset.editing = "1";
    body.innerHTML = `
      <label class="visually-hidden" for="cv-${key}-value">Resumo profissional</label>
      <textarea class="cv-in" rows="8" id="cv-${key}-value"
        data-slot="${key}.value">${esc(it.value)}</textarea>`;
  } else if (mod.kind === "fields") {
    body.className = "cv-fields is-editing";
    body.dataset.editing = "1";
    body.innerHTML = mod.items.map((it, i) => editRow(mod, it, i)).join("") +
      `<button type="button" class="cv-add" data-add="${key}">Adicionar campo</button>`;
  } else {
    body.className = "cv-entries is-editing";
    body.dataset.editing = "1";
    body.innerHTML = mod.items.map((it, i) => editEntry(mod, it, i)).join("") +
      `<button type="button" class="cv-add" data-add="${key}">Adicionar entrada</button>`;
  }

  const btn = block.querySelector("[data-edit]");
  if (btn) btn.hidden = true;

  if (!document.getElementById("cv-savebar")) {
    const bar = document.createElement("div");
    bar.id = "cv-savebar";
    bar.className = "cv-savebar";
    bar.innerHTML = `
      <button type="button" class="btn primary" data-save>Salvar currículo</button>
      <button type="button" class="btn quiet" data-cancel>Cancelar</button>`;
    modulesEl.appendChild(bar);
  }
  document.getElementById("cv-savebar").scrollIntoView({ block: "nearest" });
}

modulesEl.addEventListener("click", (e) => {
  const copy = e.target.closest("[data-copy]");
  if (copy) { copyText(copy.dataset.copy); return; }

  const edit = e.target.closest("[data-edit]");
  if (edit) { startEdit(edit.dataset.edit); return; }

  const add = e.target.closest("[data-add]");
  if (add) {
    const mod = modules.find((m) => m.key === add.dataset.add);
    if (!mod) return;
    const blank = mod.kind === "fields"
      ? { label: "Campo", value: "" }
      : { title: "", org: "", context: "", period: "", body: "", links: "" };
    mod.items.push(blank);
    const block = modulesEl.querySelector(`[data-module="${mod.key}"]`);
    const body = block.querySelector(".cv-fields, .cv-entries");
    body.insertAdjacentHTML(
      "beforeend",
      mod.kind === "fields"
        ? editRow(mod, blank, mod.items.length - 1)
        : editEntry(mod, blank, mod.items.length - 1)
    );
    body.querySelector('[data-add]').focus();
    return;
  }

  const del = e.target.closest("[data-del]");
  if (del) {
    const [key, rawIndex] = del.dataset.del.split(".");
    const mod = modules.find((m) => m.key === key);
    const i = Number(rawIndex);
    if (!mod || !mod.items[i]) return;
    const wrap = del.closest("[data-entry]");
    mod.items.splice(i, 1);
    wrap.remove();
    // renumera os data-slot e data-del para seguir os índices novos
    const block = modulesEl.querySelector(`[data-module="${key}"]`);
    block.querySelectorAll("[data-entry]").forEach((el, n) => {
      el.dataset.index = n;
      el.querySelector("[data-del]").dataset.del = `${key}.${n}`;
      el.querySelectorAll("[data-slot]").forEach((inp) => {
        inp.dataset.slot = `${key}.${n}.${inp.dataset.slot.split(".").pop()}`;
      });
    });
    return;
  }

  if (e.target.closest("[data-save]")) { save(); return; }

  if (e.target.closest("[data-cancel]")) { load().then((d) => render(d.modules)); }
});

/* ---------------------------------------------------------------- carregar */
async function load() {
  const res = await fetch("/api/v1/cv");
  if (res.status === 401) { location.href = "/login"; return { modules: [] }; }
  return res.json();
}

/* ---------------------------------------------------------------- importar */
function importPreview(payload) {
  pendingImport = payload.modules;
  const rows = payload.modules.map((mod) => {
    const n = mod.items.length;
    const filled = mod.items.filter((it) =>
      mod.kind === "fields"
        ? (it.value || "").trim()
        : mod.kind === "text"
          ? (it.value || "").trim()
          : (it.title || "").trim()
    ).length;
    return `<tr>
      <th scope="row">${esc(mod.label)}</th>
      <td>${n}</td>
      <td>${filled}</td>
    </tr>`;
  }).join("");

  importEl.innerHTML = `
    <div class="cv-import-head">
      <h3>Revise antes de salvar</h3>
      <p>O parser é afinado ao formato deste currículo. Confira a tabela e
      ajuste o que estiver errado depois de salvar.</p>
    </div>
    ${payload.unmapped && payload.unmapped.length
      ? `<p class="cv-warn">Seções não reconhecidas (o texto delas não foi
         importado): <strong>${payload.unmapped.map(esc).join(", ")}</strong></p>`
      : ""}
    <table class="cv-import-table">
      <caption class="visually-hidden">Módulos lidos do PDF</caption>
      <thead><tr><th scope="col">Módulo</th><th scope="col">Itens</th>
        <th scope="col">Preenchidos</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="cv-import-actions">
      <button type="button" class="btn primary" data-import-save>Salvar no currículo</button>
      <button type="button" class="btn quiet" data-import-cancel>Descartar</button>
    </div>`;
  importEl.hidden = false;
  importEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

importEl.addEventListener("click", async (e) => {
  if (e.target.closest("[data-import-cancel]")) {
    importEl.hidden = true;
    importEl.innerHTML = "";
    pendingImport = null;
    setStatus("");
    return;
  }
  if (!e.target.closest("[data-import-save]") || !pendingImport) return;

  try {
    const res = await fetch("/api/v1/cv", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modules: Object.fromEntries(
        pendingImport.map((m) => [m.key, m.items])
      ) }),
    });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(err.detail || "Falha ao salvar", "err");
      return;
    }
    importEl.hidden = true;
    importEl.innerHTML = "";
    pendingImport = null;
    const data = await load();
    render(data.modules);
    setStatus("Currículo importado do PDF", "ok");
    toast("Currículo importado");
  } catch (err) {
    setStatus("Sem conexão para salvar", "err");
  }
});

fileEl.addEventListener("change", async () => {
  const file = fileEl.files && fileEl.files[0];
  if (!file) return;
  fileLabelEl.textContent = "Lendo o PDF";
  setStatus("Lendo o PDF", "info");

  const form = new FormData();
  form.append("arquivo", file);
  try {
    const res = await fetch("/api/v1/cv:import", { method: "POST", body: form });
    if (res.status === 401) { location.href = "/login"; return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.detail || "Não consegui ler esse PDF", "err");
      fileLabelEl.textContent = "Importar PDF";
      return;
    }
    fileLabelEl.textContent = "Importar PDF";
    setStatus("");
    importPreview(data);
  } catch (err) {
    setStatus("Sem conexão para enviar o PDF", "err");
    fileLabelEl.textContent = "Importar PDF";
  } finally {
    fileEl.value = "";
  }
});

/* ---------------------------------------------------------------- boot */
(async function boot() {
  const data = await load();
  render(data.modules);
  if (!modules.some((m) => m.items.some((it) => (it.title || it.value || "").trim()))) {
    setStatus("Nada importado ainda. Use <strong>Importar PDF</strong> para ler o currículo.", "info");
  }
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
