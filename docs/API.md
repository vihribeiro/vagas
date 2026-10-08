# API — Vagas App

Documento de integração para quem alimenta ou avalia as vagas: o serviço de
varredura de e-mail (hospedado no `musei.ai`), o career-ops, e qualquer
ranqueador (agente, script local, LLM). Tudo aqui foi conferido no código em
`app/main.py`, não deduzido da documentação anterior.

**Papéis:** o app **ingere** vagas de qualquer produtor, guarda o currículo em
módulos e **consome** avaliações de qualquer ranqueador. O ranqueador não é
parte do app — entra pelo contrato descrito em
[`docs/SCORING.md`](SCORING.md) e pode ser o muse.ai, o hermes ou outro.

## Resumo dos endpoints

| Método | Rota | Auth | Para que |
|---|---|---|---|
| `POST` | `/api/v1/jobs:bulk` | `X-API-Key` | Ingerir vagas (quem descobre) |
| `GET` | `/api/v1/jobs:for-scoring` | `X-API-Key` | Ranqueador: puxar CV + vagas a avaliar |
| `POST` | `/api/v1/jobs:score` | `X-API-Key` | Ranqueador: gravar avaliações |
| `POST` | `/api/v1/jobs:purge` | `X-API-Key` | Ranqueador: apagar vagas com nota abaixo do limiar |
| `GET` | `/api/v1/cv` | sessão **ou** `X-API-Key` | Ler currículo estruturado |
| `PUT` | `/api/v1/cv` | sessão **ou** `X-API-Key` | Gravar currículo (browser ou agente) |
| `POST` | `/api/v1/cv:import` | sessão | PDF → módulos (não salva) |
| `GET` | `/api/v1/jobs` | sessão | Listar (o painel) |
| `PATCH` | `/api/v1/jobs/{id}/status` | sessão | Marcar status/anotação |
| `DELETE` | `/api/v1/jobs/{id}` | sessão | Excluir a vaga (e a avaliação dela) |

Sobre o `:` no caminho: é literal. `jobs:bulk`, `jobs:for-scoring`,
`jobs:score` e `jobs:purge` não têm `/` — service worker ou proxy que
normalize `:` para `/` quebra a chamada.

### Autenticação

| Modo | Credencial |
|---|---|
| API (`X-API-Key`) | valor de `VAGAS_API_KEY` do servidor, via header `X-API-Key` |
| Painel | `POST /login` com `password=VAGAS_PASSWORD`, cookie de sessão |

Comparação da chave por `hmac.compare_digest` (tempo constante). Sem a chave,
ou com a chave vazia no servidor, a resposta é `403`. Não há sessão nos
endpoints de API: a chave é a única credencial.

---

## Ingestão de vagas

```
POST /api/v1/jobs:bulk
```

### Corpo

```json
{
  "jobs": [
    {
      "title": "Desenvolvedor Front-end Júnior",
      "company": "Grupo SysMap",
      "location": "100% Remoto",
      "source": "other",
      "source_url": "https://remotar.com.br/job/162837",
      "email_date": "2026-10-05",
      "notes": "AngularJS + Next.js + TypeScript"
    }
  ]
}
```

### Campos

| Campo | Obrigatório | Normalizado | Para que serve |
|---|---|---|---|
| `title` | **sim** | aparado | Cargo. Vazio → item descartado (`skipped`) |
| `company` | não | aparado | Empresa. Vazio é aceito |
| `location` | não | aparado | Modalidade e/ou cidade. Aparece no card |
| `source` | não | **minúsculas** | Etiqueta da origem. Vira a pílula colorida e o filtro |
| `source_url` | não | aparado | Link do anúncio |
| `email_date` | não | aparado | Data do e-mail de origem |
| `notes` | não | aparado | Stack, requisitos, observação. Vai no card |
| `external_links` | não | ignorado | Legado; nada no app usa |

Chave desconhecida é ignorada silenciosamente. Não há erro por campo extra.

### Score no título (formato legado)

O produtor ainda pode avaliar do jeito antigo, colando a nota no título:
`Desenvolvedor Front-end JR [4.4/5]`. O app **separa sozinho**: o título fica
limpo, o score vai para `job_evals` (com `scored_by: "provedor"`) e a
recomendação é derivada pela régua (≥3.5 `yes`, ≥2.5 `maybe`, senão `no`).

**Isso não é mais a forma recomendada.** A forma nova é o ranqueador avaliar
na fase 3 via `POST /api/v1/jobs:score` (veja abaixo), depois de o currículo
existir. O formato legado continua aceito só para produtores antigos não
quebrarem — e deixa de sujar a deduplicação, que agora usa o título limpo.

### Resposta

```json
{ "inserted": 7, "skipped": 3 }
```

| Código | Quando |
|---|---|
| `200` | sucesso — **inclusive quando tudo foi `skipped`** |
| `400` | corpo não é JSON, ou `jobs` não é lista |
| `403` | `X-API-Key` ausente ou errada |

`200` com `inserted: 0` e `skipped: N` é resposta normal de reenvio. Não é erro.

### Deduplicação

A chave é `normalize(title) + "|" + normalize(company)`, onde `normalize`
aplica: minúsculas → remove acentos → troca tudo que não for `[a-z0-9 ]` por
espaço → colapsa → apara. `"Desenvolvedor Front-End Júnior"` e
`"desenvolvedor frontend junior"` geram a mesma chave.

Consequências que importam:

- O mesmo anúncio chegando por e-mail em dias diferentes conta 1 vaga só.
- Vaga repetida **não** sobrescreve: título, origem, `source_url`, `notes`,
  status e anotação do primeiro envio continuam.
- Não há update. Corrigir dado errado exige buscar no painel ou editar o banco.
  Planeje o `title` completo no primeiro envio.
- Empresa com nome variado (`iFood`, `Ifood`, `IFOOD`) gera três chaves.
  Normalize o nome da empresa no serviço antes de enviar.

### `source` — valores que têm cor própria

| Valor | Cor | Quando usar |
|---|---|---|
| `bebee` | amarelo | site beBee |
| `indeed` | azul | Indeed |
| `glassdoor` | verde | Glassdoor |
| `linkedin` | azul | LinkedIn Jobs |
| `remotar` | roxo | remotar.com.br |
| `frontendbr` | rosa | github.com/frontendbr/vagas |
| `nomades` | verde-água | nomadesdigitais.com |
| `solides` | bege | vagas.solides.com.br, vagas.com.br |
| `greenhouse` | verde | boards Greenhouse/Ashby/Workable de empresa |
| `other` | cinza | qualquer outra origem |

Use o slug minúsculo; é como o filtro da UI casa.

---

## Leitura para avaliação (o ranqueador)

```
GET /api/v1/jobs:for-scoring
```

Uma chamada só, com `X-API-Key`:

```json
{
  "cv_version": 3,
  "cv": [ { "key": "competencias", "label": "Competências", "kind": "fields",
            "items": [ { "label": "Frontend", "value": "Angular, TypeScript" } ] } ],
  "jobs": [ { "id": 12, "dedup_key": "desenvolvedor react|stone", "title": "...", "company": "...",
              "location": "...", "source": "greenhouse", "source_url": "...",
              "notes": "React + Next.js", "created_at": "..." } ]
}
```

- `cv` são os módulos do currículo (mesma estrutura de `GET /api/v1/cv`).
- `jobs` só traz vagas **sem avaliação** ou avaliadas com uma **versão antiga**
  do currículo (`cv_version` anterior ao atual).
- Detalhes do contrato e regras: [`docs/SCORING.md`](SCORING.md).

---

## Gravar avaliações (o ranqueador)

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
      "reasons": ["Match alto de Angular + TypeScript"],
      "tips": ["Na carta, destaque o projeto Seller Hub"],
      "scored_by": "muse-ai-v2"
    }
  ]
}
```

Identifica a vaga por `id` ou `dedup_key`. `score` 0–5 (ou `null` para
limpar), `recommendation` em `yes|maybe|no`, `reasons`/`tips` listas de
strings. Mando vazio limpa a avaliação e a vaga volta ao `for-scoring`.

Resposta: `{ "ok": true, "applied": 3, "skipped": 1, "cv_version": 3 }`.
Item inválido vira `skipped`, não derruba o lote.

---

## Apagar vagas abaixo do limiar (o ranqueador)

```
POST /api/v1/jobs:purge
```

```json
{ "score_max": 3.0 }
```

Chamada opcional logo **depois** do `jobs:score`: apaga toda vaga cuja
avaliação ficou **abaixo** de `score_max` (padrão `3.0`, aceita 0–5). Assim
o painel nunca recebe vaga "fora" — a cascata leva `job_status` e
`job_evals` junto. Vaga **sem** avaliação (score `NULL`) nunca é mexida.

Resposta: `{ "ok": true, "deleted": 2, "ids": [7, 11], "score_max": 3.0 }`.

---

## Currículo (dois caminhos, os mesmos módulos)

O currículo vive em `cv_modules`, uma linha por módulo. Quem escreve:

- **Navegador**: `POST /api/v1/cv:import` (PDF → módulos, não salva) e
  `PUT /api/v1/cv` (grava após revisão na gaveta).
- **Agente**: `PUT /api/v1/cv` direto, com `X-API-Key`, no mesmo formato.

`PUT /api/v1/cv`:

```json
{
  "modules": {
    "competencias": [ { "label": "Frontend", "value": "Angular, TypeScript" } ]
  }
}
```

Módulo desconhecido → `400`. Cada save **bumpa `cv_version`**: avaliações
feitas sobre a versão anterior viram defasadas e voltam ao `for-scoring`.

`GET /api/v1/cv` devolve:

```json
{ "modules": [ { "key": "competencias", "label": "Competências", "kind": "fields", "items": [...] } ] }
```

Aceita sessão **ou** `X-API-Key`.

---

## Leitura para o painel

```
GET /api/v1/jobs?source=&status=&q=
GET /api/v1/jobs/{id}
```

Exigem sessão de login por cookie (não aceitam `X-API-Key`; o agente usa o
`for-scoring`).

Filtros de `GET /api/v1/jobs`:

| Parâmetro | Efeito |
|---|---|
| `source` | igualdade exata; vazio = todas |
| `status` | `pending` \| `applied` \| `rejected` \| `dismissed`; vazio = todas |
| `q` | busca em `title`, `company` e `location` |

A resposta traz `counts` ao lado de `jobs` — os números dos filtros do
painel, calculados **sem** o filtro da própria dimensão (cada aba ignora o
`status` dela, cada pílula ignora a `source` dela) e respeitando os outros:

```json
{
  "jobs": [ ... ],
  "counts": {
    "status":  { "pending": 4, "applied": 2, "rejected": 1, "dismissed": 3 },
    "source":  { "bebee": 3, "linkedin": 4, "other": 3 }
  }
}
```

É o que garante que abrir "Dispensadas" não zere as outras abas: o número
de cada filtro é sempre o resultado que o clique dele entregaria. Origem sem
vaga no status atual vem com `0` (a lista de origens é completa, para a
pílula não sumir do menu).

**Ordem = ranking:** score do ranqueador decrescente primeiro, vaga sem
avaliação para o fim, desempate pela mais recente.

### Campos de uma vaga na leitura

| Campo | Conteúdo |
|---|---|
| `id` | inteiro, use no `PATCH` de status |
| `dedup_key` | chave de deduplicação (para o ranqueador devolver via score) |
| `title` | título limpo (sem `[score/5]` legado) |
| `company`, `location`, `source`, `source_url`, `email_date`, `created_at` | como enviado |
| `notes` | stack/observação do produtor |
| `status_notes` | anotação que o **usuário** escreveu no painel |
| `status` / `status_label` | `pending` \| `applied` \| `rejected` \| `dismissed` + rótulo pt-BR |
| `score` / `tier` | nota do ranqueador (ou `null`) + faixa visual (`alta` \| `media` \| `baixa` \| `fora`) |
| `recommendation` / `reco_label` | `yes` \| `maybe` \| `no` + rótulo pt-BR |
| `reasons` / `tips` | listas de motivos e de dicas gravadas pelo ranqueador |
| `scored_by` / `cv_version` | quem avaliou e em qual versão do currículo |

### Alterar status

```
PATCH /api/v1/jobs/{id}/status
```

Exige sessão. Aceita `{"status": "dismissed", "notes": "..."}`. Não aceita
`X-API-Key`. Status válidos: `pending`, `applied`, `rejected`, `dismissed`.

> `dismissed` ("Dispensada") é o alvo do gesto de dispensar no modo deslizar.
> Ele é um status próprio, não um sinônimo de `rejected`.

---

## Coexistência dos produtores

| Produtor | Como entra |
|---|---|
| serviço de e-mail (`musei.ai`) | `POST /api/v1/jobs:bulk` |
| career-ops | `scripts/career_sync.py` → mesma rota |
| ranqueador (muse.ai, hermes, script) | `GET /api/v1/jobs:for-scoring` + `POST /api/v1/jobs:score` |
| agente local demo | `scripts/score_agent.py` |

A deduplicação por `title + company` resolve repetição entre produtores, desde
que o título chegue igual. Nada disso depende do ranqueador: sem muse.ai, um
agente local (ou o `score_agent.py`) roda o mesmo contrato; sem ranqueador
nenhum, o app funciona com vagas sem score.

## Checklist de migração

- [ ] Ingestão: nada muda na chamada HTTP. O `notes` continua sendo a stack.
- [ ] **Score:** pare de colar `[N.N/5]` no título. Se já cola, o app separa —
      mas a forma certa é a fase 3: ler `for-scoring` e gravar `jobs:score`
      depois que o currículo existir.
- [ ] Ranqueador (muse.ai): `GET /api/v1/jobs:for-scoring` entrega CV
      estruturado + vagas a avaliar; `POST /api/v1/jobs:score` grava
      score/recomendação/motivos/dicas.
- [ ] Dicas: o campo `tips` é o que aparece como "Dicas do agente" no card e no
      detalhe — onde o ranqueador diz se vale ou não aplicar e por quê. Veja
      [`docs/SCORING.md`](SCORING.md).

## Referência

- Implementação: `app/main.py` — `api_bulk_jobs`, `api_for_scoring`,
  `api_score_jobs`, `job_evals`, `cv_modules`.
- Deduplicação: `app/main.py`, `make_dedup_key` e `normalize`.
- Cliente de ingestão: `scripts/career_sync.py`.
- Cliente de avaliação (demo): `scripts/score_agent.py`.
- Contrato de avaliação: `docs/SCORING.md`.
- Manual de integração da muse.ai: `docs/MUSE_AI.md`.
- Variáveis de ambiente: `README.md`, seção "Variáveis de ambiente".