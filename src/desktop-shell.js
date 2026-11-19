import './desktop-shell.css';

if (window.desktopShell?.customTitleBar) {
  document.documentElement.classList.add('desktop-shell');
  const bar = document.createElement('div');
  bar.className = 'desktop-titlebar';
  bar.textContent = 'Language Study Coach';
  document.body.prepend(bar);
}
