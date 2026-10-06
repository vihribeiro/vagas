/* Service worker da extensão "Vagas — LinkedIn bridge".
 *
 * As chamadas à API saem daqui, e não do content script: o content script roda
 * dentro da página do LinkedIn e o navegador bloquearia o fetch cross-origin.
 * Com host_permissions, o fetch feito pelo service worker não passa pelo CORS
 * da página. Nenhuma senha do LinkedIn é lida — a extensão só usa a chave de
 * API do próprio painel (VAGAS_API_KEY), guardada no chrome.storage.local.
 */

const DEFAULTS = {
  apiUrl: "https://vagas.av-house.com",
  apiKey: "",
  source: "linkedin",
  defaultRadio: "none", // none | yes | no — Sim/Não sem resposta mapeada
};

/* Modelo inicial de respostas do Easy Apply. Cada linha = pattern => resposta;
   pattern é uma lista separada por vírgula de palavras-chave (bate no rótulo
   do campo, normalizado). O usuário edita tudo nas Opções. */
const TEMPLATE_DEFAULT = [
  { pattern: "telefone,phone,número de telefone,número de celular,phone number", answer: "" },
  { pattern: "salário,salario,salary,pretensão salarial,salary expectation", answer: "" },
  { pattern: "experiência,experiencia,years of experience,ano de experiência", answer: "" },
  { pattern: "portfólio,portfolio,portfolio link,link do portfólio,site pessoal,github", answer: "" },
  { pattern: "linkedin", answer: "" },
  { pattern: "inglês,ingles,english level,nível de inglês,language proficiency", answer: "" },
  { pattern: "autorização,authorized to work,auth to work,permissão para trabalhar,right to work", answer: "sim" },
  { pattern: "visto,visa,sponsorship,precisa de visto,visa sponsorship", answer: "não" },
  { pattern: "por que você quer,why do you want,por que quer trabalhar", answer: "" },
  { pattern: "disponibilidade,availability,quando pode começar,start date", answer: "" },
];

async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULTS);
  const s = { ...DEFAULTS, ...data };
  s.apiUrl = String(s.apiUrl || "").trim().replace(/\/+$/, "");
  s.source = String(s.source || "linkedin").trim().toLowerCase() || "linkedin";
  return s;
}

async function getTemplate() {
  const data = await chrome.storage.local.get({ template: TEMPLATE_DEFAULT });
  return Array.isArray(data.template) ? data.template : TEMPLATE_DEFAULT;
}

async function sendJob(job) {
  const s = await getSettings();
  if (!s.apiKey) return { ok: false, error: "no_key" };
  const payload = {
    jobs: [
      {
        title: String(job.title || "").trim(),
        company: String(job.company || "").trim(),
        location: String(job.location || "").trim(),
        source: s.source,
        source_url: String(job.source_url || "").trim(),
        notes: "",
      },
    ],
  };
  if (!payload.jobs[0].title) return { ok: false, error: "no_title" };

  let res;
  try {
    res = await fetch(`${s.apiUrl}/api/v1/jobs:bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": s.apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, error: "network" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: "unauthorized" };
  if (!res.ok) return { ok: false, error: `http_${res.status}` };

  let body = null;
  try { body = await res.json(); } catch (err) { /* resposta sem corpo */ }
  return {
    ok: true,
    inserted: Number(body?.inserted) || 0,
    skipped: Number(body?.skipped) || 0,
  };
}

async function testConnection() {
  const s = await getSettings();
  if (!s.apiUrl) return { ok: false, error: "no_url" };
  if (!s.apiKey) return { ok: false, error: "no_key" };
  try {
    const res = await fetch(`${s.apiUrl}/api/v1/cv`, {
      headers: { "X-API-Key": s.apiKey },
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: "network" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case "GET_SETUP": {
        const [settings, template] = await Promise.all([getSettings(), getTemplate()]);
        sendResponse({
          source: settings.source,
          defaultRadio: settings.defaultRadio,
          template,
          configured: !!settings.apiKey,
        });
        return;
      }
      case "SEND_JOB":
        sendResponse(await sendJob(msg.job || {}));
        return;
      case "TEST_CONNECTION":
        sendResponse(await testConnection());
        return;
      default:
        sendResponse({ ok: false, error: "unknown" });
    }
  })();
  return true; // resposta chega de forma assíncrona
});