# Vagas App

> 🇧🇷 [Versão em português](README.md)

A personal job-tracking dashboard for finding and applying to jobs fast, with a
**swipe deck** to decide in seconds and an **CV drawer** that splits your resume
into ready-to-copy blocks.

The app is the **interface**; discovering jobs and deciding whether they are
worth applying to is the job of pluggable external services (see
[How it works](#how-it-works)). With no provider configured, the app already
works on its own — jobs just arrive without a score.

- **Stack:** Python + FastAPI · SQLite (stdlib, no ORM) · vanilla HTML/CSS/JS
  (no npm, no build step) · PWA
- **Lightweight:** Docker or 3 commands with plain Python
- **Design:** cream paper, hard shadows, pastel blocks, serif type, no emoji
- **Languages:** Portuguese (default) and English, switchable from the top bar —
  the choice is remembered, and an English browser lands straight on the EN UI.

## Features

- **Job list** with status (pending, applied, rejected, dismissed), source
  filters, search and ranking by the ranker's score.
- **Swipe mode:** pending jobs become a Tinder-style deck — swipe **left to
  apply**, **right to dismiss** (or use the buttons / ← → arrows), with undo.
- **CV as modules ("drawer"):** import the PDF, review it, and every block gets
  a copy button and inline editing — to paste straight into the application form.
- **Job detail** with the agent evaluation: 0–5 score, recommendation
  (Apply / Consider / Avoid), **reasons** and **tips** — plus your own notes.
- **PWA:** installs as an app on your phone (requires HTTPS in production).
- **Chrome extension ([`extension/`](extension/README.md)):** while browsing
  LinkedIn, a **+** button on each job card sends the job straight to the
  dashboard (and pre-fills the application form for you to review before
  submitting).

## How it works

```
1. INGESTION   any producer sends jobs             → POST /api/v1/jobs:bulk
2. CV          the dashboard (PDF → review) or the agent → PUT /api/v1/cv
3. SCORING     a ranker reads what's missing, scores and saves
               → GET /api/v1/jobs:for-scoring + POST /api/v1/jobs:score
```

The ranker answers **"is this job worth applying to?"**: it reads the structured
CV + the unscored jobs and returns, per job:

- **`score`** (0–5) → orders the list and the deck;
- **`recommendation`** → Apply / Consider / Avoid;
- **`reasons`** → why the score (shown on the card and in the detail);
- **`tips`** → **in-app tips**: what to mention in your pitch, what to ask on
  first contact, whether to apply and why.

It can be a model (muse.ai), a hermes agent, or a local script — the contract is
provider-neutral. Without a ranker the app keeps working, just without scores.
Contract: [`docs/SCORING.md`](docs/SCORING.md) · muse.ai manual:
[`docs/MUSE_AI.md`](docs/MUSE_AI.md).

## Run with Docker (recommended)

Prerequisite: [Docker](https://www.docker.com/) (with Compose).

```bash
git clone https://github.com/vihribeiro/vagas.git vagas-app
cd vagas-app

# 1. create the .env with your own values
cp .env.example .env

# 2. generate secure secrets and edit the .env
openssl rand -hex 32    # (run twice: VAGAS_SECRET_KEY and VAGAS_API_KEY)

# 3. start it
docker compose up -d --build
```

Done: the dashboard is at **http://localhost:8234** (configurable in
`docker-compose.yml`). The dashboard password is the `VAGAS_PASSWORD` you set.

The SQLite database persists in the `vagas-data` volume (mounted at `/data`).
The container runs as a **non-root** user and the compose has a healthcheck on
`/healthz`:

```bash
docker compose ps        # status: Up (healthy)
docker compose logs -f   # logs
docker compose down      # stop (data preserved in the volume)
docker compose down -v   # stop and delete the database
```

> **On Linux/Windows,** nothing changes in the flow. The entry point is always
> `http://localhost:8234`.

## First use

1. Open http://localhost:8234 and sign in with the `VAGAS_PASSWORD`.
2. Go to **CV → Import PDF**, send your resume and review the extracted modules
   (nothing is saved without your review).
3. Feed some jobs to test — directly via the API (below) or with the demo
   ranker:
   ```bash
   VAGAS_BASE=http://localhost:8234 VAGAS_API_KEY=<your-key> \
     python3 scripts/score_agent.py
   ```
   The script uses a placeholder overlap heuristic — the same contract a real
   LLM would use. That's also why you can send jobs with `[4.4/5]` embedded in
   the title: the app splits the score out and stores it as an evaluation.

## Run locally without Docker (development)

Prerequisite: Python 3.12+ (uses [`pymupdf`](https://pymupdf.readthedocs.io/)
to read the CV PDF).

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # generate real values (openssl rand -hex 32)
# the app loads the root .env automatically (outside Docker)

VAGAS_DATA_DIR=./data uvicorn app.main:app --reload
```

The app runs at http://localhost:8000 (uvicorn's default).

## Environment variables

| Variable | Purpose |
|---|---|
| `VAGAS_PASSWORD` | Dashboard password (compared via SHA-256 hash) |
| `VAGAS_SECRET_KEY` | Login session secret |
| `VAGAS_API_KEY` | Key used by producers/rankers in the `X-API-Key` header |
| `VAGAS_DATA_DIR` | Where `vagas.db` lives (optional; `/data` in Docker) |

Use `openssl rand -hex 32` for `VAGAS_SECRET_KEY` and `VAGAS_API_KEY`.
**Never commit the `.env`** — the repo only ships `.env.example`.

## API

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/jobs:bulk` | `X-API-Key` | Insert jobs (dedup by `dedup_key`) |
| `GET` | `/api/v1/jobs:for-scoring` | `X-API-Key` | Ranker: CV + jobs to score |
| `POST` | `/api/v1/jobs:score` | `X-API-Key` | Ranker: store evaluations |
| `GET` | `/api/v1/cv` | session or `X-API-Key` | CV modules |
| `PUT` | `/api/v1/cv` | session or `X-API-Key` | Save CV |
| `GET` | `/api/v1/jobs?source=&status=&q=` | session | List with filters |
| `PATCH` | `/api/v1/jobs/{id}/status` | session | `{"status": "applied", "notes": "..."}` |

Valid statuses: `pending`, `applied`, `rejected`, `dismissed`.
Details, payloads and rules: [`docs/API.md`](docs/API.md).

## Project structure

```
app/
  main.py          # backend: routes, database, auth, migration
  cv_parser.py     # PDF → structured CV modules
  templates/       # pages (login, dashboard, detail, CV)
  static/          # CSS, vanilla JS and PWA (service worker)
docs/
  API.md           # complete API catalog
  SCORING.md       # provider-neutral scoring contract
  MUSE_AI.md       # muse.ai integration manual
scripts/
  career_sync.py   # idempotent local ingestion (uses local data)
  score_agent.py   # demo ranker implementing the contract
Dockerfile / docker-compose.yml
requirements.txt   # pinned dependencies
```

## Development notes

- **Asset versioning (PWA):** when you change `style.css`/`app.js`/etc., bump
  `ASSET_VERSION` in `app/main.py` **and** `V`/`CACHE` in `app/static/sw.js`,
  otherwise the service worker may keep serving the old UI on your phone.
- **Light/dark theme:** dark mode appears in two places in `style.css`
  (`@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`), and
  both token lists must stay identical.
- **Colors:** `--ink` is the hard shadow, not text color. Text uses `--on-tone`
  (on pastel), `--on-ink` (on dark) and `--on-field` (in fields), with WCAG AA
  target contrast.
- **Language:** all UI strings live in `app/static/i18n.js` (PT/EN dictionaries,
  `I18N.t()` for dynamic text, `data-i18n*` attributes for static text). Backend
  API errors carry a stable `code` so the UI can localize them.

## Documentation

- [docs/API.md](docs/API.md) — endpoints, payloads, dedup, filters.
- [docs/SCORING.md](docs/SCORING.md) — scoring contract (any provider).
- [docs/MUSE_AI.md](docs/MUSE_AI.md) — muse.ai setup manual.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to run, test and submit changes.

## License

[MIT License](LICENSE).