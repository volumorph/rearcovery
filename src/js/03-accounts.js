/* ================= Вкладки боковой панели ================= */
function switchPanel(name){
  document.querySelectorAll('.panel-tab').forEach(function(t){
    t.classList.toggle('active', t.dataset.panel === name);
  });
  $('panel-accounts').classList.toggle('hidden', name !== 'accounts');
  $('panel-guide').classList.toggle('hidden', name !== 'guide');
}

function accountHay(a){
  var r = a.recovery || {};
  return [a.name, a.username, a.notes, r.notes, r.phone, r.codes]
    .concat((r.questions || []).map(function(x){ return (x.q || '') + ' ' + (x.a || ''); }))
    .concat((a.shared || []).map(function(s){ return s.name + ' ' + s.username; }))
    .join(' ').toLowerCase();
}
function filterAccounts(){
  var q = (state.search || '').trim().toLowerCase();
  if(!q) return state.vault.accounts.slice();
  return state.vault.accounts.filter(function(a){ return accountHay(a).indexOf(q) !== -1; });
}
function onAccountSearch(v){ state.search = v || ''; renderAccounts(); }

function dupPasswordGroups(){
  var groups = new Map(); // пароль -> [аккаунты]
  state.vault.accounts.forEach(function(a){
    if(!a.password) return;
    if(!groups.has(a.password)) groups.set(a.password, []);
    groups.get(a.password).push(a);
  });
  var res = [];
  groups.forEach(function(accs){
    // пара «Telegram (восстановление)» + «Telegram (уведомления)», возникшая при
    // разбиении одного старого Telegram, — не дубль, это одна и та же учётка
    if(accs.length === 2 && tgSplitPair(accs[0], accs[1])) return;
    if(accs.length > 1) res.push(accs);
  });
  return res;
}
function tgSplitPair(a, b){
  var isTg = function(x){ return x.type === 'telegram-notify' || x.type === 'telegram-recovery'; };
  if(!isTg(a) || !isTg(b) || a.type === b.type) return false;
  var n1 = (a.name || '').replace(/ \(уведомления\)$/, '');
  var n2 = (b.name || '').replace(/ \(уведомления\)$/, '');
  return n1 === n2 && (a.parentId || null) === (b.parentId || null);
}
function dupPasswordIds(){
  var s = new Set();
  dupPasswordGroups().forEach(function(accs){ accs.forEach(function(a){ s.add(a.id); }); });
  return s;
}

function renderAccounts(){
  var el = $('accounts-list');
  var q = (state.search || '').trim().toLowerCase();
  if(!state.vault.accounts.length){
    el.innerHTML = '<div class="empty">Пока нет аккаунтов.<br>Нажмите «＋ Добавить аккаунт», чтобы внести почту, сервис или что угодно, и связать их через восстановление.</div>';
    return;
  }
  var dupIds = dupPasswordIds();
  var html = '';
  state.vault.accounts.forEach(function(a){
    if(a.parentId) return; // вложенные рендерятся внутри родителя
    var ch = containerChildren(a);
    var kids;
    if(q){
      var parentOk = accountHay(a).indexOf(q) !== -1;
      kids = ch.filter(function(c){ return accountHay(c).indexOf(q) !== -1; });
      if(!parentOk && !kids.length) return; // не совпал ни родитель, ни дети
    } else {
      kids = ch;
    }
    html += accountCard(a, dupIds, false);
    kids.forEach(function(c){ html += accountCard(c, dupIds, true); });
  });
  el.innerHTML = html || '<div class="empty">Ничего не найдено по запросу «' + esc(state.search) + '».</div>';
}

function accountCard(a, dupIds, nested){
  var r = a.recovery || {};
  var via = r.viaAccountId ? state.vault.accounts.find(function(x){ return x.id === r.viaAccountId; }) : null;
  var shown = state.revealedIds.has(a.id);
  var pwHtml = a.password
    ? (shown ? esc(a.password) : '••••••••••••')
    : '<span style="color:#e05a5a;font-weight:600">пароль не записан</span>';
  var badges = [];
  if(r.codes) badges.push('резервные коды');
  if(r.phone) badges.push('телефон/резерв');
  if((r.questions||[]).length) badges.push('вопросы');
  if(a.shared && a.shared.length) badges.push('общий доступ ×' + a.shared.length);
  var nch = containerChildren(a).length;
  if(nch) badges.push(nch + ' вложено');
  var meta = via ? 'восстанавливается через ' + esc(via.name || '?') : '';
  if(a.type === 'telegram-notify' && a.notifyEmailId){
    var nf = state.vault.accounts.find(function(x){ return x.id === a.notifyEmailId; });
    meta += (meta ? ' · ' : '') + 'уведомления → ' + esc(nf ? (nf.name || '?') : '?');
  }
  var badgeHtml = badges.map(function(b){ return '<span class="badge">' + esc(b) + '</span>'; }).join('');
  if(dupIds && dupIds.has(a.id)) badgeHtml += '<span class="badge warn">⚠️ дубль пароля</span>';
  var rows = '';
  if(a.username){
    rows += '<div class="kv"><span>Логин / e-mail</span><code>' + esc(a.username) + '</code>'
      + '<button class="btn-mini" onclick="copyText(' + esc(jsStr(a.username)) + ')">Копировать</button></div>';
  }
  rows += '<div class="kv"><span>Пароль</span><code class="pw">' + pwHtml + '</code>'
    + (a.password
      ? '<span class="kv-actions"><button class="btn-mini" onclick="toggleReveal(' + esc(jsStr(a.id)) + ')">' + (shown ? 'Скрыть' : 'Показать') + '</button><button class="btn-mini" onclick="copyAccountPassword(' + esc(jsStr(a.id)) + ')">Копировать</button></span>'
      : '<span></span>') + '</div>';
  if(r.codes){
    rows += '<div class="kv"><span>Резервные коды</span><pre>' + esc(r.codes) + '</pre>'
      + '<button class="btn-mini" onclick="copyText(' + esc(jsStr(r.codes)) + ')">Копировать</button></div>';
  }
  if(r.phone){
    rows += '<div class="kv"><span>Телефон / резерв</span><code>' + esc(r.phone) + '</code><span></span></div>';
  }
  if(r.notes){
    rows += '<div class="kv"><span>Прочее</span><code>' + esc(r.notes) + '</code><span></span></div>';
  }
  if((r.questions||[]).length){
    rows += r.questions.filter(function(q){ return q.a; }).map(function(q){
      return '<div class="kv"><span>Вопрос: ' + esc(q.q || '—') + '</span><code>' + esc(q.a) + '</code>'
        + '<button class="btn-mini" onclick="copyText(' + esc(jsStr(q.a)) + ')">Копировать</button></div>';
    }).join('');
  }
  if(a.shared && a.shared.length){
    rows += '<div class="kv"><span>Общий доступ</span><code>' + esc(a.shared.map(function(s){ return s.name || (s.username || 'логин'); }).join(', ')) + '</code><span></span></div>';
  }
  return '<div class="acc-card' + (nested ? ' nested' : '') + (state.currentAccountId === a.id ? ' selected' : '') + '" data-id="' + esc(a.id) + '">'
    + '<div class="acc-head"><div class="acc-title">'
    + '<span class="acc-name-wrap">' + typeIconSvg(a.type, a.name, 20) + '<span class="acc-name">' + esc(a.name || 'Без названия') + '</span></span>'
    + (meta ? '<span class="acc-meta">' + meta + '</span>' : '')
    + badgeHtml
    + '</div><div class="acc-actions">'
    + '<button class="btn-mini" onclick="requestAccountEdit(' + esc(jsStr(a.id)) + ')">Изменить</button>'
    + '<button class="btn-mini danger" onclick="requestDeleteAccount(' + esc(jsStr(a.id)) + ')">Удалить</button>'
    + '</div></div>'
    + '<div class="acc-secret">' + rows + '</div></div>';
}

function findAccount(id){ return state.vault.accounts.find(function(a){ return a.id === id; }); }
function toggleReveal(id){
  var a = findAccount(id);
  if(!a) return;
  if(state.revealedIds.has(id)) state.revealedIds.delete(id); else state.revealedIds.add(id);
  renderAccounts();
}
function copyAccountPassword(id){
  var a = findAccount(id);
  if(a && a.password) copyText(a.password, { secret: true });
}

/* ================= Редактор аккаунта ================= */
function openEditor(id){
  if(state.streamMode){ toast('В режиме стрима данные скрыты — сначала нажмите «Показать данные»'); return; }
  var a = id ? findAccount(id) : null;
  state.currentAccountId = id || null;
  var f = a || emptyAccount();
  $('editor-title').textContent = a ? 'Аккаунт: ' + (a.name || 'Без названия') : 'Новый аккаунт';
  var others = state.vault.accounts.filter(function(x){ return x.id !== f.id; });
  var viaOpts = '<option value="">— не восстанавливается —</option>'
    + others.map(function(o){
      return '<option value="' + esc(o.id) + '"' + (f.recovery.viaAccountId === o.id ? ' selected' : '') + '>' + esc(o.name || 'Без названия') + '</option>';
    }).join('');
  var notifyOpts = '<option value="">— нет —</option>'
    + others.map(function(o){
      return '<option value="' + esc(o.id) + '"' + (f.notifyEmailId === o.id ? ' selected' : '') + '>' + esc(o.name || 'Без названия') + '</option>';
    }).join('');
  var typeOpts = Object.keys(ACCOUNT_TYPES).map(function(k){
    return '<option value="' + esc(k) + '"' + (f.type === k ? ' selected' : '') + '>' + esc(ACCOUNT_TYPES[k].label) + '</option>';
  }).join('');
  // «внутри аккаунта»: только верхний уровень (контейнеры), и нельзя вкладывать
  // в собственного потомка (цикл). Вложенный в родителя не может быть контейнером.
  var parentOpts = '<option value="">— верхний уровень —</option>'
    + others.filter(function(o){ return !o.parentId && !descendantIds(f.id).has(o.id); }).map(function(o){
      return '<option value="' + esc(o.id) + '"' + (f.parentId === o.id ? ' selected' : '') + '>' + esc(o.name || 'Без названия') + '</option>';
    }).join('');

  var qRows = (f.recovery.questions||[]).map(function(q){
    return questionRow(esc(q.q), esc(q.a));
  }).join('');
  var shRows = (f.shared||[]).map(function(s){
    return sharedRow(esc(s.name), esc(s.username), esc(s.password));
  }).join('');

  $('editor-form').innerHTML =
    '<div class="grid2">'
    + '<div class="field"><label>Название *</label><input id="ed-name" value="' + esc(f.name) + '" placeholder="Например: Почта A"></div>'
    + '<div class="field"><label>Логин / e-mail</label><input id="ed-username" value="' + esc(f.username) + '" autocomplete="off" spellcheck="false"></div>'
    + '</div>'
    + '<div class="field"><label>Пароль</label><div class="pw-wrap">'
    + '<input id="ed-password" type="password" value="' + esc(f.password) + '" autocomplete="new-password" spellcheck="false">'
    + '<button type="button" class="btn-mini" onclick="toggleInputType(this)">👁</button>'
    + '<button type="button" class="btn-mini" onclick="genIntoEditor()">🎲 Сгенерировать</button>'
    + '</div></div>'
    + '<div class="field"><label>Тип / сервис</label><select id="ed-type">' + typeOpts + '</select></div>'
    + '<div class="field"><label>Внутри аккаунта (необязательно)</label><select id="ed-parent">' + parentOpts + '</select>'
    + '<div class="hint">Сервис появится списком с иконками внутри выбранного аккаунта-контейнера (например, внутри почты) — без лишних проводов на карте. Маршрут восстановления наследуется от родителя, если у сервиса нет своего.</div></div>'
    + '<div class="field"><label>Заметки</label><textarea id="ed-notes" rows="2">' + esc(f.notes) + '</textarea></div>'

    + '<div class="subhead">🔁 Восстановление доступа</div>'
    + '<div id="ed-via-wrap"><div class="field"><label>Этот аккаунт восстанавливается через</label><select id="ed-via">' + viaOpts + '</select>'
    + '<div class="hint">Выберите другой аккаунт (например, почту, к которой привязано восстановление). Так строится маршрут в «Путеводителе». Для «Telegram (восстановление)» это исходная почта — красный выход ноды.</div></div></div>'
    + '<div id="ed-notify-wrap" style="display:none"><div class="field"><label>🔔 Почта для уведомлений</label><select id="ed-notify">' + notifyOpts + '</select>'
    + '<div class="hint">Почта, на которую Telegram шлёт уведомления о входе. На графе — зелёный выход ноды (только у «Telegram (уведомления)»).</div></div></div>'
    + '<div class="field"><label>Резервные коды</label><textarea id="ed-codes" rows="2" placeholder="Одноразовые коды восстановления, по одному на строку">' + esc(f.recovery.codes) + '</textarea></div>'
    + '<div class="grid2">'
    + '<div class="field"><label>Телефон / резервная почта</label><input id="ed-phone" value="' + esc(f.recovery.phone) + '"></div>'
    + '<div class="field"><label>Прочее (SMS, приложение…)</label><input id="ed-rnotes" value="' + esc(f.recovery.notes) + '"></div>'
    + '</div>'
    + '<div class="field"><label>Контрольные вопросы</label><div id="q-rows">' + qRows + '</div>'
    + '<button type="button" class="btn-mini" onclick="addQuestionRow()">＋ Вопрос</button></div>'

    + '<div class="subhead">👥 Кто ещё может входить (общие пароли)</div>'
    + '<div id="shared-rows">' + shRows + '</div>'
    + '<button type="button" class="btn-mini" onclick="addSharedRow()">＋ Добавить</button>'

    + '<div class="form-actions">'
    + '<button type="submit" class="btn">💾 Сохранить</button>'
    + (a ? '<button type="button" class="btn danger" onclick="requestDeleteAccount(' + esc(jsStr(a.id)) + ')">Удалить</button>' : '')
    + '<span class="spacer"></span>'
    + '<button type="button" class="btn secondary" onclick="closeModal(\'modal-editor\')">Отмена</button>'
    + '</div>';

  $('ed-type').addEventListener('change', syncNotifyField);
  syncNotifyField();
  openModal('modal-editor');
}
function syncNotifyField(){
  var t = ($('ed-type') || {}).value;
  var wrap = $('ed-notify-wrap');
  if(wrap) wrap.style.display = t === 'telegram-notify' ? '' : 'none';
  var viaWrap = $('ed-via-wrap');
  if(viaWrap) viaWrap.style.display = t === 'telegram-notify' ? 'none' : '';
}

function questionRow(q, a){
  return '<div class="rowline q-row">'
    + '<input class="q" placeholder="Вопрос" value="' + (q||'') + '">'
    + '<input class="a" placeholder="Ответ" value="' + (a||'') + '">'
    + '<button type="button" class="btn-mini danger" onclick="removeRow(this)">✕</button></div>';
}
function sharedRow(n, u, p){
  return '<div class="rowline shared-row">'
    + '<input class="sh-name" placeholder="Название (кто это)" value="' + (n||'') + '">'
    + '<input class="sh-user" placeholder="Логин" value="' + (u||'') + '">'
    + '<div class="pw-wrap"><input class="sh-pass" type="password" placeholder="Пароль" value="' + (p||'') + '">'
    + '<button type="button" class="btn-mini" onclick="toggleInputType(this)">👁</button></div>'
    + '<button type="button" class="btn-mini danger" onclick="removeRow(this)">✕</button></div>';
}
function addQuestionRow(){
  var div = document.createElement('div');
  div.innerHTML = questionRow('','');
  var row = div.firstChild;
  $('q-rows').appendChild(row);
  row.querySelector('.q').focus();
}
function addSharedRow(){
  var div = document.createElement('div');
  div.innerHTML = sharedRow('','','');
  var row = div.firstChild;
  $('shared-rows').appendChild(row);
  row.querySelector('.sh-name').focus();
}
function removeRow(btn){ btn.closest('.rowline').remove(); }
function toggleInputType(btn){
  var inp = btn.previousElementSibling;
  if(!inp || inp.tagName !== 'INPUT') return;
  var show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
}
function genIntoEditor(){
  var pw = generatePassword();
  var el = $('ed-password');
  if(el){ el.value = pw; el.type = 'text'; }
  toast('Пароль сгенерирован');
}
function readEditorForm(){
  var val = function(id){ var el = $(id); return el ? el.value : ''; };
  var questions = Array.prototype.slice.call(document.querySelectorAll('#editor-form .q-row')).map(function(r){
    return { q: r.querySelector('.q').value, a: r.querySelector('.a').value };
  }).filter(function(x){ return x.q || x.a; });
  var shared = Array.prototype.slice.call(document.querySelectorAll('#editor-form .shared-row')).map(function(r){
    return { name: r.querySelector('.sh-name').value, username: r.querySelector('.sh-user').value, password: r.querySelector('.sh-pass').value };
  }).filter(function(x){ return x.name || x.username || x.password; });
  return {
    id: state.currentAccountId || uid(),
    type: val('ed-type'),
    name: val('ed-name'), username: val('ed-username'), password: val('ed-password'), notes: val('ed-notes'),
    parentId: val('ed-parent') || null,
    recovery: {
      viaAccountId: val('ed-via') || null,
      codes: val('ed-codes'), phone: val('ed-phone'), notes: val('ed-rnotes'),
      questions: questions
    },
    notifyEmailId: val('ed-notify') || null,
    shared: shared
  };
}
