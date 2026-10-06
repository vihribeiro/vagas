# Vagas App

Painel pessoal para acompanhar vagas de emprego e se candidatar rápido, com um
**baralho deslizante** para decidir em segundos e uma **gaveta de currículo**
que separa o CV em blocos prontos para copiar e colar.

O app é a **interface**; descobrir vagas e avaliar se vale aplicar é trabalho de
serviços externos plugáveis (veja [Como funciona](#como-funciona)). Sem nenhum
provedor configurado, o app já funciona sozinho — as vagas é que ficam sem nota.

- **Stack:** Python + FastAPI · SQLite (stdlib, sem ORM) · HTML/CSS/JS vanilla
  (sem npm, sem build) · PWA
- **Sem dependências pesadas:** Docker ou 3 comandos com Python puro
- **Design:** papel creme, sombras duras, blocos pastel, serifados, sem emoji

## Recursos

- **Lista de vagas** com status (pendente, candidatada, recusada, dispensada),
  filtros por origem, busca e ordenação pela nota do ranqueador.
- **Modo deslizar:** as vagas pendentes viram um baralho estilo Tinder —
  deslize **para a esquerda para candidatar**, **para a direita para
  dispensar** (ou use os botões / setas ← →), com desfazer.
- **Currículo em módulos ("gaveta"):** importe o PDF, revise, e cada bloco ganha
  botão de copiar e edição no lugar — para colar direto no formulário do site
  de candidatura.
- **Detalhe da vaga** com a avaliação do agente: score 0–5, recomendação
  (Aplicar / Considerar / Evitar), **motivos** e **dicas** — além de anotações
  suas.
- **PWA:** instala como app no celular (requer HTTPS em produção).

## Como funciona

```
1. INGESTÃO   qualquer produtor manda vagas      → POST /api/v1/jobs:bulk
2. CURRÍCULO  o painel (PDF → revisão) ou o agente → PUT /api/v1/cv
3. AVALIAÇÃO  um ranqueador lê o que falta, calcula e grava
              → GET /api/v1/jobs:for-scoring + POST /api/v1/jobs:score
```

O ranqueador responde **"vale a pena aplicar nesta vaga?"**: lê o currículo
estruturado + as vagas sem avaliação e devolve, por vaga:

- **`score`** (0–5) → ordena lista e baralho;
- **`recommendation`** → Aplicar / Considerar / Evitar;
- **`reasons`** → por que essa nota (aparece no card e no detalhe);
- **`tips`** → **dicas dentro do app**: o que citar na carta, o que pedir no
  primeiro contato, se vale ou não aplicar e por quê.

Pode ser um modelo (muse.ai), um agente hermes, ou um script local — o esquema é
neutro. Sem ranqueador, o app continua funcionando normalmente, só sem nota.
Contrato: [`docs/SCORING.md`](docs/SCORING.md) · manual da muse.ai:
[`docs/MUSE_AI.md`](docs/MUSE_AI.md).

## Rodar com Docker (recomendado)

Pré-requisito: [Docker](https://www.docker.com/) (com Compose).

```bash
git clone <url-do-repositorio> vagas-app
cd vagas-app

# 1. crie o .env com valores seus
cp .env.example .env

# 2. gere segredos seguros e edite o .env
openssl rand -hex 32    # (rode 2x: VAGAS_SECRET_KEY e VAGAS_API_KEY)

# 3. suba
docker compose up -d --build
```

Pronto: o painel fica em **http://localhost:8234** (porta configurável no
`docker-compose.yml`). A senha do painel é o `VAGAS_PASSWORD` que você definiu.

O banco SQLite persiste no volume `vagas-data` (montado em `/data`). O container
roda como usuário **não-root** e o compose tem healthcheck no `/healthz`:

```bash
docker compose ps        # estado: Up (healthy)
docker compose logs -f   # logs
docker compose down      # para (dados preservados no volume)
docker compose down -v   # para e apaga o banco
```

> **No Linux/Windows**, nada muda no fluxo. O portão de entrada é sempre
> `http://localhost:8234`.

## Primeiro uso

1. Acesse http://localhost:8234 e entre com o `VAGAS_PASSWORD`.
2. Em **Currículo → Importar PDF**, envie seu CV e revise os módulos extraídos
   (nada é gravado sem sua revisão).
3. Alimente para testar — direto via API (veja abaixo) ou com o demo de
   ranqueamento:
   ```bash
   VAGAS_BASE=http://localhost:8234 VAGAS_API_KEY=<sua-chave> \
     python3 scripts/score_agent.py
   ```
   O script usa uma heurística de overlap (placeholder) — o mesmo contrato que
   um LLM real usaria. É por isso que você também pode enviar vagas com a
   `[4.4/5]` embutida no título: o app separa a nota e guarda como avaliação.

## Rodar localmente sem Docker (desenvolvimento)

Pré-requisito: Python 3.12+ (usa [`pymupdf`](https://pymupdf.readthedocs.io/)
para ler o PDF do currículo).

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # gere valores reais (openssl rand -hex 32)

VAGAS_DATA_DIR=./data uvicorn app.main:app --reload
```

O app cai em http://localhost:8000 (padrão do uvicorn).

## Variáveis de ambiente

| Variável | Para que serve |
|---|---|
| `VAGAS_PASSWORD` | Senha do painel (comparada via hash SHA-256) |
| `VAGAS_SECRET_KEY` | Segredo das sessões de login |
| `VAGAS_API_KEY` | Chave usada por produtores/ranqueadores no header `X-API-Key` |
| `VAGAS_DATA_DIR` | Onde fica o `vagas.db` (opcional; no Docker é `/data`) |

Use `openssl rand -hex 32` para `VAGAS_SECRET_KEY` e `VAGAS_API_KEY`.
**Nunca commite o `.env`** — o repositório só traz o `.env.example`.

## API

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/v1/jobs:bulk` | `X-API-Key` | Insere vagas (dedup por `dedup_key`) |
| `GET` | `/api/v1/jobs:for-scoring` | `X-API-Key` | Ranqueador: CV + vagas a avaliar |
| `POST` | `/api/v1/jobs:score` | `X-API-Key` | Ranqueador: grava avaliações |
| `GET` | `/api/v1/cv` | sessão ou `X-API-Key` | Módulos do currículo |
| `PUT` | `/api/v1/cv` | sessão ou `X-API-Key` | Grava currículo |
| `GET` | `/api/v1/jobs?source=&status=&q=` | sessão | Lista com filtros |
| `PATCH` | `/api/v1/jobs/{id}/status` | sessão | `{"status": "applied", "notes": "..."}` |

Status válidos: `pending`, `applied`, `rejected`, `dismissed`.
Detalhes, payloads e regras: [`docs/API.md`](docs/API.md).

## Estrutura do projeto

```
app/
  main.py          # backend: rotas, banco, auth, migração
  cv_parser.py     # PDF → módulos estruturados do currículo
  templates/       # páginas (login, painel, detalhe, currículo)
  static/          # CSS, JS vanilla e PWA (service worker)
docs/
  API.md           # catálogo completo da API
  SCORING.md       # contrato neutro de avaliação
  MUSE_AI.md       # manual de integração da muse.ai
scripts/
  career_sync.py   # ingestão local idempotente (usa dados locais)
  score_agent.py   # demo de ranqueador que implementa o contrato
Dockerfile / docker-compose.yml
requirements.txt   # dependências fixadas
```

## Notas de desenvolvimento

- **Versionamento de assets (PWA):** ao mudar `style.css`/`app.js`/etc.,
  aumente `ASSET_VERSION` em `app/main.py` **e** o `V`/`CACHE` em
  `app/static/sw.js`, senão o service worker pode continuar entregando o visual
  antigo no celular.
- **Tema claro/escuro:** o escuro aparece em dois pontos do `style.css`
  (`@media (prefers-color-scheme: dark)` e `:root[data-theme="dark"]`) e as duas
  listas de tokens precisam ser idênticas.
- **Cores:** `--ink` é a sombra dura, não cor de texto. Texto usa `--on-tone`
  (sobre pastel), `--on-ink` (sobre escuro) e `--on-field` (em campos), com
  contraste alvo WCAG AA.

## Documentação

- [docs/API.md](docs/API.md) — endpoints, payloads, dedup, filtros.
- [docs/SCORING.md](docs/SCORING.md) — contrato de avaliação (qualquer provedor).
- [docs/MUSE_AI.md](docs/MUSE_AI.md) — manual de configuração da muse.ai.

## Licença

[Licença MIT](LICENSE).