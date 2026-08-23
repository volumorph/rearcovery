/* ================= Константы и состояние ================= */
var LS_VAULTS = 'pvg.vaults.v1';
var LS_KEY = 'pvg.blob.v1';   // устаревший одиночный ключ (только для миграции)
var KDF_ITERATIONS = 1200000;   // усиление v2 (было 600000 в v1)
var KDF_VERSION = 2;            // версия KDF-схемы в блобе (v1 = 600k, v2 = 1.2M)

var state = {
  blob: null,          // зашифрованный контейнер (внешний JSON)
  salt: null,          // base64 соль текущего ключа
  key: null,           // CryptoKey (AES-GCM): ключ данных (v2 — VK, v1 — производный)
  derivedKey: null,    // производный ключ от пароля (для v2: оборачивает VK)
  seedWrap: null,      // {iv, ct}: VK, обёрнутый ключом от seed-фразы (ekSeed)
  seedIterations: null,// итерации KDF для seed-ключа (хранятся в блобе)
  seedPending: null,   // {phrase, ask} — временное состояние настройки seed
  vault: null,         // расшифрованные данные {version, accounts}
  tab: 'accounts',
  currentAccountId: null,
  revealedIds: new Set(),
  camera: { x: 0, y: 0, s: 1 },
  cameraInitialized: false,
  selected: null,      // {kind:'node'|'wire', ...}
  search: '',          // фильтр поиска по аккаунтам
  guideSearch: '',     // фильтр поиска в путеводителе
  vaults: [],          // реестр хранилищ: [{id, name, blob, updatedAt}]
  vaultId: null,       // id текущего (разблокированного) хранилища
  selectedVaultId: null, // выбранное хранилище на экране разблокировки
  setupMode: 'first',
  pendingAction: null,   // {action:'delete'|'edit', accountId} — ожидает подтверждения мастер-паролем
  streamMode: false,     // «режим стрима»: скрывает имена/данные на графе и в панели
  dirty: false,          // были ли изменения данных с последнего сохранения
};

/* ================= Утилиты ================= */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function jsStr(s){ return JSON.stringify(String(s == null ? '' : s)); }
function truncate(s,n){ s = String(s == null ? '' : s); return s.length > n ? s.slice(0,n-1) + '…' : s; }
function uid(){ return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)); }
function randomBytes(n){ var u = new Uint8Array(n); crypto.getRandomValues(u); return u; }
function bytesToBase64(bytes){ var s=''; for(var i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function base64ToBytes(b64){ var bin = atob(b64); var u = new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i); return u; }
function nowTime(){ return new Date().toLocaleTimeString(); }

/* ================= Иконки типов аккаунтов ================= */
var igGradId = 'igg-' + Math.random().toString(36).slice(2);
var goGradId = 'gog-' + Math.random().toString(36).slice(2);

function envGlyph(){
  return '<rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="#fff" stroke-width="1.8"/>'
    + '<path d="M3.5 8.5 L12 14 L20.5 8.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
}
function atGlyph(){
  return '<text x="12" y="16.5" font-size="15" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">@</text>';
}
function goGlyph(){
  return '<defs><linearGradient id="' + goGradId + '" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#4285F4"/><stop offset=".3" stop-color="#34A853"/><stop offset=".6" stop-color="#FBBC05"/><stop offset="1" stop-color="#EA4335"/></linearGradient></defs>'
    + '<text x="12" y="16.5" font-size="15.5" font-weight="800" fill="url(#' + goGradId + ')" text-anchor="middle" font-family="Arial, sans-serif">G</text>';
}
function igGlyph(){
  return '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5.4" fill="none" stroke="#fff" stroke-width="1.8"/>'
    + '<circle cx="12" cy="12" r="4.1" fill="none" stroke="#fff" stroke-width="1.8"/>'
    + '<circle cx="16.7" cy="7.3" r="1.25" fill="#fff"/>';
}
function sparkGlyph(){
  return '<path d="M12 2.5 L14.6 9.4 L21.5 12 L14.6 14.6 L12 21.5 L9.4 14.6 L2.5 12 L9.4 9.4 Z" fill="#e6c15c"/>';
}
function bankGlyph(){
  return '<path d="M12 3.2 L21.5 8.6 L2.5 8.6 Z" fill="#fff"/>'
    + '<rect x="6.3" y="10.2" width="3" height="7.6" fill="#fff"/>'
    + '<rect x="10.5" y="10.2" width="3" height="7.6" fill="#fff"/>'
    + '<rect x="14.7" y="10.2" width="3" height="7.6" fill="#fff"/>'
    + '<rect x="3.5" y="19" width="17" height="2" rx="1" fill="#fff"/>';
}
function usersGlyph(){
  return '<circle cx="9" cy="8.5" r="3.4" fill="#fff"/>'
    + '<circle cx="16.5" cy="9.5" r="2.6" fill="#fff"/>'
    + '<path d="M3.2 19.5 C3.7 15.9 6 13.6 9 13.6 C12 13.6 14.3 15.9 14.8 19.5 Z" fill="#fff"/>'
    + '<path d="M14.4 14.1 C17 14.4 19.3 16.5 19.9 19.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>';
}
function gameGlyph(){
  return '<rect x="2.5" y="7.6" width="19" height="10.6" rx="5.2" fill="none" stroke="#fff" stroke-width="1.8"/>'
    + '<circle cx="7.2" cy="10.6" r="1.4" fill="#fff"/>'
    + '<circle cx="16.8" cy="10.6" r="1.4" fill="#fff"/>'
    + '<path d="M10.3 13 h3.4 M12 11.4 v3.2" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>';
}
function gridGlyph(){
  return '<rect x="4" y="4" width="7" height="7" rx="2" fill="#fff"/>'
    + '<rect x="13" y="4" width="7" height="7" rx="2" fill="#fff"/>'
    + '<rect x="4" y="13" width="7" height="7" rx="2" fill="#fff"/>'
    + '<rect x="13" y="13" width="7" height="7" rx="2" fill="#fff"/>';
}
function megaGlyph(){
  return '<path d="M4.5 18 L9 6.5 L12 12 L15 6.5 L19.5 18" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
}
function telegramGlyph(){
  return '<circle cx="12" cy="12" r="9.6" fill="#2AABEE"/>'
    + '<path d="M4.4 12.4 L18.7 6.7 L14.9 18.2 L12.2 13.9 L7.3 15.7 L9.5 13.1 Z" fill="#fff"/>';
}

var ACCOUNT_TYPES = {
  '':          { label: 'Без типа', tile: '#66788f', svg: '' },
  'mail':      { label: 'Почта', tile: '#2f6fed', svg: envGlyph() },
  'google':    { label: 'Google', tile: '#ffffff', svg: goGlyph() },
  'proton':    { label: 'Proton', tile: '#6d4aff', svg: envGlyph() },
  'mailru':    { label: 'Mail.ru', tile: '#005FF9', svg: atGlyph() },
  'mega':      { label: 'MEGA', tile: '#d9272e', svg: megaGlyph() },
  'telegram':  { label: 'Telegram', tile: '#ffffff', svg: telegramGlyph() },
  'instagram': { label: 'Instagram', tile: 'grad', svg: igGlyph() },
  'genshin':   { label: 'Genshin Impact', tile: '#1d2333', svg: sparkGlyph() },
  'bank':      { label: 'Банк', tile: '#2e9e5b', svg: bankGlyph() },
  'social':    { label: 'Соцсеть', tile: '#e04f9f', svg: usersGlyph() },
  'game':      { label: 'Игра', tile: '#16a085', svg: gameGlyph() },
  'service':   { label: 'Сервис', tile: '#8a5cc8', svg: gridGlyph() }
};

function typeIconSvg(type, name, size){
  var t = ACCOUNT_TYPES[type] || ACCOUNT_TYPES[''];
  size = size || 18;
  var inner = t.svg
    || '<text x="12" y="16.5" font-size="14" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">' + esc((name || '?').charAt(0).toUpperCase()) + '</text>';
  var tile = t.tile === 'grad'
    ? '<defs><linearGradient id="' + igGradId + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#feda75"/><stop offset=".55" stop-color="#d62976"/><stop offset="1" stop-color="#962fbf"/></linearGradient></defs><rect width="24" height="24" rx="6" fill="url(#' + igGradId + ')"/>'
    : '<rect width="24" height="24" rx="6" fill="' + (t.tile || '#66788f') + '"/>';
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="display:block;flex-shrink:0">' + tile + inner + '</svg>';
}

var toastTimer = null;
function toast(msg, ms){
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, ms || 2200);
}

var CLIPBOARD_CLEAR_MS = 30000;   // через сколько очищать буфер после копирования пароля
var clipboardTimer = null;
var clipboardSecret = null;
function clearClipboardIfSecret(){
  if(!navigator.clipboard || !navigator.clipboard.writeText){ clipboardSecret = null; return; }
  function wipe(){ if(clipboardSecret) navigator.clipboard.writeText('').catch(function(){}); }
  function finish(){ clipboardSecret = null; }
  if(!navigator.clipboard.readText){ wipe(); finish(); return; }
  navigator.clipboard.readText().then(function(cur){
    // очищаем только если в буфере всё ещё лежит наш секрет (не затираем чужое)
    if(clipboardSecret && cur === clipboardSecret) wipe();
    finish();
  }).catch(function(){
    // не смогли прочитать буфер (нет разрешения/фокуса) — стираем безусловно:
    // лучше очистить лишнее, чем оставить пароль в буфере
    wipe();
    finish();
  });
}
function scheduleClipboardClear(secret){
  clipboardSecret = secret;
  clearTimeout(clipboardTimer);
  clipboardTimer = setTimeout(clearClipboardIfSecret, CLIPBOARD_CLEAR_MS);
}
function copyText(t, opts){
  if(!t){ return; }
  opts = opts || {};
  function done(){
    toast(opts.secret ? 'Скопировано · буфер очистится через 30 с' : 'Скопировано');
    if(opts.secret) scheduleClipboardClear(t);
  }
  function fallback(){
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); done(); }catch(e){ toast('Не удалось скопировать'); }
    ta.remove();
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(done, fallback);
  } else fallback();
}

function showScreen(name){
  ['setup','unlock','main'].forEach(function(s){
    $('screen-'+s).classList.toggle('hidden', s !== name);
  });
}
function openModal(id){ $(id).classList.remove('hidden'); }
function closeModal(id){ $(id).classList.add('hidden'); }
function closeModals(){
  document.querySelectorAll('.overlay').forEach(function(m){ m.classList.add('hidden'); });
}
