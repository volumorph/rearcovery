/* ================= Нодовый редактор (стиль Blender) ================= */
var NODE_W = 190, HEADER_H = 30, NODE_H = 86, SOCKET_Y = 56;
var svgEl = null;
var dragState = null;

function vaultLayout(){
  if(!state.vault.layout) state.vault.layout = { nodes: {}, camera: null };
  return state.vault.layout;
}

function ensureLayout(){
  var lay = vaultLayout();
  var accounts = state.vault.accounts;
  var ids = {};
  accounts.forEach(function(a){ ids[a.id] = true; });
  Object.keys(lay.nodes).forEach(function(k){ if(!ids[k]) delete lay.nodes[k]; });
  if(!accounts.length) return lay;
  var anal = analyzeRecovery();
  var colW = 240, rowH = 104;
  var maxDepth = 0;
  accounts.forEach(function(a){
    if(!anal.inCycle.has(a.id)){ var d = anal.depthOf.get(a.id) || 0; if(d > maxDepth) maxDepth = d; }
  });
  var cols = new Map();
  accounts.forEach(function(a){
    // конечные точки (глубина 0) — справа, восстанавливаемые — слева: поток слева направо
    var ci = anal.inCycle.has(a.id) ? 0 : ((maxDepth - (anal.depthOf.get(a.id) || 0)) + 1);
    if(!cols.has(ci)) cols.set(ci, []);
    cols.get(ci).push(a.id);
  });
  cols.forEach(function(idsInCol, ci){
    idsInCol.forEach(function(id, i){
      if(!lay.nodes[id]) lay.nodes[id] = { x: 24 + ci * colW, y: 24 + i * rowH };
    });
  });
  return lay;
}

function accById(id){ return state.vault.accounts.find(function(a){ return a.id === id; }); }

function renderGraph(){
  var el = $('graph-canvas');
  if(!state.vault) return;
  updateGraphTitleNotes(state.currentAccountId);
  ensureLayout();
  var svg = ensureSvg();
  if(svg.parentNode !== el){ el.innerHTML = ''; el.appendChild(svg); }
  if(!state.cameraInitialized){
    state.cameraInitialized = true;
    var lay = vaultLayout();
    if(lay.camera){
      state.camera = { x: lay.camera.x, y: lay.camera.y, s: lay.camera.s };
    } else {
      state.camera = { x: 0, y: 0, s: 1 };
      fitView();
      return;
    }
  }
  if(!state.vault.accounts.length){
    el.innerHTML = '<div class="empty dark">Карта появится здесь, когда вы добавите аккаунты и свяжете их через восстановление.</div>';
    return;
  }
  var vis = guideVisibleIds();
  if(vis && !vis.size){
    el.innerHTML = '<div class="empty dark">🔍 Ничего не найдено по запросу «' + esc(state.guideSearch.trim()) + '».</div>';
    return;
  }
  svg.innerHTML = buildGraphContent();
}

function ensureSvg(){
  if(svgEl) return svgEl;
  var ns = 'http://www.w3.org/2000/svg';
  svgEl = document.createElementNS(ns, 'svg');
  svgEl.setAttribute('class', 'g-canvas');
  svgEl.addEventListener('pointerdown', onGraphPointerDown);
  svgEl.addEventListener('pointermove', onGraphPointerMove);
  svgEl.addEventListener('pointerup', onGraphPointerUp);
  svgEl.addEventListener('pointercancel', onGraphPointerUp);
  svgEl.addEventListener('wheel', onGraphWheel, { passive: false });
  svgEl.addEventListener('dblclick', onGraphDblClick);
  svgEl.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  return svgEl;
}

function screenToWorld(cx, cy){
  var rect = svgEl.getBoundingClientRect();
  return { x: (cx - rect.left - state.camera.x) / state.camera.s, y: (cy - rect.top - state.camera.y) / state.camera.s };
}

function buildGraphContent(){
  var s = [];
  s.push('<defs><marker id="garr" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#8a94a6"/></marker>'
    + '<marker id="garr-red" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#e05a5a"/></marker>'
    + '<marker id="garr-green" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#4caf7d"/></marker></defs>');
  s.push('<g transform="translate(' + state.camera.x + ',' + state.camera.y + ') scale(' + state.camera.s + ')">');
  s.push(gridSvg());
  s.push(wiresSvg());
  s.push(nodesSvg());
  if(dragState && dragState.kind === 'wire') s.push(dragState.tempPath);
  s.push('</g>');
  return s.join('');
}

function gridSvg(){
  var rect = svgEl.getBoundingClientRect();
  var cam = state.camera;
  var x0 = -cam.x / cam.s, y0 = -cam.y / cam.s;
  var x1 = x0 + rect.width / cam.s, y1 = y0 + rect.height / cam.s;
  var step = cam.s < 0.25 ? 200 : (cam.s < 0.55 ? 100 : 50);
  var g = [], n = 0;
  for(var i = Math.floor(x0 / step) * step; i <= x1; i += step, n++){
    g.push('<line x1="' + i + '" y1="' + y0 + '" x2="' + i + '" y2="' + y1 + '" stroke="' + (n % 4 === 0 ? '#262b33' : '#20242b') + '" stroke-width="1"/>');
  }
  n = 0;
  for(i = Math.floor(y0 / step) * step; i <= y1; i += step, n++){
    g.push('<line x1="' + x0 + '" y1="' + i + '" x2="' + x1 + '" y2="' + i + '" stroke="' + (n % 4 === 0 ? '#262b33' : '#20242b') + '" stroke-width="1"/>');
  }
  return g.join('');
}

function wirePathFor(a, dstId, outDy){
  var lay = vaultLayout().nodes;
  var p1 = lay[a.id], p2 = lay[dstId];
  if(!p1 || !p2) return null;
  var x1 = p1.x + NODE_W, y1 = p1.y + SOCKET_Y + (outDy || 0);
  var x2 = p2.x, y2 = p2.y + SOCKET_Y;
  var dx = Math.max(46, Math.abs(x2 - x1) / 2);
  return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
}

function wiresSvg(){
  var out = [];
  var selKey = state.selected && state.selected.kind === 'wire' ? state.selected.key : null;
  var chain = chainIds();
  var vis = guideVisibleIds();
  var nm = function(x){ return streamName(x); };
  state.vault.accounts.forEach(function(a){
    var isTg = a.type === 'telegram';
    var via = a.recovery ? a.recovery.viaAccountId : null;
    if(via && (!vis || (vis.has(a.id) && vis.has(via)))){
      var d = wirePathFor(a, via, 0);
      if(d){
        var key = a.id + '>' + via;
        var sel = key === selKey;
        var inChainWire = chain && chain.has(a.id) && chain.has(via);
        var dimWire = !!chain && !inChainWire;
        var col = sel ? '#f5a623' : (inChainWire ? '#4da3ff' : (isTg ? '#e05a5a' : '#77808c'));
        var wdt = sel ? 2.8 : (inChainWire ? 2.6 : 1.8);
        var dst = accById(via);
        var mkr = isTg ? 'url(#garr-red)' : 'url(#garr)';
        out.push('<path class="g-wire" data-kind="via" data-src="' + esc(a.id) + '" data-key="' + esc(key) + '" d="' + d + '"' + (dimWire ? ' opacity="0.3"' : '') + ' fill="none" stroke="' + col + '" stroke-width="' + wdt + '" marker-end="' + mkr + '">'
          + '<title>' + (isTg ? 'Исходная почта: ' : '') + '«' + esc(nm(a)) + '» восстанавливается через «' + esc(dst ? nm(dst) : '?') + '». Кликните и нажмите Del, чтобы разорвать.</title></path>');
        out.push('<path d="' + d + '" fill="none" stroke="transparent" stroke-width="14" pointer-events="all"/>');
      }
    }
    if(isTg && a.notifyEmailId && (!vis || (vis.has(a.id) && vis.has(a.notifyEmailId)))){
      var dn = wirePathFor(a, a.notifyEmailId, 16);
      if(dn){
        var nkey = a.id + '~' + a.notifyEmailId;
        var nsel = nkey === selKey;
        var ndim = !!chain && (!chain.has(a.id) || !chain.has(a.notifyEmailId));
        var ndst = accById(a.notifyEmailId);
        out.push('<path class="g-wire" data-kind="notify" data-src="' + esc(a.id) + '" data-key="' + esc(nkey) + '" d="' + dn + '"' + (ndim ? ' opacity="0.3"' : '') + ' fill="none" stroke="' + (nsel ? '#f5a623' : '#4caf7d') + '" stroke-width="' + (nsel ? 2.8 : 1.8) + '" marker-end="url(#garr-green)">'
          + '<title>«' + esc(nm(a)) + '» шлёт уведомления на «' + esc(ndst ? nm(ndst) : '?') + '». Кликните и нажмите Del, чтобы разорвать.</title></path>');
        out.push('<path d="' + dn + '" fill="none" stroke="transparent" stroke-width="14" pointer-events="all"/>');
      }
    }
  });
  return out.join('');
}

function nodeHeaderColor(a){
  var t = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES[''];
  if(a.type === 'google') return '#4285f4';
  if(a.type === 'telegram') return '#229ed9';
  if(t.tile === 'grad') return 'url(#' + igGradId + ')';
  return t.tile || '#66788f';
}

function nodesSvg(){
  var out = [];
  var lay = vaultLayout().nodes;
  var nm = function(x){ return streamName(x); };
  var anal = analyzeRecovery();
  var chain = chainIds();
  var vis = guideVisibleIds();
  state.vault.accounts.forEach(function(a){
    if(vis && !vis.has(a.id)) return;
    var p = lay[a.id];
    if(!p) return;
    var r = a.recovery || {};
    var header = nodeHeaderColor(a);
    if(anal.inCycle.has(a.id)) header = '#e0913b';
    else if(!r.viaAccountId && !hasRecoveryData(r)) header = '#d64545';
    var selected = state.selected && state.selected.kind === 'node' && state.selected.id === a.id;
    var inChain = chain && chain.has(a.id);
    var dim = !!chain && !inChain;
    var hasData = hasRecoveryData(r);
    var badgeRow = hasData
      ? '<text x="10" y="' + (HEADER_H + 34) + '" font-size="10.5" fill="#7f8794">' + esc([r.codes ? 'коды' : null, r.phone ? 'телефон' : null, (r.questions && r.questions.length) ? 'вопросы' : null].filter(Boolean).join(' · ')) + '</text>'
      : '<text x="10" y="' + (HEADER_H + 34) + '" font-size="10.5" fill="#c96f6f">нет данных восстановления</text>';
    var pwRow = a.password
      ? ''
      : '<text x="10" y="' + (HEADER_H + 48) + '" font-size="10.5" fill="#e05a5a">пароль не записан</text>';
    var dispName = streamName(a);
    out.push('<g class="g-node" data-id="' + esc(a.id) + '"' + (dim ? ' opacity="0.45"' : '') + ' transform="translate(' + p.x + ',' + p.y + ')">'
      + '<rect class="g-node-body" width="' + NODE_W + '" height="' + NODE_H + '" rx="7" fill="#3b3f46" stroke="' + (selected ? '#f5a623' : (inChain ? '#4da3ff' : '#24282e')) + '" stroke-width="' + (selected ? 2.6 : (inChain ? 2.4 : 1.2)) + '">'
      + '<title>' + esc(dispName) + ' — двойной клик, чтобы изменить</title></rect>'
      + '<path d="M0,7 Q0,0 7,0 L' + (NODE_W - 7) + ',0 Q' + NODE_W + ',0 ' + NODE_W + ',7 L' + NODE_W + ',' + HEADER_H + ' L0,' + HEADER_H + ' Z" fill="' + header + '"/>'
      + '<g transform="translate(7,5)">' + typeIconSvg(a.type, a.name, 20) + '</g>'
      + '<text x="32" y="' + (HEADER_H - 10) + '" font-size="12.5" font-weight="700" fill="#fff">' + esc(truncate(dispName, 21)) + '</text>'
      + (state.streamMode ? '' : '<text x="10" y="' + (HEADER_H + 16) + '" font-size="11" fill="#aab1bc">' + esc(truncate(a.username || 'нет логина', 27)) + '</text>')
      + badgeRow
      + pwRow
      + '<circle class="g-sock" cx="0" cy="' + SOCKET_Y + '" r="6" fill="#5a5f69" stroke="#1d2126" stroke-width="1.5">'
      + '<title>Вход: аккаунты, которые восстанавливаются через «' + esc(nm(a)) + '». Потяните в пустоту, чтобы отсоединить.</title></circle>'
      + (a.type === 'telegram'
          ? '<circle class="g-sock" cx="' + NODE_W + '" cy="' + SOCKET_Y + '" r="6" fill="#e05a5a" stroke="#1d2126" stroke-width="1.5">'
          + '<title>Исходная почта: «' + esc(nm(a)) + '» восстанавливается через неё. Тяните на вход другого узла.</title></circle>'
          + '<circle class="g-sock" cx="' + NODE_W + '" cy="' + (SOCKET_Y + 16) + '" r="6" fill="#4caf7d" stroke="#1d2126" stroke-width="1.5">'
          + '<title>Почта для уведомлений: Telegram шлёт сюда уведомления о входе. Тяните на вход другого узла.</title></circle>'
          : '<circle class="g-sock" cx="' + NODE_W + '" cy="' + SOCKET_Y + '" r="6" fill="#5a7dff" stroke="#1d2126" stroke-width="1.5">'
          + '<title>Выход: «' + esc(nm(a)) + '» восстанавливается через другой аккаунт. Тяните на вход другого узла.</title></circle>')
      + '</g>');
  });
  return out.join('');
}

function hitTest(wx, wy){
  var lay = vaultLayout().nodes;
  var accounts = state.vault.accounts;
  var vis = guideVisibleIds();
  for(var i = accounts.length - 1; i >= 0; i--){
    var a = accounts[i];
    if(vis && !vis.has(a.id)) continue;
    var p = lay[a.id];
    if(!p) continue;
    if(Math.hypot(wx - p.x, wy - (p.y + SOCKET_Y)) <= 13) return { kind: 'input', nodeId: a.id };
    if(Math.hypot(wx - (p.x + NODE_W), wy - (p.y + SOCKET_Y)) <= 13) return { kind: 'output', nodeId: a.id, out: 'via' };
    if(a.type === 'telegram' && Math.hypot(wx - (p.x + NODE_W), wy - (p.y + SOCKET_Y + 16)) <= 13) return { kind: 'output', nodeId: a.id, out: 'notify' };
    if(wx >= p.x && wx <= p.x + NODE_W && wy >= p.y && wy <= p.y + NODE_H) return { kind: 'node', nodeId: a.id };
  }
  var best = null, bestD = 10;
  function wireHit(a, dstId, outDy, wireKind){
    var p1 = lay[a.id], p2 = lay[dstId];
    if(!p1 || !p2) return;
    var pts = bezierPoints(p1.x + NODE_W, p1.y + SOCKET_Y + (outDy || 0), p2.x, p2.y + SOCKET_Y);
    for(var k = 0; k < pts.length; k++){
      var dd = Math.hypot(wx - pts[k][0], wy - pts[k][1]);
      if(dd < bestD){ bestD = dd; best = { kind: 'wire', wireKind: wireKind, key: a.id + (wireKind === 'notify' ? '~' : '>') + dstId, srcId: a.id, dstId: dstId }; }
    }
  }
  accounts.forEach(function(a){
    if(vis && !vis.has(a.id)) return;
    var via = a.recovery ? a.recovery.viaAccountId : null;
    if(via && (!vis || vis.has(via))) wireHit(a, via, 0, 'via');
    if(a.type === 'telegram' && a.notifyEmailId && (!vis || vis.has(a.notifyEmailId))) wireHit(a, a.notifyEmailId, 16, 'notify');
  });
  return best || { kind: 'bg' };
}

function bezierPoints(x1, y1, x2, y2){
  var dx = Math.max(46, Math.abs(x2 - x1) / 2);
  var pts = [];
  for(var t = 0; t <= 1; t += 0.05){
    var mt = 1 - t;
    pts.push([
      mt*mt*mt*x1 + 3*mt*mt*t*(x1 + dx) + 3*mt*t*t*(x2 - dx) + t*t*t*x2,
      mt*mt*mt*y1 + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y2
    ]);
  }
  return pts;
}

function tempWirePath(x1, y1, x2, y2){
  var dx = Math.max(46, Math.abs(x2 - x1) / 2);
  return '<path d="M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" fill="none" stroke="#f5a623" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#garr)"/>';
}

function updateGraphTitleNotes(id){
  var el = $('graph-title-notes');
  if(!el) return;
  if(state.streamMode){ el.textContent = ''; el.style.display = 'none'; return; }
  var a = id ? accById(id) : null;
  if(!a || !(a.notes || (a.recovery && a.recovery.notes))){
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  var h = '<span class="who">' + esc(a.name || 'Без названия') + '</span>';
  if(a.notes) h += '<div>' + esc(a.notes) + '</div>';
  if(a.recovery && a.recovery.notes) h += '<div>' + esc(a.recovery.notes) + '</div>';
  el.innerHTML = h;
  el.style.display = 'block';
}

function selectNode(id){
  state.currentAccountId = id;
  state.selected = { kind: 'node', id: id };
  var sel = $('guide-select');
  if(sel) sel.value = id;
  updateChainHighlight();
  renderGuideDetail(id);
  highlightAccountCard(id);
  updateGraphTitleNotes(id);
}

function selectFromList(id){
  state.currentAccountId = id;
  state.selected = { kind: 'node', id: id };
  var sel = $('guide-select');
  if(sel) sel.value = id;
  updateChainHighlight();
  renderGuideDetail(id);
  highlightAccountCard(id);
  updateGraphTitleNotes(id);
  switchPanel('guide');
}

function highlightAccountCard(id){
  var cards = document.querySelectorAll('#accounts-list .acc-card');
  cards.forEach(function(c){ c.classList.toggle('selected', c.dataset.id === id); });
  if(id && !$('panel-accounts').classList.contains('hidden')){
    var sel = document.querySelector('#accounts-list .acc-card.selected');
    if(sel) sel.scrollIntoView({ block: 'nearest' });
  }
}

function initAccountsList(){
  var list = $('accounts-list');
  if(!list || list.dataset.init) return;
  list.dataset.init = '1';
  list.addEventListener('click', function(e){
    if(e.target.closest('button')) return; // кнопки обрабатываются своими обработчиками
    var card = e.target.closest('.acc-card');
    if(card && card.dataset.id) selectFromList(card.dataset.id);
  });
}

function onGraphPointerDown(e){
  if(e.button !== 0) return;
  var w = screenToWorld(e.clientX, e.clientY);
  var hit = hitTest(w.x, w.y);
  svgEl.classList.add('dragging');
  var lay = vaultLayout().nodes;
  if(hit.kind === 'output'){
    state.selected = null;
    var p = lay[hit.nodeId];
    var ody = hit.out === 'notify' ? 16 : 0;
    dragState = { kind: 'wire', from: 'out', nodeId: hit.nodeId, out: hit.out || 'via', sx: p.x + NODE_W, sy: p.y + SOCKET_Y + ody, tempPath: tempWirePath(p.x + NODE_W, p.y + SOCKET_Y + ody, w.x, w.y) };
    renderGraph();
  } else if(hit.kind === 'input'){
    state.selected = null;
    var pin = lay[hit.nodeId];
    dragState = { kind: 'wire', from: 'in', nodeId: hit.nodeId, sx: pin.x, sy: pin.y + SOCKET_Y, tempPath: tempWirePath(w.x, w.y, pin.x, pin.y + SOCKET_Y) };
    renderGraph();
  } else if(hit.kind === 'node'){
    selectNode(hit.nodeId);
    var np = lay[hit.nodeId];
    dragState = { kind: 'node', nodeId: hit.nodeId, origX: np.x, origY: np.y, startX: e.clientX, startY: e.clientY, moved: false };
  } else if(hit.kind === 'wire'){
    state.selected = { kind: 'wire', key: hit.key, srcId: hit.srcId, dstId: hit.dstId, wireKind: hit.wireKind || 'via' };
    updateChainHighlight();
  } else {
    // клик по пустому полю — «дефолтный режим»: снять выделение и подсветку маршрута
    if(state.currentAccountId || state.selected){
      state.currentAccountId = null;
      state.selected = null;
      var sel = $('guide-select');
      if(sel) sel.value = '';
      updateChainHighlight();
      renderGuideDetail(null);
      highlightAccountCard(null);
    }
    dragState = { kind: 'pan', startX: e.clientX, startY: e.clientY, camX: state.camera.x, camY: state.camera.y };
  }
  if(dragState){ try{ svgEl.setPointerCapture(e.pointerId); }catch(err){} }
  e.preventDefault();
}

function onGraphPointerMove(e){
  if(!dragState) return;
  if(dragState.kind === 'pan'){
    state.camera.x = dragState.camX + (e.clientX - dragState.startX);
    state.camera.y = dragState.camY + (e.clientY - dragState.startY);
    renderGraph();
  } else if(dragState.kind === 'node'){
    var p = vaultLayout().nodes[dragState.nodeId];
    if(!p) return;
    p.x = Math.round(dragState.origX + (e.clientX - dragState.startX) / state.camera.s);
    p.y = Math.round(dragState.origY + (e.clientY - dragState.startY) / state.camera.s);
    dragState.moved = true;
    renderGraph();
  } else if(dragState.kind === 'wire'){
    var w = screenToWorld(e.clientX, e.clientY);
    var hit = hitTest(w.x, w.y);
    var nodes = vaultLayout().nodes;
    var snap = null;
    if(dragState.from === 'out' && hit.kind === 'input' && hit.nodeId !== dragState.nodeId){
      var sp = nodes[hit.nodeId];
      snap = { x: sp.x, y: sp.y + SOCKET_Y };
    } else if(dragState.from === 'in' && hit.kind === 'output' && hit.nodeId !== dragState.nodeId){
      var op = nodes[hit.nodeId];
      snap = { x: op.x + NODE_W, y: op.y + SOCKET_Y + (hit.out === 'notify' ? 16 : 0) };
    }
    dragState.tempPath = dragState.from === 'out'
      ? tempWirePath(dragState.sx, dragState.sy, snap ? snap.x : w.x, snap ? snap.y : w.y)
      : tempWirePath(w.x, w.y, dragState.sx, dragState.sy);
    renderGraph();
  }
}

function onGraphPointerUp(e){
  svgEl.classList.remove('dragging');
  if(!dragState) return;
  var d = dragState;
  dragState = null;
  if(d.kind === 'wire'){
    var w = screenToWorld(e.clientX, e.clientY);
    var hit = hitTest(w.x, w.y);
    if(d.from === 'out'){
      if(d.out === 'notify'){
        if(hit.kind === 'input' && hit.nodeId !== d.nodeId) setNotify(d.nodeId, hit.nodeId);
        else if(hit.kind === 'bg' || hit.kind === 'wire') setNotify(d.nodeId, null);
      } else {
        if(hit.kind === 'input' && hit.nodeId !== d.nodeId) setVia(d.nodeId, hit.nodeId);
        else if(hit.kind === 'bg' || hit.kind === 'wire') setVia(d.nodeId, null);
      }
    } else {
      if(hit.kind === 'output' && hit.nodeId !== d.nodeId){
        if(hit.out === 'notify') setNotify(hit.nodeId, d.nodeId);
        else setVia(hit.nodeId, d.nodeId);
      } else if(hit.kind === 'bg' || hit.kind === 'wire') clearIncoming(d.nodeId);
    }
    renderGraph();
  } else if(d.kind === 'node'){
    if(d.moved){ saveCamera(); scheduleSave(); }
    renderGraph();
  } else if(d.kind === 'pan'){
    saveCamera();
    renderGraph();
  }
}

function onGraphWheel(e){
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}

function onGraphDblClick(e){
  var w = screenToWorld(e.clientX, e.clientY);
  var hit = hitTest(w.x, w.y);
  if(hit.kind === 'node') requestAccountEdit(hit.nodeId);
}

function zoomAt(cx, cy, factor){
  var rect = svgEl.getBoundingClientRect();
  var px = cx - rect.left, py = cy - rect.top;
  var wx = (px - state.camera.x) / state.camera.s, wy = (py - state.camera.y) / state.camera.s;
  var ns = Math.min(3, Math.max(0.15, state.camera.s * factor));
  state.camera.s = ns;
  state.camera.x = px - wx * ns;
  state.camera.y = py - wy * ns;
  saveCamera();
  renderGraph();
}

function zoomAtCenter(factor){
  var rect = svgEl.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}

function fitView(){
  var lay = vaultLayout();
  var vis = guideVisibleIds();
  var ids = Object.keys(lay.nodes).filter(function(id){ return !vis || vis.has(id); });
  if(!ids.length) return;
  var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  ids.forEach(function(id){
    var p = lay.nodes[id];
    if(!p) return;
    if(p.x < minX) minX = p.x;
    if(p.y < minY) minY = p.y;
    if(p.x + NODE_W > maxX) maxX = p.x + NODE_W;
    if(p.y + NODE_H > maxY) maxY = p.y + NODE_H;
  });
  if(minX === 1e9) return;
  var cw = svgEl.clientWidth || 800;
  var ch = svgEl.clientHeight || 560;
  var s = Math.min(1.2, (cw - 70) / ((maxX - minX) || 1), (ch - 70) / ((maxY - minY) || 1));
  if(s < 0.1) s = 0.1;
  state.camera.s = s;
  state.camera.x = (cw - (maxX - minX) * s) / 2 - minX * s;
  state.camera.y = (ch - (maxY - minY) * s) / 2 - minY * s;
  saveCamera();
  renderGraph();
}

function saveCamera(){
  if(!state.vault) return;
  vaultLayout().camera = { x: state.camera.x, y: state.camera.y, s: state.camera.s };
  scheduleSave();
}

function setVia(srcId, dstId){
  var a = accById(srcId);
  if(!a) return;
  if(dstId === srcId){ toast('Нельзя связать аккаунт с самим собой'); return; }
  var was = a.recovery ? a.recovery.viaAccountId : null;
  if(was === dstId) return;
  a.recovery.viaAccountId = dstId;
  if(dstId) toast('Связь: «' + a.name + '» → через «' + ((accById(dstId) || {}).name || '?') + '»');
  else toast('Связь убрана');
  scheduleSave();
  renderGuideDetail(state.currentAccountId);
}

function streamLabel(a){
  var t = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES[''];
  if(a.type === 'mail' || a.type === 'google' || a.type === 'mailru' || a.type === 'proton') return '•••••';
  return t.label || 'Аккаунт';
}
function streamName(a){
  return state.streamMode ? streamLabel(a) : (a.name || 'Без названия');
}
function toggleStreamMode(){
  state.streamMode = !state.streamMode;
  var b = $('btn-stream');
  if(b){
    b.textContent = state.streamMode ? '👁 Показать данные' : '🙈 Скрыть данные';
    b.classList.toggle('active', state.streamMode);
  }
  var panel = document.querySelector('.side-panel');
  if(panel) panel.classList.toggle('streaming', state.streamMode);
  updateGraphTitleNotes(state.currentAccountId);
  renderGraph();
  renderAccounts();
  renderGuide();
  toast(state.streamMode ? '🙈 Режим стрима: данные скрыты' : 'Данные снова видны');
}

function setNotify(srcId, dstId){
  var a = accById(srcId);
  if(!a) return;
  if(dstId === srcId){ toast('Нельзя связать аккаунт с самим собой'); return; }
  var was = a.notifyEmailId || null;
  if(was === dstId) return;
  a.notifyEmailId = dstId;
  if(dstId) toast('Уведомления: «' + a.name + '» → «' + ((accById(dstId) || {}).name || '?') + '»');
  else toast('Связь уведомлений убрана');
  scheduleSave();
  renderGuideDetail(state.currentAccountId);
}

function clearIncoming(nodeId){
  var changed = false;
  state.vault.accounts.forEach(function(a){
    if(a.recovery && a.recovery.viaAccountId === nodeId){ a.recovery.viaAccountId = null; changed = true; }
  });
  if(changed){ scheduleSave(); toast('Входящие связи убраны'); }
  renderGuideDetail(state.currentAccountId);
}

function graphAdd(){ openEditor(null); }

function graphEditSelected(){
  if(!state.selected || state.selected.kind !== 'node'){
    toast('Сначала выберите узел на карте');
    return;
  }
  requestAccountEdit(state.selected.id);
}

function graphDeleteSelected(){
  if(!state.selected) return;
  if(state.selected.kind === 'node'){
    requestDeleteAccount(state.selected.id);
  } else if(state.selected.kind === 'wire'){
    if(state.selected.wireKind === 'notify') setNotify(state.selected.srcId, null);
    else setVia(state.selected.srcId, null);
    state.selected = null;
    renderGraph();
  }
}

window.addEventListener('keydown', function(e){
  if((e.key === 'Delete' || e.key === 'Backspace') && state.vault && state.selected){
    var t = document.activeElement ? document.activeElement.tagName : '';
    if(t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    e.preventDefault();
    graphDeleteSelected();
  }
});
