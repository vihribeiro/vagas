#!/usr/bin/env python3
"""Agente ranqueador de exemplo — implementa o contrato neutro do app.

Este script é um *demonstrativo* do contrato, não o ranqueador de verdade.
Ele exercita o ciclo completo com uma heurística determinística (overlap de
termos entre o currículo e a vaga), para que qualquer agente — muse.ai,
hermes, um agente com LLM — possa copiar a estrutura e trocar só o "meio":
a função `avaliar_vaga(cv, vaga)`.

Fluxo (tudo com a mesma X-API-Key):

  1. GET  /api/v1/jobs:for-scoring  → currículo estruturado + vagas sem
     avaliação (ou com avaliação de uma versão antiga do currículo).
  2. Calcula score (0–5), recomendação (yes/maybe/no), motivos e dicas.
  3. POST /api/v1/jobs:score        → grava as avaliações em lote.

Quando o currículo muda, o app bumpa a versão e as vagas voltam a aparecer
no for-scoring — não é preciso nada deste script mudar.

Uso:
    VAGAS_BASE=http://localhost:8000 VAGAS_API_KEY=devkey python3 scripts/score_agent.py
"""

import json
import os
import re
import sys
import unicodedata
import urllib.request

BASE = os.environ.get("VAGAS_BASE", "http://localhost:8000").rstrip("/")
API_KEY = os.environ.get("VAGAS_API_KEY", "")


def _norm(text: str) -> str:
    text = (text or "").lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9\s]", " ", text)


def request(method: str, path: str, body: dict | None = None) -> dict:
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "X-API-Key": API_KEY,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def cv_texto(cv: list[dict]) -> str:
    """Módulos do currículo viram um texto único apalavrado para o match."""
    partes = []
    for mod in cv:
        for it in mod.get("items", []):
            if mod.get("kind") == "entries":
                for campo in ("title", "org", "body"):
                    if (it.get(campo) or "").strip():
                        partes.append(it[campo])
            elif (it.get("value") or "").strip():
                partes.append(it["value"])
    return " ".join(partes)


def habilidades(cv: list[dict]) -> list[str]:
    """Extrai os termos mais importantes do currículo: competências, resumo,
    títulos de experiência — o 'núcleo' que um agente de verdade pesaria."""
    sinais = {
        "competencias",
        "resumo",
        "experiencia",
        "projetos",
        "idiomas",
        "formacao",
    }
    termos: list[str] = []
    for mod in cv:
        if mod.get("key") not in sinais:
            continue
        for it in mod.get("items", []):
            if mod.get("kind") == "entries":
                for campo in ("title", "org", "context", "body"):
                    termos.extend(re.findall(r"[A-Za-zÀ-ú][\w+#.-]{1,}", it.get(campo) or ""))
            else:
                termos.extend(re.findall(r"[A-Za-zÀ-ú][\w+#.-]{1,}", it.get("value") or ""))
    # dedupe mantendo a ordem; remove ruído curto
    vistos: set[str] = set()
    limpos: list[str] = []
    for t in termos:
        low = t.lower()
        if len(low) < 3 or low in vistos:
            continue
        vistos.add(low)
        limpos.append(low)
    return limpos


def avaliar_vaga(cv: list[dict], vaga: dict) -> dict:
    """O 'coração' do ranqueador. A heurística aqui é encharcada de propósito:
    o agente de verdade (muse.ai/hermes/LLM) troca só este trecho."""
    alvo = _norm(" ".join([vaga["title"], vaga.get("company", ""),
                           vaga.get("location", ""), vaga.get("notes", "")]))
    termos = habilidades(cv)
    alvo_tokens = set(alvo.split())

    # termos do currículo presentes no anúncio
    presentes = [t for t in termos if t in alvo_tokens or any(t in w for w in alvo_tokens)]
    cobertura = len(presentes) / max(1, len(termos))

    score = round(4.4 * min(1.0, cobertura * 2.0) +
                  1.0 * (len(presentes) >= 3) - 0.4 * (not vaga.get("location", "").strip() or "remoto" in _norm(vaga.get("location", ""))), 1)
    score = max(0.0, min(5.0, score))

    if score >= 3.5:
        recomendacao = "yes"
    elif score >= 2.5:
        recomendacao = "maybe"
    else:
        recomendacao = "no"

    motivo_base = (
        f"Está entre os {len(presentes)} termos do seu perfil já citados no anúncio: "
        f"{', '.join(presentes[:5])}" if presentes else
        "O anúncio não aponta para nenhuma habilidade do seu currículo."
    )
    dica = (
        "Tem match de perfil: mencione os projetos dessas tecnologias na apresentação."
        if recomendacao != "no" else
        "Sem sobreposição clara: vale só se você quiser mudar de direção."
    )

    return {
        "dedup_key": vaga["dedup_key"],
        "score": score,
        "recommendation": recomendacao,
        "reasons": [motivo_base],
        "tips": [dica],
        "scored_by": "score_agent_demo",
    }


def main() -> int:
    if not API_KEY:
        print("Defina VAGAS_API_KEY (e opcionalmente VAGAS_BASE).", file=sys.stderr)
        return 2

    envelope = request("GET", "/api/v1/jobs:for-scoring")
    cv, jobs = envelope["cv"], envelope["jobs"]
    print(f"currículo v{envelope['cv_version']}: {len(cv)} módulos · "
          f"{len(jobs)} vagas para avaliar")

    if not jobs:
        print("Nada a avaliar.")
        return 0

    evals = [avaliar_vaga(cv, vaga) for vaga in jobs]
    resp = request("POST", "/api/v1/jobs:score", {"evals": evals})
    print(f"enviadas: {resp.get('applied')} avaliações (cv_version {resp.get('cv_version')})")

    for e in sorted(evals, key=lambda x: x["score"], reverse=True):
        print(f"  {e['score']:>3} {e['recommendation']:>5}  {e['dedup_key']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())