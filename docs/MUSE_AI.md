# Integração muse.ai ↔ Vagas

Manual de integração do serviço de inteligência (muse.ai) com o app de vagas.
Contém **tudo que o muse.ai precisa para fazer a parte dele**: o que receber do
app e a estrutura exata dos JSON que ele envia de volta.

> Este documento é neutro de provedor: o contrato é o mesmo para muse.ai,
> hermes ou um agente local. A implementação de referência está em
> `docs/SCORING.md` e o cliente de exemplo em `scripts/score_agent.py`.

---

## 1. O papel de cada lado

| Quem | Faz o quê | Como |
|---|---|---|
| **App** | guarda vagas, currículo e avaliações; ordena por score | API abaixo |
| **muse.ai** | (1) **descobre** vagas nos e-mails (já faz hoje) e **envia** pro app | `POST /api/v1/jobs:bulk` |
| **muse.ai** | (2) **avalia** cada vaga contra o currículo e **devolve** nota, motivos e dicas | `GET /api/v1/jobs:for-scoring` + `POST /api/v1/jobs:score` |
| **Usuário** | navega a lista / desliza / lê as dicas no painel | UI |

O app **nunca calcula match**. Ele entrega o que falta avaliar e recebe o
resultado pronto — trocar de fornecedor não muda nada no app.

---

## 2. O que você entrega ao muse.ai (configuração)

Na configuração do muse.ai, cadastre:

| Item | Valor |
|---|---|
| **URL base** | produção: `https://<seu-dominio>` · local/teste: `http://localhost:8234` |
| **Cabeçalho de autenticação** | `X-API-Key: <VAGAS_API_KEY>` (mesmo valor do `.env` do app) |
| **Content-Type** | `application/json` |
| **`scored_by`** | o rótulo que o muse.ai usa em cada avaliação (ex.: `muse-ai-v2`). Ele aparece no app como "por muse-ai-v2" |
| **Agendamento** | rodar o ciclo de avaliação **depois de cada varredura** e **depois de cada mudança de currículo** (ver §6) |

O muse.ai **não precisa** de senha nem sessão — só a `X-API-Key`. As rotas de
produção (bulk, avaliação e currículo) não dependem de login.

---

## 3. Fluxo completo

```
        muse.ai                                          app
   ┌──────────────────┐                            ┌──────────────────┐
   │ varre e-mails,   │  POST /api/v1/jobs:bulk    │ grava, deduplica │
   │ monta JSON das   │ ─────────────────────────► │                   │
   │ vagas            │                            │                   │
   └──────────────────┘                            └─────────┬────────┘
                                                              │
   (usuário importa o CV no painel — ou o agente escreve via  │
    PUT /api/v1/cv)                                           │
                                                              ▼
   ┌──────────────────┐   GET /api/v1/jobs:for-scoring   ┌───────────────┐
   │ chama quando     │ ◄─────────────────────────────── │ devolve CV    │
   │ terminar a       │  {cv_version, cv, jobs}          │ estruturado + │
   │ varredura/update │                                  │ vagas p/      │
   └──────────────────┘                                  │ avaliar       │
           │                                             └───────────────┘
           │  calcula: nota 0–5 + recomendação + motivos + dicas
           ▼
   ┌──────────────────┐   POST /api/v1/jobs:score       ┌───────────────┐
   │ manda JSON das   │ ───────────────────────────────► │ grava e       │
   │ avaliações       │  {evals:[...]}                   │ reordena a    │
   └──────────────────┘                                  │ lista/baralho │
                                                         └───────────────┘
```

A fase de avaliação só produz resultado quando existem **vagas** e **currículo**.
Sem currículo, o `for-scoring` devolve `cv` vazio — é melhor esperar o usuário
importar o CV do que avaliar "às cegas".

---

## 4. Parte 1 — muse.ai envia as vagas (ingestão)

### Requisição

```
POST {BASE_URL}/api/v1/jobs:bulk
Headers: X-API-Key: <VAGAS_API_KEY>
         Content-Type: application/json
```

### Corpo (uma vaga por item da lista `jobs`)

```json
{
  "jobs": [
    {
      "title": "Desenvolvedor Frontend Angular Pleno",
      "company": "Mercado Livre",
      "location": "100% Remoto",
      "source": "remotar",
      "source_url": "https://remotar.com.br/vaga/angular-pleno",
      "email_date": "2026-10-06",
      "external_links": [
        "https://remotar.com.br/vaga/angular-pleno"
      ],
      "notes": "Angular 16 + TypeScript + RxJS + NgRx"
    }
  ]
}
```

### Regras que o app aplica

| Campo | O que o app faz |
|---|---|
| `title` | vira a chave do dedup. Vaga com título vazio é ignorada |
| `company` | parte da chave de dedup junto com `title` |
| `source` | **slug minúsculo** — use sempre os mesmos valores (`gupy`, `greenhouse`, `remotar`, `solides`, `linkedin`, `other`…). É daqui que vêm as cores do painel; slug desconhecido cai na cor neutra |
| `source_url` | link "anúncio original" no app |
| `external_links` | lista de URLs extra |
| `notes` | observação mostrada no app **e usada pelo ranqueador** na avaliação — mande a stack/requisitos que o muse.ai já extraiu do e-mail |
| `email_date` | data da correspondência (ISO) |
| `[N.N/5]` no título | formato legado ainda funciona: o app separa e guarda como avaliação `scored_by: provedor`. Prefira o §5 |

**Dedup:** título+empresa normalizados (sem acento/caixa). Vaga repetida = contada
em `skipped`, **não** sobrescreve status nem avaliação existentes.

### Resposta

```json
{ "inserted": 5, "skipped": 1 }
```

---

## 5. Parte 2 — muse.ai avalia as vagas (o coração da integração)

### 5.1 Puxar o que avaliar (pull)

```
GET {BASE_URL}/api/v1/jobs:for-scoring
Header: X-API-Key: <VAGAS_API_KEY>
```

É **só GET** — uma chamada traz o currículo estruturado **e** as vagas que
precisam de avaliação:

```json
{
  "cv_version": 3,
  "cv": [
    {
      "key": "dados_pessoais",
      "label": "Dados pessoais",
      "kind": "fields",
      "items": [ { "label": "Nome completo", "value": "Vinicius Ribeiro" } ]
    },
    {
      "key": "contato",
      "label": "Contato",
      "kind": "fields",
      "items": [ { "label": "E-mail", "value": "vinicius@exemplo.com" } ]
    },
    {
      "key": "resumo",
      "label": "Resumo profissional",
      "kind": "text",
      "items": [ { "label": "", "value": "Desenvolvedor frontend com foco em Angular e TypeScript..." } ]
    },
    {
      "key": "competencias",
      "label": "Competências",
      "kind": "fields",
      "items": [
        { "label": "Frontend", "value": "Angular, TypeScript, RxJS, HTML, CSS, Sass" }
      ]
    },
    {
      "key": "experiencia",
      "label": "Experiência",
      "kind": "entries",
      "items": [
        {
          "title": "Desenvolvedor Frontend",
          "org": "Empresa Y",
          "context": "SPAs de produto",
          "period": "2023 — atual",
          "body": "Angular 15+, TypeScript, RxJS, testes e2e",
          "links": ""
        }
      ]
    }
  ],
  "jobs": [
    {
      "id": 1,
      "dedup_key": "desenvolvedor frontend angular pleno|mercado livre",
      "title": "Desenvolvedor Frontend Angular Pleno",
      "company": "Mercado Livre",
      "location": "100% Remoto",
      "source": "remotar",
      "source_url": "https://remotar.com.br/vaga/angular-pleno",
      "notes": "Angular 16 + TypeScript + RxJS + NgRx",
      "created_at": "2026-10-06T15:00:00+00:00"
    }
  ]
}
```

**O que o muse.ai recebe para decidir:**

- `cv` são os mesmos módulos do painel — **estruturados, sem PDF**. É a memória
  do que a pessoa é (resumo, competências, experiência, formação, idiomas,
  disponibilidade…).
- `jobs` só traz onde falta avaliação: vaga **sem** avaliação ou avaliada com uma
  **versão anterior** do currículo. A cada `cv_version`, o app diz o que está
  defasado — o ranqueador não guarda estado.
- `source_url` + `external_links` deixam o muse.ai ler a descrição completa da
  vaga no link, se quiser afinar a avaliação além de `title`/`notes`.

### 5.2 Gravar as avaliações (push)

```
POST {BASE_URL}/api/v1/jobs:score
Headers: X-API-Key: <VAGAS_API_KEY>
         Content-Type: application/json
```

```json
{
  "evals": [
    {
      "id": 1,
      "score": 4.6,
      "recommendation": "yes",
      "reasons": [
        "Match alto: Angular + TypeScript são o núcleo do perfil",
        "100% remoto, dentro da disponibilidade cadastrada"
      ],
      "tips": [
        "Na carta, destaque o design system que você manteve",
        "Pergunte sobre o time de produto no primeiro contato"
      ],
      "scored_by": "muse-ai-v2"
    }
  ]
}
```

### Regras de cada item de `evals`

| Campo | Regra |
|---|---|
| `id` **ou** `dedup_key` | identifica a vaga (um dos dois; `id` ganha). Use o `dedup_key` se não quiser guardar ids do app |
| `score` | número **0–5** (inteiro ou decimal). O app ordena a lista e o baralho por ele |
| `recommendation` | `yes` (vale aplicar) · `maybe` (talvez) · `no` (deixa passar) — ou vazio |
| `reasons` | lista de strings, até 20 — **aparece como "Motivos"** no card e no detalhe |
| `tips` | lista de strings, até 20 — **aparece como "Dicas do agente"** no app: o que citar na carta, o que pedir no primeiro contato, se vale ou não aplicar e por quê |
| `scored_by` | quem avaliou, até 60 caracteres — aparece no detalhe ("por muse-ai-v2") |

**Semântica da nota + recomendação** (o que o app mostra):

| score | recommendation | Painel mostra |
|---|---|---|
| 4.6 | `yes` | selo `4.6` + pílula **APLICAR** |
| 3.4 | `maybe` | selo `3.4` + pílula **CONSIDERAR** |
| 2.1 | `no` | selo `2.1` + pílula **EVITAR** |

**Limpar:** mandar um item todo vazio (`"score": null`, sem recommendation/
reasons/tips) **apaga** a avaliação — a vaga volta para o próximo `for-scoring`.

### Resposta

```json
{ "ok": true, "applied": 3, "skipped": 1, "cv_version": 3 }
```

Item inválido (vaga inexistente, score fora de 0–5, recommendation desconhecida)
conta como `skipped` e não derruba o lote — envie em lotes de até 100.

---

## 6. Ciclo de invalidação (reavaliação)

Cada `PUT /api/v1/cv` (salvar currículo) bumpa `cv_version`. Consequência:

- avaliações feitas sobre a versão antiga do CV **voltam** ao `for-scoring`
  automaticamente;
- o muse.ai não precisa controlar nada: quando rodar o próximo GET, o app entrega
  de novo o que ficou defasado.

**Regra de ouro do agendamento:** rode o ciclo (for-scoring → calcular → score)
depois de **cada varredura de e-mails** e depois de **cada alteração de
currículo**. Não existe push/webhook no app — o modelo é pull, e o custo do loop
excessivo é só processamento de vagas que já têm score (o GET devolve vazio).

---

## 7. Opcional — muse.ai também escreve o currículo

Se for útil o agente montar/atualizar o currículo estruturado (mesma estrutura
de módulos da §5.1), use:

```
PUT {BASE_URL}/api/v1/cv
Headers: X-API-Key: <VAGAS_API_KEY>
```

```json
{
  "modules": {
    "resumo": [ { "label": "", "value": "Desenvolvedor frontend..." } ],
    "competencias": [
      { "label": "Frontend", "value": "Angular, TypeScript, RxJS" },
      { "label": "Testes", "value": "Jasmine, Cypress" }
    ],
    "experiencia": [
      {
        "title": "Desenvolvedor Frontend",
        "org": "Empresa Y",
        "context": "SPAs de produto",
        "period": "2023 — atual",
        "body": "Angular 15+, TypeScript, RxJS, testes e2e",
        "links": ""
      }
    ]
  }
}
```

Cada save bumpa `cv_version` (reavaliação de tudo que já tinha score — use com
cuidado). A rota de importação de PDF (`POST /api/v1/cv:import`) exige login de
navegador e não é para o serviço.

### Módulos e formatos (fonte da verdade: `app/cv_parser.py`)

| `key` | `label` | `kind` | Campos por item |
|---|---|---|---|
| `dados_pessoais` | Dados pessoais | `fields` | `label`, `value` |
| `contato` | Contato | `fields` | `label`, `value` |
| `redes` | Redes | `fields` | `label`, `value` |
| `resumo` | Resumo profissional | `text` | `label`, `value` (máx. 1 item) |
| `disponibilidade` | Disponibilidade | `fields` | `label`, `value` |
| `formacao` | Formação | `entries` | `title`, `org`, `context`, `period`, `body`, `links` |
| `experiencia` | Experiência | `entries` | idem |
| `projetos` | Projetos | `entries` | idem |
| `competencias` | Competências | `fields` | `label`, `value` |
| `idiomas` | Idiomas | `fields` | `label`, `value` |
| `cursos` | Cursos | `entries` | idem |

---

## 8. Testar contra a instância local

Com o app rodando (`docker compose up -d` na porta 8234, chave do `.env`):

```bash
B=http://localhost:8234
K=<SUA_VAGAS_API_KEY>                    # use o mesmo valor de VAGAS_API_KEY do .env do app

# 1. enviar vaga
curl -s -X POST $B/api/v1/jobs:bulk -H "Content-Type: application/json" -H "X-API-Key: $K" \
  -d '{"jobs":[{"title":"Frontend Developer","company":"Stone","location":"São Paulo","source":"greenhouse","notes":"React + Next.js + TypeScript"}]}'

# 2. puxar o que avaliar
curl -s -H "X-API-Key: $K" $B/api/v1/jobs:for-scoring

# 3. gravar avaliação
curl -s -X POST $B/api/v1/jobs:score -H "Content-Type: application/json" -H "X-API-Key: $K" \
  -d '{"evals":[{"id":1,"score":3.4,"recommendation":"maybe","reasons":["React entra no leque"],"tips":["Destaque o TypeScript"],"scored_by":"muse-ai-demo"}]}'
```

O cliente de exemplo `scripts/score_agent.py` mostra o ciclo completo com
heurística no lugar do LLM — troque a função `avaliar_vaga` por chamadas ao
modelo muse.ai e ele fica pronto.

---

## 9. Erros comuns

| Código | Causa |
|---|---|
| `403` | `X-API-Key` ausente ou divergente do `VAGAS_API_KEY` do app |
| `400 detail "corpo JSON inválido"` | payload não é JSON válido |
| `400 "jobs precisa ser uma lista"` / `"evals precisa ser uma lista"` | o campo raiz tem o tipo errado |
| `skipped` alto no `/jobs:bulk` | títulos vazios ou vagas já cadastradas (dedup) |
| `skipped` alto no `/jobs:score` | id/dedup_key inexistente ou score fora de 0–5 |
| `for-scoring` devolve poucos itens | quase tudo já foi avaliado para o `cv_version` atual — normal |

---

## Referência de rotas

| Rota | Uso | Auth |
|---|---|---|
| `POST /api/v1/jobs:bulk` | muse.ai envia vagas | X-API-Key |
| `GET /api/v1/jobs:for-scoring` | muse.ai puxa CV + vagas pendentes | X-API-Key |
| `POST /api/v1/jobs:score` | muse.ai grava avaliações | X-API-Key |
| `GET /api/v1/cv` | ler currículo estruturado | X-API-Key ou sessão |
| `PUT /api/v1/cv` | escrever currículo estruturado | X-API-Key ou sessão |
| `GET /api/v1/jobs` | listar vagas (UI/logística) | sessão |

Mais detalhes de contrato: `docs/SCORING.md`.; catálogo geral: `docs/API.md`.