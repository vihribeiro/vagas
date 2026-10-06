# Extensão do Chrome — LinkedIn → Vagas

Captura vagas do LinkedIn para o painel de vagas e preenche os formulários do
Easy Apply para você **revisar antes de enviar** (nunca envia sozinho).

Feita para uso pessoal, dentro dos termos do projeto: **curadoria manual, baixo
volume, nada de automatizar além disso** — sem coleta em massa, sem auto-apply,
sem reler nada que não seja a página de vagas que você já está vendo.

## O que ela faz

1. **Busca `/jobs`:** um botão **﹢** no canto de cada card envia a vaga para o
   painel via `POST /api/v1/jobs:bulk` (a origem fica `linkedin`). O botão
   mostra ✓ (enviada), ✓ âmbar (já existia — o dedup por título+empresa
   derruba duplicadas) ou ✗ (erro).
2. **Página de detalhe da vaga:** botão flutuante **"＋ Enviar pra vagas"** no
   canto inferior direito.
3. **Easy Apply:** quando o modal de candidatura abre, a extensão preenche os
   campos com as respostas do seu modelo (em **Opções**). Campo de texto,
   seletor e Sim/Não. **O clique em "Enviar candidatura" é sempre seu.**

> O envio acontece no service worker, com a chave que você cola nas opções —
> nada é lido da sua sessão do LinkedIn.

## Instalar (carregar sem publicar)

1. `chrome://extensions`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. **Carregar sem compactação** → selecione a pasta `extension/` deste repo
4. Clique no ícone da extensão → **Opções**:
   - **URL do painel:** `https://vagas.av-house.com` (padrão)
   - **Chave de API:** o valor de `VAGAS_API_KEY` no `.env` do servidor
   - **Respostas do Easy Apply:** uma linha por pergunta, `palavra => resposta`
   - **Testar conexão** para validar servidor + chave

Depois é só navegar em `https://www.linkedin.com/jobs/` e usar os botões ﹢.

## Notas honestas

- **O LinkedIn muda a estrutura da página com frequência.** Os seletores têm
  fallback e a injeção é idempotente, mas se um botão sumir ou “não ler” um
  card, é sinal de layout novo — ajuste os seletores no `content.js`.
- **Perguntas Sim/Não**: por padrão a extensão só responde quem tem resposta
  no seu modelo (ex.: `autorização => sim`, `visto,sponsorship => não`). Se
  quiser, dá para definir um padrão global (“Sim”/“Não”) nas opções.
- **Full width**: os campos de Upload de currículo (PDF) não são preenchidos —
  você anexa o arquivo.
- Mantenha a chave de API só com você. Este repo é público: ela fica apenas no
  `chrome.storage.local` do seu navegador, nunca no código.

## Arquivos

```
manifest.json   # Manifest V3: escopo, permissões e host_permissions
background.js   # service worker: guarda config e faz o fetch da API
content.js      # botões nos cards/detalhe + autofill do Easy Apply
options.html    # página de opções (URL, chave, modelo de respostas)
options.js      # lógica das opções + "testar conexão"
```