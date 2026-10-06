/* Detalhe da vaga: troca de status e salvamento de anotações. */
const msgEl = document.getElementById("save-msg");
const notesEl = document.getElementById("notes");
const statusBtns = Array.from(document.querySelectorAll(".status-btns .btn"));
const statusPill = document.querySelector(".tag-row .pill");

let msgTimer = null;

function showMsg(text, ok = true) {
  clearTimeout(msgTimer);
  msgEl.textContent = text;
  msgEl.className = "save-msg " + (ok ? "ok" : "err");
  msgTimer = setTimeout(() => { msgEl.textContent = ""; }, 4000);
}

function markActive(status) {
  statusBtns.forEach((b) => b.classList.toggle("active", b.dataset.status === status));
  // mantém o selo do topo em dia com o botão marcado
  var match = statusBtns.find((b) => b.dataset.status === status);
  if (match && statusPill) {
    statusPill.className = "pill status-" + status;
    statusPill.textContent = match.dataset.label;
  }
}

async function patchStatus(status, notes) {
  const res = await fetch(`/api/v1/jobs/${JOB_ID}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, notes }),
  });
  if (res.status === 401) { location.href = "/login"; return null; }
  if (!res.ok) { showMsg("Erro ao salvar.", false); return null; }
  return res.json();
}

function busy(on) {
  statusBtns.forEach((b) => { b.disabled = on; });
  document.getElementById("save-notes").disabled = on;
}

statusBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    busy(true);
    const data = await patchStatus(btn.dataset.status, notesEl.value);
    busy(false);
    if (data) {
      markActive(data.status);
      showMsg("Status atualizado.");
    }
  });
});

document.getElementById("save-notes").addEventListener("click", async () => {
  const current = statusBtns.find((b) => b.classList.contains("active"));
  const status = current ? current.dataset.status : CURRENT_STATUS;
  busy(true);
  const data = await patchStatus(status, notesEl.value);
  busy(false);
  if (data) {
    markActive(data.status);
    showMsg("Anotações salvas.");
  }
});

// Ctrl/Cmd + Enter salva as anotações
notesEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    document.getElementById("save-notes").click();
  }
});

markActive(CURRENT_STATUS);
