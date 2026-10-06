#!/usr/bin/env python3
"""Ponte career-ops -> Vagas App.

Le `career-ops/data/pipeline.md` e `career-ops/data/applications.md` e envia
para o app via `POST /api/v1/jobs:bulk`, que é a rota que a automação de
e-mail já usava.

Por que ler Markdown e não o SQLite do career-ops: o `DATA_CONTRACT.md` dele
declara `data/pipeline.md` e `data/applications.md` como camada de usuário, e
o `data/applications.db` é um índice derivado, reconstruível com
`node tracker.mjs sync`. Depender do Markdown é depender da fonte, não do
cache.

Idempotente: o app deduplica por (title, company) e o `INSERT OR IGNORE`
devolve rowcount 0 na segunda vez, então rodar todo dia não duplica nada.

    python3 scripts/career_sync.py                 # envia o pipeline pendente
    python3 scripts/career_sync.py --dry-run       # só mostra o que iria enviar
    python3 scripts/career_sync.py --base http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAREER = ROOT / "career-ops"
PIPELINE = CAREER / "data" / "pipeline.md"
TRACKER = CAREER / "data" / "applications.md"

# Linha do pipeline.md:
#   - [ ] {url} | {empresa} | {cargo} | {nivel} | {local} | {stack} | {data}
PIPELINE_RE = re.compile(
    r"^- \[( |x)\] (?P<url>\S+) \| (?P<rest>.+)$"
)

# Cada board é uma origem, não um "outro": 17 vagas de fontes diferentes
# viravam uma pílula cinza só, e aí o filtro por origem não ajuda em nada.
SOURCE_BY_HOST = {
    "greenhouse.io": "greenhouse",
    "ashbyhq.com": "greenhouse",
    "workable.com": "greenhouse",
    "remotar.com.br": "remotar",
    "github.com": "frontendbr",
    "nomadesdigitais.com": "nomades",
    "solides.com.br": "solides",
    "vagas.com.br": "solides",
    "programathor.com.br": "nomades",
    "indeed.com": "indeed",
    "linkedin.com": "linkedin",
    "gupy.io": "other",
    "accenture.com": "other",
}
DEFAULT_SOURCE = "career-ops"

# Níveis que o pipeline.md traz em coluna própria, e as grafias que contam
# como o mesmo nível. Sem o mapa, "Desenvolvedor Front-end JR" + nível
# "Júnior" vira "JR (Júnior)" no card: strings diferentes, mesmo cargo.
LEVEL_ALIASES = {
    "junior": "junior", "jr": "junior", "jr.": "junior",
    "pleno": "pleno", "plena": "pleno",
    "senior": "senior", "sr": "senior",
    "trainee": "trainee", "estagio": "estagio",
    # numeral romano isolado no fim do título é nível, não qualquer coisa
    "i": "junior", "ii": "pleno", "iii": "senior",
}
LEVELS = set(LEVEL_ALIASES)


def parece_local(valor: str) -> bool:
    """Diz se o campo parece modalidade/local, e não stack.

    Sem isto, uma linha do pipeline.md sem a coluna de local entrega a stack
    no lugar dela — o card mostrava "FMX Soluções · .NET no back" como se fosse
    a localização. Stack em português quase sempre cita framework; local cita
    modalidade ou cidade.
    """
    v = fold(valor)
    if not v:
        return False
    if any(k in v for k in (
        "remot", "hibrid", "presencial", "home office", "brasil",
    )):
        return True
    # sigla de estado ou cidade com duas letras maiúsculas virada caixa
    return bool(re.search(r"\b(sp|rj|sc|rs|pr|mg|ba|pe|ce|go|df|ms|mt|pa|am|ro|rr|ap|ma|pb|pi|rn|ro|es|se)\b", valor.lower()))


def source_for(url: str) -> str:
    for host, src in SOURCE_BY_HOST.items():
        if host in url:
            return src
    return DEFAULT_SOURCE


def fold(s: str) -> str:
    """minúsculas sem acento, para comparar nível dentro do texto."""
    import unicodedata
    out = []
    for ch in unicodedata.normalize("NFD", s.lower()):
        if not unicodedata.combining(ch):
            out.append(ch)
    return "".join(out)


def canonical_level(word: str) -> str | None:
    return LEVEL_ALIASES.get(fold(word).strip(" ."))


def nivel_de(valor: str) -> bool:
    """True se o campo é um nível (ou faixa de níveis).

    "Júnior a Sênior" é um nível, mas a divisão ingênua em `/` devolve "a", que
    não é nível nenhum — e aí o campo seguinte (a modalidade) escorrega para a
    coluna da stack. Por isso os conectores entram na divisão.
    """
    partes = [
        p for p in re.split(r"[/,\s]+|ate|até|\ba\b", valor.lower()) if p.strip()
    ]
    return bool(partes) and all(canonical_level(p) for p in partes)


def nivel_ja_no_cargo(cargo: str, nivel: str) -> bool:
    """True se o cargo já declara o nível, em qualquer grafia.

    Compara token a token para não dar falso positivo: "Front-end I" casaria
    com qualquer "i" solto se a busca fosse por substring.
    """
    canon = {canonical_level(p) for p in re.split(r"[/,\s]+", nivel) if p.strip()}
    canon.discard(None)
    if not canon:
        return False
    tokens = [fold(t).strip(" .") for t in re.split(r"[^A-Za-zÀ-ÿ0-9]+", cargo) if t.strip()]
    return any(canonical_level(t) in canon for t in tokens)


def split_rest(rest: str) -> dict:
    """Divide o resto da linha em campos, tolerando pipes a mais.

    A linha é `empresa | cargo | nível | local | stack | data`, mas a data e a
    stack são opcionais e o cargo às vezes contém o próprio separador
    ("Desenvolvedor(a) Front-End Júnior | Pleno"). Por isso o primeiro campo é
    a empresa, o segundo o cargo, e o resto vira detalhe.
    """
    parts = [p.strip() for p in rest.split("|")]
    empresa = parts[0] if parts else ""
    cargo = parts[1] if len(parts) > 1 else ""
    resto = parts[2:]
    return {"empresa": empresa, "cargo": cargo, "resto": resto}


def parse_pipeline() -> list[dict]:
    """Lê o pipeline.md.

    Formato da linha:
        - [ ] {url} | {empresa} | {cargo} | {nível} | {local} | {stack} | {data}

    O nível e a data são opcionais, e o cargo às vezes contém o próprio
    separador ("Desenvolvedor(a) Front-End Júnior | Pleno"), então a divisão é
    posicional e tolerante, não por número fixo de campos.
    """
    if not PIPELINE.exists():
        return []
    jobs = []
    for line in PIPELINE.read_text(encoding="utf-8").splitlines():
        m = PIPELINE_RE.match(line.strip())
        if not m:
            continue
        if m.group(1) == "x":
            continue  # já processada
        url = m.group("url")
        f = split_rest(m.group("rest"))
        cargo = f["cargo"]
        resto = f["resto"]

        nivel = resto[0] if resto else ""
        if nivel and nivel_de(nivel):
            resto = resto[1:]
            if not nivel_ja_no_cargo(cargo, nivel):
                cargo = f"{cargo} ({nivel})"

        local = resto[0] if resto else ""
        stack = resto[1] if len(resto) > 1 else ""
        # Se o primeiro campo não parece local, a linha veio sem a coluna de
        # local: então ele é o começo da stack, não o lugar dela.
        if not parece_local(local):
            if local:
                stack = f"{local} — {stack}" if stack else local
            local = ""

        jobs.append({
            "title": cargo,
            "company": f["empresa"],
            "location": local or "Brasil",
            "source": source_for(url),
            "source_url": url,
            "notes": stack,
        })
    return jobs


def parse_tracker() -> list[dict]:
    """Lê o tracker. Vaga avaliada já tem score — entra com esse rótulo no card.

    O app não tem campo de score; ele vai no título entre colchetes, que é o
    que o card mostra em destaque. Não é o ideal, mas é honesto: mostra a nota
    sem inventar coluna nova no banco por causa de um import.
    """
    if not TRACKER.exists():
        return []
    jobs = []
    lines = TRACKER.read_text(encoding="utf-8").splitlines()
    header = None
    for line in lines:
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if set("".join(cells)) <= set("-: "):
            continue
        if header is None:
            header = [c.lower() for c in cells]
            continue
        if len(cells) < len(header):
            continue
        row = dict(zip(header, cells))
        company = row.get("company", "")
        role = row.get("role", "")
        if not company or not role:
            continue
        score = row.get("score", "")
        title = role if score in ("", "—", "-", "N/A") else f"{role} [{score}]"
        report = row.get("report", "")
        # `links` guarda o caminho do relatório .md. Não é mais enviado ao app
        # (a feature "Também encontrada em" saiu), mas é o que permite ler a
        # modalidade e a recomendação de onde a avaliação realmente as deixou.
        m = re.search(r"\(([^)]+)\)", report)
        links = [m.group(1)] if m else []

        # Vaga avaliada tem relatório .md, que é onde a avaliação deixou a
        # modalidade e a recomendação. Ler de lá é melhor do que inferir: o
        # relatório foi escrito lendo a JD inteira.
        location = row.get("location") or ""
        notes = row.get("notes", "")
        if links:
            md = (CAREER / links[0]).resolve()
            if md.is_file():
                head = md.read_text(encoding="utf-8", errors="replace")[:1600]
                lm = re.search(r"^\*\*Location:\*\*\s*(.+)$", head, re.M)
                if lm:
                    location = lm.group(1).strip()
                sm = re.search(r"^\*\*Score:\*\*\s*(.+)$", head, re.M)
                if sm:
                    notes = f"{notes} — {sm.group(1).strip()}".strip(" —")

        jobs.append({
            "title": title,
            "company": company,
            "location": location or "Brasil",
            "source": source_for(links[0]) if links else DEFAULT_SOURCE,
            "source_url": links[0] if links else "",
            "notes": notes,
        })
    return jobs


def send(base: str, api_key: str, jobs: list[dict]) -> dict:
    body = json.dumps({"jobs": jobs}).encode("utf-8")
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/v1/jobs:bulk",
        data=body,
        headers={"Content-Type": "application/json", "X-API-Key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--base",
        default=os.environ.get("VAGAS_BASE", "http://127.0.0.1:8000"),
        help="URL do Vagas App",
    )
    ap.add_argument(
        "--api-key",
        default=os.environ.get("VAGAS_API_KEY", ""),
        help="chave da API (ou a env VAGAS_API_KEY)",
    )
    ap.add_argument("--dry-run", action="store_true", help="só mostra, não envia")
    ap.add_argument("--tracker", action="store_true", help="inclui o tracker avaliado")
    args = ap.parse_args()

    jobs = parse_pipeline()
    if args.tracker:
        jobs += parse_tracker()

    # dedup dentro do próprio arquivo: a mesma vaga pode estar em pipeline e
    # tracker depois de ser avaliada
    seen = set()
    uniq = []
    for j in jobs:
        key = (j["title"].strip().lower(), j["company"].strip().lower())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(j)

    print(f"{len(uniq)} vaga(s) para enviar")
    for j in uniq:
        print(f"  {j['company']:<22} | {j['title']}")

    if args.dry_run:
        return 0
    if not args.api_key:
        print("\nerro: falta a API key (--api-key ou VAGAS_API_KEY)", file=sys.stderr)
        return 2

    try:
        res = send(args.base, args.api_key, uniq)
    except urllib.error.HTTPError as e:
        print(f"\nerro {e.code}: {e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"\nerro de conexão com {args.base}: {e.reason}", file=sys.stderr)
        return 1

    print(f"\ninseridas: {res['inserted']}  ignoradas: {res['skipped']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())