// Display preference is session-only, just like the journey and journal.
(() => {
  'use strict';
  const root = document.documentElement;
  const control = document.getElementById('theme');
  const system = matchMedia('(prefers-color-scheme: dark)');
  let systemDark = system.matches;
  let preference = 'auto';

  function applyTheme() {
    const theme = preference === 'auto' ? (systemDark ? 'dark' : 'light') : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    root.style.colorScheme = theme;
    control.value = preference;
    const browserColour = document.querySelector('meta[name="theme-color"]');
    browserColour?.setAttribute('content', theme === 'dark' ? '#101e21' : '#f0efe7');
  }

  control.addEventListener('change', () => {
    preference = ['auto', 'light', 'dark'].includes(control.value) ? control.value : 'auto';
    applyTheme();
  });
  const onSystemChange = event => {
    systemDark = event.matches;
    if (preference === 'auto') applyTheme();
  };
  if (system.addEventListener) system.addEventListener('change', onSystemChange);
  else system.addListener?.(onSystemChange);
  applyTheme();
})();
