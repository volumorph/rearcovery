/* ================= Seed-фраза: интерфейс ================= */
/* Настройка (тулбар «🌱 Seed-фраза»), отключение, восстановление с экрана входа. */
/* Предупреждение «seed не настроен» в панели «Путеводитель» (после разблокировки) */
function updateGuideSeedWarn(){
  var el = $('guide-seed-warn');
  if(!el) return;
  el.classList.toggle('hidden', !!(state.seedWrap && state.seedWrap.ct));
}

function updateSeedUnlockLink(){
  var el = $('unlock-seed-link');
  var warn = $('unlock-seed-warn');
  if(!el) return;
  var entry = state.vaults.find(function(v){ return v.id === state.selectedVaultId; });
  var hasSeed = !!(entry && entry.blob && entry.blob.ekSeed);
  el.classList.toggle('hidden', !hasSeed);
  if(warn) warn.classList.toggle('hidden', !entry || hasSeed);
}

function showSeedStep(step){
  ['seed-step-state', 'seed-step-show', 'seed-step-verify'].forEach(function(id){
    $(id).classList.toggle('hidden', id !== 'seed-step-' + step);
  });
}

function openSeedModal(){
  $('seed-pass').value = '';
  $('seed-err').textContent = '';
  $('seed-verify-err').textContent = '';
  var active = !!(state.vault && state.vault.seedEnabled);
  $('seed-state-note').innerHTML = active
    ? 'Seed-восстановление <b>активно</b>: фраза из 12 слов позволяет получить доступ к хранилищу, если забыт мастер-пароль. Фраза — второй полный ключ, храните её офлайн.'
    : 'Seed-восстановление <b>выключено</b> (по умолчанию). Включите — будет сгенерирована фраза из 12 слов; она показывается один раз, запишите её.';
  $('btn-seed-main').classList.toggle('hidden', active);
  $('btn-seed-remove').classList.toggle('hidden', !active);
  showSeedStep('state');
  openModal('modal-seed');
  $('seed-pass').focus();
}

function doSeedGenerate(){
  var pw = $('seed-pass').value;
  var err = $('seed-err');
  err.textContent = '';
  if(!pw){ err.textContent = 'Введите мастер-пароль для подтверждения.'; return; }
  var btn = $('btn-seed-main');
  btn.disabled = true; btn.textContent = 'Генерация…';
  return deriveKey(pw, state.salt, state.blob.iterations)
    .then(function(dk){ return unlockWithKey(state.blob, dk); }) // подтверждение пароля
    .then(function(){ return generateSeedPhrase(); })
    .then(function(phrase){
      state.seedPending = { phrase: phrase };
      var words = phrase.split(' ');
      $('seed-words').innerHTML = words.map(function(w, i){
        return '<span class="seed-word"><b>' + (i + 1) + '.</b> ' + esc(w) + '</span>';
      }).join('');
      showSeedStep('show');
    })
    .catch(function(){ err.textContent = 'Неверный мастер-пароль.'; })
    .finally(function(){ btn.disabled = false; btn.textContent = '🌱 Сгенерировать фразу'; });
}

function doSeedVerifyStart(){
  var words = state.seedPending.phrase.split(' ');
  var pool = [];
  while(pool.length < 3){
    var r = Math.floor(Math.random() * words.length);
    if(pool.indexOf(r) === -1) pool.push(r);
  }
  state.seedPending.ask = pool.slice().sort(function(a, b){ return a - b; });
  $('seed-ask').textContent = pool.map(function(i){ return i + 1; }).join(', ');
  $('seed-verify-inputs').innerHTML = pool.map(function(i, k){
    return '<div class="field" style="margin-top:8px"><label>Слово №' + (i + 1) + '</label>'
      + '<input type="text" id="seed-vi-' + k + '" autocomplete="off" spellcheck="false"></div>';
  }).join('');
  $('seed-verify-err').textContent = '';
  showSeedStep('verify');
  $('seed-vi-0').focus();
}

function doSeedSetupConfirm(){
  var phrase = state.seedPending.phrase;
  var ws = normalizeSeedPhrase(phrase).split(' ');
  var ask = state.seedPending.ask || [];
  for(var i = 0; i < ask.length; i++){
    var inp = $('seed-vi-' + i);
    var val = inp ? normalizeSeedPhrase(inp.value) : '';
    if(val !== ws[ask[i]]){
      $('seed-verify-err').textContent = 'Слово №' + (ask[i] + 1) + ' не совпало — сверьтесь с записанной фразой.';
      return;
    }
  }
  var pw = $('seed-pass').value;
  var err = $('seed-err');
  err.textContent = '';
  if(!pw){ err.textContent = 'Введите мастер-пароль.'; return; }
  var btn = event && event.target ? event.target : null;
  if(btn){ btn.disabled = true; btn.textContent = 'Настройка…'; }
  return deriveKey(pw, state.salt, state.blob.iterations)
    .then(function(dk){ return unlockWithKey(state.blob, dk).then(function(){ state.derivedKey = dk; }); })
    .then(function(){
      var seedKeyP = deriveSeedKey(phrase);
      var vkRawP;
      if(!state.v2){
        // v1 → v2: новый случайный VK, данные перешифровываются
        vkRawP = Promise.resolve(randomBytes(32)).then(function(raw){
          return crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, true, ['encrypt','decrypt']).then(function(vk){
            state.key = vk; state.v2 = true;
            return raw;
          });
        });
      } else {
        vkRawP = crypto.subtle.exportKey('raw', state.key);
      }
      return Promise.all([seedKeyP, vkRawP]).then(function(res){
        return wrapKeyBytes(res[1], res[0]).then(function(ek){
          state.seedWrap = { iv: ek.iv, ct: ek.ct };
          state.seedIterations = SEED_KDF_ITERATIONS;
          state.vault.seedEnabled = true;
          return saveBlob();
        });
      });
    })
    .then(function(){
      state.seedPending = null;
      closeModal('modal-seed');
      updateGuideSeedWarn();
      toast('Seed-фраза настроена. Храните её в надёжном месте.');
    })
    .catch(function(e){
      state.seedPending = null;
      $('seed-verify-err').textContent = e && e.message ? e.message : 'Не удалось настроить seed.';
      if(btn){ btn.disabled = false; btn.textContent = 'Подтвердить'; }
    });
}

function doSeedRemove(){
  var pw = $('seed-pass').value;
  var err = $('seed-err');
  err.textContent = '';
  if(!pw){ err.textContent = 'Введите мастер-пароль.'; return; }
  var btn = $('btn-seed-remove');
  btn.disabled = true; btn.textContent = 'Отключение…';
  return deriveKey(pw, state.salt, state.blob.iterations)
    .then(function(dk){ return unlockWithKey(state.blob, dk); })
    .then(function(){
      state.seedWrap = null;
      state.seedIterations = null;
      state.vault.seedEnabled = false;
      return saveBlob();
    })
    .then(function(){
      closeModal('modal-seed');
      updateGuideSeedWarn();
      toast('Seed-восстановление отключено. Фраза больше не сможет открыть хранилище.');
    })
    .catch(function(){ err.textContent = 'Неверный мастер-пароль.'; })
    .finally(function(){ if(btn){ btn.disabled = false; btn.textContent = '🗑 Отключить восстановление по seed'; } });
}

/* Восстановление доступа с экрана разблокировки */
function openSeedRecover(){
  $('seed-recover-input').value = '';
  $('seed-recover-pass').value = '';
  $('seed-recover-pass2').value = '';
  $('seed-recover-err').textContent = '';
  openModal('modal-seed-recover');
  $('seed-recover-input').focus();
}

function doSeedRecover(){
  var phrase = $('seed-recover-input').value;
  var nw = $('seed-recover-pass').value;
  var cf = $('seed-recover-pass2').value;
  var err = $('seed-recover-err');
  err.textContent = '';
  if(!phrase.trim()){ err.textContent = 'Введите seed-фразу (12 слов).'; return; }
  if(nw.length < 8){ err.textContent = 'Новый мастер-пароль должен быть не короче 8 символов.'; return; }
  if(nw !== cf){ err.textContent = 'Новые пароли не совпадают.'; return; }
  var entry = state.vaults.find(function(v){ return v.id === state.selectedVaultId; });
  if(!entry || !entry.blob || !entry.blob.ekSeed){ err.textContent = 'Для этого хранилища seed-восстановление не настроено.'; return; }
  var blob = entry.blob;
  var btn = event && event.target ? event.target : null;
  if(btn){ btn.disabled = true; btn.textContent = 'Проверка…'; }
  return seedPhraseValid(phrase).then(function(ok){
    if(!ok) throw new Error('Seed-фраза не распознана — проверьте слова.');
    return deriveSeedKey(phrase, blob.seedIterations || SEED_KDF_ITERATIONS);
  }).then(function(seedKey){
    return unwrapKeyBytes(blob.ekSeed, blob.ekSeedIv, seedKey).then(function(raw){
      return crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, true, ['encrypt','decrypt']);
    }).then(function(vk){
      return decryptWithKey(blob, vk).then(function(vault){
        var newSalt = bytesToBase64(randomBytes(16));
        return deriveKey(nw, newSalt, KDF_ITERATIONS).then(function(newDk){
          state.key = vk;
          state.derivedKey = newDk;
          state.v2 = true;
          state.seedWrap = { iv: blob.ekSeedIv, ct: blob.ekSeed };
          state.seedIterations = blob.seedIterations || SEED_KDF_ITERATIONS;
          state.vault = vault;
          state.vault.seedEnabled = true;
          state.salt = newSalt;
          state.blob = blob;
          state.vaultId = entry.id;
          return saveBlob();
        });
      });
    });
  }).then(function(){
    closeModal('modal-seed-recover');
    $('seed-recover-input').value = '';
    $('seed-recover-pass').value = '';
    $('seed-recover-pass2').value = '';
    enterMain();
    toast('Доступ восстановлен по seed-фразе. Установлен новый мастер-пароль.');
  }).catch(function(e){
    err.textContent = e && e.message ? e.message : 'Не удалось восстановить доступ.';
  }).finally(function(){
    if(btn){ btn.disabled = false; btn.textContent = 'Восстановить доступ'; }
  });
}
