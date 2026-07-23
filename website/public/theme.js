(function () {
  const KEY = 'ougi-theme';
  const root = document.documentElement;

  function apply(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem(KEY, next);
    document.querySelectorAll('[data-theme-label]').forEach((el) => {
      el.textContent = next === 'light' ? 'Dark' : 'Light';
    });
  }

  apply(localStorage.getItem(KEY) || 'dark');

  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cur = root.getAttribute('data-theme') || 'dark';
      apply(cur === 'dark' ? 'light' : 'dark');
    });
  });
})();
