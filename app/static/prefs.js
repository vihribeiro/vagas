/* Preferências de interface: fonte para dislexia (botão "Aa") e paleta de
   cor — 3 combinações para o tema claro e 3 para o escuro (popover no botão
   de paleta da topbar). Escolher uma paleta também escolhe o modo (grupo
   Escuro liga o tema escuro, grupo Claro liga o claro) — o botão sol/lua
   não existe mais. Cada modo lembra a própria escolha. Roda no <head>,
   depois do theme.js, para os atributos estarem no <html> antes do primeiro
   pintar; monta e liga os botões quando o DOM estiver pronto. Tudo
   persistido no localStorage, como o tema e o idioma. */
(function () {
  var FONT_KEY = "vagas-font";
  var OLD_PALETTE_KEY = "vagas-palette";
  var LIGHT_PALETTE_KEY = "vagas-palette-light";
  var DARK_PALETTE_KEY = "vagas-palette-dark";
  var LIGHT_PALETTES = ["creme", "gelo", "vidro"];
  var DARK_PALETTES = ["escuro", "noite", "carvao"];
  /* fundo de cada paleta — acompanha o --bg do style.css, só para o
     <meta theme-color> do navegador não ficar com a cor errada */
  var LIGHT_BG = { creme: "#f4f1ec", gelo: "#eef1f6", vidro: "#f9f9f7" };
  var DARK_BG = { escuro: "#17161b", noite: "#12151c", carvao: "#0b0b0d" };
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  // i18n.js carrega antes deste arquivo no <head>; o t() traduz os rótulos e
  // cai na chave crua se, por algum motivo, não estiver disponível.
  var t = (window.I18N && I18N.t) ? I18N.t : function (k) { return k; };

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  /* a versão antiga guardava UMA paleta (só do claro) na chave "vagas-palette";
     migra para a chave do tema claro na primeira visita. */
  function migratePalette() {
    if (read(LIGHT_PALETTE_KEY) !== null) return;
    var old = read(OLD_PALETTE_KEY);
    if (!old) return;
    write(LIGHT_PALETTE_KEY, old);
    try { localStorage.removeItem(OLD_PALETTE_KEY); } catch (e) {}
  }

  /* ------------------------------------------------------------- fonte */
  function fontOn() {
    return read(FONT_KEY) === "dyslexic";
  }

  function applyFont() {
    var on = fontOn();
    if (on) document.documentElement.setAttribute("data-font", "dyslexic");
    else document.documentElement.removeAttribute("data-font");
    return on;
  }

  function paintFontButtons() {
    var on = applyFont();
    var label = on ? t("font_dyslexic_off") : t("font_dyslexic_on");
    var btns = document.querySelectorAll("[data-font-toggle]");
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      if (btn.dataset.wired) continue;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function () {
        write(FONT_KEY, fontOn() ? "normal" : "dyslexic");
        paintFontButtons();
      });
    }
  }

  /* ------------------------------------------------------------- paleta */
  function storedPalette(dark) {
    var key = dark ? DARK_PALETTE_KEY : LIGHT_PALETTE_KEY;
    var list = dark ? DARK_PALETTES : LIGHT_PALETTES;
    var p = read(key);
    return list.indexOf(p) >= 0 ? p : (dark ? "escuro" : "creme");
  }

  function darkNow() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") return true;
    if (attr === "light") return false;
    return mq.matches;
  }

  function applyPalette() {
    var dark = darkNow();
    var p = storedPalette(dark);
    var root = document.documentElement;
    // o atributo só marca a paleta "alternativa" de cada modo: os padrões
    // (creme no claro, escuro no escuro) são o próprio CSS base e não
    // precisam de marcação — assim as paletas escuras jamais vazam pro claro.
    var plain = dark ? (p === "escuro") : (p === "creme");
    if (plain) root.removeAttribute("data-palette");
    else root.setAttribute("data-palette", p);

    var media = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"][media*="prefers-color-scheme: ' + media + '"]');
    var color = (dark ? DARK_BG : LIGHT_BG)[p];
    if (meta && color) meta.setAttribute("content", color);

    paintPaletteButtons(dark, p);
  }

  var PALETTE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>' +
    '<circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>' +
    '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>';

  function optHTML(id, mode) {
    return (
      '<button type="button" class="palette-opt" data-palette-opt="' + id + '" data-palette-mode="' + mode +
      '" aria-pressed="false">' +
      '<span class="palette-dot sw-' + id + '" aria-hidden="true"></span>' +
      "<span>" + t("palette_label_" + id) + "</span></button>"
    );
  }

  // o wrap já está nos templates (uma linha por página); o botão e o
  // popover são montados aqui para não triplicar o markup em 3 templates.
  function buildPaletteUI() {
    var hosts = document.querySelectorAll("[data-palette-host]");
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      if (host.dataset.built) continue;
      host.dataset.built = "1";
      var html =
        '<button type="button" class="icon-btn" data-palette-toggle aria-haspopup="true" aria-expanded="false"' +
        ' aria-label="' + t("palette_aria") + '" title="' + t("palette_aria") + '">' + PALETTE_ICON + "</button>" +
        '<div class="palette-pop" data-palette-pop hidden>' +
        '<div class="palette-label">' + t("palette_group_light") + "</div>";
      for (var j = 0; j < LIGHT_PALETTES.length; j++) {
        html += optHTML(LIGHT_PALETTES[j], "light");
      }
      html += '<div class="palette-label">' + t("palette_group_dark") + "</div>";
      for (var k = 0; k < DARK_PALETTES.length; k++) {
        html += optHTML(DARK_PALETTES[k], "dark");
      }
      host.innerHTML = html + "</div>";
    }
  }

  function closePop() {
    var pops = document.querySelectorAll("[data-palette-pop]");
    for (var i = 0; i < pops.length; i++) pops[i].hidden = true;
    var togglers = document.querySelectorAll("[data-palette-toggle]");
    for (var j = 0; j < togglers.length; j++) togglers[j].setAttribute("aria-expanded", "false");
  }

  function paintPaletteButtons(dark, current) {
    var opts = document.querySelectorAll("[data-palette-opt]");
    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      var selected = opt.dataset.paletteMode === (dark ? "dark" : "light") && opt.dataset.paletteOpt === current;
      opt.setAttribute("aria-pressed", selected ? "true" : "false");
      if (opt.dataset.wired) continue;
      opt.dataset.wired = "1";
      opt.addEventListener("click", function () {
        var mode = this.dataset.paletteMode;
        write(mode === "dark" ? DARK_PALETTE_KEY : LIGHT_PALETTE_KEY, this.dataset.paletteOpt);
        // escolher a paleta também escolhe o modo: o grupo Escuro liga o
        // tema escuro, o grupo Claro liga o claro (substitui o botão
        // sol/lua que saiu da topbar).
        if (window.VagasTheme && VagasTheme.set) VagasTheme.set(mode);
        applyPalette();
        closePop();
      });
    }

    var togglers = document.querySelectorAll("[data-palette-toggle]");
    for (var j = 0; j < togglers.length; j++) {
      var tog = togglers[j];
      if (tog.dataset.wired) continue;
      tog.dataset.wired = "1";
      tog.addEventListener("click", function (e) {
        e.stopPropagation(); // deixa o clique de fora fechar, este de abrir
        var pop = this.parentNode.querySelector("[data-palette-pop]");
        if (!pop) return;
        pop.hidden = !pop.hidden;
        this.setAttribute("aria-expanded", pop.hidden ? "false" : "true");
      });
    }
  }

  /* o popover fecha em clique fora e em Escape */
  document.addEventListener("click", function (e) {
    var pop = document.querySelector("[data-palette-pop]");
    if (!pop || pop.hidden) return;
    if (e.target.closest && e.target.closest("[data-palette-pop], [data-palette-toggle]")) return;
    closePop();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePop();
  });

  /* ---------------------------------------------------------------- boot */
  migratePalette();
  applyFont();
  applyPalette();

  // trocar de tema (botão ou sistema) reavalia a paleta: cada modo tem a
  // sua escolha, e o atributo acompanha o modo efetivo.
  if (window.MutationObserver) {
    new MutationObserver(applyPalette).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  if (mq.addEventListener) {
    mq.addEventListener("change", applyPalette);
  } else if (mq.addListener) {
    mq.addListener(applyPalette);
  }

  function boot() {
    buildPaletteUI();
    paintFontButtons();
    applyPalette();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();