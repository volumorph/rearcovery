/* ================= Экспорт / импорт ================= */
function exportFileName(){
  // оригинальное имя файла хранится в реестре (от импорта или прошлого экспорта)
  var entry = currentEntry();
  if(entry && entry.fileName) return entry.fileName;
  return 'paroli-vault-' + new Date().toISOString().slice(0,10) + '.json';
}

function doExport(){
  var el = $('export-filename');
  if(el) el.textContent = 'Файл будет сохранён как: ' + exportFileName();
  openModal('modal-export');
}

function exportFile(){
  buildBlob(state.vault).then(function(blob){
    var name = exportFileName();
    var data = JSON.stringify(blob, null, 2);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Сохранён файл: ' + name);
    markExported(name);
  });
}

function exportClipboard(){
  buildBlob(state.vault).then(function(blob){
    copyText(JSON.stringify(blob));
    markExported();
  });
}

var APP_SOURCE = null; // исходный HTML (для «скачать локальную копию»)
function downloadLocalCopy(){
  var name = 'password-guide.html';
  function save(txt){
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/html' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Сохранён файл: ' + name);
  }
  if(location.protocol !== 'http:' && location.protocol !== 'https:'){
    save(APP_SOURCE || '<!DOCTYPE html>\n' + document.documentElement.outerHTML);
    return;
  }
  // веб-версия: скачиваем исходный файл как есть, без состояния страницы
  fetch(location.href, { cache: 'no-store' }).then(function(r){ return r.text(); }).then(save).catch(function(){
    save(APP_SOURCE || '<!DOCTYPE html>\n' + document.documentElement.outerHTML);
  });
}

/* ================= О приложении (версия + хэш + обновления) ================= */
var APP_VERSION = '1.0';
var GITHUB_REPO = 'volumorph/rearcovery'; // репозиторий для проверки обновлений
var ABOUT_HASH = null;                    // SHA-256 текущего исполняемого файла
function computeHash(text){
  var enc = new TextEncoder();
  return crypto.subtle.digest('SHA-256', enc.encode(text)).then(function(buf){
    var u = new Uint8Array(buf);
    var hex = '';
    for(var i = 0; i < u.length; i++) hex += ('0' + u[i].toString(16)).slice(-2);
    return hex;
  });
}
function sourceText(){
  if(location.protocol === 'http:' || location.protocol === 'https:'){
    // веб-версия: ровно тот файл, который отдал сервер
    return fetch(location.href, { cache: 'no-store' }).then(function(r){ if(!r.ok) throw new Error('fetch failed'); return r.text(); });
  }
  return Promise.resolve(APP_SOURCE || '<!DOCTYPE html>\n' + document.documentElement.outerHTML);
}
function openAbout(){
  $('about-version').textContent = APP_VERSION;
  $('about-hash').textContent = 'считаю…';
  $('about-update').innerHTML = '';
  openModal('modal-about');
  if(location.protocol === 'http:' || location.protocol === 'https:'){
    // версия из файла VERSION на том же сайте — подстраховка для старых
    // опубликованных файлов, где APP_VERSION ещё не вшита в сборку
    fetch('./VERSION', { cache: 'no-store' }).then(function(r){ if(!r.ok) throw new Error('no version file'); return r.text(); }).then(function(t){
      var v = (t || '').trim();
      if(v) $('about-version').textContent = v;
    }).catch(function(){});
  }
  // локальная (file://) копия показывает версию, вшитую в сам файл при сборке —
  // никакой заглушки «(локальная копия)» больше нет
  sourceText().then(computeHash).then(function(h){
    ABOUT_HASH = h;
    $('about-hash').textContent = h;
    if(location.protocol === 'file:'){
      // локальная копия: сразу сверяем с последним релизом, не дожидаясь кнопки.
      // Браузерный «Сохранить страницу как» меняет байты файла (хотя код тот же),
      // и пользователь без этой сверки видит непонятное расхождение хэшей.
      checkUpdates();
    }
  }).catch(function(){
    ABOUT_HASH = null;
    $('about-hash').textContent = 'не удалось вычислить';
  });
}
function checkUpdates(){
  var st = $('about-update');
  var btn = $('btn-check-update');
  if(btn) btn.disabled = true;
  st.innerHTML = 'Проверяю…';
  var done = function(html){ st.innerHTML = html; if(btn) btn.disabled = false; };
  var hashReady = ABOUT_HASH ? Promise.resolve(ABOUT_HASH) : sourceText().then(computeHash);
  hashReady.then(function(myHash){
    return fetch('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', { cache: 'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function(rel){
        var tag = rel.tag_name || '';
        var m = (rel.body || '').match(/[0-9a-f]{64}/);
        var latestHash = m ? m[0] : '';
        var releasesUrl = 'https://github.com/' + GITHUB_REPO + '/releases';
        if(myHash && latestHash && myHash === latestHash){
          done('✅ Вы запускаете последнюю опубликованную версию (<b>' + esc(tag) + '</b>) — обновление не нужно.');
        } else if(myHash && latestHash){
          done('⚠️ Ваш файл отличается от релиза <b>' + esc(tag) + '</b> (хэши не совпадают). Частая причина: копия сохранена через браузер («Сохранить страницу как») — код тогда тот же, но байты другие; скачайте заново кнопкой «⬇️ Скачать локальную копию (HTML)» в веб-версии. Устаревшая копия или подмена файла тоже дают расхождение. <a href="' + releasesUrl + '" target="_blank" rel="noopener">Открыть релизы</a>');
        } else if(tag){
          done('Последняя версия на GitHub: <b>' + esc(tag) + '</b>. <a href="' + releasesUrl + '" target="_blank" rel="noopener">Открыть релизы</a>');
        } else {
          done('Не удалось получить данные с GitHub.');
        }
      });
  }).catch(function(){
    done('Не удалось проверить: нет сети или GitHub недоступен.');
  });
}

function openImport(){
  $('import-err').textContent = '';
  $('import-text').value = '';
  $('import-file').value = '';
  $('import-file-name').textContent = '';
  openModal('modal-import');
}

function importFileChosen(input){
  var file = input.files && input.files[0];
  if(!file) return;
  $('import-file-name').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function(){ applyImport(reader.result, file.name); };
  reader.readAsText(file);
}

function importText(){
  var t = $('import-text').value.trim();
  if(!t){ $('import-err').textContent = 'Вставьте содержимое файла-бэкапа.'; return; }
  applyImport(t);
}

function applyImport(text, fileName){
  var err = $('import-err');
  var blob;
  try{ blob = JSON.parse(text); }catch(e){ err.textContent = 'Не удалось разобрать JSON: ' + e.message; return; }
  if(!validBlob(blob)){ err.textContent = 'Файл не похож на бэкап «Путеводителя по паролям».'; return; }
  var name = fileName || $('import-file-name').textContent || ('Импорт ' + new Date().toLocaleDateString());
  name = name.replace(/\.json$/i, '');
  state.vaults.push({ id: uid(), name: name, blob: blob, updatedAt: Date.now(), lastExportAt: null, fileName: fileName || null });
  saveVaults(state.vaults);
  state.selectedVaultId = state.vaults[state.vaults.length - 1].id;
  closeModal('modal-import');
  lock();
  // «когда сохранён» и «какая версия» — прямо в сообщении после импорта
  var saved = blob.savedAt ? new Date(blob.savedAt).toLocaleString() : 'дата неизвестна (старый формат)';
  var fmt = 'v' + (blob.version || 1) + '.' + (blob.kdfVersion || 1);
  toast('Хранилище «' + name + '» добавлено · сохранено: ' + saved + ' · формат ' + fmt + '. Введите его мастер-пароль.', 6000);
}

/* ================= Генератор паролей ================= */
function openGenerator(){
  regen();
  openModal('modal-generator');
}

function generatePassword(){
  var len = parseInt($('gen-len').value, 10) || 20;
  var sets = [];
  if($('gen-upper').checked) sets.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  if($('gen-lower').checked) sets.push('abcdefghijklmnopqrstuvwxyz');
  if($('gen-digits').checked) sets.push('0123456789');
  if($('gen-symbols').checked) sets.push('!@#$%^&*()-_=+[]{};:,.<>?/~');
  if(!sets.length) return '';
  var all = sets.join('');
  var arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  var chars = [];
  for(var i = 0; i < len; i++){
    if(i < sets.length){
      chars.push(sets[i][arr[i] % sets[i].length]);
    }else{
      chars.push(all[arr[i] % all.length]);
    }
  }
  // перетасовать (Fisher–Yates), чтобы обязательные символы не были в начале
  for(var j = chars.length - 1; j > 0; j--){
    var r = new Uint32Array(1);
    crypto.getRandomValues(r);
    var k = r[0] % (j + 1);
    var tmp = chars[j]; chars[j] = chars[k]; chars[k] = tmp;
  }
  return chars.join('');
}

function regen(){
  $('gen-out').value = generatePassword();
}

/* ================= Автоблокировка =================
 * Таймаут берётся из настроек (state.settings.idleMin, см. 09-settings.js);
 * перечитывается на каждом тике, поэтому смена настройки применяется сразу. */
var lastActive = Date.now();
function markActive(){ lastActive = Date.now(); }
['click','keydown','mousemove','touchstart','scroll'].forEach(function(ev){
  window.addEventListener(ev, markActive, { passive: true });
});
function startIdleWatch(){
  setInterval(function(){
    var ms = idleMs();
    if(ms > 0 && state.vault && Date.now() - lastActive > ms){
      lock();
    }
  }, 10000);
}

/* ================= Запуск ================= */
document.addEventListener('DOMContentLoaded', boot);
$('btn-setup').addEventListener('click', doSetup);
$('btn-unlock').addEventListener('click', tryUnlock);
['setup-pass','setup-pass2'].forEach(function(id){ $(id).addEventListener('keydown', function(e){ if(e.key === 'Enter') doSetup(); }); });
$('unlock-pass').addEventListener('keydown', function(e){ if(e.key === 'Enter') tryUnlock(); });
$('auth-pass').addEventListener('keydown', function(e){ if(e.key === 'Enter') confirmAuth(); });
