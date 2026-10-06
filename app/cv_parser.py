"""Le um currículo em PDF e separa em módulos usáveis em formulário de candidatura.

Abordagem: extrai o texto linha a linha, acha os cabeçalhos de seção em caixa
alta e fatia o documento neles. Dentro de cada seção o texto vira campos
(rótulo/valor) ou entradas (título/org/contexto/período/descrição/links).

O parser é afinado ao formato de currículo brasileiro em uma coluna, que é o
formato deste documento. Onde ele não reconhece um bloco, devolve o texto cru
em vez de inventar, e o app sempre mostra o resultado como prévia para a pessoa
revisar antes de salvar — nada é gravado direto no banco.

Cada seção de lista tem seu próprio sinal de início de entrada:
- ``period``: uma linha de período ("2023 – atual", "Concluído em 2026")
- ``dash``:  uma linha com travessão ("Seller Hub — Painel de Vendas")
- ``year``:  uma linha de ano solta na linha seguinte
"""

import io
import re
import unicodedata

# ------------------------------------------------------------------ módulo

# (chave, rótulo, tipo, comofatiar_lista)
#   tipo: "fields" | "text" | "entries"
MODULES = [
    ("dados_pessoais", "Dados pessoais", "fields", None),
    ("contato", "Contato", "fields", None),
    ("redes", "Redes", "fields", None),
    ("resumo", "Resumo profissional", "text", None),
    ("disponibilidade", "Disponibilidade", "fields", None),
    ("formacao", "Formação", "entries", "period"),
    ("experiencia", "Experiência", "entries", "period"),
    ("projetos", "Projetos", "entries", "dash"),
    ("competencias", "Competências", "fields", None),
    ("idiomas", "Idiomas", "fields", None),
    ("cursos", "Cursos", "entries", "year"),
]

# Campos que o PDF nunca traz, mas formulário de candidatura BR pede. Começam
# vazios para a pessoa preencher uma vez só.
EXTRA_FIELDS = {
    "disponibilidade": [
        ("CPF", ""),
        ("Data de nascimento", ""),
        ("Estado civil", ""),
        ("Pretensão salarial", ""),
        ("Disponibilidade para início", ""),
        ("Possui CNH", ""),
        ("Número de dependentes", ""),
    ],
}

# cabeçalho de seção -> chave do módulo. Comparado sem acento, em caixa alta.
SECTION_MAP = {
    "RESUMO PROFISSIONAL": "resumo",
    "RESUMO": "resumo",
    "SOBRE": "resumo",
    "PERFIL": "resumo",
    "OBJETIVO": "resumo",
    "FORMACAO": "formacao",
    "FORMACAO ACADEMICA": "formacao",
    "EDUCACAO": "formacao",
    "EXPERIENCIA": "experiencia",
    "EXPERIENCIA PROFISSIONAL": "experiencia",
    "EXPERIENCIAS": "experiencia",
    "HISTORICO PROFISSIONAL": "experiencia",
    "PROJETOS": "projetos",
    "PORTFOLIO": "projetos",
    "COMPETENCIAS": "competencias",
    "COMPETENCIAS TECNICAS": "competencias",
    "HABILIDADES": "competencias",
    "HABILIDADES TECNICAS": "competencias",
    "SKILLS": "competencias",
    "TECNOLOGIAS": "competencias",
    "STACK": "competencias",
    "IDIOMAS": "idiomas",
    "CURSOS": "cursos",
    "CERTIFICACOES": "cursos",
    "CERTIFICADOS": "cursos",
    "TREINAMENTOS": "cursos",
}

EM_DASH = "—"          # travessão: separa "Nome — Descrição"
EN_DASH = "–"          # meia-rígua: "2023 – atual"
MID_DOT = "·"          # ponto médio: separador de lista
DASHES = EM_DASH + EN_DASH + "‒―−"

# ------------------------------------------------------------------ helpers


def _deaccent(text: str) -> str:
    norm = unicodedata.normalize("NFD", text or "")
    return "".join(c for c in norm if unicodedata.category(c) != "Mn")


def _key(text: str) -> str:
    """Normaliza um cabeçalho para comparação: sem acento, caixa alta, só letras."""
    letters = "".join(
        c for c in _deaccent(text or "").upper() if c.isalpha() or c.isspace()
    )
    return re.sub(r"\s+", " ", letters).strip()


def clean_lines(pdf_bytes: bytes) -> list[str]:
    """Extrai o texto do PDF em linhas.

    Usa PyMuPDF porque ele preserva a quebra de linha visual. O pypdf cola a
    linha seguinte na anterior quando o texto está em colunas lado a lado, o
    que destrói justamente a informação de estrutura que o parser usa.
    """
    import fitz

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        raw = "\n".join(page.get_text("text") for page in doc)
    raw = raw.replace("ﬁ", "fi").replace("ﬂ", "fl")
    raw = re.sub(r"[ \t ]+", " ", raw)
    lines = [ln.strip() for ln in raw.split("\n")]
    return [ln for ln in lines if ln]


def split_sections(
    lines: list[str],
) -> tuple[list[str], dict[str, list[str]], dict[str, list[str]]]:
    """Separa o cabeçalho (antes da primeira seção) das seções.

    Devolve (cabeçalho, seções conhecidas, seções desconhecidas). Seções em
    caixa alta não reconhecidas vêm à parte para o app mostrar, em vez de
    sumirem em silêncio.
    """
    header: list[str] = []
    sections: dict[str, list[str]] = {}
    unknown: dict[str, list[str]] = {}
    current: str | None = None
    unknown_current: str | None = None
    seen_first = False

    for line in lines:
        norm = _key(line)
        target = SECTION_MAP.get(norm)
        looks_like_header = (
            len(line) <= 42
            and 1 <= len(norm.split()) <= 5
            and line.upper() == line
            and any(ch.isalpha() for ch in line)
        )

        if target is not None and not seen_first and not sections:
            # primeira seção reconhecida: o que veio antes é o cabeçalho
            seen_first = True
            current = target
            sections[current] = []
            unknown_current = None
            continue

        if target is not None:
            current = target
            unknown_current = None
            sections.setdefault(current, [])
            continue

        if looks_like_header and current is None:
            header.append(line)
            continue

        if looks_like_header:
            # seção desconhecida no meio do documento: guarda à parte
            unknown_current = line
            unknown[line] = []
            current = None
            continue

        if unknown_current is not None:
            unknown[unknown_current].append(line)
        elif current is not None:
            sections[current].append(line)
        else:
            header.append(line)

    return header, sections, unknown


# ------------------------------------------------------------------ header

RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
RE_PHONE = re.compile(r"\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}")
RE_CITY = re.compile(r"^[A-ZÀ-Ú][\w\s]{2,40}\s*[—–-]\s*[A-Z]{2}$")
SOCIAL_LABELS = ("Site", "LinkedIn", "GitHub", "Portfolio", "Portfólio")


def _split_pipes(line: str) -> list[str]:
    return [p.strip(" |" + MID_DOT) for p in line.split("|") if p.strip(" |" + MID_DOT)]


def parse_header(header_lines: list[str]) -> dict[str, list[dict]]:
    """Nome, cargo, cidade, telefone, e-mail e redes vêm do bloco inicial."""
    data: dict[str, list[dict]] = {
        "dados_pessoais": [],
        "contato": [],
        "redes": [],
    }
    if not header_lines:
        return data

    data["dados_pessoais"].append(
        {"label": "Nome completo", "value": header_lines[0].strip()}
    )
    if len(header_lines) > 1:
        data["dados_pessoais"].append(
            {"label": "Cargo", "value": header_lines[1].strip()}
        )

    for line in header_lines[2:]:
        email = RE_EMAIL.search(line)
        if email:
            data["contato"].append({"label": "E-mail", "value": email.group(0)})
        for phone in RE_PHONE.findall(line):
            clean = re.sub(r"\s+", " ", phone).strip()
            data["contato"].append({"label": "Telefone", "value": clean})

        hit_social = False
        for label in SOCIAL_LABELS:
            m = re.search(rf"{label}\s*:\s*([^|]+)", line, re.I)
            if m:
                value = m.group(1).strip().strip("|").lstrip(":").strip()
                if value:
                    data["redes"].append({"label": label, "value": value})
                    hit_social = True

        if not email and not RE_PHONE.search(line) and not hit_social:
            for piece in _split_pipes(line):
                if RE_CITY.match(piece):
                    city, _, uf = re.split(r"[—–-]", piece, maxsplit=1)
                    data["dados_pessoais"].append(
                        {"label": "Cidade/UF", "value": f"{city.strip()} - {uf.strip()}"}
                    )
                    break

    return _dedupe_fields(data)


def _dedupe_fields(data: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """Mantém a primeira ocorrência de cada rótulo."""
    out: dict[str, list[dict]] = {}
    for key, items in data.items():
        seen, uniq = set(), []
        for it in items:
            label = (it.get("label") or "").lower()
            if label in seen:
                continue
            seen.add(label)
            uniq.append(it)
        out[key] = uniq
    return out


# ------------------------------------------------------------------ seções simples


def parse_resumo(lines: list[str]) -> str:
    return " ".join(lines).strip()


def parse_labeled(lines: list[str]) -> list[dict]:
    """Competências: junta linhas de continuação e quebra em rótulo/valor.

    "Frontend: Angular, TypeScript" numa linha, continuação na seguinte.
    """
    fields: list[dict] = []
    current: str | None = None
    buffer: list[str] = []

    def flush() -> None:
        if current and buffer:
            fields.append({"label": current, "value": " ".join(buffer).strip()})

    for line in lines:
        m = re.match(r"^([A-Za-zÀ-ú/ ()]{2,28}):\s*(.+)$", line)
        if m:
            flush()
            current = m.group(1).strip()
            buffer = [m.group(2).strip()]
        elif current:
            buffer.append(line)
        else:
            fields.append({"label": "", "value": line})
    flush()
    return [f for f in fields if f["value"]]


def parse_idiomas(lines: list[str]) -> list[dict]:
    """Idiomas vêm como "Português (nativo) · Inglês (intermediário — 115h)"."""
    fields = []
    for part in _split_mid_dots(" ".join(lines)):
        part = part.strip(" .")
        if not part:
            continue
        m = re.match(r"^([A-Za-zÀ-úçÇãõáéíóú\s]{2,30}?)\s*\((.+)\)$", part)
        if m:
            fields.append({"label": m.group(1).strip(), "value": m.group(2).strip()})
        else:
            fields.append({"label": "Idioma", "value": part})
    return fields


def _split_mid_dots(text: str) -> list[str]:
    return [p.strip(" " + MID_DOT) for p in text.split(MID_DOT) if p.strip(" " + MID_DOT)]


# ------------------------------------------------------------------ entradas

RE_PERIOD = re.compile(
    r"^[\s\d]{0,10}(?:19|20)\d{2}\s*[%s]\s*(?:atual|presente|(?:19|20)\d{2})?$" % DASHES,
    re.I,
)
RE_STATUS_YEAR = re.compile(
    r"^(?:Conclu[íi]do(?: em)?|Em andamento|Cursando|Prev[íi]s?)\b.*?(?:19|20)\d{2}", re.I
)
RE_BARE_YEAR = re.compile(r"^(?:19|20)\d{2}$")
RE_LINK_LINE = re.compile(r"(?:Demo|C[óo]digo|Reposit[óo]rio|Live|Vercel|Link)\s*:", re.I)


def _looks_like_stack(line: str) -> bool:
    """Linha de stack: lista separada por ponto médio e sem fim de frase."""
    return MID_DOT in line and not line.rstrip().endswith((".", ",", ";"))


def _looks_like_subtitle(line: str) -> bool:
    """Linha curta sem pontuação final: cabe como subtítulo ao lado do título."""
    stripped = line.strip()
    return 0 < len(stripped) <= 72 and not stripped.endswith((".", ",", ";", ":"))


def _split_title_dash(line: str) -> tuple[str, str]:
    """'Seller Hub — Painel de Vendas' -> ('Seller Hub', 'Painel de Vendas')."""
    head, sep, rest = line.partition(EM_DASH)
    if sep and head.strip() and rest.strip():
        return head.strip(), rest.strip()
    return line.strip(), ""


def _entries_period(lines: list[str]) -> list[dict]:
    """Experiência e formação.

    A linha de período é a âncora: o título é a linha imediatamente acima e o
    subtítulo, a linha acima dessa (se parecer com subtítulo). Tudo entre a
    âncora e o título seguinte é descrição.
    """
    anchors = [
        i
        for i, ln in enumerate(lines)
        if RE_PERIOD.match(ln) or RE_STATUS_YEAR.match(ln)
    ]
    if not anchors:
        return []

    # cabeçalhos primeiro, para saber onde cada descrição começa e termina
    headers: list[list[str]] = []
    for a in anchors:
        head = [lines[a - 1].strip()] if a >= 1 else []
        if len(head) == 1 and a >= 2 and _looks_like_subtitle(lines[a - 2]):
            head.insert(0, lines[a - 2].strip())
        headers.append(head)

    entries = []
    for k, a in enumerate(anchors):
        body_start = a + 1
        if k + 1 < len(anchors):
            # stop exclusivo: o cabeçalho da próxima entrada começa em
            # anchor - len(header), então o corpo vai até essa linha.
            body_end = anchors[k + 1] - len(headers[k + 1])
        else:
            body_end = len(lines)
        head = headers[k]
        if not head:
            continue
        # O travessão no título nomeia a empresa; a linha seguinte, quando existe,
        # é a organização de novo com outro formato (ex.: "Instituto Mackenzie").
        title, context = _split_title_dash(head[0])
        entries.append(
            {
                "title": title,
                "org": head[1] if len(head) > 1 else "",
                "context": context,
                "period": lines[a].strip(),
                "body": " ".join(lines[body_start : max(body_start, body_end)]).strip(),
                "links": "",
            }
        )
    return entries


def _entries_dash(lines: list[str]) -> list[dict]:
    """Projetos: cada entrada abre com uma linha contendo travessão.

    Depois do título vem a linha de stack (separada por ponto médio), a
    descrição e, por fim, linhas de Demo/Código.
    """
    anchors = [i for i, ln in enumerate(lines) if EM_DASH in ln]
    entries = []
    for k, a in enumerate(anchors):
        stop = anchors[k + 1] if k + 1 < len(anchors) else len(lines)
        chunk = lines[a + 1 : stop]
        title, subtitle = _split_title_dash(lines[a])

        stack = ""
        if chunk and _looks_like_stack(chunk[0]):
            stack = chunk[0].strip()
            chunk = chunk[1:]

        links, body = [], []
        for ln in chunk:
            (links if RE_LINK_LINE.search(ln) else body).append(ln.strip())

        entries.append(
            {
                "title": title,
                "org": stack,
                "context": subtitle,
                "period": "",
                "body": " ".join(body).strip(),
                "links": " ".join(links).strip(),
            }
        )
    return entries


def _entries_year(lines: list[str]) -> list[dict]:
    """Cursos: a entrada abre na linha imediatamente anterior a um ano solto.

    A primeira entrada do currículo não tem ano, então a linha 0 também conta
    como início.
    """
    anchors = []
    for i, ln in enumerate(lines):
        if i == 0:
            anchors.append(i)
        elif i + 1 < len(lines) and RE_BARE_YEAR.match(lines[i + 1].strip()):
            anchors.append(i)

    entries = []
    for k, a in enumerate(anchors):
        stop = anchors[k + 1] if k + 1 < len(anchors) else len(lines)
        chunk = lines[a : stop]
        if not chunk:
            continue
        title, subtitle = _split_title_dash(chunk[0])
        rest = chunk[1:]

        period = ""
        if rest and RE_BARE_YEAR.match(rest[0].strip()):
            period = rest[0].strip()
            rest = rest[1:]

        entries.append(
            {
                "title": title,
                "org": subtitle,
                "context": "",
                "period": period,
                "body": " ".join(rest).strip(),
                "links": "",
            }
        )
    return entries


ENTRY_SPLITTERS = {
    "period": _entries_period,
    "dash": _entries_dash,
    "year": _entries_year,
}


# ------------------------------------------------------------------ topo


def parse_cv(pdf_bytes: bytes) -> dict:
    """PDF -> {"modules": {...}, "unmapped": [...]} pronto para a prévia."""
    lines = clean_lines(pdf_bytes)
    header_lines, sections, unknown = split_sections(lines)

    modules: dict[str, object] = {}
    modules.update(parse_header(header_lines))

    for key, _label, kind, splitter in MODULES:
        if kind != "entries":
            continue
        body = sections.get(key) or []
        modules[key] = ENTRY_SPLITTERS[splitter](body) if body else []

    for key, _label, kind, _splitter in MODULES:
        if key in modules:
            continue
        body = sections.get(key) or []
        if kind == "text":
            modules[key] = parse_resumo(body)
        elif kind == "fields":
            modules[key] = parse_idiomas(body) if key == "idiomas" else parse_labeled(body)
        else:
            modules[key] = []

    # campos que o PDF não traz
    for key, pairs in EXTRA_FIELDS.items():
        existing = {(f.get("label") or "").lower() for f in modules.get(key, [])}
        for label, value in pairs:
            if label.lower() not in existing:
                modules.setdefault(key, []).append({"label": label, "value": value})

    # forma final: todo módulo é lista de itens, texto vira um item só
    for key, _label, kind, _splitter in MODULES:
        val = modules.get(key)
        if kind == "text":
            modules[key] = [{"label": "", "value": val if isinstance(val, str) else ""}]
        elif not isinstance(val, list):
            modules[key] = []

    return {"modules": modules, "unmapped": list(unknown.keys())}
