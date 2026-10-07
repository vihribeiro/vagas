/* Tema claro/escuro.
   Não tem botão próprio: o modo é dirigido pela escolha de paleta no
   prefs.js (paleta do grupo Escuro liga o escuro, do grupo Claro liga o
   claro) e, na primeira visita sem escolha, pela preferência do sistema.
   Roda no <head> para evitar flash de cor. */
(function () {
  var KEY = "vagas-theme";
  var mq = window.matchMedia("(prefers-color-scheme: dark)");

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

  /* usado pelo prefs.js quando uma paleta do popover escolhe o modo */
  function setMode(mode) {
    if (mode !== "light" && mode !== "dark") return;
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    apply();
  }

  // a preferência do sistema só vale enquanto não houver escolha explícita;
  // o CSS acompanha sozinho (media query), e aqui só garantimos o atributo.
  function onSchemeChange() { apply(); }

  if (mq.addEventListener) {
    mq.addEventListener("change", onSchemeChange);
  } else if (mq.addListener) {
    mq.addListener(onSchemeChange);
  }

  apply();
  window.VagasTheme = { set: setMode, current: current };
})();