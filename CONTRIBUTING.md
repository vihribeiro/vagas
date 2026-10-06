# Contribuindo

Obrigado pelo interesse! Este guia cobre como rodar, testar e enviar mudanças
para o **Vagas App** — uma base JavaScript/package é zero: Python + FastAPI no
backend, HTML/CSS/JS vanilla no front, sem npm e sem build.

## Stack e estrutura

```
app/
  main.py          # backend: rotas, banco, auth, migração (arquivo único)
  cv_parser.py     # PDF → módulos estruturados do currículo
  templates/       # páginas (login, painel, detalhe, currículo)
  static/          # CSS, JS vanilla e PWA (service worker)
docs/
  API.md           # catálogo completo da API
  SCORING.md       # contrato de avaliação (qualquer provedor)
  MUSE_AI.md       # manual de integração da muse.ai
scripts/
  career_sync.py   # ingestão local idempotente (usa dados locais do usuário)
  score_agent.py   # demo de ranqueador que implementa o contrato
```

## Rodar para desenvolver

```bash
# opção 1: Docker
cp .env.example .env
docker compose up -d --build        # painel em http://localhost:8234

# opção 2: local
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                # o app lê o .env da raiz automaticamente
VAGAS_DATA_DIR=./data uvicorn app.main:app --reload   # em http://localhost:8000
```

> O banco é SQLite e a migração roda sozinha no boot (`app/main.py`). Para zerar
> o banco local no Docker: `docker compose down -v`. Sem venv/volume, basta
> apagar o arquivo `data/vagas.db`.

## Convenções do backend

- **Um arquivo, sem ORM** — `app/main.py` usa `sqlite3` da stdlib e migração
  idempotente no boot. Mantenha o padrão: novas tabelas entram no bloco de
  migração, sem framework de banco.
- **Rotas de API** são `/api/v1/...`, verbos REST, com sufixo de ação quando a
  ação não é CRUD puro (`jobs:bulk`, `jobs:score`, `jobs:for-scoring`).
- **Auth** — painel usa sessão (`require_login`); produtores/ranqueadores usam
  o header `X-API-Key` (`require_api_key`). Nunca exponha uma rota de produção
  sem uma das duas.
- **Contrato de avaliação é neutro** — o app não calcula nota nem inventa
  `scored_by`. Toda mudança no fluxo de scoring precisa manter o contrato de
  `docs/SCORING.md` (for-scoring puxa, score grava).
- **Detalhes e mensagens de erro em português**, coerentes com o restante.

## Convenções do frontend

- **JS vanilla, sem framework e sem build.** Não adicione npm/webpack/vite.
- **Design tokens no `style.css`.** `--ink` é a cor da **sombra dura**, não de
  texto. Texto usa `--on-tone` (sobre pastel), `--on-ink` (sobre escuro) e
  `--on-field` (em campos). Contraste alvo WCAG AA.
- **Tema escuro aparece em DOIS lugares** do `style.css`: dentro de
  `@media (prefers-color-scheme: dark)` e em `:root[data-theme="dark"]`. As
  duas listas de tokens precisam ficar **idênticas**.
- **Sem emoji** no visual — o design é papel creme, sombras duras, serifados.

### ⚠️ Bump da versão dos assets (PWA)

Toda mudança em `style.css`, `app.js`, `swipe.js`, `detail.js`, `cv.js` ou
`theme.js` exige **aumentar a versão nos DOIS lugares**:

1. `ASSET_VERSION` em `app/main.py`;
2. `CACHE` e `V` em `app/static/sw.js`.

Sem isso o service worker pode continuar entregando a versão antiga no celular,
mesmo depois do deploy.

## Como testar

### API (curl)

```bash
B=http://localhost:8000            # ou 8234 no Docker
K=<valor de VAGAS_API_KEY no .env>

curl -s $B/healthz                                  # {"ok":true}
curl -s -X POST $B/api/v1/jobs:bulk -H "Content-Type: application/json" -H "X-API-Key: $K" \
  -d '{"jobs":[{"title":"Dev", "company":"Exemplo", "source":"other"}]}'
curl -s -H "X-API-Key: $K" $B/api/v1/jobs:for-scoring
curl -s -X POST $B/api/v1/jobs:score -H "Content-Type: application/json" -H "X-API-Key: $K" \
  -d '{"evals":[{"id":1,"score":3.4,"recommendation":"maybe","reasons":["Teste"],"tips":["Dica"],"scored_by":"dev"}]}'
```

### Demo de ranqueador

```bash
VAGAS_BASE=$B VAGAS_API_KEY=$K python3 scripts/score_agent.py
```

### Fluxo do painel

Teste as duas visões (Lista e Deslizar), o detalhe da vaga com e sem avaliação,
o modo escuro e o currículo (importação de PDF + copiar + editar). O PWA no
celular precisa de HTTPS; em dev use o painel no navegador.

## Enviar uma mudança

1. Crie um branch descritivo: `git checkout -b feat/x` ou `fix/y`.
2. Faça commits pequenos e com mensagens claras.
3. Rode os testes acima e conferira se nada quebrou nas duas visões.
4. Abra um Pull Request usando o
   [template](.github/PULL_REQUEST_TEMPLATE.md).

### Checklist antes do PR

- [ ] Frontend mudou? `ASSET_VERSION` e `sw.js` foram bumpados juntos.
- [ ] API mudou? `docs/API.md` (e `docs/SCORING.md`, se for contrato) foi
      atualizado.
- [ ] `.env` e dados pessoais **nunca** entram no commit (o `.gitignore` cuida).
- [ ] Testado localmente (Docker ou uvicorn) e no navegador.