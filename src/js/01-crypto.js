/* ================= Криптография ================= */
function deriveKey(password, saltB64, iterations){
  var salt = base64ToBytes(saltB64);
  var enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
    .then(function(mat){
      return crypto.subtle.deriveKey(
        {name:'PBKDF2', salt:salt, iterations:iterations, hash:'SHA-256'},
        mat, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
    });
}

function encryptWithKey(obj, key){
  var iv = randomBytes(12);
  var pt = new TextEncoder().encode(JSON.stringify(obj));
  return crypto.subtle.encrypt({name:'AES-GCM', iv:iv}, key, pt).then(function(ct){
    return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
  });
}

function decryptWithKey(blob, key){
  var iv = base64ToBytes(blob.iv);
  var ct = base64ToBytes(blob.ct);
  return crypto.subtle.decrypt({name:'AES-GCM', iv:iv}, key, ct).then(function(pt){
    return JSON.parse(new TextDecoder().decode(pt));
  });
}

/* v2-формат (seed включён или был включён): данные шифруются стабильным ключом
 * VK; VK обёрнут производным ключом от пароля (ekPass) и ключом от seed-фразы
 * (ekSeed, если настроена). Смена пароля/укрепление меняют только ekPass. */
function wrapKeyBytes(rawBytes, wrappingKey){
  var iv = randomBytes(12);
  return crypto.subtle.encrypt({name:'AES-GCM', iv:iv}, wrappingKey, rawBytes).then(function(ct){
    return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
  });
}
function unwrapKeyBytes(ctB64, ivB64, key){
  var iv = base64ToBytes(ivB64);
  var ct = base64ToBytes(ctB64);
  return crypto.subtle.decrypt({name:'AES-GCM', iv:iv}, key, ct).then(function(raw){ return new Uint8Array(raw); });
}
/* Расшифровка блоба производным ключом от пароля: для v2 сначала разворачиваем VK */
function unlockWithKey(blob, key){
  if(blob && blob.ekPass){
    return unwrapKeyBytes(blob.ekPass, blob.ekIv, key).then(function(raw){
      return crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, true, ['encrypt','decrypt']);
    }).then(function(vk){ return decryptWithKey(blob, vk); });
  }
  return decryptWithKey(blob, key);
}

function buildBlob(vault){
  return encryptWithKey(vault, state.key).then(function(enc){
    var isV2 = !!state.v2;
    var b = {
      app:'password-vault', version: isV2 ? 2 : 1,
      kdf:'PBKDF2-SHA256', kdfVersion:KDF_VERSION, iterations:KDF_ITERATIONS,
      salt: state.salt, iv: enc.iv, ct: enc.ct,
      savedAt: new Date().toISOString()   // момент создания этого блоба (для «сохранён» при импорте)
    };
    if(!isV2) return b;
    // v2: пере-обернуть VK под текущий производный ключ (меняется при смене пароля/укреплении)
    return crypto.subtle.exportKey('raw', state.key).then(function(vkRaw){
      return wrapKeyBytes(vkRaw, state.derivedKey).then(function(ekPass){
        b.ekIv = ekPass.iv;
        b.ekPass = ekPass.ct;
        if(state.seedWrap && state.seedWrap.ct){
          b.ekSeedIv = state.seedWrap.iv;
          b.ekSeed = state.seedWrap.ct;
          b.seedIterations = state.seedIterations || SEED_KDF_ITERATIONS;
        }
        return b;
      });
    });
  });
}

function validBlob(b){
  return b && typeof b === 'object' && b.app === 'password-vault'
    && typeof b.salt === 'string' && typeof b.iv === 'string'
    && typeof b.ct === 'string' && typeof b.iterations === 'number';
}

/* ================= Хранение (реестр хранилищ) ================= */
function loadVaults(){
  try{
    var raw = localStorage.getItem(LS_VAULTS);
    if(!raw) return [];
    var arr = JSON.parse(raw);
    if(!Array.isArray(arr)) return [];
    return arr.filter(function(v){ return v && typeof v.id === 'string' && validBlob(v.blob); });
  }catch(e){ return []; }
}
function saveVaults(vaults){
  try{ localStorage.setItem(LS_VAULTS, JSON.stringify(vaults)); }catch(e){}
}
function migrateLegacy(){
  try{
    var raw = localStorage.getItem(LS_KEY);
    if(!raw) return;
    var b = JSON.parse(raw);
    if(!validBlob(b)) return;
    var vaults = [{ id: uid(), name: 'Моё хранилище', blob: b, updatedAt: Date.now(), lastExportAt: null, fileName: null }];
    localStorage.setItem(LS_VAULTS, JSON.stringify(vaults));
    localStorage.removeItem(LS_KEY);
  }catch(e){}
}
function currentEntry(){
  return state.vaults.find(function(v){ return v.id === state.vaultId; }) || null;
}

var saveTimer = null;
function scheduleSave(){
  state.dirty = true;
  setStatus('Сохранение…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function(){
    saveBlob().then(function(){ setStatus('Сохранено ✓ ' + nowTime()); refreshBackupStatus(); });
  }, 250);
}
function setStatus(t){ $('save-status').textContent = t; }

function saveBlob(){
  if(!state.key || !state.vault) return Promise.resolve();
  state.vault.updatedAt = new Date().toISOString();
  return buildBlob(state.vault).then(function(blob){
    state.blob = blob;
    var entry = currentEntry();
    if(!entry){
      state.vaultId = uid();
      state.vaults.push({ id: state.vaultId, name: 'Моё хранилище', blob: blob, updatedAt: Date.now(), lastExportAt: null, fileName: null });
    } else {
      entry.blob = blob;
      // updatedAt поднимаем только при реальных изменениях: иначе блокировка
      // (пересохранение без правок) ложно помечала бы бэкап устаревшим
      if(state.dirty) entry.updatedAt = Date.now();
    }
    state.dirty = false;
    saveVaults(state.vaults);
  });
}

/* ================= Индикатор бэкапа ================= */
function dayOf(ms){ var d = new Date(ms); d.setHours(0,0,0,0); return d.getTime(); }
function backupInfo(){
  if(!state.vault) return null;
  var entry = currentEntry();
  if(!entry) return null;
  var hasData = state.vault.accounts && state.vault.accounts.length > 0;
  var last = entry.lastExportAt || 0;
  // «устарел» считаем по календарным дням, а не секундам: если последнее
  // изменение и экспорт случились в один день — бэкап считается актуальным
  var up = entry.updatedAt || 0;
  var stale = last > 0 && up > 0 && dayOf(up) > dayOf(last);
  return { hasData: hasData, last: last, stale: stale };
}
function refreshBackupStatus(){
  var el = $('backup-status');
  if(!el) return;
  var info = backupInfo();
  if(!info || !info.hasData){ el.style.display = 'none'; return; }
  el.style.display = '';
  var days = info.last ? Math.floor((Date.now() - info.last) / 86400000) : null;
  if(!info.last){
    el.className = 'bup-danger';
    el.textContent = '⚠️ Бэкап не создан';
    el.title = 'Файл-бэкап ещё не сохранялся — данные есть только в этом браузере. Клик — экспорт.';
  } else if(info.stale){
    el.className = 'bup-warn';
    el.textContent = '⚠️ Бэкап устарел' + (days > 0 ? ' · ' + days + ' дн.' : '');
    el.title = 'Данные менялись после последнего экспорта. Клик — сделать свежий бэкап.';
  } else {
    el.className = 'bup-ok';
    el.textContent = '✓ Бэкап актуален' + (days > 0 ? ' · ' + days + ' дн.' : ' · сегодня');
    el.title = 'Бэкап свежий: экспорт сделан в день последних изменений. Клик — экспорт.';
  }
}
function markExported(fileName){
  var entry = currentEntry();
  if(!entry) return;
  entry.lastExportAt = Date.now();
  if(typeof fileName === 'string' && fileName) entry.fileName = fileName;
  saveVaults(state.vaults);
  refreshBackupStatus();
}
