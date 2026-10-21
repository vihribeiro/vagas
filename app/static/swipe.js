/* Modo deslizar (Tinder de vagas): o baralho de pendentes, uma vaga por vez,
   com todas as informações no card. Deslizar (ou botões / ← →) decide:
   esquerda = candidatar, direita = dispensar. Desfazer devolve o último card.

   Candidatar NÃO altera status — a vaga continua em Pendentes (o card só sai
   do baralho desta sessão; marcar como candidatada é decisão à parte). Só
   dispensar grava status, com o mesmo PATCH de status que a lista usa.
   As funções $, esc e scoreTier vêm do app.js. */
(function () {
  const deckEl = document.getElementById("swipe-deck");
  const hintEl = document.getElementById("swipe-hint");
  const undoBtn = document.getElementById("swipe-undo");
  const toastEl = document.getElementById("toast");
  const trashTargetEl = document.getElementById("swipe-trash-target");
  const luckEl = document.getElementById("swipe-luck");

  let jobs = [];
  let history = []; // decisões desfeitas nesta sessão do baralho
  let busy = false;
  let luckTimer = null;
  let trashTimer = null;

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

  function stackCardHTML(job, depth) {
    return `<div class="swipe-card swipe-card-stack stack-layer-${depth}" ${scoreColorAttrs(job.score)} aria-hidden="true"></div>`;
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
      <article class="swipe-card" data-id="${j.id}" ${scoreColorAttrs(j.score)}>
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
          <button type="button" class="btn danger" data-job-del="${j.id}">${I18N.t("job_delete_btn")}</button>
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

    // Três próximas vagas formam a pilha; a primeira continua na frente.
    const stack = jobs.slice(1, 4).map((job, index) =>
      stackCardHTML(job, index + 1)
    ).reverse().join("");
    deckEl.innerHTML = stack +
      `<div class="swipe-card swipe-card-front" ${scoreColorAttrs(jobs[0].score)}>${cardHTML(jobs[0])}</div>`;

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
      // botões e links do card não devem iniciar o gesto de deslizar
      if (e.target.closest("a, button")) return;
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
      else {
        card.style.transform = "";
        card.style.opacity = "";
        trashTargetEl.classList.remove("is-targeted");
      }
    });
    card.addEventListener("pointercancel", () => {
      drag = null;
      card.style.transform = "";
      card.style.opacity = "";
      trashTargetEl.classList.remove("is-targeted");
    });
  }

  function showGoodLuck() {
    luckEl.textContent = I18N.t("swipe_good_luck");
    luckEl.hidden = false;
    requestAnimationFrame(() => luckEl.classList.add("is-visible"));
    clearTimeout(luckTimer);
    luckTimer = setTimeout(() => {
      luckEl.classList.remove("is-visible");
      setTimeout(() => { luckEl.hidden = true; }, 220);
    }, 1250);
  }

  function showTrash() {
    clearTimeout(trashTimer);
    trashTargetEl.classList.add("is-visible", "is-targeted");
  }

  function hideTrash() {
    trashTargetEl.classList.remove("is-targeted");
    clearTimeout(trashTimer);
    trashTimer = setTimeout(() => trashTargetEl.classList.remove("is-visible"), 240);
  }

  function animateExit(card, dismiss) {
    const startTransform = getComputedStyle(card).transform;
    const startOpacity = getComputedStyle(card).opacity;
    const dragTransform = card.style.transform;
    card.style.transform = "none";
    const base = card.getBoundingClientRect();
    card.style.transform = dragTransform;

    const target = dismiss ? trashTargetEl.getBoundingClientRect() : null;
    const targetX = dismiss ? target.left + target.width / 2 : -window.innerWidth;
    const targetY = dismiss ? target.top + target.height / 2 : base.top + base.height / 2 - 56;
    const dx = targetX - (base.left + base.width / 2);
    const dy = targetY - (base.top + base.height / 2);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (typeof card.animate !== "function") {
      card.style.transform = "";
      card.style.opacity = "";
      if (dismiss) {
        card.style.setProperty("--trash-x", `${dx}px`);
        card.style.setProperty("--trash-y", `${dy}px`);
      }
      card.classList.add(dismiss ? "fly-trash-fallback" : "fly-left");
      return { finished: new Promise((resolve) => setTimeout(resolve, reducedMotion ? 1 : 360)), cancel() {} };
    }

    const destination = `translate(${dx}px, ${dy}px) rotate(${dismiss ? 58 : -16}deg) scale(.08)`;
    const frames = dismiss ? [
      { transform: startTransform, opacity: startOpacity, offset: 0 },
      { transform: `translate(${-dx * 0.05}px, -12px) rotate(-5deg) scale(1.02)`, opacity: 1, offset: .14 },
      { transform: `translate(${dx * 0.48}px, ${dy * 0.32}px) rotate(18deg) scale(.78)`, opacity: .96, offset: .46 },
      { transform: `translate(${dx * 0.88}px, ${dy * 0.84}px) rotate(42deg) scale(.32)`, opacity: .7, offset: .82 },
      { transform: destination, opacity: 0, offset: 1 },
    ] : [
      { transform: startTransform, opacity: startOpacity, offset: 0 },
      { transform: `translate(${dx * 0.34}px, ${dy * 0.12}px) rotate(-7deg) scale(.98)`, opacity: .95, offset: .28 },
      { transform: destination, opacity: 0, offset: 1 },
    ];

    return card.animate(frames, {
      duration: reducedMotion ? 1 : (dismiss ? 760 : 520),
      easing: "cubic-bezier(.2,.85,.25,1)",
      fill: "forwards",
    });
  }

  async function decide(choice) {
    // choice 0 = candidatar (esquerda) · 1 = dispensar (direita)
    const job = jobs[0];
    if (!job || busy) return;
    busy = true;
    // dispensar grava dismissed; candidatar não toca no status (fica pending)
    const status = choice ? "dismissed" : null;
    const card = document.querySelector(".swipe-card-front");
    let animation = null;
    const statusRequest = status ? patchStatus(job.id, status) : Promise.resolve(true);
    if (card) {
      card.style.pointerEvents = "none";
      if (choice) {
        showTrash();
        await new Promise((resolve) => setTimeout(resolve, 150));
      } else {
        showGoodLuck();
      }
      animation = animateExit(card, Boolean(choice));
    }

    const animationDone = animation ? animation.finished.catch(() => {}) : Promise.resolve();
    const [ok] = await Promise.all([statusRequest, animationDone]);
    if (animation && typeof animation.cancel === "function") animation.cancel();
    if (choice) hideTrash();

    if (!ok) {
      // devolve o card: nada de perder a vaga por erro de rede
      if (card) {
        card.classList.remove("fly-left", "fly-trash-fallback");
        card.style.transform = "";
        card.style.opacity = "";
        card.style.pointerEvents = "";
        card.style.removeProperty("--trash-x");
        card.style.removeProperty("--trash-y");
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

  /* ---------------------------------------------------------------- exclusão */
  deckEl.addEventListener("click", (e) => {
    const del = e.target.closest("[data-job-del]");
    if (!del) return;
    deleteFromDeck(Number(del.dataset.jobDel));
  });

  async function deleteFromDeck(id) {
    if (!confirm(I18N.t("job_delete_confirm"))) return;
    try {
      const res = await fetch(`/api/v1/jobs/${id}`, { method: "DELETE" });
      if (res.status === 401) { location.href = "/login"; return; }
      if (!res.ok) { toast(I18N.t("job_delete_fail")); return; }
      jobs = jobs.filter((j) => j.id !== id);
      // só some do histórico o que foi excluído — mantém o undo das outras
      history = history.filter((h) => h.job.id !== id);
      renderDeck();
    } catch (err) {
      toast(I18N.t("job_delete_fail"));
    }
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
    if (last.status) {
      // dispensar gravou status: devolver é voltar para pendente
      const ok = await patchStatus(last.job.id, "pending");
      if (!ok) {
        history.push(last);
        toast(I18N.t("swipe_undo_fail"));
      } else {
        jobs.unshift(last.job);
      }
    } else {
      // candidatar não gravou nada: é só pôr o card de volta no baralho
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
