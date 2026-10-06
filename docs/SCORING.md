# Contrato de avaliação de vagas (scoring)

Como o app decide **qual vaga vale a pena** — e como qualquer ranqueador
(muse.ai, hermes, um agente com LLM, um script local) entra nesse fluxo sem
mudar o app.

## Princípio

**O app coleta e exibe; o ranqueador decide.** O app não sabe calcular match
currículo × vaga — e nem precisa. Ele só:

1. guarda as vagas (qualquer produtor via `POST /api/v1/jobs:bulk`),
2. guarda o currículo em módulos estruturados,
3. entrega o que falta avaliar a quem souber avaliar, e
4. armazena o resultado e ordena por ele.

O score é **sempre** gravado por quem avaliou (campo `scored_by`), nunca
inventado pelo app. Trocar de ranqueador não exige mudança no app: é o mesmo
contrato HTTP com outra implementação do "meio".

## Fases

```
1. INGESTÃO      produtor (muse.ai, scanner, career-ops) → POST /api/v1/jobs:bulk
2. CURRÍCULO     navegador (PDF → revisão) OU agente  → PUT /api/v1/cv
                 (as duas escrevem os MESMOS módulos em cv_modules)
                 cada save bumpa cv_version
3. AVALIAÇÃO     ranqueador lê o que falta avaliar, calcula, grava
```

A fase 3 só existe se as fases 1 e 2 existirem. Sem currículo não há o que
comparar. A fase 2 pode vir do agente (o ranqueador importa o CV também), mas
o fluxo do navegador continua sendo o principal.

## Como o ranqueador participa

Somente duas chamadas, com a mesma `X-API-Key` da ingestão:

### 1. Puxar o que avaliar (GET, pull)

```
GET /api/v1/jobs:for-scoring
```

Respostas:

```json
{
  "cv_version": 3,
  "cv": [
    { "key": "competencias", "label": "Competências", "kind": "fields",
      "items": [ { "label": "Frontend", "value": "Angular, TypeScript, RxJS" } ] },
    { "key": "resumo", "label": "Resumo profissional", "kind": "text",
      "items": [ { "label": "", "value": "..." } ] }
  ],
  "jobs": [
    {
      "id": 12,
      "dedup_key": "desenvolvedor react pleno|stone",
      "title": "Desenvolvedor React Pleno",
      "company": "Stone",
      "location": "São Paulo · híbrido",
      "source": "greenhouse",
      "source_url": "https://boards.greenhouse.io/...",
      "notes": "React + Next.js + TypeScript",
      "created_at": "2026-10-06T15:00:00+00:00"
    }
  ]
}
```

- `cv` são os módulos do currículo como o painel os mostra — a mesma estrutura
  que `GET /api/v1/cv` devolve. Nenhum PDF: o ranqueador lê estrutura.
- `jobs` só traz onde falta avaliação: vaga **sem** `job_evals` ou cuja
  avaliação foi feita com uma **versão anterior** do currículo
  (`job_evals.cv_version < cv_version`).
- Tudo numa chamada: o currículo já vem junto, não precisa de segunda rota.

### 2. Gravar as avaliações (POST)

```
POST /api/v1/jobs:score
```

```json
{
  "evals": [
    {
      "id": 12,
      "score": 4.1,
      "recommendation": "yes",
      "reasons": ["Match alto de Angular + TypeScript", "100% remoto"],
      "tips": ["Na carta, destaque o projeto Seller Hub"],
      "scored_by": "muse-ai-v2"
    }
  ]
}
```

Regras:

| Campo | Regra |
|---|---|
| `id` **ou** `dedup_key` | identifica a vaga (um dos dois; `id` ganha) |
| `score` | número 0–5, ou `null` |
| `recommendation` | `yes` \| `maybe` \| `no` (ou vazio) |
| `reasons` | lista de strings, até 20, ~300 caracteres cada |
| `tips` | lista de strings, até 20 — **é o campo das dicas do app** |
| `scored_by` | quem avaliou, até 60 chars (aparece no detalhe: "por muse-ai-v2") |

Mandar tudo vazio (score `null`, sem recommendation/reasons/tips) **limpa** a
avaliação da vaga — ela volta para o `for-scoring`.

Resposta: `{ "ok": true, "applied": 3, "skipped": 1, "cv_version": 3 }`. Item
inválido (vaga inexistente, score fora de 0–5, recommendation desconhecida) é
`skipped`, não derruba o lote.

## O que o ranqueador recebe para decidir (pergunta "o que passo para o muse.ai")

O `for-scoring` já entrega o mínimo para avaliar, **sem dados do usuário além
do currículo**:

- `cv` → os módulos estruturados (dados pessoais, contato, resumo,
  disponibilidade, formação, experiência, projetos, competências, idiomas,
  certificações, redes). É a memória do que o usuário é.
- `jobs` → o anúncio no formato do produtor: cargo, empresa, local,
  `source_url` (para o ranqueador que quiser ler a JD inteira no link),
  `notes` (stack/requisitos já extraídos) e a data.

Se o ranqueador for um serviço remoto (muse.ai), ele recebe esse payload
quando fizer o GET. Se for um agente local (hermes/LLM), o mesmo payload, via
o mesmo endpoint — o script `scripts/score_agent.py` é o exemplo funcional.

**O que o ranqueador deveria produzir:**

1. `score` — a nota 0–5 da chance da vaga versus o currículo. O app ordena a
   lista e o modo deslizar por ela.
2. `recommendation` — tradução direta: `yes` = vale aplicar, `maybe` = talvez,
   `no` = deixa passar.
3. `reasons` — por que essa nota (aparece no card e no detalhe).
4. `tips` — o que fazer nessa vaga: o que citar na carta, o que pedir no
   primeiro contato, se vale ou não aplicar e por quê. **Aparece no app como
   "Dicas do agente"** — é o campo que o usuário pediu para ter dentro do app.

## Invalidação por versão do currículo

Cada `PUT /api/v1/cv` bumpa `cv_version`. O `for-scoring` usa esse número para
decidir o que devolver: avaliação feita sobre a versão antiga do CV é
reavaliada. O ranqueador **não precisa** guardar estado — o app diz o que está
defasado. Reavaliar depois de atualizar o currículo é apenas repetir o ciclo.

## Testar o ciclo completo

```bash
# app local com chave
VAGAS_PASSWORD=teste VAGAS_SECRET_KEY=dev VAGAS_API_KEY=dev uvicorn app.main:app

# agente demo (heurística de overlap — só para exercitar o contrato)
VAGAS_BASE=http://localhost:8000 VAGAS_API_KEY=dev python3 scripts/score_agent.py
```

O `score_agent.py` é o andador: mostra onde entra um LLM de verdade. toda a
inteligência fica na função `avaliar_vaga(cv, vaga)` — troque ela por chamadas
ao modelo e o resto (pull, validação, push) continua igual.

## Referência

- Implementação no app: `app/main.py` — `api_for_scoring`, `api_score_jobs`,
  `job_evals`, `get_cv_version`/`bump_cv_version`.
- Cliente de exemplo: `scripts/score_agent.py`.
- Endpoints e formatos: `docs/API.md`.