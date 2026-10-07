/* i18n: português por padrão, com toggle para inglês.
   - expõe window.I18N.t(key[, params]) e window.I18N.lang para o JS;
   - aplica data-i18n / data-i18n-html / data-i18n-placeholder /
     data-i18n-aria / data-i18n-title / data-i18n-label no DOM;
   - o botão [data-lang-toggle] troca o idioma e recarrega a página (os
     dados vivem no banco/DOM, o shell inteiro é recarregado de novo).
   Carrega no <head>, antes do theme.js, para o t() estar pronto na hora. */
(function () {
  const KEY = "vagas-lang";

  const DICTS = {
    pt: {
      // login
      login_doc_title: "Vagas — Entrar",
      login_tagline: "Digite a senha para acessar o painel.",
      login_password: "Senha",
      login_submit: "Entrar",
      login_wrong_password: "Senha incorreta.",

      // comum
      common_curriculo: "Currículo",
      common_sair: "Sair",
      source_other: "outro",
      loading: "Carregando",
      loading_wait: "Aguarde um instante.",

      // painel (lista/deslizar)
      nav_view_aria: "Modo de visualização",
      view_swipe: "Deslizar",
      view_list: "Lista",
      search_label: "Buscar vagas",
      search_placeholder: "Título, empresa ou local",
      search_clear_aria: "Limpar busca",
      source_row_label: "Origem",
      source_filter_aria: "Filtrar por origem",
      status_filter_aria: "Filtrar por status",
      swipe_hint: "Deslize para o lado (ou use ← para candidatar, → para dispensar)",
      swipe_apply: "Candidatar",
      swipe_dismiss: "Dispensar",
      undo_aria: "Desfazer",
      app_offline_title: "Sem conexão",
      app_offline_body: "Não foi possível carregar as vagas.",
      app_empty_title: "Nada por aqui",
      app_empty_body: "Nenhuma vaga bate com esses filtros.",

      // abas e estados
      tab_all: "Todas",
      tab_pending: "Pendentes",
      tab_applied: "Candidatadas",
      tab_rejected: "Recusadas",
      tab_dismissed: "Dispensadas",
      status_pending: "Pendente",
      status_applied: "Candidatado",
      status_rejected: "Recusado",
      status_dismissed: "Dispensada",
      status_btn_pending: "Pendente",
      status_btn_applied: "Candidatei-me",
      status_btn_rejected: "Recusar",
      status_btn_dismissed: "Dispensar",
      reco_yes: "Aplicar",
      reco_maybe: "Considerar",
      reco_no: "Evitar",

      // detalhe da vaga
      detail_back: "Voltar",
      detail_email_date: "e-mail de {date}",
      detail_agent_eval: "Avaliação do agente",
      detail_scored_by: "por {who}",
      detail_reasons: "Motivos",
      detail_tips: "Dicas",
      detail_apply_where: "Onde se candidatar",
      detail_original: "Anúncio original",
      detail_google: "Buscar no Google",
      detail_status: "Status",
      detail_notes: "Anotações",
      detail_notes_label: "Anotações sobre a vaga",
      detail_notes_placeholder: "Ex.: me candidatei pelo site da empresa em 04/10",
      detail_save_notes: "Salvar anotações",
      detail_status_saved: "Status atualizado.",
      detail_notes_saved: "Anotações salvas.",
      detail_save_error: "Erro ao salvar.",
      job_delete: "Excluir vaga",
      job_delete_hint: "Remove a vaga e a avaliação dela do banco de dados — sem volta.",
      job_delete_btn: "Excluir",
      job_delete_confirm: "Excluir esta vaga? Isso não tem volta.",
      job_delete_fail: "Erro ao excluir a vaga.",

      // currículo
      cv_doc_title: "Currículo",
      cv_back_aria: "Voltar para as vagas",
      cv_nav_aria: "Módulos do currículo",
      cv_nav_title: "Módulos",
      cv_nav_open_aria: "Abrir lista de módulos",
      cv_intro: "Toque em <strong>copiar</strong> e cole direto no campo do site de candidatura. Cada módulo tem um botão que copia tudo de uma vez.",
      cv_import_btn: "Importar PDF",
      cv_import_reading: "Lendo o PDF",
      cv_copy_nothing: "Nada para copiar ainda",
      cv_copied: "Copiado",
      cv_copy_failed: "Não consegui copiar — selecione e copie à mão",
      cv_field_label: "Campo",
      cv_field_empty: "a preencher",
      cv_copy_aria: "Copiar {what}",
      cv_no_title: "Sem título",
      cv_entry: "entrada",
      cv_text_empty: "Resumo ainda não importado.",
      cv_none: "Sem itens.",
      cv_edit: "Editar",
      cv_empty_title: "Currículo vazio",
      cv_empty_body: "Importe um PDF para começar.",
      cv_saving: "Salvando",
      cv_save_fail: "Falha ao salvar",
      cv_saved: "Salvo",
      cv_saved_toast: "Currículo salvo",
      cv_save_offline: "Sem conexão para salvar",
      cv_label: "Rótulo",
      cv_value: "Valor",
      cv_title: "Título",
      cv_org: "Organização",
      cv_context: "Contexto",
      cv_period: "Período",
      cv_body: "Descrição",
      cv_links: "Links",
      cv_remove: "Remover",
      cv_new_entry: "Nova entrada",
      cv_resumo_label: "Resumo profissional",
      cv_add_field: "Adicionar campo",
      cv_add_entry: "Adicionar entrada",
      cv_savebar_save: "Salvar currículo",
      cv_savebar_cancel: "Cancelar",
      cv_import_review: "Revise antes de salvar",
      cv_import_note: "O parser é afinado ao formato deste currículo. Confira a tabela e ajuste o que estiver errado depois de salvar.",
      cv_import_unmapped: "Seções não reconhecidas (o texto delas não foi importado):",
      cv_import_caption: "Módulos lidos do PDF",
      cv_import_col_module: "Módulo",
      cv_import_col_items: "Itens",
      cv_import_col_filled: "Preenchidos",
      cv_import_save: "Salvar no currículo",
      cv_import_discard: "Descartar",
      cv_imported_ok: "Currículo importado do PDF",
      cv_imported_toast: "Currículo importado",
      cv_import_read_fail: "Não consegui ler esse PDF",
      cv_import_offline: "Sem conexão para enviar o PDF",
      cv_boot_note: "Nada importado ainda. Use <strong>Importar PDF</strong> para ler o currículo.",

      // erros da API do currículo (código → mensagem local)
      cv_module_unknown: "Módulo de currículo desconhecido",
      cv_items_not_list: "Os itens precisam ser uma lista",
      cv_modules_not_object: "'modules' precisa ser um objeto",
      cv_import_pdf: "Envie um arquivo .pdf",
      cv_import_empty: "Arquivo vazio",
      cv_import_too_big: "Arquivo maior que o limite permitido",
      cv_import_unreadable: "Não consegui ler o PDF",

      // modo deslizar
      swipe_reasons: "Motivos",
      swipe_tips: "Dicas do agente",
      swipe_no_eval: "Ainda sem avaliação do agente — importe o currículo e rode o ranqueador.",
      swipe_original: "Anúncio original",
      swipe_detail: "Ver detalhe",
      swipe_all_done: "Todas decididas",
      swipe_all_done_body: "Nenhuma vaga pendente. Volte para a lista para rever o que marcou.",
      swipe_view_list: "Ver lista",
      swipe_reg_fail: "Não consegui registrar — confira a conexão",
      swipe_undo_fail: "Não consegui desfazer — confira a conexão",

      // tema
      theme_light: "Ativar tema claro",
      theme_dark: "Ativar tema escuro",

      // acessibilidade (fonte e paleta)
      font_dyslexic_on: "Ativar fonte para dislexia",
      font_dyslexic_off: "Desativar fonte para dislexia",
      palette_aria: "Esquema de cores",
      palette_group_light: "Claro",
      palette_group_dark: "Escuro",
      palette_label_creme: "Creme",
      palette_label_gelo: "Gelo",
      palette_label_vidro: "Vidro",
      palette_label_escuro: "Escuro",
      palette_label_noite: "Noite",
      palette_label_carvao: "Carvão",
    },

    en: {
      login_doc_title: "Vagas — Sign in",
      login_tagline: "Enter the password to access the dashboard.",
      login_password: "Password",
      login_submit: "Sign in",
      login_wrong_password: "Incorrect password.",

      common_curriculo: "CV",
      common_sair: "Log out",
      source_other: "other",
      loading: "Loading",
      loading_wait: "One moment.",

      nav_view_aria: "View mode",
      view_swipe: "Swipe",
      view_list: "List",
      search_label: "Search jobs",
      search_placeholder: "Title, company or location",
      search_clear_aria: "Clear search",
      source_row_label: "Source",
      source_filter_aria: "Filter by source",
      status_filter_aria: "Filter by status",
      swipe_hint: "Swipe sideways (or use ← to apply, → to dismiss)",
      swipe_apply: "Apply",
      swipe_dismiss: "Dismiss",
      undo_aria: "Undo",
      app_offline_title: "No connection",
      app_offline_body: "Couldn't load jobs.",
      app_empty_title: "Nothing here",
      app_empty_body: "No jobs match these filters.",

      tab_all: "All",
      tab_pending: "Pending",
      tab_applied: "Applied",
      tab_rejected: "Rejected",
      tab_dismissed: "Dismissed",
      status_pending: "Pending",
      status_applied: "Applied",
      status_rejected: "Rejected",
      status_dismissed: "Dismissed",
      status_btn_pending: "Pending",
      status_btn_applied: "I applied",
      status_btn_rejected: "Reject",
      status_btn_dismissed: "Dismiss",
      reco_yes: "Apply",
      reco_maybe: "Consider",
      reco_no: "Avoid",

      detail_back: "Back",
      detail_email_date: "email from {date}",
      detail_agent_eval: "Agent evaluation",
      detail_scored_by: "by {who}",
      detail_reasons: "Reasons",
      detail_tips: "Tips",
      detail_apply_where: "Where to apply",
      detail_original: "Original listing",
      detail_google: "Search on Google",
      detail_status: "Status",
      detail_notes: "Notes",
      detail_notes_label: "Notes about this job",
      detail_notes_placeholder: "E.g., I applied on the company website on 10/04",
      detail_save_notes: "Save notes",
      detail_status_saved: "Status updated.",
      detail_notes_saved: "Notes saved.",
      detail_save_error: "Couldn't save.",
      job_delete: "Delete job",
      job_delete_hint: "Removes the job and its evaluation from the database — no undo.",
      job_delete_btn: "Delete",
      job_delete_confirm: "Delete this job? This can't be undone.",
      job_delete_fail: "Couldn't delete the job.",

      cv_doc_title: "CV",
      cv_back_aria: "Back to jobs",
      cv_nav_aria: "CV modules",
      cv_nav_title: "Modules",
      cv_nav_open_aria: "Open module list",
      cv_intro: "Tap <strong>copy</strong> and paste it directly into the job application field. Every module has a button that copies everything at once.",
      cv_import_btn: "Import PDF",
      cv_import_reading: "Reading the PDF",
      cv_copy_nothing: "Nothing to copy yet",
      cv_copied: "Copied",
      cv_copy_failed: "Couldn't copy — select and copy manually",
      cv_field_label: "Field",
      cv_field_empty: "to fill in",
      cv_copy_aria: "Copy {what}",
      cv_no_title: "No title",
      cv_entry: "entry",
      cv_text_empty: "Summary not imported yet.",
      cv_none: "No items.",
      cv_edit: "Edit",
      cv_empty_title: "Empty CV",
      cv_empty_body: "Import a PDF to get started.",
      cv_saving: "Saving",
      cv_save_fail: "Couldn't save",
      cv_saved: "Saved",
      cv_saved_toast: "CV saved",
      cv_save_offline: "No connection to save",
      cv_label: "Label",
      cv_value: "Value",
      cv_title: "Title",
      cv_org: "Organization",
      cv_context: "Context",
      cv_period: "Period",
      cv_body: "Description",
      cv_links: "Links",
      cv_remove: "Remove",
      cv_new_entry: "New entry",
      cv_resumo_label: "Professional summary",
      cv_add_field: "Add field",
      cv_add_entry: "Add entry",
      cv_savebar_save: "Save CV",
      cv_savebar_cancel: "Cancel",
      cv_import_review: "Review before saving",
      cv_import_note: "The parser is tuned to this CV's format. Check the table and fix anything wrong after saving.",
      cv_import_unmapped: "Unrecognized sections (their text was not imported):",
      cv_import_caption: "Modules read from the PDF",
      cv_import_col_module: "Module",
      cv_import_col_items: "Items",
      cv_import_col_filled: "Filled",
      cv_import_save: "Save to CV",
      cv_import_discard: "Discard",
      cv_imported_ok: "CV imported from PDF",
      cv_imported_toast: "CV imported",
      cv_import_read_fail: "Couldn't read that PDF",
      cv_import_offline: "No connection to send the PDF",
      cv_boot_note: "Nothing imported yet. Use <strong>Import PDF</strong> to read your CV.",

      cv_module_unknown: "Unknown CV module",
      cv_items_not_list: "Items must be a list",
      cv_modules_not_object: "'modules' must be an object",
      cv_import_pdf: "Please send a .pdf file",
      cv_import_empty: "Empty file",
      cv_import_too_big: "File larger than the allowed limit",
      cv_import_unreadable: "Couldn't read the PDF",

      swipe_reasons: "Reasons",
      swipe_tips: "Agent tips",
      swipe_no_eval: "No agent evaluation yet — import the CV and run the ranker.",
      swipe_original: "Original listing",
      swipe_detail: "View details",
      swipe_all_done: "All decided",
      swipe_all_done_body: "No pending jobs. Go back to the list to review what you marked.",
      swipe_view_list: "View list",
      swipe_reg_fail: "Couldn't register — check your connection",
      swipe_undo_fail: "Couldn't undo — check your connection",

      theme_light: "Switch to light theme",
      theme_dark: "Switch to dark theme",

      font_dyslexic_on: "Enable dyslexia font",
      font_dyslexic_off: "Disable dyslexia font",
      palette_aria: "Color scheme",
      palette_group_light: "Light",
      palette_group_dark: "Dark",
      palette_label_creme: "Cream",
      palette_label_gelo: "Ice",
      palette_label_vidro: "Glass",
      palette_label_escuro: "Dark",
      palette_label_noite: "Night",
      palette_label_carvao: "Charcoal",
    },
  };

  function detect() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "pt" || saved === "en") return saved;
    } catch (e) { /* storage indisponível: cai na detecção */ }
    const nav = (navigator.language || (navigator.languages && navigator.languages[0]) || "pt-BR").toLowerCase();
    return nav.indexOf("en") === 0 ? "en" : "pt";
  }

  const lang = detect();

  window.I18N = {
    lang: lang,
    locale: () => (lang === "en" ? "en-US" : "pt-BR"),
    t(key, params) {
      const dict = DICTS[lang] || DICTS.pt;
      let text = dict[key] !== undefined ? dict[key] : DICTS.pt[key];
      text = text !== undefined ? text : key;
      if (params) {
        text = text.replace(/\{(\w+)\}/g, (_, name) =>
          params[name] !== undefined ? String(params[name]) : "");
      }
      return text;
    },
    switchLang(next) {
      try { localStorage.setItem(KEY, next); } catch (e) {}
      location.reload();
    },
    applyStatic,
  };

  function parseParams(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* Aplica as traduções estáticas do DOM. Os textos dinâmicos (gerados por
     JS) já usam I18N.t() no momento em que são montados. */
  function applyStatic() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = I18N.t(el.getAttribute("data-i18n"),
        parseParams(el.getAttribute("data-i18n-params")));
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = I18N.t(el.getAttribute("data-i18n-html"),
        parseParams(el.getAttribute("data-i18n-params")));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", I18N.t(el.getAttribute("data-i18n-placeholder")));
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", I18N.t(el.getAttribute("data-i18n-aria")));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", I18N.t(el.getAttribute("data-i18n-title")));
    });
    document.querySelectorAll("[data-i18n-label]").forEach((el) => {
      el.setAttribute("data-label", I18N.t(el.getAttribute("data-i18n-label")));
    });
  }

  function wireToggle() {
    const next = lang === "pt" ? "en" : "pt";
    const label = lang === "pt" ? "English" : "Português";
    document.querySelectorAll("[data-lang-toggle]").forEach((btn) => {
      btn.textContent = lang === "pt" ? "EN" : "PT";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", () => I18N.switchLang(next));
    });
  }

  function boot() {
    document.documentElement.lang = lang;
    applyStatic();
    wireToggle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();