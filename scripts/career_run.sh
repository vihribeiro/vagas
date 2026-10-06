#!/usr/bin/env bash
# Roda o career-ops e manda as vagas para o Vagas App.
#
# São três passos, e só o primeiro é automático:
#
#   1. node scan.mjs        varre os boards e joga em data/pipeline.md
#                           (zero-token, sem IA, roda sozinho)
#   2. avaliação A–F        lê a JD de cada vaga e dá a nota. PRECISA de uma
#                           sessão de CLI de IA (Claude Code, Codex, OpenCode).
#                           Não é um script: é o motivo de o career-ops existir.
#                           Sem essa sessão, as vagas ficam no pipeline sem score.
#   3. career_sync.py       manda o pipeline + o tracker pro app, pela API
#
# Este script faz 1 e 3. O passo 2 é manual por natureza — mas o script
# imprime o reminder no final, porque é o passo que alguém esquece.
#
# Uso:
#   VAGAS_BASE=https://vagas.exemplo VAGAS_API_KEY=xxx ./scripts/career_run.sh
#   VAGAS_BASE=https://vagas.exemplo VAGAS_API_KEY=xxx ./scripts/career_run.sh --dry-run
#
# Sem VAGAS_API_KEY o script falha antes de rodar o scan: melhor não varrer
# 700 vagas para descobrir no fim que não tinha para onde enviar.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAREER="$ROOT/career-ops"
SYNC="$ROOT/scripts/career_sync.py"
BASE="${VAGAS_BASE:-http://127.0.0.1:8000}"
KEY="${VAGAS_API_KEY:-}"
DRY=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY="--dry-run" ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "$KEY" ]; then
  cat >&2 <<'MSG'
erro: VAGAS_API_KEY vazia.

O scan gasta rede para varrer as empresas; sem chave não há para onde enviar o
resultado, e o passo é desperdiçado. A chave é a mesma do servidor — a env
VAGAS_API_KEY do .env lá (ver README, "Variáveis de ambiente").

  VAGAS_BASE=https://seu-servidor VAGAS_API_KEY=$(openssl rand -hex 32) ./scripts/career_run.sh
MSG
  exit 2
fi

if [ ! -d "$CAREER" ]; then
  echo "erro: $CAREER não existe. O career-ops é a sua ferramenta local de
  varredura (não acompanha este repositório público)." >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || {
  echo "erro: node não está no PATH (necessário para o scan)." >&2; exit 2;
}

echo "==> 1/3  varredura dos boards (sem IA)"
cd "$CAREER"
if [ -n "$DRY" ]; then
  node scan.mjs --dry-run | tail -12
else
  node scan.mjs
fi

echo
echo "==> 2/3  avaliação A–F  (PRECISA de CLI de IA)"
cat <<'MSG'
    Esta etapa não é um script. Abra uma sessão do Claude Code, Codex ou
    OpenCode na pasta career-ops/ e rode:

        /career-ops pipeline

    Ele lê cada URL pendente em data/pipeline.md, avalia contra cv.md,
    config/profile.yml e modes/_brief.md, e grava o score em
    data/applications.md. Vaga sem avaliação fica sem score e não ordena
    na lista do app.
MSG

echo
echo "==> 3/3  envio para o app"
python3 "$SYNC" --base "$BASE" --api-key "$KEY" --tracker $DRY

echo
echo "próximo passo: rodar a avaliação A–F (passo 2) e repetir o 3/3 com --tracker"