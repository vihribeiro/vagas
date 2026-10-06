/* Modo deslizar (Tinder de vagas): o baralho de pendentes, uma vaga por vez,
   com todas as informações no card. Deslizar (ou botões / ← →) decide:
   esquerda = candidatar, direita = dispensar. Desfazer devolve o último card.

   Toda decisão é o PATCH de status que a lista já usa — nada novo no backend.
   As funções $, esc e scoreTier vêm do app.js. */
(function () {
  const deckEl = document.getElementById("swipe-deck");
  const hintEl = document.getElementById("swipe-hint");
  const undoBtn = document.getElementById("swipe-undo");
  const toastEl = document.getElementById("toast");

  let jobs = [];
  let history = []; // decisões desfeitas nesta sessão do baralho
  let busy = false;

  const THRESHOLD = 88; // px de arrasto que decide o lado

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
      setTimeout(() => { toastEl.hidden = true; }, 200);
    }, 2000);
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(I18N.locale(), { day: "2-digit", month: "short" });
  }

  function recoPill(j) {
    if (!j.recommendation) return "";
    return `<span class="reco reco-${esc(j.recommendation)}">${esc(I18N.t("reco_" + j.recommendation) || j.recommendation)}</span>`;
  }

  function scoreBadge(j) {
    if (j.score == null || j.score === "") return "";
    return `<span class="score" data-tier="${esc(scoreTier(j.score))}">${esc(Number(j.score).toFixed(1))}</span>`;
  }

  function cardHTML(j) {
    const reasons = (j.reasons || [])
      .filter(Boolean)
      .map((r) => `<li>${esc(r)}</li>`)
      .join("");
    const tips = (j.tips || [])
      .filter(Boolean)
      .map((t) => `<li>${esc(t)}</li>`)
      .join("");
    const date = fmtDate(j.created_at);

    return `
      <article class="swipe-card" data-id="${j.id}">
        <div class="swipe-card-top">
          ${scoreBadge(j)}${recoPill(j)}
          <span class="src source-${esc(j.source || "other")}">${esc(j.source || I18N.t("source_other"))}</span>
        </div>
        <h2 class="swipe-title">${esc(String(j.title || "").replace(/\s*\[\d\.\d\/5\]$/, ""))}</h2>
        <p class="swipe-meta">${esc(j.company || "—")}${j.location ? " · " + esc(j.location) : ""}${date ? " · " + date : ""}</p>
        ${j.notes ? `<p class="swipe-stack">${esc(j.notes)}</p>` : ""}

        <div class="swipe-eval">
          ${reasons ? `<div class="swipe-group"><h3>${I18N.t("swipe_reasons")}</h3><ul class="swipe-list">${reasons}</ul></div>` : ""}
          ${tips ? `<div class="swipe-group"><h3>${I18N.t("swipe_tips")}</h3><ul class="swipe-list tips">${tips}</ul></div>` : ""}
          ${!reasons && !tips ? `<p class="swipe-none">${I18N.t("swipe_no_eval")}</p>` : ""}
        </div>

        <footer class="swipe-links">
          ${j.source_url
            ? `<a class="btn" href="${esc(j.source_url)}" target="_blank" rel="noopener">${I18N.t("swipe_original")}</a>`
            : ""}
          <a class="btn quiet" href="/vagas/${j.id}">${I18N.t("swipe_detail")}</a>
        </footer>
      </article>`;
  }

  function renderDeck() {
    if (!jobs.length) {
      deckEl.innerHTML = `
        <p class="empty"><strong>${I18N.t("swipe_all_done")}</strong>
          ${I18N.t("swipe_all_done_body")}
        </p>
        <p class="empty-cta"><button type="button" class="btn primary" id="swipe-back-list">${I18N.t("swipe_view_list")}</button></p>`;
      hintEl.hidden = true;
      undoBtn.hidden = history.length === 0;
      deckEl.querySelector("#swipe-back-list")?.addEventListener("click", () =>
        document.querySelector('[data-view="list"]')?.click()
      );
      return;
    }

    // card de trás (peek) + card da frente com todas as informações
    deckEl.innerHTML =
      (jobs[1] ? `<div class="swipe-card swipe-card-behind">${cardHTML(jobs[1])}</div>` : "") +
      `<div class="swipe-card swipe-card-front">${cardHTML(jobs[0])}</div>`;

    hintEl.hidden = false;
    undoBtn.hidden = history.length === 0;
    attachDrag(document.querySelector(".swipe-card-front"));
  }

  /* ---------------------------------------------------------------- gesto */
  let drag = null;

  function attachDrag(card) {
    if (!card) return;
    card.addEventListener("pointerdown", (e) => {
      if (busy) return;
      card.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
    });
    card.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag.dx = e.clientX - drag.x0;
      drag.dy = e.clientY - drag.y0;
      const rot = drag.dx / 18;
      card.style.transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${rot}deg)`;
      card.style.opacity = Math.min(1, 1 - Math.abs(drag.dx) / (THRESHOLD * 2.4));
    });
    card.addEventListener("pointerup", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = drag.dx;
      drag = null;
      if (dx > THRESHOLD) decide(1);           // direita → dispensar
      else if (dx < -THRESHOLD) decide(0);     // esquerda → candidatar
      else card.style.transform = "";
    });
    card.addEventListener("pointercancel", () => { drag = null; });
  }

  async function decide(choice) {
    // choice 0 = candidatar (esquerda) · 1 = dispensar (direita)
    const job = jobs[0];
    if (!job || busy) return;
    busy = true;
    const dir = choice ? "right" : "left";
    const status = choice ? "dismissed" : "applied";
    const card = document.querySelector(".swipe-card-front");
    if (card) {
      card.classList.add("fly-" + dir);
      card.style.pointerEvents = "none";
    }

    const ok = await patchStatus(job.id, status);
    if (!ok) {
      // devolve o card: nada de perder a vaga por erro de rede
      if (card) {
        card.classList.remove("fly-" + dir);
        card.style.transform = "";
        card.style.pointerEvents = "";
      }
      busy = false;
      toast(I18N.t("swipe_reg_fail"));
      return;
    }

    jobs.shift();
    history.push({ job, status });
    renderDeck();
    busy = false;
  }

  /* ---------------------------------------------------------------- ações */
  document.getElementById("swipe-apply").addEventListener("click", () => decide(0));
  document.getElementById("swipe-dismiss").addEventListener("click", () => decide(1));

  undoBtn.addEventListener("click", async () => {
    if (busy) return;
    const last = history.pop();
    if (!last) return;
    busy = true;
    undoBtn.disabled = true;
    const ok = await patchStatus(last.job.id, "pending");
    if (!ok) {
      history.push(last);
      toast(I18N.t("swipe_undo_fail"));
    } else {
      jobs.unshift(last.job);
    }
    undoBtn.disabled = false;
    renderDeck();
    busy = false;
  });

  document.addEventListener("keydown", (e) => {
    if (document.getElementById("swipe").hidden) return;
    if (e.key === "ArrowLeft") decide(0);    // ← candidatar
    if (e.key === "ArrowRight") decide(1);   // → dispensar
  });

  async function patchStatus(id, status) {
    try {
      const res = await fetch(`/api/v1/jobs/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.status === 401) { location.href = "/login"; return false; }
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  async function load() {
    deckEl.innerHTML =
      `<p class="empty"><strong>${I18N.t("loading")}</strong>${I18N.t("loading_wait")}</p>`;
    try {
      const res = await fetch("/api/v1/jobs?status=pending");
      if (res.status === 401) { location.href = "/login"; return; }
      const data = await res.json();
      jobs = data.jobs || [];
      history = [];
      renderDeck();
    } catch (err) {
      deckEl.innerHTML =
        `<p class="empty"><strong>${I18N.t("app_offline_title")}</strong>${I18N.t("app_offline_body")}</p>`;
    }
  }

  window.SwipeDeck = {
    reload: () => { history = []; load(); },
    stop: () => { jobs = []; },
  };

  // Boot: quando o app abriu já em modo deslizar (preferência salva), o
  // app.js chamou setView antes deste arquivo carregar — carrega aqui então.
  if (!document.getElementById("swipe").hidden) load();
})();