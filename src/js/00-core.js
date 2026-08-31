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
  selectedIds: new Set(), // мультивыбор нод (box selection)
  search: '',          // фильтр поиска по аккаунтам
  guideSearch: '',     // фильтр поиска в путеводителе
  vaults: [],          // реестр хранилищ: [{id, name, blob, updatedAt}]
  vaultId: null,       // id текущего (разблокированного) хранилища
  selectedVaultId: null, // выбранное хранилище на экране разблокировки
  setupMode: 'first',
  pendingAction: null,   // {action:'delete'|'edit', accountId} — ожидает подтверждения мастер-паролем
  streamMode: false,     // «режим стрима»: скрывает имена/данные на графе и в панели
  dirty: false,          // были ли изменения данных с последнего сохранения
  settings: null,        // {theme, idleMin, clipSec} — из localStorage (см. 09-settings.js)
  collapsedParents: new Set(), // свёрнутые ноды-контейнеры (в памяти, не в блобе)
};

/* ================= Вложенные сервисы (parentId) =================
 * Сервис с parentId живёт внутри аккаунта-контейнера (обычно почты): на графе
 * он показывается списком с иконками внутри ноды родителя, а не отдельной нодой
 * с проводом. Один уровень вложенности: контейнеры — верхнего уровня.
 * Доступ к вложенному сервису неявно наследует маршрут родителя (effectiveVia). */
function containerChildren(a){
  if(!a) return [];
  return state.vault.accounts.filter(function(x){ return x.parentId === a.id; });
}
function descendantIds(id){
  var out = new Set();
  function walk(i){
    containerChildren(findAccount(i)).forEach(function(c){
      if(!out.has(c.id)){ out.add(c.id); walk(c.id); }
    });
  }
  walk(id);
  return out;
}
function effectiveVia(a){
  if(!a) return null;
  return (a.recovery && a.recovery.viaAccountId) || a.parentId || null;
}

/* ================= Роли Telegram =================
 * С v1.0.44 Telegram — это две отдельные роли вместо одного типа с двумя
 * выходами: «telegram-notify» (зелёный выход — почта для уведомлений) и
 * «telegram-recovery» (красный выход — исходная почта, через которую
 * восстанавливается). У каждой роли ровно один выход, никаких лишних сокетов
 * на контейнере после вложения. */
function isTelegram(a){ return !!(a && (a.type === 'telegram-notify' || a.type === 'telegram-recovery')); }
function isTelegramNotify(a){ return !!(a && a.type === 'telegram-notify'); }
function isTelegramRec(a){ return !!(a && a.type === 'telegram-recovery'); }

/* Миграция старого «telegram» (два выхода: via + notify):
 *  - обе связи есть  → принудительно разбиваем на две ноды (recovery + notify);
 *    оригинальный id остаётся у «восстановления», чтобы внешние ссылки других
 *    аккаунтов (via/notify/parentId) не оборвались; клон «уведомлений» получает
 *    суффикс в имени;
 *  - только via       → telegram-recovery;
 *  - только notify    → telegram-notify;
 *  - ничего           → telegram-recovery (красный выход, без связи).
 * Возвращает число изменённых аккаунтов. Идемпотентна: новые типы не трогает. */
function migrateVaultTg(vault){
  if(!vault || !Array.isArray(vault.accounts)) return 0;
  var changed = 0;
  var out = [];
  vault.accounts.forEach(function(a){
    if(!a || a.type !== 'telegram'){ out.push(a); return; }
    changed++;
    if(!a.recovery) a.recovery = { viaAccountId: null, codes: '', phone: '', notes: '', questions: [] };
    var via = a.recovery.viaAccountId ? a.recovery.viaAccountId : null;
    var notify = a.notifyEmailId || null;
    if(via && notify){
      var rec = { id: a.id, type: 'telegram-recovery', name: a.name || '', username: a.username || '', password: a.password || '', notes: a.notes || '', parentId: a.parentId || null, recovery: { viaAccountId: via, codes: (a.recovery && a.recovery.codes) || '', phone: (a.recovery && a.recovery.phone) || '', notes: (a.recovery && a.recovery.notes) || '', questions: (a.recovery && a.recovery.questions) || [] }, notifyEmailId: null, shared: a.shared || [] };
      var ntf = { id: uid(), type: 'telegram-notify', name: (a.name || 'Telegram') + ' (уведомления)', username: a.username || '', password: a.password || '', notes: a.notes || '', parentId: a.parentId || null, recovery: { viaAccountId: null, codes: '', phone: '', notes: '', questions: [] }, notifyEmailId: notify, shared: [] };
      out.push(rec, ntf);
    } else if(via){
      a.type = 'telegram-recovery';
      a.notifyEmailId = null;
      out.push(a);
    } else if(notify){
      a.type = 'telegram-notify';
      a.recovery.viaAccountId = null;
      out.push(a);
    } else {
      a.type = 'telegram-recovery'; // без связей — роль «восстановление» с красным выходом
      out.push(a);
    }
  });
  vault.accounts = out;
  return changed;
}

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

/* Полноценные фирменные логотипы (простые одноцветные пути из Simple Icons, CC0):
 * белый знак на фирменной подложке. tuple = [путь, фон]. */
function brand(tuple){
  return { tile: tuple[1], svg: '<path d="' + tuple[0] + '" fill="#fff"/>' };
}

var GO = 'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z';
var PROTON = 'M2.474 17.75V24h4.401v-5.979c0-.582.232-1.14.645-1.551a2.204 2.204 0 0 1 1.556-.643h4.513a7.955 7.955 0 0 0 5.612-2.318 7.907 7.907 0 0 0 2.325-5.595 7.91 7.91 0 0 0-2.325-5.596A7.958 7.958 0 0 0 13.587 0H2.474v7.812h4.401V4.129h6.416c.995 0 1.951.394 2.656 1.097.704.7 1.1 1.653 1.101 2.646a3.742 3.742 0 0 1-1.101 2.648 3.766 3.766 0 0 1-2.656 1.097H8.627a6.158 6.158 0 0 0-4.352 1.795 6.133 6.133 0 0 0-1.801 4.338z';
var MEGA = 'M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm6.23 16.244a.371.371 0 0 1-.373.372H16.29a.371.371 0 0 1-.372-.372v-4.828c0-.04-.046-.06-.08-.033l-3.32 3.32a.742.742 0 0 1-1.043 0l-3.32-3.32c-.027-.027-.08-.007-.08.033v4.828a.371.371 0 0 1-.372.372H6.136a.371.371 0 0 1-.372-.372V7.757c0-.206.166-.372.372-.372h1.076a.75.75 0 0 1 .525.22l4.13 4.13a.18.18 0 0 0 .26 0l4.13-4.13c.14-.14.325-.22.525-.22h1.075c.206 0 .372.166.372.372z';
var TELEGRAM = 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z';
var INSTAGRAM = 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077';
var X = 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z';
var TWITCH = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z';
var GITHUB = 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';
var DISCORD = 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';
var SOUNDCLOUD = 'M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z';
var STEAM = 'M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z';
var GUMROAD = 'M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0Zm-.007 5.12c4.48 0 5.995 3.025 6.064 4.744h-3.239c-.069-.962-.897-2.406-2.896-2.406-2.136 0-3.514 1.857-3.514 4.126 0 2.27 1.378 4.125 3.514 4.125 1.93 0 2.758-1.512 3.103-3.025h-3.103v-1.238h6.509v6.327h-2.855v-3.989c-.207 1.444-1.102 4.264-4.617 4.264-3.516 0-5.584-2.82-5.584-6.326 0-3.645 2.276-6.602 6.618-6.602z';
var EPIC = 'M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 0 0 .02.433c.031.3.037.59.316.92.027.033.311.245.311.245.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2 0 0 .284-.211.311-.243.28-.33.285-.621.316-.92a4.261 4.261 0 0 0 .02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54zm-3.74 10.147a1.708 1.708 0 0 1 .591.108 1.745 1.745 0 0 1 .49.299l-.452.546a1.247 1.247 0 0 0-.308-.195.91.91 0 0 0-.363-.068.658.658 0 0 0-.28.06.703.703 0 0 0-.224.163.783.783 0 0 0-.151.243.799.799 0 0 0-.056.299v.008a.852.852 0 0 0 .056.31.7.7 0 0 0 .157.245.736.736 0 0 0 .238.16.774.774 0 0 0 .303.058.79.79 0 0 0 .445-.116v-.339h-.548v-.565H7.37v1.255a2.019 2.019 0 0 1-.524.307 1.789 1.789 0 0 1-.683.123 1.642 1.642 0 0 1-.602-.107 1.46 1.46 0 0 1-.478-.3 1.371 1.371 0 0 1-.318-.455 1.438 1.438 0 0 1-.115-.58v-.008a1.426 1.426 0 0 1 .113-.57 1.449 1.449 0 0 1 .312-.46 1.418 1.418 0 0 1 .474-.309 1.58 1.58 0 0 1 .598-.111 1.708 1.708 0 0 1 .045 0zm11.963.008a2.006 2.006 0 0 1 .612.094 1.61 1.61 0 0 1 .507.277l-.386.546a1.562 1.562 0 0 0-.39-.205 1.178 1.178 0 0 0-.388-.07.347.347 0 0 0-.208.052.154.154 0 0 0-.07.127v.008a.158.158 0 0 0 .022.084.198.198 0 0 0 .076.066.831.831 0 0 0 .147.06c.062.02.14.04.236.061a3.389 3.389 0 0 1 .43.122 1.292 1.292 0 0 1 .328.17.678.678 0 0 1 .207.24.739.739 0 0 1 .071.337v.008a.865.865 0 0 1-.081.382.82.82 0 0 1-.229.285 1.032 1.032 0 0 1-.353.18 1.606 1.606 0 0 1-.46.061 2.16 2.16 0 0 1-.71-.116 1.718 1.718 0 0 1-.593-.346l.43-.514c.277.223.578.335.9.335a.457.457 0 0 0 .236-.05.157.157 0 0 0 .082-.142v-.008a.15.15 0 0 0-.02-.077.204.204 0 0 0-.073-.066.753.753 0 0 0-.143-.062 2.45 2.45 0 0 0-.233-.062 5.036 5.036 0 0 1-.413-.113 1.26 1.26 0 0 1-.331-.16.72.72 0 0 1-.222-.243.73.73 0 0 1-.082-.36v-.008a.863.863 0 0 1 .074-.359.794.794 0 0 1 .214-.283 1.007 1.007 0 0 1 .34-.185 1.423 1.423 0 0 1 .448-.066 2.006 2.006 0 0 1 .025 0zm-9.358.025h.742l1.183 2.81h-.825l-.203-.499H8.623l-.198.498h-.81zm2.197.02h.814l.663 1.08.663-1.08h.814v2.79h-.766v-1.602l-.711 1.091h-.016l-.707-1.083v1.593h-.754zm3.469 0h2.235v.658h-1.473v.422h1.334v.61h-1.334v.442h1.493v.658h-2.255zm-5.3.897l-.315.793h.624zm-1.145 5.19h8.014l-4.09 1.348z';
var ARTSTATION = 'M0 17.723l2.027 3.505h.001a2.424 2.424 0 0 0 2.164 1.333h13.457l-2.792-4.838H0zm24 .025c0-.484-.143-.935-.388-1.314L15.728 2.728a2.424 2.424 0 0 0-2.142-1.289H9.419L21.598 22.54l1.92-3.325c.378-.637.482-.919.482-1.467zm-11.129-3.462L7.428 4.858l-5.444 9.428h10.887z';
var BLUESKY = 'M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026';
/* Splice и Superhive нет в Simple Icons — стилизованные знаки. */
function spliceGlyph(){
  return '<path d="M5 20v-7M9.5 20V9M14 20V5M18.5 20v-6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>'
    + '<path d="M6.4 20h12.2l-2.8-4 1.4-2-2-3.2-2.2 3.4 1.4 1.8-1.6 1.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
}
function hiveGlyph(){
  return '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/>'
    + '<path d="M12 8l6 3.4v3.2L12 18l-6-3.4v-3.2L12 8Z" fill="none" stroke="#fff" stroke-width="1.5"/>';
}

function envGlyph(){
  return '<rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="#fff" stroke-width="1.8"/>'
    + '<path d="M3.5 8.5 L12 14 L20.5 8.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
}
function atGlyph(){
  return '<text x="12" y="16.5" font-size="15" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">@</text>';
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
var ACCOUNT_TYPES = {
  '':          { label: 'Без типа', tile: '#66788f', svg: '' },
  'mail':      { label: 'Почта', tile: '#2f6fed', svg: envGlyph() },
  'google':    brand([GO, '#4285F4']),
  'proton':    brand([PROTON, '#6d4aff']),
  'mailru':    { label: 'Mail.ru', tile: '#005FF9', svg: atGlyph() },
  'mega':      brand([MEGA, '#d9272e']),
  'telegram-notify':    brand([TELEGRAM, '#2AABEE']),
  'telegram-recovery':  brand([TELEGRAM, '#2AABEE']),
  'instagram': { label: 'Instagram', tile: 'grad', svg: '<path d="' + INSTAGRAM + '" fill="#fff"/>' },
  'genshin':   { label: 'Genshin Impact', tile: '#1d2333', svg: sparkGlyph() },
  'bank':      { label: 'Банк', tile: '#2e9e5b', svg: bankGlyph() },
  'social':    { label: 'Соцсеть', tile: '#e04f9f', svg: usersGlyph() },
  'game':      { label: 'Игра', tile: '#16a085', svg: gameGlyph() },
  'service':   { label: 'Сервис', tile: '#8a5cc8', svg: gridGlyph() },
  'xcom':      brand([X, '#000000']),
  'twitch':    brand([TWITCH, '#6441a5']),
  'github':    brand([GITHUB, '#24292f']),
  'discord':   brand([DISCORD, '#5865f2']),
  'soundcloud':brand([SOUNDCLOUD, '#ff5500']),
  'steam':     brand([STEAM, '#1b2838']),
  'splice':    { label: 'Splice', tile: '#3366cc', svg: spliceGlyph() },
  'gumroad':   brand([GUMROAD, '#e4049c']),
  'epic':      brand([EPIC, '#000000']),
  'artstation':brand([ARTSTATION, '#13aff0']),
  'bluesky':   brand([BLUESKY, '#0a8afd']),
  'superhive': { label: 'Superhive', tile: '#ffd333', svg: hiveGlyph() }
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
  var ms = clipClearMs();
  if(!ms){ clipboardSecret = null; return; } // очистка выключена в настройках
  clipboardSecret = secret;
  clearTimeout(clipboardTimer);
  clipboardTimer = setTimeout(clearClipboardIfSecret, ms);
}
function copyText(t, opts){
  if(!t){ return; }
  opts = opts || {};
  function done(){
    toast(opts.secret ? 'Скопировано · ' + clipClearLabel() : 'Скопировано');
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
/* Выпадающие меню тулбара (категории «Хранилище/Защита/Узлы/Вид»).
 * toggleGraphMenu вызывается из onclick кнопки-категории; клик по пункту
 * меню выполняет действие и закрывает меню; клик где-то ещё — закрывает. */
function toggleGraphMenu(btn){
  var wrap = btn.closest ? btn.closest('.graph-menu') : null;
  if(!wrap) return;
  var open = wrap.classList.contains('open');
  closeGraphMenus();
  if(!open) wrap.classList.add('open');
}
function closeGraphMenus(){
  document.querySelectorAll('.graph-menu.open').forEach(function(m){ m.classList.remove('open'); });
}
/* Сворачиваемая легенда графа: отдельная кнопка вместо постоянной полосы */
function toggleLegend(){
  var wrap = document.querySelector('.legend-wrap');
  if(!wrap) return;
  var open = wrap.classList.toggle('open');
  var box = document.querySelector('#legend-box');
  if(box) box.classList.toggle('hidden', !open);
}
function closeLegend(){
  var wrap = document.querySelector('.legend-wrap');
  if(!wrap) return;
  wrap.classList.remove('open');
  var box = document.querySelector('#legend-box');
  if(box) box.classList.add('hidden');
}
document.addEventListener('click', function(e){
  var t = e && e.target;
  if(!t || !t.closest) return;
  if(t.closest('.legend-wrap')){ closeGraphMenus(); return; }
  if(t.closest('.graph-menu-panel')){ closeGraphMenus(); return; }
  if(!t.closest('.graph-menu')) closeGraphMenus();
  if(!t.closest('.legend-wrap')) closeLegend();
});

/* Крестик «✕» на всех модалках. Закрытие только осознанное (✕ / Отмена):
 * клик по фону больше не закрывает окно. Инжектится в DOM после захвата
 * APP_SOURCE, поэтому сериализация/хэш файла не затрагиваются. */
function initModalCloseButtons(){
  document.querySelectorAll('.overlay').forEach(function(ov){
    if(ov.dataset.closeBtn) return;
    ov.dataset.closeBtn = '1';
    var panel = ov.querySelector('.modal-panel');
    if(!panel) return;
    var x = document.createElement('button');
    x.className = 'modal-close';
    x.textContent = '✕';
    x.title = 'Закрыть';
    x.setAttribute('aria-label', 'Закрыть');
    x.addEventListener('click', function(){
      if(ov.id === 'modal-auth') closeAuthModal();
      else closeModal(ov.id);
    });
    panel.appendChild(x);
  });
}
