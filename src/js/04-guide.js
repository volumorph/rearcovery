/* ================= Вкладка «Путеводитель» ================= */
function analyzeRecovery(){
  var byId = new Map(state.vault.accounts.map(function(a){ return [a.id, a]; }));
  var inCycle = new Set();
  var color = new Map(); // 1 = в стеке, 2 = обработан
  function dfs(id, stack){
    color.set(id, 1); stack.push(id);
    var a = byId.get(id);
    var via = a && a.recovery ? a.recovery.viaAccountId : null;
    if(via && byId.has(via)){
      if(color.get(via) === 1){
        var i = stack.indexOf(via);
        for(var k = i; k < stack.length; k++) inCycle.add(stack[k]);
      } else if(color.get(via) !== 2){
        dfs(via, stack);
      }
    }
    stack.pop(); color.set(id, 2);
  }
  state.vault.accounts.forEach(function(a){ if(color.get(a.id) !== 2) dfs(a.id, []); });

  var depthOf = new Map();
  function depth(id){
    if(depthOf.has(id)) return depthOf.get(id);
    var a = byId.get(id);
    var via = a && a.recovery ? a.recovery.viaAccountId : null;
    var d = 0;
    if(via && byId.has(via)) d = inCycle.has(via) ? 1 : 1 + depth(via);
    depthOf.set(id, d);
    return d;
  }
  state.vault.accounts.forEach(function(a){ if(!inCycle.has(a.id)) depth(a.id); });
  inCycle.forEach(function(id){ depthOf.set(id, 0); });
  return { inCycle: inCycle, depthOf: depthOf };
}

function chainFor(id){
  var byId = new Map(state.vault.accounts.map(function(a){ return [a.id, a]; }));
  var steps = [], seen = new Set();
  var cur = byId.get(id), cycle = false;
  while(cur){
    if(seen.has(cur.id)){ cycle = true; steps.push(cur); break; }
    seen.add(cur.id);
    steps.push(cur);
    var via = cur.recovery ? cur.recovery.viaAccountId : null;
    cur = (via && byId.has(via)) ? byId.get(via) : null;
  }
  return { steps: steps, cycle: cycle };
}

function chainIds(){
  if(!state.currentAccountId || !state.vault.accounts.length) return null;
  var chain = chainFor(state.currentAccountId);
  if(!chain || !chain.steps.length) return null;
  var s = new Set();
  chain.steps.forEach(function(a){ s.add(a.id); });
  return s;
}

function updateChainHighlight(){
  if(!svgEl) return;
  var chain = chainIds();
  svgEl.querySelectorAll('.g-node').forEach(function(ng){
    var id = ng.getAttribute('data-id');
    var inChain = chain && chain.has(id);
    var dim = !!chain && !inChain;
    ng.setAttribute('opacity', dim ? '0.45' : '1');
    var body = ng.querySelector('.g-node-body');
    if(body){
      var selected = state.selected && state.selected.kind === 'node' && state.selected.id === id;
      body.setAttribute('stroke', selected ? '#f5a623' : (inChain ? '#4da3ff' : '#24282e'));
      body.setAttribute('stroke-width', selected ? '2.6' : (inChain ? '2.4' : '1.2'));
    }
  });
  svgEl.querySelectorAll('.g-wire').forEach(function(w){
    var key = w.getAttribute('data-key');
    var kind = w.getAttribute('data-kind') || 'via';
    var inChain = false;
    if(chain && key && key.indexOf('>') > 0){
      var parts = key.split('>');
      inChain = chain.has(parts[0]) && chain.has(parts[1]);
    }
    var sel = state.selected && state.selected.kind === 'wire' && state.selected.key === key;
    var dim = !!chain && !inChain;
    var src = accById(w.getAttribute('data-src'));
    var base = kind === 'notify' ? '#4caf7d' : (src && src.type === 'telegram' ? '#e05a5a' : '#77808c');
    w.setAttribute('opacity', dim ? '0.3' : '1');
    w.setAttribute('stroke', sel ? '#f5a623' : (kind === 'via' && inChain ? '#4da3ff' : base));
    w.setAttribute('stroke-width', sel ? '2.8' : (kind === 'via' && inChain ? '2.6' : '1.8'));
  });
}

function hasRecoveryData(r){
  return !!(r && (r.codes || r.phone || r.notes || (r.questions && r.questions.length)));
}

function computeRisks(){
  var risks = [];
  if(!state.vault.accounts.length) return risks;
  var anal = analyzeRecovery();
  state.vault.accounts.forEach(function(a){
    var r = a.recovery || {};
    if(!r.viaAccountId && !hasRecoveryData(r)){
      risks.push({ a: a, type: 'no-recovery', text: 'нет ни пути, ни данных восстановления — при потере доступа вернуться не получится' });
    }
    if(anal.inCycle.has(a.id)){
      risks.push({ a: a, type: 'cycle', text: 'участвует в цикле восстановления (A→B→A) — разорвите цикл' });
    }
    if(a.password && a.password.length > 0 && a.password.length < 8){
      risks.push({ a: a, type: 'weak', text: 'короткий пароль (' + a.password.length + ' симв.)' });
    }
  });
  dupPasswordGroups().forEach(function(accs){
    accs.forEach(function(a){
      var others = accs.filter(function(x){ return x.id !== a.id; }).map(function(x){ return '«' + (x.name || 'Без названия') + '»'; });
      risks.push({ a: a, type: 'dup', text: 'пароль совпадает с: ' + others.join(', ') + ' — утечка одного аккаунта означает утечку всех' });
    });
  });
  return risks;
}

function guideSearchQuery(){ return (state.guideSearch || '').trim().toLowerCase(); }

function guideFilteredAccounts(){
  var q = guideSearchQuery();
  var all = state.vault.accounts;
  if(!q) return all;
  return all.filter(function(a){
    var r = a.recovery || {};
    var hay = [a.name, a.username, a.notes, r.notes, r.phone, r.codes]
      .concat((r.questions || []).map(function(x){ return (x.q || '') + ' ' + (x.a || ''); }))
      .concat((a.shared || []).map(function(s){ return s.name + ' ' + s.username; }))
      .join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });
}

function guideVisibleIds(){
  var q = guideSearchQuery();
  if(!q) return null;
  var s = new Set();
  guideFilteredAccounts().forEach(function(a){ s.add(a.id); });
  return s;
}

function onGuideSearch(v){
  state.guideSearch = v || '';
  renderGuide();
}

function renderGuide(){
  if(typeof updateGuideSeedWarn === 'function') updateGuideSeedWarn();
  var accounts = guideFilteredAccounts();
  var q = guideSearchQuery();
  if(state.currentAccountId && !accounts.some(function(a){ return a.id === state.currentAccountId; })){
    state.currentAccountId = null;
  }
  var sel = $('guide-select');
  sel.innerHTML = '<option value="">— не выбран —</option>' + accounts.map(function(a){
    return '<option value="' + esc(a.id) + '"' + (state.currentAccountId === a.id ? ' selected' : '') + '>' + esc(a.name || 'Без названия') + '</option>';
  }).join('');
  sel.value = state.currentAccountId || '';
  var info = $('guide-search-info');
  if(q){
    info.style.display = '';
    info.textContent = '🔍 Найдено ' + accounts.length + ' из ' + state.vault.accounts.length + ' аккаунтов по запросу «' + state.guideSearch.trim() + '»';
  } else {
    info.style.display = 'none';
    info.textContent = '';
  }
  renderGraph();
  renderGuideDetail(state.currentAccountId);
}

function guideSelect(id){
  state.currentAccountId = id || null;
  state.selected = null;
  updateChainHighlight();
  renderGuideDetail(state.currentAccountId);
}

function renderGuideDetail(id){
  var byId = new Map(state.vault.accounts.map(function(a){ return [a.id, a]; }));
  var risksEl = $('guide-risks');
  var vis = guideVisibleIds();
  var risks = computeRisks().filter(function(r){ return !vis || vis.has(r.a.id); });
  risksEl.innerHTML = risks.length
    ? risks.map(function(r){ return '<div class="risk ' + r.type + '">⚠️ <b>' + esc(r.a.name || 'Без названия') + '</b> — ' + esc(r.text) + '</div>'; }).join('')
    : '<div class="ok-line">✅ Явных проблем не найдено.</div>';

  var el = $('guide-detail');
  if(!state.vault.accounts.length){
    el.innerHTML = '<div class="empty">Добавьте аккаунты, чтобы строить маршруты восстановления.</div>';
    return;
  }
  if(guideSearchQuery() && !guideFilteredAccounts().length){
    el.innerHTML = '<div class="empty">🔍 Ничего не найдено по запросу «' + esc(state.guideSearch.trim()) + '». Измените запрос или очистите поиск.</div>';
    return;
  }
  if(!id){
    el.innerHTML = '<div class="empty">Кликните по узлу на карте или выберите аккаунт из списка, чтобы увидеть его маршрут восстановления.'
      + (guideSearchQuery() ? ' Найдено совпадений: ' + guideFilteredAccounts().length + '.' : '') + '</div>';
    return;
  }
  var chain = chainFor(id);
  var steps = chain.steps;
  var root = steps[steps.length - 1];
  var html = '';
  if(chain.cycle){
    html += '<div class="risk cycle">⚠️ Обнаружен цикл восстановления: ' + steps.map(function(s){ return esc(s.name || 'Без названия'); }).join(' → ')
      + '. В цикле данные могут стать недоступными. Измените связь «восстанавливается через» у одного из аккаунтов.</div>';
  }
  html += '<div class="chain-head">Маршрут восстановления для <b>' + esc((byId.get(id) || {}).name || 'Без названия') + '</b></div>';

  steps.forEach(function(a, i){
    var isFirst = i === 0, isLast = i === steps.length - 1;
    var r = a.recovery || {};
    var via = r.viaAccountId ? byId.get(r.viaAccountId) : null;
    html += '<div class="step-card' + (isFirst ? ' current' : '') + '">'
      + '<div class="step-num">ШАГ ' + (i + 1) + '</div>'
      + '<div class="step-title"><span style="display:inline-flex;flex-shrink:0">' + typeIconSvg(a.type, a.name, 20) + '</span><span>' + esc(a.name || 'Без названия') + '</span>'
      + (via ? ' <span class="muted" style="font-weight:400">→ восстанавливается через <b>' + esc(via.name || '?') + '</b></span>' : '')
      + (isLast && !via ? '<span class="tag">конечная точка</span>' : '')
      + '</div>'
      + '<div class="kv"><span>Логин</span><code>' + esc(a.username || '—') + '</code>'
      + (a.username ? '<button class="btn-mini" onclick="copyText(' + esc(jsStr(a.username)) + ')">Копировать</button>' : '<span></span>') + '</div>'
      + '<div class="kv"><span>Пароль</span><code>' + (a.password ? esc(a.password) : '<span style="color:#e05a5a;font-weight:600">пароль не записан</span>') + '</code>'
      + (a.password ? '<button class="btn-mini" onclick="copyText(' + esc(jsStr(a.password)) + ',{secret:true})">Копировать</button>' : '<span></span>') + '</div>'
      + (r.codes ? '<div class="kv"><span>Резервные коды</span><pre>' + esc(r.codes) + '</pre><button class="btn-mini" onclick="copyText(' + esc(jsStr(r.codes)) + ')">Копировать</button></div>' : '')
      + (r.phone ? '<div class="kv"><span>Телефон / резерв</span><code>' + esc(r.phone) + '</code><span></span></div>' : '')
      + (r.notes ? '<div class="kv"><span>Прочее</span><code>' + esc(r.notes) + '</code><span></span></div>' : '')
      + (a.type === 'telegram' && a.notifyEmailId
          ? '<div class="kv"><span>Почта уведомлений</span><code>' + esc(((byId.get(a.notifyEmailId) || {}).name) || '?') + '</code><span></span></div>' : '')
      + (r.questions || []).filter(function(q){ return q.a; }).map(function(q){
        return '<div class="kv"><span>Вопрос: ' + esc(q.q || '—') + '</span><code>' + esc(q.a) + '</code>'
          + '<button class="btn-mini" onclick="copyText(' + esc(jsStr(q.a)) + ')">Копировать</button></div>';
      }).join('')
      + (a.shared && a.shared.length
          ? '<div class="kv"><span>Общий доступ</span><code>' + esc(a.shared.map(function(s){ return s.name || (s.username || 'логин'); }).join(', ')) + '</code><span></span></div>' : '')
      + (!isLast ? '<div class="arrow-down">↓ если здесь заблокированы — переходите к следующему шагу</div>' : '')
      + (isLast && !hasRecoveryData(r) && !via
          ? '<div class="risk no-recovery" style="margin-top:10px">⚠️ У этой конечной точки нет данных восстановления. Добавьте резервные коды, вопросы или телефон — иначе при потере доступа не будет пути назад.</div>' : '')
      + '</div>';
  });
  el.innerHTML = html;
}
