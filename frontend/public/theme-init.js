// Aplica el tema antes de pintar para evitar el parpadeo. Es un archivo aparte porque la CSP no permite scripts inline.
(function () {
  try {
    var t = localStorage.getItem('nora-theme');
    if (t !== 'light' && t !== 'dark') t = null;
    var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themePref = t || 'system';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
