## Resumo

O que esta mudança faz e por quê.

## Mudanças

- [ ] Backend (`app/main.py`, `cv_parser.py`, ...)
- [ ] Frontend (`app/static/*`, `app/templates/*`, ...)
- [ ] Docs (`docs/API.md`, `docs/SCORING.md`, `docs/MUSE_AI.md`, README)
- [ ] Infra (Dockerfile, docker-compose, scripts)

## Testes feitos

- [ ] `docker compose up -d --build` (ou uvicorn local) sem erros
- [ ] API: `healthz`, `bulk`, `for-scoring`, `score` (curl)
- [ ] Painel: Lista, Deslizar, detalhe, tema escuro, currículo
- [ ] Comportamento sem ranqueador configurado continua OK

## Checklist

- [ ] Frontend mudou → `ASSET_VERSION` (main.py) **e** `V`/`CACHE` (sw.js)
      bumpados juntos
- [ ] API/contrato mudou → docs atualizados
- [ ] Nenhum segredo ou dado pessoal no diff (`.env` continua fora)
- [ ] Branch base: `main`

## Notas

Qualquer observação para o revisor.