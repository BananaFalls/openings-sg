/* Runs before first paint (see app/layout.tsx) so a saved theme choice never flashes the other theme. */
export const THEME_SCRIPT =
  "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";
