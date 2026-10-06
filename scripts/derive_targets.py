#!/usr/bin/env python3
"""Deriva o vocabulário de cargo do currículo para o title_filter.

Por que isso existe: o career-ops deriva keywords de `config/profile.yml`
para o campo `keywords:` de um provider (`providers/_profile-keywords.mjs`),
mas **não** para `title_filter.positive` — o próprio `_profile-keywords.mjs`
documenta que a derivação foi escopada de propósito, porque leva uma mudança
no contrato `Provider.fetch(entry, ctx)`. Então `title_filter` é escrito à
mão por design upstream.

O problema de escrever à mão sem fonte é que o filtro vira opinião de quem
digitou. A primeira versão deste projeto listava 13 linguagens no `negative`
(Java, Go, C#, .NET, PHP...) com o critério "não é JavaScript", que é o
oposto do certo: o currículo lista SQL, PostgreSQL, MySQL, Node e Python em
competência, tem projeto entregue em PHP e curso de Python com modelagem.

Este script fecha a lacuna pelo lado certo: ele **lê o currículo** e emite
só o que está lá escrito. A Stack deixa de ser critério e vira o que é de
fato — evidência de que a vaga pede o que o currículo mostra.

    python3 scripts/derive_targets.py            # imprime o relatório
    python3 scripts/derive_targets.py --emit     # imprime o bloco YAML

O que ele NÃO faz, deliberadamente: decidir nível, salário ou modalidade.
Isso vem das declarações do usuário e vive em `config/profile.yml` e
`modes/_brief.md`. Aqui só sai vocabulário de cargo e stack.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CV = ROOT / "career-ops" / "cv.md"
PROFILE = ROOT / "career-ops" / "config" / "profile.yml"

# ── o que é cargo, e não tecnologia ──────────────────────────────────────────
# Termos que descrevem a FUNÇÃO. Estes formam o positive do title_filter,
# porque é o que diz "isto é desenvolvimento de software".
ROLES = [
    # grafias brasileiras
    "Desenvolvedor", "Desenvolvedora", "Desenvolvedor(a)", "Pessoa Desenvolvedora",
    "Desenv", "Programador", "Programadora", "Analista Desenvolvedor",
    "Engenheiro de Software",
    # grafias em inglês
    "Software Engineer", "Software Developer", "Developer", "Full Stack",
    "Fullstack", "Full-Stack", "Frontend", "Front-End", "Front End", "Web Developer",
    "UI Engineer",
]

# ── o que é tecnologia, e não cargo ──────────────────────────────────────────
# Vêm do currículo. Serve para dois propósitos: confirmar a compatibilidade e
# construir o AND-group que exige a stack (ex: "frontend + angular").
def extract_technologies(cv_text: str) -> list[str]:
    """Tecnologias citadas no currículo, normalizadas.

    Só entra o que está escrito no CV. Não há lista de technologies "comuns"
    de mercado — se não está no currículo, não está aqui.
    """
    # dicionário de sinônimos -> forma canônica que aparece em título de vaga
    syn = {
        "angular": "Angular",
        "typescript": "TypeScript",
        "javascript": "JavaScript",
        "react": "React",
        "node": "Node",
        "nodejs": "Node",
        "python": "Python",
        "php": "PHP",
        "sql": "SQL",
        "postgresql": "PostgreSQL",
        "mysql": "MySQL",
        "vue": "Vue",
        "tailwindcss": "Tailwind",
        "gsap": "GSAP",
        "docker": "Docker",
        "git": "Git",
        "graphql": "GraphQL",
        "jwt": "JWT",
        "rest": "REST",
        "vitest": "Vitest",
        "html5": "HTML",
        "css3": "CSS",
        "wordpress": "WordPress",
        "elementor": "Elementor",
    }
    found = set()
    low = cv_text.lower()
    for key, canonical in syn.items():
        if re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])", low):
            found.add(canonical)
    return sorted(found)


# ── nível: o alvo declarado pelo usuário ─────────────────────────────────────
# O filtro SEMPRE exige nível. Sem isso, uma palavra solta como "engineer"
# deixa passar Engineering Director, Engineering Manager e Security Engineer,
# e a proteção passa a ser o negative — lista que nunca termina.
LEVELS = {
    "júnior": ["Júnior", "Junior", "Jr"],
    "pleno": ["Pleno", "Plena"],
    "jr": ["Jr"],
}
LEVEL_NEGATIVE = ["Sênior", "Senior", "Especialista", "Staff", "Tech Lead",
                  "Lead", "Principal", "Engineer III", "Engineer IV",
                  "Developer III", "Developer IV"]


def read_cv() -> str:
    if not CV.exists():
        sys.exit(f"erro: {CV} não existe")
    return CV.read_text(encoding="utf-8")


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if not unicodedata.combining(c)
    )


def report(cv_text: str) -> None:
    techs = extract_technologies(cv_text)
    print(f"currículo lido: {CV.relative_to(ROOT)} ({len(cv_text)} bytes)")
    print(f"\ntecnologias citadas no currículo ({len(techs)}):")
    for t in techs:
        print(f"  {t}")

    print(f"\ncargos (vocabulário do positive, {len(ROLES)}):")
    for r in ROLES:
        print(f"  {r}")

    print("\nníveis exigidos pelo filtro:")
    for lvl, forms in LEVELS.items():
        print(f"  {lvl}: {', '.join(forms)}")

    print(f"\nníveis barrados no negative: {', '.join(LEVEL_NEGATIVE)}")

    # conferência: as linguagens que eu tinha barrado antes aparecem no CV?
    print("\nlinguagens que a versão anterior barrava — estão no currículo?")
    for lang in ("Java", "Go", "C#", ".NET", "Kotlin", "PHP", "Python", "Node"):
        in_cv = bool(re.search(
            rf"(?<![a-z0-9]){re.escape(strip_accents(lang).lower())}(?![a-z0-9])",
            strip_accents(cv_text.lower())))
        print(f"  {lang:<8} {'SIM — não pode ser barrada' if in_cv else 'não citada'}")


def emit(cv_text: str) -> None:
    print("""  positive:
    # ── derivado de cv.md por scripts/derive_targets.py ──────────────────────
    # Toda entrada exige CARGO + NÍVEL. Sem o nível, uma palavra solta como
    # "engineer" deixa passar Engineering Director, Security Engineer e
    # Reliability Engineer, e a proteção vira o negative — lista infinita.
""")
    for role in ROLES:
        for level_forms in LEVELS.values():
            for lv in level_forms:
                print(f'    - "{role} + {lv}"')
    print()
    print("    # cargo com o nível já escrito no nome")
    for t in ("Software Engineer I", "Software Engineer II", "Software Developer Jr",
              "Junior Developer", "Junior Frontend", "Estágio em Desenvolvimento",
              "Trainee de Desenvolvimento"):
        print(f'    - "{t}"')
    print()
    print("  negative:")
    print("    # nível acima do alvo")
    for lv in LEVEL_NEGATIVE:
        print(f'    - "{lv}"')
    print("    # domínio sem interface web (decisão de alvo, não de linguagem:")
    print("    # Java, Go, C#, .NET, PHP, Python e Node têm tela web e NÃO entram)")
    for d in ("Quality Assurance", "Analista de Qualidade", "Mobile", "iOS",
              "Android", "Power BI", "Business Intelligence", "Data Scientist",
              "SAP", "Dynamics", "COBOL", "RPA", "SRE"):
        print(f'    - "{d}"')
    print("    # não é desenvolvimento")
    for d in ("Comercial", "Vendedor", "Account Executive", "Inside Sales",
              "Customer Success", "Consultor", "Coordenador", "Gerente",
              "Head", "Diretor"):
        print(f'    - "{d}"')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--emit", action="store_true",
                    help="imprime o bloco YAML do title_filter")
    args = ap.parse_args()
    cv_text = read_cv()
    if args.emit:
        emit(cv_text)
    else:
        report(cv_text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())