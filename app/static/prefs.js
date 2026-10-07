/* Preferências de interface: fonte para dislexia (botão "Aa") e paleta de
   cor da versão clara (popover com as 3 combinações no botão de paleta).
   Roda no <head>, depois do theme.js, para os atributos estarem no <html>
   antes do primeiro pintar; monta e liga os botões quando o DOM estiver
   pronto. Tudo persistido no localStorage, como o tema e o idioma. */
(function () {
  var FONT_KEY = "vagas-font";
  var PALETTE_KEY = "vagas-palette";
  var PALETTES = ["creme", "gelo", "vidro"];
  /* fundo de cada paleta — acompanha o --bg do style.css, só para o
     <meta theme-color> do navegador não ficar com a cor errada */
  var PALETTE_BG = { creme: "#f4f1ec", gelo: "#eef1f6", vidro: "#f9f9f7" };
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
  function storedPalette() {
    var p = read(PALETTE_KEY);
    return PALETTES.indexOf(p) >= 0 ? p : "creme";
  }

  function darkNow() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") return true;
    if (attr === "light") return false;
    return mq.matches;
  }

  function applyPalette() {
    var p = storedPalette();
    var root = document.documentElement;
    // a paleta é um ajuste da versão clara: no escuro o atributo some, e a
    // escolha fica guardada para quando o tema claro voltar.
    if (p !== "creme" && !darkNow()) root.setAttribute("data-palette", p);
    else root.removeAttribute("data-palette");

    var meta = document.querySelector('meta[name="theme-color"][media*="prefers-color-scheme: light"]');
    if (meta && PALETTE_BG[p]) meta.setAttribute("content", PALETTE_BG[p]);

    paintPaletteButtons(p);
  }

  var PALETTE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>' +
    '<circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>' +
    '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>';

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
        '<div class="palette-pop" data-palette-pop hidden>';
      for (var j = 0; j < PALETTES.length; j++) {
        var id = PALETTES[j];
        html +=
          '<button type="button" class="palette-opt" data-palette-opt="' + id + '" aria-pressed="false">' +
          '<span class="palette-dot sw-' + id + '" aria-hidden="true"></span>' +
          "<span>" + t("palette_label_" + id) + "</span></button>";
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

  function paintPaletteButtons(current) {
    var opts = document.querySelectorAll("[data-palette-opt]");
    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      opt.setAttribute("aria-pressed", opt.dataset.paletteOpt === current ? "true" : "false");
      if (opt.dataset.wired) continue;
      opt.dataset.wired = "1";
      opt.addEventListener("click", function () {
        write(PALETTE_KEY, this.dataset.paletteOpt);
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
  applyFont();
  applyPalette();

  // trocar de tema (botão ou sistema) reavalia a paleta: ela só existe no
  // claro, e o botão também some via CSS.
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
