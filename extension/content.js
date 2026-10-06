/* Content script — roda nas páginas do LinkedIn Jobs.
 *
 * 1) Injeta um botão "+" em cada card dos resultados para enviar a vaga pro
 *    painel (o POST acontece no service worker, background.js).
 * 2) Na página de detalhe, injeta um botão flutuante "Enviar pra vagas".
 * 3) Autopreenche os formulários do Easy Apply com as respostas do modelo
 *    (opções da extensão). NUNCA envia a candidatura: o clique final é seu.
 *
 * O LinkedIn muda os seletores com frequência — aqui tudo tem fallback:
 * se as classes conhecidas não existirem, a extensão detecta qualquer âncora
 * /jobs/view/{id} e usa o contêiner dela como card. Um contador ("pill")
 * no canto inferior esquerdo mostra o que a extensão encontrou na página.
 */
"use strict";

/* ------------------------------------------------------------------ estado */
let template = [];
let defaultRadio = "none";
let setup = { configured: false };
const autofilled = new WeakSet();
let pill = null;
let loopTimer = null;

/* ---------------------------------------------------------------- utilidades */
function u(t) {
  return String(t || "").replace(/\s+/g, " ").trim();
}
function normalize(s) {
  return u(s).toLowerCase();
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

function jobHref(card) {
  const a =
    card.querySelector('a[href*="/jobs/view/"]') ||
    card.querySelector('a[href*="/jobs/"]');
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
    ".job-card-container__link",
    "h3.base-search-card__title",
    "[data-tracking-control-name*='job-card']",
    "h3",
    "h2",
    "h4",
    "strong",
  ]);
  let company = firstText(card, [
    ".job-card-container__primary-description",
    ".artdeco-entity-lockup__subtitle",
    ".base-search-card__subtitle",
    ".job-search-card__subtitle",
    ".job-card-container__company-name",
    "a[data-tracking-control-name*='company']",
  ]);
  let location = firstText(card, [
    ".job-card-container__metadata-item",
    ".base-search-card__metadata",
    ".job-search-card__location",
    ".artdeco-entity-lockup__caption",
    ".job-card-container__metadata-wrapper",
  ]);
  let href = jobHref(card);

  // Fallback genérico: título sai do rótulo/texto do link da vaga, e empresa/
  // local saem das linhas do texto do card (layout novo que muda as classes).
  if (!title) {
    const link = card.querySelector('a[href*="/jobs/view/"]');
    title = link
      ? u(link.getAttribute("aria-label")) || u(link.textContent) || u(link.title)
      : "";
  }
  if (!title) {
    // Diagnóstico: o layout mudou a ponto de não achar o título.
    // eslint-disable-next-line no-console
    console.log("[vagas-bridge] card não lido — estrutura da página:", card.outerHTML.slice(0, 1500));
  }
  if (company === "" || location === "") {
    const lines = (card.innerText || "")
      .split("\n")
      .map(u)
      .filter(Boolean)
      .filter((l) => l !== title);
    if (company === "" && lines.length) company = lines[0];
    if (location === "") {
      location =
        lines.find((l) => /[·,•]|\d/.test(l) && l !== company) ||
        (lines.length > 1 ? lines[1] : "") ||
        "";
    }
  }
  if (!title) return null;
  return { title, company, location, source_url: href };
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
    "a[data-tracking-control-name*='company']",
  ]);
  const location = firstText(document, [
    ".job-details-jobs-unified-top-card__tertiary-description-container",
    ".jobs-unified-top-card__tertiary-description-container",
    ".job-details-jobs-unified-top-card__metadata",
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
  ".scaffold-layout__list-item",
  ".job-card-container",
  ".jobs-search-results__card",
  ".jobs-search-card",
];

/* Sobe até o menor ancestral que contém exatamente esta âncora de vaga. */
function containerForJobLink(anchor) {
  let c = anchor;
  for (let i = 0; i < 5; i++) {
    const p = c.parentElement;
    if (!p || p === document.body || p === document.documentElement) return null;
    if (p.querySelectorAll('a[href*="/jobs/view/"]').length === 1) return p;
    c = p;
  }
  return null;
}

function findCards() {
  for (const sel of CARD_SELECTORS) {
    const all = [...document.querySelectorAll(sel)];
    if (!all.length) continue;
    const props = all.filter((c) => c.querySelector('a[href*="/jobs/"]'));
    if (props.length) return props;
  }
  // Fallback: qualquer âncora de vaga /jobs/view/{id} → contêiner pai
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/jobs/view/"]')) {
    const box = containerForJobLink(a);
    if (!box || seen.has(box)) continue;
    seen.add(box);
    out.push(box);
  }
  return out;
}

function placeCardButtons() {
  for (const card of findCards()) {
    if (card.hasAttribute("data-ve-card")) continue;
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
        toast("Não consegui ler este card — abra o console (F12) e me mande o log.");
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

/* ------------------------------------------------- contador de diagnóstico */
let pillHidden = false;
function placePill({ cards, detail }) {
  if (pillHidden) return;
  if (!pill) {
    pill = document.createElement("div");
    pill.className = "ve-pill";
    const label = document.createElement("span");
    label.className = "ve-label";
    const hide = document.createElement("button");
    hide.textContent = "×";
    hide.title = "Ocultar até recarregar a página";
    hide.addEventListener("click", () => {
      pill.remove();
      pill = null;
      pillHidden = true;
    });
    pill.append(label, hide);
    document.body.appendChild(pill);
  }
  let msg;
  if (detail) {
    msg = "Página de vaga — botão “＋ Enviar pra vagas” no canto inferior direito";
  } else if (cards > 0) {
    msg = `${cards} card(s) — clique em ﹢ para enviar pro painel`;
  } else {
    msg = "Nenhum card detectado nesta página";
  }
  if (!setup.configured) msg += "  ·  ⚠ chave de API não configurada";
  pill.className = "ve-pill" + ((!detail && cards === 0) ? " warn" : "");
  pill.querySelector(".ve-label").textContent = msg;
}

/* -------------------------------------------------------- autofill (Easy Apply) */
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
    const target = g.radios.find((r) => wantBool(labelOf(r)) === want) || g.radios[0];
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
function schedule() {
  if (loopTimer) return;
  loopTimer = setTimeout(() => {
    loopTimer = null;
    const detail = isDetailPage();
    placeCardButtons();
    placeDetailButton();
    placePill({ cards: findCards().length, detail });
    const modal = document.querySelector(
      "#jobs-easy-apply-modal, .jobs-easy-apply-modal, .jobs-easy-apply-form"
    );
    if (modal) {
      addFillButton(modal);
      autoFillOnce(modal);
    }
  }, 350);
}

/* ------------------------------------------------------------------- init */
sendMessage({ type: "GET_SETUP" }).then((r) => {
  if (r && r.template) template = parseTemplate(r.template);
  defaultRadio = r && r.defaultRadio ? r.defaultRadio : "none";
  setup.configured = !!(r && r.configured);
});

const mo = new MutationObserver(schedule);
mo.observe(document.documentElement, { childList: true, subtree: true });
schedule();
// rede de segurança para trocas de rota que não disparam mutação
setInterval(schedule, 2000);