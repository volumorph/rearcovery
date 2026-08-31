/* ================= Вход / выход / смена пароля ================= */
function emptyAccount(){
  return { id: uid(), type:'', name:'', username:'', password:'', notes:'',
    parentId:null, // вложенный сервис: живёт внутри аккаунта-контейнера (см. 00-core.js)
    recovery:{ viaAccountId:null, codes:'', phone:'', notes:'', questions:[] },
    notifyEmailId:null,
    shared:[] };
}

function renderModeBadge(){
  var online = location.protocol === 'http:' || location.protocol === 'https:';
  document.querySelectorAll('.mode-badge').forEach(function(el){
    el.textContent = online ? '🌐 Онлайн-версия' : '💻 Локальная версия (offline)';
    el.title = online
      ? 'Страница отдаётся по сети. Вводите мастер-пароль только на официальном адресе.'
      : 'Файл открыт локально (file://). Данные не покидают компьютер.';
    el.classList.remove('mode-online', 'mode-offline');
    el.classList.add(online ? 'mode-online' : 'mode-offline');
  });
  // «Скачать локальную копию» имеет смысл только в веб-версии: в file:// это
  // и есть тот самый файл, качать его самого странно. Прячем кнопки и подсказку.
  document.querySelectorAll('.dl-copy-btn, .dl-copy-hint').forEach(function(el){
    el.classList.toggle('hidden', !online);
  });
}

function boot(){
  if(!window.crypto || !crypto.subtle){
    alert('Ваш браузер не поддерживает Web Crypto API (нужен современный Chrome/Firefox/Edge).');
    return;
  }
  // исходная копия DOM ДО любых динамических изменений (плашка режима и т.п.) —
  // нужна для «скачать локальную копию» и хэша в file://-копии: только так
  // сериализация DOM байт-в-байт совпадает с файлом и хэш совпадает с опубликованным
  APP_SOURCE = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  initModalCloseButtons(); // после захвата APP_SOURCE — не влияет на сериализацию/хэш
  loadSettings();          // настройки до применения темы (тема мутирует <html>, поэтому строго после APP_SOURCE)
  applyTheme();
  initThemeListener();
  renderModeBadge();
  if(!localStorage.getItem(LS_VAULTS)) migrateLegacy();
  state.vaults = loadVaults();
  if(state.vaults.length){
    state.selectedVaultId = state.vaults[0].id;
    showScreen('unlock');
    renderVaultList();
    $('unlock-pass').focus();
  } else {
    showSetupScreen('first');
  }
  startIdleWatch();
}

function renderVaultList(){
  var el = $('vault-list');
  if(typeof updateSeedUnlockLink === 'function') updateSeedUnlockLink();
  if(!state.vaults.length){
    el.innerHTML = '<div class="empty" style="padding:16px">Пока нет хранилищ — создайте первое.</div>';
    return;
  }
  el.innerHTML = state.vaults.map(function(v){
    var sel = v.id === state.selectedVaultId;
    var when = v.updatedAt ? new Date(v.updatedAt).toLocaleString() : '—';
    // когда сохранён файл и какой версии — видно прямо в карточке хранилища;
    // каждое поле своей строкой, чтобы длинное имя файла не съедало место
    var meta = 'обновлено: ' + esc(when);
    if(v.fileName) meta += '<br>файл: ' + esc(v.fileName);
    if(v.blob && v.blob.savedAt) meta += '<br>сохранено: ' + esc(new Date(v.blob.savedAt).toLocaleString());
    if(v.blob) meta += '<br>формат v' + (v.blob.version || 1) + '.' + (v.blob.kdfVersion || 1);
    return '<div class="vault-card' + (sel ? ' selected' : '') + '" onclick="selectVault(' + esc(jsStr(v.id)) + ')">'
      + '<div class="vault-name">🔐 ' + esc(v.name || 'Без названия') + '</div>'
      + '<div class="vault-meta">' + meta + '</div>'
      + '<div class="vault-actions">'
      + '<button class="btn-mini" title="Переименовать" onclick="event.stopPropagation();renameVault(' + esc(jsStr(v.id)) + ')">✎</button>'
      + '<button class="btn-mini danger" title="Удалить из списка" onclick="event.stopPropagation();deleteVault(' + esc(jsStr(v.id)) + ')">✕</button>'
      + '</div></div>';
  }).join('');
}
function selectVault(id){
  state.selectedVaultId = id;
  $('unlock-err').textContent = '';
  renderVaultList();
}
function renameVault(id){
  var v = state.vaults.find(function(x){ return x.id === id; });
  if(!v) return;
  var n = prompt('Название хранилища:', v.name);
  if(n === null) return;
  v.name = n.trim() || v.name;
  saveVaults(state.vaults);
  renderVaultList();
}
function deleteVault(id){
  var v = state.vaults.find(function(x){ return x.id === id; });
  if(!v) return;
  if(!confirm('Удалить хранилище «' + v.name + '» из этого приложения? Файл-бэкап (.json) при этом не удалится.')) return;
  state.vaults = state.vaults.filter(function(x){ return x.id !== id; });
  if(state.selectedVaultId === id) state.selectedVaultId = state.vaults.length ? state.vaults[0].id : null;
  saveVaults(state.vaults);
  renderVaultList();
}
function showSetupScreen(mode){
  state.setupMode = mode || 'additional';
  $('setup-name').value = '';
  $('setup-pass').value = '';
  $('setup-pass2').value = '';
  $('setup-err').textContent = '';
  $('setup-title').textContent = state.vaults.length ? 'Новое хранилище — отдельный мастер-пароль и отдельные данные.' : 'Создание хранилища. Здесь будет жить весь ваш парольный мир: аккаунты, данные восстановления и карта «кто через кого восстанавливается».';
  $('setup-back').classList.toggle('hidden', state.vaults.length === 0);
  showScreen('setup');
  $('setup-pass').focus();
}
function backToUnlock(){
  if(state.vaults.length){
    showScreen('unlock');
    renderVaultList();
    $('unlock-pass').focus();
  }
}

function doSetup(){
  var p1 = $('setup-pass').value, p2 = $('setup-pass2').value;
  var name = $('setup-name').value.trim() || 'Моё хранилище';
  var err = $('setup-err');
  err.textContent = '';
  if(p1.length < 8){ err.textContent = 'Мастер-пароль должен быть не короче 8 символов.'; return; }
  if(p1 !== p2){ err.textContent = 'Пароли не совпадают.'; return; }
  var btn = $('btn-setup');
  btn.disabled = true; btn.textContent = 'Создание…';
  // сбросить «хвост» предыдущей (v2-)сессии: формат выводится из блоба,
  // но остатки seed-состояния в памяти не должны переживать создание нового
  state.seedWrap = null;
  state.seedIterations = null;
  state.derivedKey = null;
  state.salt = bytesToBase64(randomBytes(16));
  return deriveKey(p1, state.salt, KDF_ITERATIONS).then(function(key){
    state.key = key;
    state.vault = { version:1, accounts:[] };
    state.vaultId = uid();
    state.vaults.push({ id: state.vaultId, name: name, blob: null, updatedAt: Date.now(), lastExportAt: null, fileName: null });
    return saveBlob();
  }).then(function(){
    enterMain();
  }).catch(function(e){
    err.textContent = 'Ошибка: ' + e.message;
  }).finally(function(){
    btn.disabled = false; btn.textContent = 'Создать хранилище';
  });
}

function tryUnlock(){
  var pw = $('unlock-pass').value;
  var btn = $('btn-unlock');
  var err = $('unlock-err');
  err.textContent = '';
  var entry = state.vaults.find(function(v){ return v.id === state.selectedVaultId; });
  if(!entry){ err.textContent = 'Выберите хранилище из списка.'; return; }
  if(!pw){ err.textContent = 'Введите мастер-пароль.'; return; }
  btn.disabled = true; btn.textContent = 'Разблокировка…';
  var blob = entry.blob;
  return deriveKey(pw, blob.salt, blob.iterations).then(function(key){
    state.derivedKey = key;
    if(blob.ekPass){
      // v2: данные под стабильным VK, производный ключ только разворачивает ekPass
      return unwrapKeyBytes(blob.ekPass, blob.ekIv, key).then(function(raw){
        return crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, true, ['encrypt','decrypt']);
      }).then(function(vk){
        state.key = vk;
        return decryptWithKey(blob, vk);
      });
    }
    state.key = key;
    return decryptWithKey(blob, key);
  }).then(function(vault){
    state.vault = vault; state.salt = blob.salt;
    state.vaultId = entry.id; state.blob = blob;
    if(blob.ekPass && blob.ekSeed){ state.seedWrap = {iv: blob.ekSeedIv, ct: blob.ekSeed}; state.seedIterations = blob.seedIterations; }
    else { state.seedWrap = null; state.seedIterations = null; }
    // миграция ролей Telegram; если что-то разбилось — сразу сохраняем новый формат
    if(migrateVaultTg(state.vault)) scheduleSave();
  }).then(function(){ enterMain(); })
    .catch(function(){ err.textContent = 'Неверный мастер-пароль.'; $('unlock-pass').select(); })
    .finally(function(){ btn.disabled = false; btn.textContent = 'Разблокировать'; });
}

function enterMain(){
  $('unlock-pass').value = '';
  state.currentAccountId = null;
  state.selected = null;
  state.cameraInitialized = false;
  showScreen('main');
  initAccountsList();
  renderAccounts();
  renderGuide();
  updateStrengthenButton();
  switchPanel('accounts');
  setStatus('Разблокировано в ' + nowTime());
  refreshBackupStatus();
}

function lock(){
  closeModals();
  if(state.key && state.vault){
    // сначала сохранить незаписанные изменения, чтобы ничего не потерять
    clearTimeout(saveTimer);
    return saveBlob().then(doLock);
  }
  doLock();
}
function doLock(){
  state.key = null;
  state.derivedKey = null;
  state.seedWrap = null;
  state.seedIterations = null;
  state.vault = null;
  state.blob = null;
  state.currentAccountId = null;
  state.selected = null;
  updateGraphTitleNotes(null);
  state.revealedIds.clear();
  state.pendingAction = null;
  state.search = '';
  if($('account-search')) $('account-search').value = '';
  state.guideSearch = '';
  if($('guide-search')) $('guide-search').value = '';
  state.vaults = loadVaults();
  if(!state.vaults.some(function(v){ return v.id === state.selectedVaultId; })){
    state.selectedVaultId = state.vaults.length ? state.vaults[0].id : null;
  }
  showScreen('unlock');
  renderVaultList();
  $('unlock-pass').value = '';
  $('unlock-err').textContent = '';
  $('unlock-pass').focus();
}

/* ================= Копия хранилища под новым паролем ================= */
function openCloneModal(){
  ['clone-name','clone-pass','clone-pass2','clone-cur'].forEach(function(id){ $(id).value = ''; });
  $('clone-err').textContent = '';
  openModal('modal-clone');
  $('clone-cur').focus();
}

function doCloneVault(){
  var cur = $('clone-cur').value, nw = $('clone-pass').value, cf = $('clone-pass2').value;
  var err = $('clone-err');
  err.textContent = '';
  var entry = currentEntry();
  var name = $('clone-name').value.trim() || 'Копия ' + (entry ? entry.name : 'хранилища');
  if(!cur){ err.textContent = 'Введите текущий мастер-пароль для подтверждения.'; return; }
  if(nw.length < 8){ err.textContent = 'Новый пароль должен быть не короче 8 символов.'; return; }
  if(nw !== cf){ err.textContent = 'Пароли не совпадают.'; return; }
  var btn = $('btn-clone');
  btn.disabled = true; btn.textContent = 'Создание…';
  return deriveKey(cur, state.salt, state.blob.iterations)
    .then(function(curKey){ return unlockWithKey(state.blob, curKey); }) // подтверждение текущим паролем
    .then(function(){
      // независимая копия данных: оригинал (state.vault) не мутируем
      var copy = JSON.parse(JSON.stringify(state.vault));
      copy.updatedAt = new Date().toISOString();
      var newSalt = bytesToBase64(randomBytes(16));
      return deriveKey(nw, newSalt, KDF_ITERATIONS).then(function(key){
        return buildBlobWith(copy, key, newSalt, KDF_ITERATIONS);
      }).then(function(blob){
        var id = uid();
        state.vaults.push({ id: id, name: name, blob: blob, updatedAt: Date.now(), lastExportAt: null, fileName: null });
        saveVaults(state.vaults);
        return blob;
      });
    })
    .then(function(blob){
      closeModal('modal-clone');
      toast('Копия «' + name + '» создана — откройте её по новому паролю с экрана входа.');
      var fname = 'rearcovery-copy-' + new Date().toISOString().slice(0,10) + '.json';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' }));
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    })
    .catch(function(){ err.textContent = 'Текущий пароль неверен.'; })
    .finally(function(){ btn.disabled = false; btn.textContent = 'Создать копию'; });
}

function openChangePass(){
  ['cp-current','cp-new','cp-confirm'].forEach(function(id){ $(id).value = ''; });
  $('cp-err').textContent = '';
  openModal('modal-change-pass');
}

function isStrengthened(){
  return !!(state.blob && state.blob.iterations >= KDF_ITERATIONS);
}
/* Кнопка «Укрепить шифрование»: когда уже на максимуме (1.2M) — показываем
 * «значок горит» (зелёный done) и блокируем повторное укрепление. */
function updateStrengthenButton(){
  var btn = $('btn-strengthen');
  if(!btn) return;
  var done = isStrengthened();
  btn.disabled = done;
  btn.classList.toggle('done', done);
  btn.textContent = done ? '🛡 Шифрование укреплено' : '🛡 Укрепить шифрование';
  btn.title = done
    ? 'Уже на максимальной мощности: PBKDF2 · ' + (KDF_ITERATIONS / 1000000) + 'M итераций'
    : 'Поднять стоимость подбора ключа: PBKDF2 ' + ((state.blob && state.blob.iterations || 0) / 1000000) + 'M → ' + (KDF_ITERATIONS / 1000000) + 'M итераций';
}

function openStrengthenKdf(){
  if(isStrengthened()){
    toast('Шифрование уже укреплено: PBKDF2 · ' + (KDF_ITERATIONS / 1000000) + 'M итераций');
    return;
  }
  $('st-pass').value = '';
  $('st-err').textContent = '';
  openModal('modal-strengthen');
}

function doChangePass(){
  var cur = $('cp-current').value, nw = $('cp-new').value, cf = $('cp-confirm').value;
  var err = $('cp-err');
  err.textContent = '';
  if(nw.length < 8){ err.textContent = 'Новый пароль должен быть не короче 8 символов.'; return; }
  if(nw !== cf){ err.textContent = 'Новые пароли не совпадают.'; return; }
  var btn = event && event.target ? event.target : null;
  return deriveKey(cur, state.salt, state.blob.iterations)
    .then(function(curKey){ return unlockWithKey(state.blob, curKey); })
    .then(function(){
      var newSalt = bytesToBase64(randomBytes(16));
      return deriveKey(nw, newSalt, KDF_ITERATIONS).then(function(key){
        state.salt = newSalt;
        state.derivedKey = key;
        if(!vaultIsV2()) state.key = key; // v1: ключ данных = новый производный; v2: VK стабилен, buildBlob переобернёт ekPass
        return saveBlob();
      });
    })
    .then(function(){
      closeModal('modal-change-pass');
      toast('Мастер-пароль изменён');
      updateStrengthenButton();
    })
    .catch(function(){ err.textContent = 'Текущий пароль неверен.'; });
}

function doStrengthenKdf(){
  var pw = $('st-pass').value;
  var err = $('st-err');
  err.textContent = '';
  if(!pw){ err.textContent = 'Введите мастер-пароль.'; return; }
  // пароль в памяти не хранится — для пере-вывода ключа нужен его ввод
  return deriveKey(pw, state.salt, state.blob.iterations)
    .then(function(oldKey){ return unlockWithKey(state.blob, oldKey); }) // проверка пароля (v1/v2)
    .then(function(){
      var newSalt = bytesToBase64(randomBytes(16));
      return deriveKey(pw, newSalt, KDF_ITERATIONS).then(function(key){
        state.salt = newSalt;
        state.derivedKey = key;
        if(!vaultIsV2()) state.key = key;
        return saveBlob();
      });
    })
    .then(function(){
      closeModal('modal-strengthen');
      toast('Шифрование укреплено: PBKDF2 · ' + (KDF_ITERATIONS / 1000000) + 'M итераций');
      updateStrengthenButton();
    })
    .catch(function(){ err.textContent = 'Неверный мастер-пароль.'; });
}

/* ================= Данные: операции над аккаунтами ================= */
function saveAccount(){
  var a = readEditorForm();
  if(!a.name.trim()){ toast('Укажите название аккаунта'); return; }
  // у ролей Telegram ровно один выход: уведомления не имеют «исходной почты», восстановление — «почты уведомлений»
  if(a.type === 'telegram-notify') a.recovery.viaAccountId = null;
  if(a.type === 'telegram-recovery') a.notifyEmailId = null;
  if(a.recovery.viaAccountId === a.id){ toast('Аккаунт не может восстанавливаться сам через себя'); return; }
  if(a.notifyEmailId === a.id){ toast('Почта уведомлений не может быть самим аккаунтом'); return; }
  if(a.parentId){
    if(a.parentId === a.id){ toast('Аккаунт не может быть внутри самого себя'); return; }
    var par = findAccount(a.parentId);
    if(!par || par.parentId){ toast('Вложить можно только в аккаунт верхнего уровня'); return; }
  }
  if(state.currentAccountId){
    var i = state.vault.accounts.findIndex(function(x){ return x.id === state.currentAccountId; });
    if(i >= 0) state.vault.accounts[i] = a;
  }else{
    state.vault.accounts.push(a);
  }
  state.currentAccountId = null;
  closeModal('modal-editor');
  scheduleSave();
  renderAccounts();
  renderGuide();
}

function requestAuth(action, accountId){
  if(state.streamMode){ toast('В режиме стрима данные скрыты — сначала нажмите «Показать данные»'); return; }
  var a = accountId ? state.vault.accounts.find(function(x){ return x.id === accountId; }) : null;
  state.pendingAction = { action: action, accountId: accountId };
  var isDelete = action === 'delete';
  $('auth-title').textContent = isDelete ? '🗑 Удаление аккаунта' : '✎ Изменение аккаунта';
  var kids = a ? containerChildren(a) : [];
  $('auth-msg').textContent = isDelete
    ? 'Вы действительно хотите удалить «' + (a ? a.name : 'аккаунт') + '» и все его данные?'
      + (kids.length ? ' Вложенных сервисов внутри: ' + kids.length + ' — они будут откреплены (станут отдельными нодами), не удалены.' : '')
      + ' Это действие необратимо.'
    : 'Для изменения «' + (a ? a.name : 'аккаунта') + '» введите мастер-пароль.';
  $('btn-auth').textContent = isDelete ? 'Удалить' : 'Изменить';
  $('auth-pass').value = '';
  $('auth-err').textContent = '';
  openModal('modal-auth');
  $('auth-pass').focus();
}
function closeAuthModal(){
  closeModal('modal-auth');
  state.pendingAction = null;
  $('auth-pass').value = '';
  $('auth-err').textContent = '';
}
function confirmAuth(){
  var pw = $('auth-pass').value;
  var err = $('auth-err');
  var pa = state.pendingAction;
  if(!pa){ closeAuthModal(); return; }
  if(!pw){ err.textContent = 'Введите мастер-пароль.'; return; }
  var btn = $('btn-auth');
  btn.disabled = true; btn.textContent = 'Проверка…';
  deriveKey(pw, state.salt, state.blob.iterations).then(function(key){
    return unlockWithKey(state.blob, key);
  }).then(function(){
    if(pa.action === 'delete-multi'){
      (pa.accountIds || []).forEach(function(id){ deleteAccountNow(id); });
      state.selectedIds.clear();
      state.selected = null;
      state.currentAccountId = null;
      var selg = $('guide-select');
      if(selg) selg.value = '';
      renderGraph();
    } else if(pa.action === 'delete'){
      deleteAccountNow(pa.accountId);
      closeModal('modal-editor');
    } else {
      openEditor(pa.accountId);
    }
    closeAuthModal();
  }).catch(function(){
    err.textContent = 'Неверный мастер-пароль.';
  }).finally(function(){
    btn.disabled = false; btn.textContent = pa.action === 'delete' ? 'Удалить' : 'Изменить';
  });
}
function requestAuthMultiple(action, ids){
  if(state.streamMode){ toast('В режиме стрима данные скрыты — сначала нажмите «Показать данные»'); return; }
  state.pendingAction = { action: action, accountIds: ids };
  $('auth-title').textContent = '🗑 Удаление ' + ids.length + ' аккаунтов';
  $('auth-msg').textContent = 'Вы действительно хотите удалить выбранные ' + ids.length + ' аккаунта(ов) и все их данные? Вложенные сервисы будут откреплены (станут отдельными нодами). Это действие необратимо.';
  $('btn-auth').textContent = 'Удалить';
  $('auth-pass').value = '';
  $('auth-err').textContent = '';
  openModal('modal-auth');
  $('auth-pass').focus();
}
function requestDeleteAccount(id){ requestAuth('delete', id); }
function requestAccountEdit(id){ requestAuth('edit', id); }
function deleteAccountNow(id){
  // вложенные сервисы открепляются (становятся отдельными), а не удаляются
  state.vault.accounts.forEach(function(a){ if(a.parentId === id) a.parentId = null; });
  state.vault.accounts = state.vault.accounts.filter(function(a){ return a.id !== id; });
  state.vault.accounts.forEach(function(a){
    if(a.recovery && a.recovery.viaAccountId === id) a.recovery.viaAccountId = null;
    if(a.notifyEmailId === id) a.notifyEmailId = null;
  });
  if(state.currentAccountId === id) state.currentAccountId = null;
  if(state.selected && state.selected.kind === 'node' && state.selected.id === id) state.selected = null;
  scheduleSave();
  renderAccounts();
  renderGuide();
}
