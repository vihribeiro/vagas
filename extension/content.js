/* Content script — roda nas páginas do LinkedIn Jobs.
 *
 * 1) Injeta um botão "+" em cada card dos resultados para enviar a vaga pro
 *    painel (o POST acontece no service worker, background.js).
 * 2) Na página de detalhe, injeta um botão flutuante "Enviar pra vagas".
 * 3) Autopreenche os formulários do Easy Apply com as respostas do modelo
 *    (opções da extensão). NUNCA envia a candidatura: o clique final é seu.
 *
 * O LinkedIn muda os seletores com frequência — tudo aqui é com fallback e
 * idempotente, pensado para sobreviver a trocas de classe sem quebrar.
 */
"use strict";

const STYLE = `
  .ve-btn {
    position: absolute !important;
    top: 6px !important;
    right: 6px !important;
    z-index: 99 !important;
    width: 24px !important;
    height: 24px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    display: grid !important;
    place-items: center !important;
    border: 0 !important;
    border-radius: 50% !important;
    background: rgba(10, 102, 194, .92) !important;
    box-shadow: 0 1px 4px rgba(0,0,0,.3) !important;
    color: #fff !important;
    font: 700 15px/1 system-ui, sans-serif !important;
    cursor: pointer !important;
    opacity: .25 !important;
    transition: opacity .15s ease !important;
  }
  .ve-btn:hover, .ve-btn:focus-visible { opacity: 1 !important; }
  .ve-btn[data-state="ok"] { background: #2e7d32 !important; opacity: 1 !important; }
  .ve-btn[data-state="dup"] { background: #b26a00 !important; opacity: 1 !important; }
  .ve-btn[data-state="err"] { background: #c62828 !important; opacity: 1 !important; }
  .ve-detail {
    position: fixed !important;
    right: 18px !important;
    bottom: 18px !important;
    z-index: 2147483000 !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 10px 14px !important;
    border: 0 !important;
    border-radius: 999px !important;
    background: #0a66c2 !important;
    color: #fff !important;
    font: 600 13px/1 system-ui, sans-serif !important;
    box-shadow: 0 4px 14px rgba(0,0,0,.25) !important;
    cursor: pointer !important;
  }
  .ve-detail[data-state="ok"] { background: #2e7d32 !important; }
  .ve-detail[data-state="dup"] { background: #b26a00 !important; }
  .ve-detail[data-state="err"] { background: #c62828 !important; }
  .ve-fill {
    display: inline-flex !important;
    align-items: center !important;
    margin-left: 10px !important;
    padding: 6px 12px !important;
    border: 1px solid rgba(0,0,0,.3) !important;
    border-radius: 999px !important;
    background: #f5f5f5 !important;
    color: #111 !important;
    font: 600 12px/1 system-ui, sans-serif !important;
    cursor: pointer !important;
  }
  .ve-toast {
    position: fixed !important;
    left: 50% !important;
    bottom: 24px !important;
    transform: translateX(-50%) !important;
    z-index: 2147483001 !important;
    padding: 9px 16px !important;
    border-radius: 8px !important;
    background: #111 !important;
    color: #fff !important;
    font: 500 13px/1 system-ui, sans-serif !important;
    box-shadow: 0 4px 14px rgba(0,0,0,.3) !important;
    opacity: 0 !important;
    transition: opacity .2s ease !important;
    pointer-events: none !important;
  }
`;

/* ---------------------------------------------------------------- utilidades */
function u(t) {
  return String(t || "").replace(/\s+/g, " ").trim();
}
function normalize(s) {
  return u(s).toLowerCase();
}

function injectStyle() {
  if (document.getElementById("ve-style")) return;
  const s = document.createElement("style");
  s.id = "ve-style";
  s.textContent = STYLE;
  (document.head || document.documentElement).appendChild(s);
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: "dead" });
        else resolve(r || { ok: false, error: "empty" });
      });
    } catch (err) {
      resolve({ ok: false, error: "dead" });
    }
  });
}

function toast(text, ms = 2400) {
  let el = document.getElementById("ve-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ve-toast";
    el.className = "ve-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.opacity = "1";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = "0"; }, ms);
}

/* Estado do botão depois do envio (inserted / já existia / erro) */
function setState(btn, res) {
  const msgs = {
    no_key: "Falta a chave de API — abra as opções da extensão.",
    unauthorized: "Chave de API inválida (401/403).",
    network: "Sem conexão com o painel — confira a URL do servidor.",
    no_title: "Não consegui ler o título da vaga.",
    dead: "Extensão desatualizada — recarregue a página.",
  };
  if (res && res.ok) {
    if (res.inserted) {
      btn.dataset.state = "ok";
      btn.textContent = "✓";
      btn.title = "Enviada pro painel";
    } else {
      btn.dataset.state = "dup";
      btn.textContent = "✓";
      btn.title = "Já existia no painel";
    }
    return;
  }
  btn.dataset.state = "err";
  btn.textContent = "✗";
  btn.title = msgs[res && res.error] || "Falha ao enviar.";
  if (res && res.error === "no_key") toast(msgs.no_key);
}

/* ------------------------------------------------- extração de dados da vaga */
function firstText(root, sels) {
  for (const s of sels) {
    const n = root.querySelector(s);
    if (n) {
      const t = u(n.textContent);
      if (t) return t;
    }
  }
  return "";
}

function cardLink(root) {
  const a = root.querySelector('a[href*="/jobs/view/"]') ||
            root.querySelector('a[href*="/jobs/"]');
  if (!a) return "";
  let href = a.getAttribute("href") || "";
  if (href.startsWith("//")) href = "https:" + href;
  if (href.startsWith("/")) href = "https://www.linkedin.com" + href;
  return href;
}

function extractCard(card) {
  const title = firstText(card, [
    "a.job-card-list__title",
    "a.job-card-container__link",
    ".job-card-list__title",
    "h3.base-search-card__title",
    "h3",
  ]);
  const company = firstText(card, [
    ".job-card-container__primary-description",
    ".artdeco-entity-lockup__subtitle",
    ".base-search-card__subtitle",
    ".job-search-card__subtitle",
    ".job-card-container__company-name",
  ]);
  const location = firstText(card, [
    ".job-card-container__metadata-item",
    ".base-search-card__metadata",
    ".job-search-card__location",
    ".artdeco-entity-lockup__caption",
  ]);
  if (!title) return null;
  return {
    title,
    company,
    location,
    source_url: cardLink(card),
  };
}

function extractDetail() {
  const title = firstText(document, [
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    "h1",
  ]);
  const company = firstText(document, [
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name",
    ".artdeco-entity-lockup__subtitle",
  ]);
  const location = firstText(document, [
    ".job-details-jobs-unified-top-card__tertiary-description-container",
    ".jobs-unified-top-card__tertiary-description-container",
  ]);
  return {
    title,
    company,
    location,
    source_url: location.href.split("?")[0],
  };
}

/* ---------------------------------------------------- botões nos cards (busca) */
const CARD_SELECTORS = [
  "li.jobs-search-results__list-item",
  "li[data-occludable-job-id]",
  ".job-card-container",
];

function findCards() {
  for (const sel of CARD_SELECTORS) {
    const all = document.querySelectorAll(sel);
    const cards = [...all].filter((c) => !c.closest("[data-ve-card]"));
    if (cards.length) return cards;
  }
  return [];
}

async function placeCardButtons() {
  for (const card of findCards()) {
    if (card.hasAttribute("data-ve-card")) continue;
    if (!card.querySelector('a[href*="/jobs/"]')) continue; // só cards de vaga
    card.setAttribute("data-ve-card", "1");
    card.style.position = "relative"; // ancora o botão no canto superior

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ve-btn";
    btn.textContent = "＋";
    btn.title = "Enviar pra vagas";
    btn.setAttribute("aria-label", "Enviar pra vagas");
    btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const job = extractCard(card);
      if (!job) {
        toast("Não consegui ler este card — o layout do LinkedIn mudou?");
        setState(btn, { ok: false, error: "no_title" });
        return;
      }
      const res = await sendMessage({ type: "SEND_JOB", job });
      setState(btn, res);
    });
    card.appendChild(btn);
  }
}

/* ---------------------------------------------------- botão na página de detalhe */
function isDetailPage() {
  return (
    /\/jobs\/view\//.test(location.pathname) ||
    !!document.querySelector(".jobs-details__main-content")
  );
}

function placeDetailButton() {
  if (!isDetailPage()) return;
  if (document.getElementById("ve-detail")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "ve-detail";
  btn.className = "ve-detail";
  btn.textContent = "＋ Enviar pra vagas";
  btn.addEventListener("click", async () => {
    const job = extractDetail();
    if (!job || !job.title) {
      toast("Não consegui ler a vaga desta página.");
      setState(btn, { ok: false, error: "no_title" });
      return;
    }
    btn.textContent = "Enviando…";
    const res = await sendMessage({ type: "SEND_JOB", job });
    if (res && res.ok) {
      btn.dataset.state = res.inserted ? "ok" : "dup";
      btn.textContent = res.inserted ? "✓ Enviada" : "✓ Já existia";
    } else {
      setState(btn, res);
      btn.textContent = "✗ Falhou — ver opções";
    }
    setTimeout(() => {
      btn.dataset.state = "";
      btn.textContent = "＋ Enviar pra vagas";
    }, 4000);
  });
  document.body.appendChild(btn);
}

/* -------------------------------------------------------- autofill (Easy Apply) */
let template = [];
let defaultRadio = "none";
const autofilled = new WeakSet();

function parseTemplate(entries) {
  return (entries || [])
    .map((e) => ({
      keys: String(e.pattern || "")
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
      answer: u(e.answer),
    }))
    .filter((e) => e.keys.length && e.answer);
}

function matchAnswer(label) {
  const l = normalize(label);
  for (const e of template) {
    if (e.keys.some((k) => l.includes(k))) return e.answer;
  }
  return null;
}

function isVisible(el) {
  if (!el || el.disabled) return false;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function labelOf(ctl) {
  if (ctl.labels && ctl.labels[0]) return u(ctl.labels[0].textContent);
  if (ctl.getAttribute("aria-label")) return u(ctl.getAttribute("aria-label"));
  if (ctl.placeholder) return u(ctl.placeholder);
  const grp = ctl.closest(
    ".fb-dash-form-element, .jobs-easy-apply-form-element, .artdeco-text-input-container, .artdeco-select, [class*='form-element']"
  );
  if (grp) {
    const t = u(
      grp.querySelector(
        "label, .fb-dash-form-element__label, .jobs-easy-apply-form-element__label, legend"
      )?.textContent
    );
    if (t) return t;
  }
  return "";
}

function setValue(ctl, value) {
  const proto = Object.getPrototypeOf(ctl);
  const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(ctl, value);
  else ctl.value = value;
  ctl.dispatchEvent(new Event("input", { bubbles: true }));
  ctl.dispatchEvent(new Event("change", { bubbles: true }));
}

function wantBool(text) {
  const t = normalize(text);
  if (["sim", "yes", "true", "s", "y"].includes(t)) return true;
  if (["não", "nao", "no", "false", "n"].includes(t)) return false;
  return null;
}

/* Preenche o que conseguir dentro do modal. Nunca clica em "Submit". */
function fillForm(scope) {
  let filled = 0;

  const textFields = scope.querySelectorAll(
    'input[type="text"], input[type="tel"], input[type="number"], input[type="email"], input[type="url"], input:not([type]), textarea'
  );
  for (const ctl of textFields) {
    if (!isVisible(ctl) || ctl.value.trim()) continue;
    const answer = matchAnswer(labelOf(ctl));
    if (!answer) continue;
    setValue(ctl, answer);
    filled += 1;
  }

  const selects = scope.querySelectorAll("select");
  for (const sel of selects) {
    if (!isVisible(sel) || sel.value) continue;
    const answer = matchAnswer(labelOf(sel));
    if (!answer) continue;
    const want = normalize(answer);
    const opts = [...sel.options].filter((o) => o.value && o.text);
    const opt = opts.find((o) => normalize(o.text) === want) ||
                opts.find((o) => normalize(o.value) === want);
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      filled += 1;
    }
  }

  const radios = [...scope.querySelectorAll('input[type="radio"]')];
  const groups = new Map();
  for (const r of radios) {
    if (!isVisible(r)) continue;
    const name = r.name || "x";
    if (!groups.has(name)) {
      groups.set(name, {
        root:
          r.closest(".fb-dash-form-element, .jobs-easy-apply-form-element, [class*='form-element']") ||
          r.closest("fieldset") ||
          scope,
        radios: [],
      });
    }
    groups.get(name).radios.push(r);
  }
  for (const g of groups.values()) {
    if (g.radios.some((r) => r.checked)) continue;
    const label = labelOf(g.radios[0]) || u(g.root?.querySelector("legend")?.textContent);
    let answer = matchAnswer(label);
    if (!answer && defaultRadio !== "none") answer = defaultRadio === "yes" ? "sim" : "não";
    if (!answer) continue;
    const want = wantBool(answer);
    if (want === null) continue;
    // escolhe o radio cujo texto bate com a resposta (sim/não); padrão: 1º radio
    const target =
      g.radios.find((r) => wantBool(labelOf(r)) === want) || g.radios[0];
    if (target && !target.checked) {
      target.click();
      filled += 1;
    }
  }

  return filled;
}

function addFillButton(modal) {
  if (modal.querySelector(".ve-fill")) return;
  const header = modal.querySelector(
    ".jobs-easy-apply-modal__header, .artdeco-modal__header, .jobs-easy-apply__header"
  );
  const target =
    header ||
    modal.querySelector(".jobs-easy-apply-modal__content, .artdeco-modal__content") ||
    modal;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ve-fill";
  btn.textContent = "Preencher respostas";
  btn.addEventListener("click", () => {
    const n = fillForm(modal);
    toast(
      n > 0
        ? `${n} campo(s) preenchido(s) — revise antes de enviar.`
        : "Nenhum campo reconhecido — confira a lista de respostas nas opções."
    );
  });
  target.appendChild(btn);
}

function autoFillOnce(modal) {
  if (autofilled.has(modal)) return;
  autofilled.add(modal);
  const n = fillForm(modal);
  if (n > 0) toast(`${n} campo(s) preenchido(s) — revise antes de enviar.`);
}

/* ------------------------------------------------------------------- loop */
let loopTimer = null;
function schedule() {
  if (loopTimer) return;
  loopTimer = setTimeout(() => {
    loopTimer = null;
    placeCardButtons();
    placeDetailButton();
    const modal = document.querySelector(
      "#jobs-easy-apply-modal, .jobs-easy-apply-modal, .jobs-easy-apply-form"
    );
    if (modal) {
      addFillButton(modal);
      autoFillOnce(modal);
    }
  }, 350);
}

injectStyle();
sendMessage({ type: "GET_SETUP" }).then((r) => {
  if (r && r.template) template = parseTemplate(r.template);
  defaultRadio = r && r.defaultRadio ? r.defaultRadio : "none";
});

const mo = new MutationObserver(schedule);
mo.observe(document.documentElement, { childList: true, subtree: true });
schedule();
// rede de segurança para trocas de rota que não disparam mutação
setInterval(schedule, 2000);