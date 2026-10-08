"""Vagas App — PWA para acompanhar vagas de emprego.

Fluxo em três fases, desenhado para não depender de um provedor só:

1. Ingestão  — qualquer produtor (muse.ai, scanner de e-mail, script) grava
   vagas via POST /api/v1/jobs:bulk. Nenhum score aqui ainda.
2. Currículo — entra pelo navegador (PDF -> módulos, com revisão na gaveta)
   ou direto por um agente; as duas rotas escrevem os mesmos módulos em
   cv_modules. Cada save bumpa a versão do currículo.
3. Avaliação — um agente ranqueador (muse.ai, hermes, qualquer outro) lê o
   currículo + as vagas ainda não avaliadas (via API key), calcula
   score/recomendação/motivos/dicas e grava via POST /api/v1/jobs:score.
   O app só armazena e ordena por score. Score do agente é fase 3, nunca 1.

Provedor nenhum é obrigatório: sem muse.ai, um agente local roda o mesmo
contrato; sem agente, o app continua funcionando com vagas sem score.
"""

import hashlib
import hmac
import json
import os
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from dotenv import load_dotenv
from starlette.middleware.sessions import SessionMiddleware

from . import cv_parser

# Teto do upload. Currículo em PDF não passa de poucos MB; acima disso é
# arquivo errado, e ler tudo na memória seria desperdício.
CV_MAX_UPLOAD = 10 * 1024 * 1024

BASE_DIR = Path(__file__).resolve().parent

# Fora do Docker o app lê o .env da raiz do projeto (uvicorn direto). No
# Docker o compose já injeta as variáveis, então aqui é no-op — e variáveis
# reais de ambiente sempre vencem o arquivo.
load_dotenv(BASE_DIR.parent / ".env")

DATA_DIR = Path(os.environ.get("VAGAS_DATA_DIR", str(BASE_DIR.parent / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "vagas.db"

# A senha do painel vem da env; guardamos só o hash SHA-256 dela.
PASSWORD_HASH = hashlib.sha256(
    os.environ.get("VAGAS_PASSWORD", "trocar-esta-senha").encode("utf-8")
).hexdigest()
SECRET_KEY = os.environ.get("VAGAS_SECRET_KEY", "dev-secret-trocar-em-producao")
API_KEY = os.environ.get("VAGAS_API_KEY", "")

STATUSES = ("pending", "applied", "rejected", "dismissed")
STATUS_LABELS = {
    "pending": "Pendente",
    "applied": "Candidatado",
    "rejected": "Recusado",
    "dismissed": "Dispensada",
}

# Recomendação do agente ranqueador. "yes/maybe/no" é o contrato; a UI mostra
# o rótulo em português (campo reco_label no payload).
RECO_LABELS = {"yes": "Aplicar", "maybe": "Considerar", "no": "Evitar"}


def reco_for(score: float | None) -> str:
    """Traduz uma nota numa recomendação simples (régua agnóstica de provedor)."""
    if score is None:
        return ""
    if score >= 3.5:
        return "yes"
    if score >= 2.5:
        return "maybe"
    return "no"

# Versão dos assets estáticos (?v=). Aumente sempre que style.css ou os .js
# mudarem: sem isso o Cache Storage do service worker pode entregar a versão
# anterior do arquivo mesmo após o deploy. O mesmo valor aparece no SHELL do
# app/static/sw.js — os dois precisam andar juntos.
ASSET_VERSION = "30"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize(text: str | None) -> str:
    """Minúsculas, sem acentos, sem pontuação, espaços colapsados."""
    text = (text or "").lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def make_dedup_key(title: str, company: str) -> str:
    return f"{normalize(title)}|{normalize(company)}"


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dedup_key TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                company TEXT NOT NULL DEFAULT '',
                location TEXT DEFAULT '',
                source TEXT DEFAULT '',
                source_url TEXT DEFAULT '',
                email_date TEXT DEFAULT '',
                external_links TEXT DEFAULT '[]',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS job_status (
                job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'pending',
                notes TEXT DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
            CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);

            -- Avaliação do agente ranqueador: score + recomendação + motivos
            -- + dicas, por vaga. Tabela separada da jobs para o leque de
            -- campos não pesar na linha principal. cv_version diz qual
            -- versão do currículo a avaliação considerou — quando o CV muda,
            -- as notas antigas ficam "vazias" para o agente reavaliar.
            CREATE TABLE IF NOT EXISTS job_evals (
                job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
                score REAL,
                recommendation TEXT NOT NULL DEFAULT '',
                reasons TEXT NOT NULL DEFAULT '[]',
                tips TEXT NOT NULL DEFAULT '[]',
                scored_by TEXT NOT NULL DEFAULT '',
                cv_version INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_evals_score ON job_evals(score DESC);

            -- Chaves/valores do app (ex.: versão do currículo).
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        # `notes` na tabela jobs: a stack é a informação que decide se a vaga
        # serve, e não havia onde guardá-la. A tabela já existe em installs
        # antigos, então a coluna entra por ALTER TABLE — CREATE TABLE IF NOT
        # EXISTS acima não muda tabela que já foi criada.
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(jobs)")}
        if "notes" not in cols:
            conn.execute("ALTER TABLE jobs ADD COLUMN notes TEXT DEFAULT ''")
        # Currículo: uma linha por módulo. A ordem, o rótulo e o tipo de cada
        # módulo vêm de cv_parser.MODULES, que é a fonte da verdade — assim
        # renomear um módulo no código não exige migração no banco.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cv_modules (
                key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL
            )
            """
        )
        _migrate_title_scores(conn)


RE_TITLE_SCORE = re.compile(r"\s*\[(\d(?:\.\d+)?)/5\]\s*$")


def split_score_suffix(title: str) -> tuple[str, float | None]:
    """Separa um score `[4.4/5]` do fim do título, quando existir.

    O formato legado (career-ops e scanners antigos) trazia a nota dentro do
    título. O app normaliza: o título fica limpo e o score vai para job_evals.
    Assim produtores antigos continuam funcionando sem mudança própria.
    """
    m = RE_TITLE_SCORE.search(title or "")
    if not m:
        return (title or "").strip(), None
    try:
        score = float(m.group(1))
    except ValueError:
        return (title or "").strip(), None
    return RE_TITLE_SCORE.sub("", title or "").strip(), score


def score_tier(score: float | None) -> str:
    """Faixa visual do score. 4.3+ é o que o career-ops trata como candidato
    prioritário; abaixo de 3.0 está fora do piso de triagem dele."""
    if score is None:
        return ""
    if score >= 4.3:
        return "alta"
    if score >= 3.6:
        return "media"
    if score >= 3.0:
        return "baixa"
    return "fora"


def _json_list(raw) -> list:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def get_cv_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM meta WHERE key = 'cv_version'").fetchone()
    if not row:
        return 0
    try:
        return int(row["value"])
    except (ValueError, TypeError):
        return 0


def bump_cv_version(conn: sqlite3.Connection) -> int:
    """Avança a versão do currículo. Volta aqui sempre que o CV mudar: é o que
    marca todas as avaliações como defasadas para o agente reavaliar."""
    version = get_cv_version(conn) + 1
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('cv_version', ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(version),),
    )
    return version


def _migrate_title_scores(conn: sqlite3.Connection) -> None:
    """Uma vez: o score que morava no título vai para job_evals e o título
    volta a não ter a nota. Também corrige a dedup_key, que era montada com o
    título sujo — vaga com e sem score eram duas linhas; agora é uma só."""
    rows = conn.execute("SELECT id, title, company FROM jobs").fetchall()
    for row in rows:
        title, score = split_score_suffix(row["title"])
        if score is None or not title:
            continue
        new_key = make_dedup_key(title, row["company"])
        dup = conn.execute(
            "SELECT id FROM jobs WHERE dedup_key = ? AND id != ?",
            (new_key, row["id"]),
        ).fetchone()
        if dup is None:
            conn.execute(
                "UPDATE jobs SET title = ?, dedup_key = ? WHERE id = ?",
                (title, new_key, row["id"]),
            )
        else:
            conn.execute("UPDATE jobs SET title = ? WHERE id = ?", (title, row["id"]))
        conn.execute(
            "INSERT OR IGNORE INTO job_evals"
            " (job_id, score, recommendation, scored_by, cv_version, updated_at)"
            " VALUES (?, ?, ?, 'legado', 0, ?)",
            (row["id"], score, reco_for(score), now_iso()),
        )


CV_EMPTY: dict[str, list] = {key: [] for key, _label, _kind, _split in cv_parser.MODULES}


def cv_payload() -> list[dict]:
    """Módulos do currículo na ordem do código, já com os dados do banco.

    Um módulo sem linha na tabela vira a lista vazia, para o painel sempre ter
    a estrutura completa mesmo antes da primeira importação.
    """
    with get_db() as conn:
        rows = conn.execute("SELECT key, data FROM cv_modules").fetchall()
    stored = {}
    for row in rows:
        try:
            parsed = json.loads(row["data"] or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(parsed, list):
            stored[row["key"]] = parsed

    out = []
    for key, label, kind, _split in cv_parser.MODULES:
        items = stored.get(key, CV_EMPTY[key])
        if kind == "text":
            items = items[:1] or [{"label": "", "value": ""}]
        out.append({"key": key, "label": label, "kind": kind, "items": items})
    return out


def job_to_dict(row: sqlite3.Row) -> dict:
    score = row["score"]
    recommendation = row["recommendation"] or ""
    return {
        "id": row["id"],
        "dedup_key": row["dedup_key"],
        "title": row["title"],
        "company": row["company"],
        "location": row["location"],
        "source": row["source"],
        "source_url": row["source_url"],
        "email_date": row["email_date"],
        "created_at": row["created_at"],
        "status": row["status"] or "pending",
        "status_label": STATUS_LABELS.get(row["status"] or "pending", "Pendente"),
        "notes": row["notes"] or "",
        # comentário do usuário, que vive em job_status.notes — separado de
        # `notes` (a stack) para não confundir os dois no front.
        "status_notes": row["status_notes"] if "status_notes" in row.keys() else "",
        # avaliação do agente ranqueador (fase 3), quando existir.
        "score": score,
        "tier": score_tier(score),
        "recommendation": recommendation,
        "reco_label": RECO_LABELS.get(recommendation, ""),
        "reasons": _json_list(row["reasons"]),
        "tips": _json_list(row["tips"]),
        "scored_by": row["scored_by"] or "",
        "cv_version": row["cv_version"] or 0,
    }


app = FastAPI(title="Vagas App", docs_url=None, redoc_url=None)
app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    same_site="lax",
    https_only=False,  # atrás de Cloudflare/VPS com HTTPS próprio
)
# CORS aberto para a extensão do Chrome (e produções) — a autenticação é por
# X-API-Key no header, então liberar o origin não abre nada sem a chave.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")
templates.env.globals["asset_version"] = ASSET_VERSION


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    """Assets estáticos e o service worker sempre revalidados.

    Sem Cache-Control o browser aplica cache heurístico e o PWA continuaria
    servindo CSS/JS antigos depois de um deploy. Com no-cache o ETag continua
    valendo, então o custo é um 304 leve por arquivo.
    """
    response = await call_next(request)
    if request.url.path.startswith(("/static/", "/sw.js")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.on_event("startup")
def _startup() -> None:
    init_db()


# ---------------------------------------------------------------- auth
def is_logged_in(request: Request) -> bool:
    return bool(request.session.get("auth"))


def require_login(request: Request) -> None:
    if not is_logged_in(request):
        raise HTTPException(status_code=401, detail="não autenticado")


def authorize(request: Request, allow_api_key: bool = False) -> None:
    """Sessão de navegador; opcionalmente também aceita a X-API-Key do app.

    Os agentes ranqueadores não têm sessão — leem o currículo e as vagas com
    a mesma chave que usam na ingestão.
    """
    if is_logged_in(request):
        return
    if allow_api_key:
        given = request.headers.get("x-api-key", "")
        if API_KEY and hmac.compare_digest(given, API_KEY):
            return
    raise HTTPException(status_code=401, detail="não autenticado")


def require_api_key(request: Request) -> None:
    given = request.headers.get("x-api-key", "")
    if not API_KEY or not hmac.compare_digest(given, API_KEY):
        raise HTTPException(status_code=403, detail="api key inválida")


# ---------------------------------------------------------------- PWA assets
@app.get("/sw.js")
def service_worker():
    return FileResponse(
        BASE_DIR / "static" / "sw.js", media_type="application/javascript"
    )


@app.get("/manifest.json")
def manifest():
    return FileResponse(
        BASE_DIR / "static" / "manifest.json", media_type="application/manifest+json"
    )


@app.get("/healthz")
def healthz():
    """Para healthcheck do Docker: sem auth, retorna 200 quando o app sobe."""
    return {"ok": True}


# ---------------------------------------------------------------- HTML (painel)
@app.get("/")
def home(request: Request):
    if not is_logged_in(request):
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(request, "index.html")


@app.get("/login")
def login_page(request: Request):
    if is_logged_in(request):
        return RedirectResponse("/", status_code=302)
    return templates.TemplateResponse(
        request, "login.html", {"error": None}
    )


@app.post("/login")
def login(request: Request, password: str = Form("")):
    given = hashlib.sha256(password.encode("utf-8")).hexdigest()
    if hmac.compare_digest(given, PASSWORD_HASH):
        request.session["auth"] = True
        return RedirectResponse("/", status_code=302)
    return templates.TemplateResponse(
        request, "login.html", {"error": "wrong_password"}, status_code=401
    )


@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=302)


@app.get("/curriculo")
def cv_page(request: Request):
    """Página do currículo.

    No desktop ele aparece como coluna ao lado da lista; no celular a coluna
    some e o mesmo conteúdo vem dentro de uma gaveta. Ter rota própria faz o
    botão "Currículo" da topbar funcionar nos dois tamanhos sem gambiarra de
    JavaScript, e deixa a URL aberta direto.
    """
    if not is_logged_in(request):
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(request, "cv.html")


@app.get("/vagas/{job_id}")
def job_detail(request: Request, job_id: int):
    if not is_logged_in(request):
        return RedirectResponse("/login", status_code=302)
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT j.*, COALESCE(s.status, 'pending') AS status,
                   COALESCE(s.notes, '') AS status_notes,
                   e.score, e.recommendation, e.reasons, e.tips,
                   e.scored_by, e.cv_version
            FROM jobs j
            LEFT JOIN job_status s ON s.job_id = j.id
            LEFT JOIN job_evals e ON e.job_id = j.id
            WHERE j.id = ?
            """,
            (job_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="vaga não encontrada")
    job = job_to_dict(row)
    return templates.TemplateResponse(
        request,
        "detail.html",
        {"job": job, "job_json": json.dumps(job)},
    )


# ---------------------------------------------------------------- API
@app.get("/api/v1/jobs")
def api_list_jobs(request: Request, source: str = "", status: str = "", q: str = ""):
    require_login(request)
    like = f"%{q.strip()}%"
    with get_db() as conn:
        rows = conn.execute(
            """
            -- `notes` aparece nas duas tabelas. Sem o alias distinto, o
            -- sqlite3.Row devolve a última ocorrência por nome e o resultado
            -- depende da ordem do SELECT — funcionava por acaso, não por
            -- desenho. `j.notes` é a stack que veio do produtor;
            -- `status_notes` é o comentário que o usuário escreve no detalhe.
            SELECT j.*,
                   COALESCE(s.status, 'pending') AS status,
                   COALESCE(s.notes, '') AS status_notes,
                   e.score, e.recommendation, e.reasons, e.tips,
                   e.scored_by, e.cv_version
            FROM jobs j
            LEFT JOIN job_status s ON s.job_id = j.id
            LEFT JOIN job_evals e ON e.job_id = j.id
            WHERE (:source = '' OR j.source = :source)
              AND (:status = '' OR COALESCE(s.status, 'pending') = :status)
              AND (:q = ''
                   OR j.title LIKE :like
                   OR j.company LIKE :like
                   OR j.location LIKE :like)
            -- A ordem é o ranking: nota do agente primeiro (fase 3), vaga
            -- sem avaliação vai para o fim (NULL no DESC do SQLite), e o
            -- desempate é a mais recente.
            ORDER BY e.score DESC, j.created_at DESC, j.id DESC
            """,
            {"source": source, "status": status, "q": q.strip(), "like": like},
        ).fetchall()

        # Os números dos filtros não podem sair da lista filtrada: cada
        # dimensão é contada ignorando o próprio filtro e respeitando os
        # outros (a busca e a dimensão vizinha). Assim, aberto em
        # "Dispensadas", os outros status seguem com a contagem real.
        status_counts = {
            r["st"]: r["n"]
            for r in conn.execute(
                """
                SELECT COALESCE(s.status, 'pending') AS st, COUNT(*) AS n
                FROM jobs j
                LEFT JOIN job_status s ON s.job_id = j.id
                WHERE (:source = '' OR j.source = :source)
                  AND (:q = ''
                       OR j.title LIKE :like
                       OR j.company LIKE :like
                       OR j.location LIKE :like)
                GROUP BY st
                """,
                {"source": source, "q": q.strip(), "like": like},
            ).fetchall()
        }
        # Lista completa de origens sob a busca: as pílulas nunca somem do
        # menu — origem sem vaga no status atual aparece com 0 (é o que o
        # clique entregaria), não some.
        all_sources = [
            r["src"]
            for r in conn.execute(
                """
                SELECT DISTINCT j.source AS src
                FROM jobs j
                WHERE j.source <> ''
                  AND (:q = ''
                       OR j.title LIKE :like
                       OR j.company LIKE :like
                       OR j.location LIKE :like)
                ORDER BY j.source
                """,
                {"q": q.strip(), "like": like},
            ).fetchall()
        ]
        facet_sources = {
            r["src"]: r["n"]
            for r in conn.execute(
                """
                SELECT j.source AS src, COUNT(*) AS n
                FROM jobs j
                LEFT JOIN job_status s ON s.job_id = j.id
                WHERE (:status = '' OR COALESCE(s.status, 'pending') = :status)
                  AND (:q = ''
                       OR j.title LIKE :like
                       OR j.company LIKE :like
                       OR j.location LIKE :like)
                GROUP BY j.source
                """,
                {"status": status, "q": q.strip(), "like": like},
            ).fetchall()
        }
        source_counts = {s: facet_sources.get(s, 0) for s in all_sources}
    return {
        "jobs": [job_to_dict(r) for r in rows],
        "counts": {"status": status_counts, "source": source_counts},
    }


@app.post("/api/v1/jobs:bulk")
async def api_bulk_jobs(
    request: Request, x_api_key: str = Header(default="", alias="X-API-Key")
):
    require_api_key(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="corpo JSON inválido")
    items = body.get("jobs", [])
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="'jobs' precisa ser uma lista")

    inserted = 0
    skipped = 0
    ts = now_iso()
    with get_db() as conn:
        for item in items:
            if not isinstance(item, dict):
                skipped += 1
                continue
            # O produtor pode mandar o score no formato legado, dentro do
            # título `[4.4/5]` — o app separa e guarda em job_evals. Assim
            # nenhum produtor antigo quebra por causa do refactor.
            title, score = split_score_suffix((item.get("title") or "").strip())
            company = (item.get("company") or "").strip()
            if not title:
                skipped += 1
                continue
            key = make_dedup_key(title, company)
            links = item.get("external_links") or []
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO jobs
                    (dedup_key, title, company, location, source, source_url,
                     email_date, external_links, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    key,
                    title,
                    company,
                    (item.get("location") or "").strip(),
                    (item.get("source") or "").strip().lower(),
                    (item.get("source_url") or "").strip(),
                    (item.get("email_date") or "").strip(),
                    json.dumps(links if isinstance(links, list) else []),
                    (item.get("notes") or "").strip(),
                    ts,
                ),
            )
            if cur.rowcount:
                inserted += 1
                conn.execute(
                    "INSERT OR IGNORE INTO job_status (job_id, status, notes, updated_at)"
                    " VALUES (?, 'pending', '', ?)",
                    (cur.lastrowid, ts),
                )
                if score is not None:
                    conn.execute(
                        "INSERT OR IGNORE INTO job_evals"
                        " (job_id, score, recommendation, scored_by, cv_version, updated_at)"
                        " VALUES (?, ?, ?, 'provedor', 0, ?)",
                        (cur.lastrowid, score, reco_for(score), ts),
                    )
            else:
                # Vaga repetida: ignora sem tocar em status/notas existentes.
                skipped += 1
    return {"inserted": inserted, "skipped": skipped}


# ---------------------------------------------------------------- API avaliação
@app.get("/api/v1/jobs:for-scoring")
def api_for_scoring(request: Request, x_api_key: str = Header(default="", alias="X-API-Key")):
    """Envelope de avaliação para o agente ranqueador, num GET só.

    Devolve o currículo estruturado + as vagas que ainda não têm avaliação
    (ou cuja avaliação usou uma versão anterior do currículo). É o "pull"
    neutro do contrato: qualquer agente — muse.ai, hermes, um script local —
    implementa da mesma forma.
    """
    require_api_key(request)
    with get_db() as conn:
        cv = get_cv_version(conn)
        rows = conn.execute(
            """
            SELECT j.id, j.dedup_key, j.title, j.company, j.location,
                   j.source, j.source_url, j.notes, j.created_at
            FROM jobs j
            LEFT JOIN job_evals e ON e.job_id = j.id
            WHERE e.job_id IS NULL OR e.cv_version < :cv
            ORDER BY j.created_at DESC, j.id DESC
            """,
            {"cv": cv},
        ).fetchall()
    return {
        "cv_version": cv,
        "cv": cv_payload(),
        "jobs": [dict(r) for r in rows],
    }


@app.post("/api/v1/jobs:score")
async def api_score_jobs(
    request: Request, x_api_key: str = Header(default="", alias="X-API-Key")
):
    """O agente ranqueador grava as avaliações em lote.

    Cada item identifica a vaga por `id` ou `dedup_key` e traz:
      score (0–5 ou null para limpar), recommendation (yes|maybe|no),
      reasons[], tips[], scored_by. A avaliação fica marcada com a versão do
      currículo vigente — quando o CV mudar, a mesma vaga volta para o
      for-scoring.
    """
    require_api_key(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="corpo JSON inválido")
    items = body.get("evals", [])
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="'evals' precisa ser uma lista")

    applied = 0
    skipped = 0
    with get_db() as conn:
        cv = get_cv_version(conn)
        for item in items:
            if not isinstance(item, dict):
                skipped += 1
                continue
            job_id = item.get("id")
            dedup = (item.get("dedup_key") or "").strip()
            if isinstance(job_id, int):
                row = conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone()
            elif dedup:
                row = conn.execute(
                    "SELECT id FROM jobs WHERE dedup_key = ?", (dedup,)
                ).fetchone()
            else:
                skipped += 1
                continue
            if row is None:
                skipped += 1
                continue

            raw_score = item.get("score")
            if raw_score is None:
                score = None
            elif isinstance(raw_score, (int, float)) and not isinstance(raw_score, bool):
                score = float(raw_score)
                if not (0 <= score <= 5):
                    skipped += 1
                    continue
            else:
                skipped += 1
                continue

            rec = (item.get("recommendation") or "").strip()
            if rec not in ("", "yes", "maybe", "no"):
                skipped += 1
                continue

            reasons_list = [str(r) for r in item.get("reasons") or [] if isinstance(r, (str, int, float))][:20]
            tips_list = [str(t) for t in item.get("tips") or [] if isinstance(t, (str, int, float))][:20]
            scored_by = (item.get("scored_by") or "").strip()[:60]

            cleared = score is None and not rec and not reasons_list and not tips_list
            if cleared:
                conn.execute("DELETE FROM job_evals WHERE job_id = ?", (row["id"],))
                applied += 1
                continue

            conn.execute(
                """
                INSERT INTO job_evals
                    (job_id, score, recommendation, reasons, tips,
                     scored_by, cv_version, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    score = excluded.score,
                    recommendation = excluded.recommendation,
                    reasons = excluded.reasons,
                    tips = excluded.tips,
                    scored_by = excluded.scored_by,
                    cv_version = excluded.cv_version,
                    updated_at = excluded.updated_at
                """,
                (
                    row["id"],
                    score,
                    rec,
                    json.dumps(reasons_list, ensure_ascii=False),
                    json.dumps(tips_list, ensure_ascii=False),
                    scored_by,
                    cv,
                    now_iso(),
                ),
            )
            applied += 1
    return {"ok": True, "applied": applied, "skipped": skipped, "cv_version": get_cv_version(conn)}


@app.post("/api/v1/jobs:purge")
async def api_purge_jobs(
    request: Request, x_api_key: str = Header(default="", alias="X-API-Key")
):
    """Apaga as vagas avaliadas abaixo do limiar (padrão: 3.0).

    O agente ranqueador chama logo depois de gravar um lote em `jobs:score`
    para que o painel nunca receba vaga "fora" (score < limiar): a cascata
    leva `job_status` e `job_evals` junto. Só mexe em vaga que já tem
    avaliação — nota NULL nunca apaga nada. Limiar vai no corpo:

        {"score_max": 3.0}    # 0–5; corpo vazio usa 3.0
    """
    require_api_key(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="corpo JSON inválido")
    score_max = body.get("score_max", 3.0)
    if (
        isinstance(score_max, bool)
        or not isinstance(score_max, (int, float))
        or not (0 <= score_max <= 5)
    ):
        raise HTTPException(
            status_code=400, detail="score_max precisa ser um número entre 0 e 5"
        )
    score_max = float(score_max)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT j.id
            FROM jobs j
            JOIN job_evals e ON e.job_id = j.id
            WHERE e.score IS NOT NULL AND e.score < :score_max
            ORDER BY j.id
            """,
            {"score_max": score_max},
        ).fetchall()
        ids = [r["id"] for r in rows]
        if ids:
            conn.executemany("DELETE FROM jobs WHERE id = ?", [(i,) for i in ids])
    return {"ok": True, "deleted": len(ids), "ids": ids, "score_max": score_max}


# ---------------------------------------------------------------- API currículo
@app.get("/api/v1/cv")
def api_get_cv(request: Request):
    authorize(request, allow_api_key=True)
    return {"modules": cv_payload()}


def _sanitize_cv(key: str, raw: object) -> list:
    """Valida e normaliza os itens de um módulo antes de gravar.

    Aceita só a forma do módulo e descarta chaves desconhecidas, para o banco
    nunca receber estrutura inesperada vinda do cliente.
    """
    spec = next((m for m in cv_parser.MODULES if m[0] == key), None)
    if spec is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "cv_module_unknown", "message": "módulo de currículo desconhecido"},
        )
    _key, _label, kind, _split = spec
    if not isinstance(raw, list):
        raise HTTPException(
            status_code=400,
            detail={"code": "cv_items_not_list", "message": "itens precisa ser uma lista"},
        )

    slots = {"fields": ("label", "value"), "text": ("label", "value")}
    slots["entries"] = ("title", "org", "context", "period", "body", "links")

    limit = 1 if kind == "text" else 200
    clean = []
    for item in raw[:limit]:
        if not isinstance(item, dict):
            continue
        out = {}
        for slot in slots[kind]:
            value = item.get(slot)
            out[slot] = value.strip() if isinstance(value, str) else ""
        clean.append(out)
    return clean


@app.put("/api/v1/cv")
async def api_save_cv(request: Request):
    authorize(request, allow_api_key=True)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="corpo JSON inválido")

    incoming = body.get("modules")
    if not isinstance(incoming, dict):
        raise HTTPException(
            status_code=400,
            detail={"code": "cv_modules_not_object", "message": "'modules' precisa ser um objeto"},
        )

    valid = {key for key, _l, _k, _s in cv_parser.MODULES}
    unknown = set(incoming) - valid
    if unknown:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "cv_module_unknown",
                "message": f"módulo desconhecido: {', '.join(sorted(unknown))}",
            },
        )

    clean = {key: _sanitize_cv(key, val) for key, val in incoming.items()}
    ts = now_iso()
    with get_db() as conn:
        for key, items in clean.items():
            conn.execute(
                """
                INSERT INTO cv_modules (key, data, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    data = excluded.data,
                    updated_at = excluded.updated_at
                """,
                (key, json.dumps(items, ensure_ascii=False), ts),
            )
        # CV mudou: avaliações existentes ficam defasadas e o agente sabe por
        # qual versão reavaliar.
        bump_cv_version(conn)
    return {"ok": True, "saved": sorted(clean)}


@app.post("/api/v1/cv:import")
async def api_import_cv(request: Request, arquivo: UploadFile = File(...)):
    """Lê um currículo em PDF e devolve os módulos montados — sem salvar.

    A gravação é um passo separado (PUT /api/v1/cv) para a pessoa revisar o
    que o parser entendeu. Dado que ele é afinado a um formato específico de
    currículo, salvar direto sobrescreveria dados bons com dados ruins.
    """
    require_login(request)
    filename = (arquivo.filename or "").lower()
    if not filename.endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail={"code": "cv_import_pdf", "message": "envie um arquivo .pdf"},
        )

    raw = await arquivo.read()
    if not raw:
        raise HTTPException(
            status_code=400,
            detail={"code": "cv_import_empty", "message": "arquivo vazio"},
        )
    if len(raw) > CV_MAX_UPLOAD:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "cv_import_too_big",
                "message": f"arquivo maior que {CV_MAX_UPLOAD // (1024 * 1024)}MB",
            },
        )

    try:
        parsed = cv_parser.parse_cv(raw)
    except Exception as exc:  # PDF corrompido, protegido, sem texto, etc.
        raise HTTPException(
            status_code=422,
            detail={"code": "cv_import_unreadable", "message": f"não consegui ler o PDF: {exc}"},
        )

    payload = []
    for key, label, kind, _split in cv_parser.MODULES:
        items = parsed["modules"].get(key) or []
        if kind == "text":
            items = items[:1] or [{"label": "", "value": ""}]
        payload.append({"key": key, "label": label, "kind": kind, "items": items})

    return {"modules": payload, "unmapped": parsed["unmapped"]}


@app.patch("/api/v1/jobs/{job_id}/status")
async def api_set_status(job_id: int, request: Request):
    require_login(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="corpo JSON inválido")
    status = (body.get("status") or "").strip()
    notes = body.get("notes") or ""
    if status not in STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status inválido (use: {', '.join(STATUSES)})",
        )
    with get_db() as conn:
        exists = conn.execute(
            "SELECT id FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="vaga não encontrada")
        conn.execute(
            """
            INSERT INTO job_status (job_id, status, notes, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                status = excluded.status,
                notes = excluded.notes,
                updated_at = excluded.updated_at
            """,
            (job_id, status, notes, now_iso()),
        )
    return {"ok": True, "status": status}


@app.delete("/api/v1/jobs/{job_id}")
def api_delete_job(job_id: int, request: Request):
    """Remove a vaga do banco. `job_status` e `job_evals` caem junto
    (ON DELETE CASCADE). Sessão do painel, como os outros endpoints da UI."""
    require_login(request)
    with get_db() as conn:
        exists = conn.execute(
            "SELECT id FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="vaga não encontrada")
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    return {"ok": True, "deleted": job_id}
