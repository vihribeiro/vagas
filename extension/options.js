"use strict";

const $ = (s) => document.querySelector(s);

function normalizeTemplate(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=>");
      const pattern = i === -1 ? l : l.slice(0, i).trim();
      const answer = i === -1 ? "" : l.slice(i + 2).trim();
      return { pattern, answer };
    })
    .filter((e) => e.pattern && e.answer);
}

async function load() {
  const data = await chrome.storage.local.get({});
  $("#apiUrl").value = data.apiUrl || "https://vagas.av-house.com";
  $("#apiKey").value = data.apiKey || "";
  $("#source").value = data.source || "linkedin";
  $("#defaultRadio").value = data.defaultRadio || "none";
  $("#template").value = (Array.isArray(data.template) ? data.template : [])
    .map((e) => `${e.pattern} => ${e.answer}`)
    .join("\n");
}

async function save() {
  await chrome.storage.local.set({
    apiUrl: $("#apiUrl").value.trim(),
    apiKey: $("#apiKey").value.trim(),
    source: $("#source").value.trim().toLowerCase() || "linkedin",
    defaultRadio: $("#defaultRadio").value,
    template: normalizeTemplate($("#template").value),
  });
}

function status(text, ok = true) {
  const el = $("#status");
  el.textContent = text;
  el.style.color = ok ? "#2e7d32" : "#c62828";
}

$("#form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  await save();
  status("Configuração salva.");
});

$("#test").addEventListener("click", async () => {
  await save();
  status("Testando…");
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TEST_CONNECTION" }, (r) =>
      resolve(r || { ok: false, error: "empty" })
    );
  });
  if (res.ok && res.status === 200) status("Tudo certo: servidor e chave válidos.");
  else if (res.error === "no_key") status("Falta a chave de API.", false);
  else if (res.error === "no_url") status("Falta a URL do servidor.", false);
  else if (res.error === "network") status("Sem conexão com o servidor.", false);
  else if (res.status === 401 || res.status === 403) status("Chave inválida (401/403).", false);
  else status(`Servidor respondeu ${res.status} — confira a URL.`, false);
});

load();