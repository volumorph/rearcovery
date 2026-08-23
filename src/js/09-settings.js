/* ================= Настройки: тема, автоблокировка, очистка буфера =================
 * Хранятся в localStorage (не в блобе — это не секреты, а предпочтения браузера).
 * state.settings: { theme:'dark'|'light'|'system', idleMin: минуты до автоблокировки (0 = выкл),
 *                   clipSec: через сколько секунд очищать буфер (0 = не очищать) }
 */
var LS_SETTINGS = 'pvg.settings.v1';
var SETTINGS_DEFAULTS = { theme: 'dark', idleMin: 15, clipSec: 30 };

function loadSettings(){
  try{
    var raw = localStorage.getItem(LS_SETTINGS);
    var s = raw ? JSON.parse(raw) : {};
    state.settings = {
      theme: (s.theme === 'light' || s.theme === 'system') ? s.theme : 'dark',
      idleMin: (typeof s.idleMin === 'number' && s.idleMin >= 0) ? s.idleMin : SETTINGS_DEFAULTS.idleMin,
      clipSec: (typeof s.clipSec === 'number' && s.clipSec >= 0) ? s.clipSec : SETTINGS_DEFAULTS.clipSec
    };
  }catch(e){
    state.settings = { theme: SETTINGS_DEFAULTS.theme, idleMin: SETTINGS_DEFAULTS.idleMin, clipSec: SETTINGS_DEFAULTS.clipSec };
  }
  return state.settings;
}
function saveSettings(){
  try{ localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }catch(e){}
}

/* ---- Тема ---- */
function prefersDark(){ return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
function themeIsDark(){
  var t = state.settings.theme;
  return t === 'dark' || (t === 'system' && prefersDark());
}
function applyTheme(){
  var dark = themeIsDark();
  var de = document.documentElement;
  if(de && de.setAttribute){
    de.setAttribute('data-theme', dark ? 'dark' : 'light');
    de.setAttribute('data-color-scheme', dark ? 'dark' : 'light');
  }
  var meta = document.querySelector('meta[name="color-scheme"]');
  if(meta) meta.setAttribute('content', dark ? 'dark' : 'light');
}
function initThemeListener(){
  if(!window.matchMedia || !window.matchMedia.addEventListener) return;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){
    if(state.settings && state.settings.theme === 'system') applyTheme();
  });
}

/* ---- Автоблокировка ---- */
function idleMs(){ var s = settingsVal(); return s.idleMin > 0 ? s.idleMin * 60000 : 0; }

/* ---- Очистка буфера ---- */
function settingsVal(){
  // state.settings может быть null до loadSettings() (например, в тестах) —
  // тогда используем дефолты, как если бы настройки не менялись
  return state.settings || SETTINGS_DEFAULTS;
}
function clipClearMs(){ var s = settingsVal(); return s.clipSec > 0 ? s.clipSec * 1000 : 0; }
function clipClearLabel(){
  var sec = settingsVal().clipSec;
  if(!sec) return 'очистка буфера выключена';
  var s = sec % 60 === 0 ? (sec / 60) + ' мин' : sec + ' с';
  return 'буфер очистится через ' + s;
}

/* ---- Модалка настроек ---- */
function openSettings(){
  var s = loadSettings();
  var themeSel = $('set-theme'), idleSel = $('set-idle'), clipSel = $('set-clip');
  if(themeSel) themeSel.value = s.theme;
  if(idleSel) idleSel.value = String(s.idleMin);
  if(clipSel) clipSel.value = String(s.clipSec);
  openModal('modal-settings');
}
function saveSettingsForm(){
  var themeSel = $('set-theme'), idleSel = $('set-idle'), clipSel = $('set-clip');
  state.settings.theme = themeSel ? themeSel.value : 'dark';
  state.settings.idleMin = idleSel ? (parseInt(idleSel.value, 10) || 0) : SETTINGS_DEFAULTS.idleMin;
  state.settings.clipSec = clipSel ? (parseInt(clipSel.value, 10) || 0) : SETTINGS_DEFAULTS.clipSec;
  saveSettings();
  applyTheme();
  closeModal('modal-settings');
  toast('Настройки сохранены');
}
