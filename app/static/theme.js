/* Tema claro/escuro.
   Roda no <head> para evitar flash de cor, e liga os botões ao carregar. */
(function () {
  var KEY = "vagas-theme";
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  // i18n.js carrega antes deste arquivo no <head>; o t() traduz a a11y dos
  // botões e cai na chave crua se, por algum motivo, não estiver disponível.
  var t = (window.I18N && I18N.t) ? I18N.t : function (k) { return k; };

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function apply() {
    var vt = stored();
    if (vt === "light" || vt === "dark") {
      document.documentElement.setAttribute("data-theme", vt);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  function current() {
    var vt = stored();
    if (vt === "light" || vt === "dark") return vt;
    return mq.matches ? "dark" : "light";
  }

  var SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>';

  var MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.8 6.8 0 0 0 9.7 9.7z"/></svg>';

  function paint() {
    var dark = current() === "dark";
    var btns = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      btn.innerHTML = dark ? SUN : MOON;
      var label = dark ? t("theme_light") : t("theme_dark");
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      if (btn.dataset.wired) continue;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function () {
        var next = current() === "dark" ? "light" : "dark";
        try { localStorage.setItem(KEY, next); } catch (e) {}
        apply();
        paint();
      });
    }
  }

  // se o tema do sistema mudar com a página aberta, o CSS acompanha sozinho
  // (é media query), mas o botão ficaria com ícone e rótulo velhos.
  function onSchemeChange() {
    apply();
    paint();
  }

  if (mq.addEventListener) {
    mq.addEventListener("change", onSchemeChange);
  } else if (mq.addListener) {
    mq.addListener(onSchemeChange);
  }

  apply();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paint);
  } else {
    paint();
  }
})();