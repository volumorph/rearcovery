/* ================= Нодовый редактор (стиль Blender) ================= */
var NODE_W = 190, HEADER_H = 30, NODE_H = 86, SOCKET_Y = 56;
var CHILD_H = 22; // высота строки вложенного сервиса внутри ноды-контейнера
var svgEl = null;
var dragState = null;

/* Высота ноды: у контейнера с вложенными сервисами растёт под их список */
function nodeHeightFor(a){
  var ch = containerChildren(a);
  if(!ch.length) return NODE_H;
  // свёрнутый контейнер — одна строка-подсказка («N вложено — развернуть»)
  var n = state.collapsedParents.has(a.id) ? 1 : ch.length;
  return HEADER_H + 54 + n * CHILD_H + 8;
}

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
  var colW = 240;
  var maxDepth = 0;
  accounts.forEach(function(a){
    if(a.parentId) return; // вложенные — не отдельные ноды, раскладка им не нужна
    if(!anal.inCycle.has(a.id)){ var d = anal.depthOf.get(a.id) || 0; if(d > maxDepth) maxDepth = d; }
  });
  var cols = new Map();
  accounts.forEach(function(a){
    if(a.parentId) return;
    // конечные точки (глубина 0) — справа, восстанавливаемые — слева: поток слева направо
    var ci = anal.inCycle.has(a.id) ? 0 : ((maxDepth - (anal.depthOf.get(a.id) || 0)) + 1);
    if(!cols.has(ci)) cols.set(ci, []);
    cols.get(ci).push(a.id);
  });
  cols.forEach(function(idsInCol, ci){
    var nextY = 24;
    idsInCol.forEach(function(id){
      var a = accById(id);
      var h = (a ? nodeHeightFor(a) : NODE_H) + 24;
      if(!lay.nodes[id]){
        // новые ноды кладём ниже уже существующих в колонке (высокие контейнеры не наезжают)
        lay.nodes[id] = { x: 24 + ci * colW, y: nextY };
        nextY += h;
      } else {
        nextY = Math.max(nextY, lay.nodes[id].y + h);
      }
    });
  });
  // у вложенных не должно быть позиций: они живут внутри контейнера
  var kids = {};
  accounts.forEach(function(a){ if(a.parentId) kids[a.id] = true; });
  Object.keys(lay.nodes).forEach(function(k){ if(kids[k]) delete lay.nodes[k]; });
  return lay;
}

function accById(id){ return state.vault.accounts.find(function(a){ return a.id === id; }); }

/* Единственный вложенный Telegram контейнера (для красного/зелёного сокетов
 * и проводов): только если Telegram внутри ровно один и контейнер сам не Telegram. */
function nestedTelegramOf(a){
  if(!a || a.type === 'telegram') return null;
  var ts = containerChildren(a).filter(function(c){ return c.type === 'telegram'; });
  return ts.length === 1 ? ts[0] : null;
}

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
  if(dragState && dragState.kind === 'extract') s.push(extractGhostSvg(dragState));
  s.push('</g>');
  return s.join('');
}

/* «Призрак» вытаскиваемого из контейнера сервиса — полупрозрачная нода за курсором */
function extractGhostSvg(d){
  var c = accById(d.nodeId);
  if(!c) return '';
  var gx = d.wx, gy = d.wy;
  return '<g transform="translate(' + (gx - NODE_W / 2) + ',' + (gy - 30) + ')" opacity="0.75">'
    + '<rect width="' + NODE_W + '" height="' + NODE_H + '" rx="7" fill="#3b3f46" stroke="#4caf7d" stroke-width="1.6" stroke-dasharray="5 3"/>'
    + '<path d="M0,7 Q0,0 7,0 L' + (NODE_W - 7) + ',0 Q' + NODE_W + ',0 ' + NODE_W + ',7 L' + NODE_W + ',' + HEADER_H + ' L0,' + HEADER_H + ' Z" fill="#4caf7d"/>'
    + '<g transform="translate(7,5)">' + typeIconSvg(c.type, c.name, 20) + '</g>'
    + '<text x="32" y="' + (HEADER_H - 10) + '" font-size="12.5" font-weight="700" fill="#fff">' + esc(truncate(streamName(c), 21)) + '</text>'
    + '</g>';
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
    if(a.parentId) return; // у вложенных сервисов нет проводов: они внутри контейнера
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
    // вложенный Telegram: его провода рисуются от контейнера (красный — исходная
    // почта наружу, зелёный — уведомления); на родителя провод не рисуется (дефолт)
    var tg2 = nestedTelegramOf(a);
    if(tg2){
      var tgVia = tg2.recovery ? tg2.recovery.viaAccountId : null;
      if(tgVia && tgVia !== a.id && (!vis || (vis.has(a.id) && vis.has(tgVia)))){
        var d3 = wirePathFor(a, tgVia, 16);
        if(d3){
          var k3 = tg2.id + '>' + tgVia;
          var s3 = k3 === selKey;
          var i3 = chain && chain.has(tg2.id) && chain.has(tgVia);
          var dm3 = !!chain && !i3;
          var dst3 = accById(tgVia);
          out.push('<path class="g-wire" data-kind="via" data-src="' + esc(tg2.id) + '" data-key="' + esc(k3) + '" d="' + d3 + '"' + (dm3 ? ' opacity="0.3"' : '') + ' fill="none" stroke="' + (s3 ? '#f5a623' : (i3 ? '#4da3ff' : '#e05a5a')) + '" stroke-width="' + (s3 ? 2.8 : (i3 ? 2.6 : 1.8)) + '" marker-end="url(#garr-red)">'
            + '<title>«' + esc(nm(tg2)) + '» (вложен в «' + esc(nm(a)) + '») восстанавливается через «' + esc(dst3 ? nm(dst3) : '?') + '». Кликните и нажмите Del, чтобы убрать связь.</title></path>');
          out.push('<path d="' + d3 + '" fill="none" stroke="transparent" stroke-width="14" pointer-events="all"/>');
        }
      }
      var tgN = tg2.notifyEmailId;
      // если красный и зелёный ведут на одну и ту же почту — рисуем только красный (восстановление), зелёный дублирует
      if(tgN && tgN !== a.id && tgN !== tgVia && (!vis || (vis.has(a.id) && vis.has(tgN)))){
        var d4 = wirePathFor(a, tgN, 32);
        if(d4){
          var k4 = tg2.id + '~' + tgN;
          var s4 = k4 === selKey;
          var dm4 = !!chain && (!chain.has(tg2.id) || !chain.has(tgN));
          var dst4 = accById(tgN);
          out.push('<path class="g-wire" data-kind="notify" data-src="' + esc(tg2.id) + '" data-key="' + esc(k4) + '" d="' + d4 + '"' + (dm4 ? ' opacity="0.3"' : '') + ' fill="none" stroke="' + (s4 ? '#f5a623' : '#4caf7d') + '" stroke-width="' + (s4 ? 2.8 : 1.8) + '" marker-end="url(#garr-green)">'
            + '<title>«' + esc(nm(tg2)) + '» (вложен в «' + esc(nm(a)) + '») шлёт уведомления на «' + esc(dst4 ? nm(dst4) : '?') + '». Кликните и нажмите Del, чтобы убрать связь.</title></path>');
          out.push('<path d="' + d4 + '" fill="none" stroke="transparent" stroke-width="14" pointer-events="all"/>');
        }
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
    if(a.parentId) return; // вложенные рисуются внутри контейнера
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
    // цель перетаскивания «вложить»: валидная — зелёная рамка, невалидная — красная
    var drop = !!(dragState && dragState.kind === 'node' && dragState.dropTarget === a.id);
    var dropBad = !!(dragState && dragState.kind === 'node' && dragState.dropRejectTarget === a.id);
    var hasData = hasRecoveryData(r);
    var h = nodeHeightFor(a);
    var badgeRow = hasData
      ? '<text x="10" y="' + (HEADER_H + 34) + '" font-size="10.5" fill="#7f8794">' + esc([r.codes ? 'коды' : null, r.phone ? 'телефон' : null, (r.questions && r.questions.length) ? 'вопросы' : null].filter(Boolean).join(' · ')) + '</text>'
      : '<text x="10" y="' + (HEADER_H + 34) + '" font-size="10.5" fill="#c96f6f">нет данных восстановления</text>';
    var pwRow = a.password
      ? ''
      : '<text x="10" y="' + (HEADER_H + 48) + '" font-size="10.5" fill="#e05a5a">пароль не записан</text>';
    var dispName = streamName(a);
    var tg = nestedTelegramOf(a); // красный/зелёный сокеты вложенного Telegram
    // вложенные сервисы: строки с иконкой внутри ноды-контейнера
    var ch = containerChildren(a);
    var collapsed = state.collapsedParents.has(a.id);
    var chRows = '';
    if(ch.length){
      var shown = collapsed ? [] : ch.filter(function(c){ return !vis || vis.has(c.id); });
      shown.forEach(function(c, i){
        var cy = HEADER_H + 54 + i * CHILD_H;
        var cSel = state.selected && state.selected.kind === 'node' && state.selected.id === c.id;
        var cInChain = chain && chain.has(c.id);
        var cDim = !!chain && !cInChain;
        var cName = streamName(c);
        // точка маршрута: зелёная — свой маршрут ведёт на родителя, красная — наружу
        var cVia = c.recovery ? c.recovery.viaAccountId : null;
        var cDot = '';
        if(cVia === a.id){
          cDot = '<circle cx="' + (NODE_W - 13) + '" cy="' + (CHILD_H / 2 - 1) + '" r="3" fill="#4caf7d"><title>«' + esc(streamName(c)) + '» восстанавливается через родителя («' + esc(streamName(a)) + '»)</title></circle>';
        } else if(cVia){
          var cDst = accById(cVia);
          cDot = '<circle cx="' + (NODE_W - 13) + '" cy="' + (CHILD_H / 2 - 1) + '" r="3" fill="#e05a5a"><title>«' + esc(streamName(c)) + '» имеет свой маршрут восстановления: через «' + esc(cDst ? streamName(cDst) : '?') + '» (не родителя)</title></circle>';
        }
        chRows += '<g class="g-child" data-id="' + esc(c.id) + '"' + (cDim ? ' opacity="0.45"' : '') + ' transform="translate(0,' + cy + ')">'
          + '<rect x="6" y="0" width="' + (NODE_W - 12) + '" height="' + (CHILD_H - 2) + '" rx="4" fill="' + (cSel ? '#4a5568' : (cInChain ? '#2f4156' : 'transparent')) + '" stroke="' + (cSel ? '#f5a623' : (cInChain ? '#4da3ff' : 'transparent')) + '" stroke-width="1"/>'
          + '<g transform="translate(10,1)">' + typeIconSvg(c.type, c.name, 14) + '</g>'
          + '<text x="30" y="' + (CHILD_H - 8) + '" font-size="11" fill="' + (cSel ? '#fff' : '#c9d1da') + '">' + esc(truncate(cName, 19)) + '</text>'
          + cDot
          + '</g>';
      });
      if(collapsed){
        chRows += '<text x="14" y="' + (HEADER_H + 54 + CHILD_H / 2 + 3) + '" font-size="10.5" fill="#7f8794">' + ch.length + ' вложено — развернуть ▾</text>';
      }
    }
    out.push('<g class="g-node" data-id="' + esc(a.id) + '"' + (dim ? ' opacity="0.45"' : '') + ' transform="translate(' + p.x + ',' + p.y + ')">'
      + '<rect class="g-node-body" width="' + NODE_W + '" height="' + h + '" rx="7" fill="#3b3f46" stroke="' + (drop ? '#4caf7d' : (dropBad ? '#e05a5a' : (selected ? '#f5a623' : (inChain ? '#4da3ff' : '#24282e')))) + '" stroke-width="' + ((drop || dropBad) ? 2.6 : (selected ? 2.6 : (inChain ? 2.4 : 1.2))) + '">'
      + '<title>' + esc(dispName) + ' — двойной клик, чтобы изменить</title></rect>'
      + '<path d="M0,7 Q0,0 7,0 L' + (NODE_W - 7) + ',0 Q' + NODE_W + ',0 ' + NODE_W + ',7 L' + NODE_W + ',' + HEADER_H + ' L0,' + HEADER_H + ' Z" fill="' + header + '"/>'
      + '<g transform="translate(7,5)">' + typeIconSvg(a.type, a.name, 20) + '</g>'
      + '<text x="32" y="' + (HEADER_H - 10) + '" font-size="12.5" font-weight="700" fill="#fff">' + esc(truncate(dispName, 21)) + '</text>'
      + (ch.length ? '<text class="g-collapse" x="' + (NODE_W - 22) + '" y="' + (HEADER_H - 9) + '" font-size="11" fill="#d7dde6" style="cursor:pointer" onclick="toggleContainerCollapse(' + esc(jsStr(a.id)) + ')">' + (collapsed ? '▸' : '▾') + '</text>' : '')
      + (state.streamMode ? '' : '<text x="10" y="' + (HEADER_H + 16) + '" font-size="11" fill="#aab1bc">' + esc(truncate(a.username || 'нет логина', 27)) + '</text>')
      + badgeRow
      + pwRow
      + chRows
      + '<circle class="g-sock" cx="0" cy="' + SOCKET_Y + '" r="6" fill="#5a5f69" stroke="#1d2126" stroke-width="1.5">'
      + '<title>Вход: аккаунты, которые восстанавливаются через «' + esc(nm(a)) + '». Потяните в пустоту, чтобы отсоединить.</title></circle>'
      + (a.type === 'telegram'
          ? '<circle class="g-sock" cx="' + NODE_W + '" cy="' + SOCKET_Y + '" r="6" fill="#e05a5a" stroke="#1d2126" stroke-width="1.5">'
          + '<title>Исходная почта: «' + esc(nm(a)) + '» восстанавливается через неё. Тяните на вход другого узла.</title></circle>'
          + '<circle class="g-sock" cx="' + NODE_W + '" cy="' + (SOCKET_Y + 16) + '" r="6" fill="#4caf7d" stroke="#1d2126" stroke-width="1.5">'
          + '<title>Почта для уведомлений: Telegram шлёт сюда уведомления о входе. Тяните на вход другого узла.</title></circle>'
          : '<circle class="g-sock" cx="' + NODE_W + '" cy="' + SOCKET_Y + '" r="6" fill="#5a7dff" stroke="#1d2126" stroke-width="1.5">'
          + '<title>Выход: «' + esc(nm(a)) + '» восстанавливается через другой аккаунт. Тяните на вход другого узла.</title></circle>')
      + (tg
          ? '<circle class="g-sock" cx="' + NODE_W + '" cy="' + (SOCKET_Y + 16) + '" r="6" fill="#e05a5a" stroke="#1d2126" stroke-width="1.5">'
          + '<title>Исходная почта вложенного «' + esc(nm(tg)) + '»: через какой аккаунт он восстанавливается (по умолчанию — этот контейнер). Тяните на вход другого узла.</title></circle>'
          + '<circle class="g-sock" cx="' + NODE_W + '" cy="' + (SOCKET_Y + 32) + '" r="6" fill="#4caf7d" stroke="#1d2126" stroke-width="1.5">'
          + '<title>Уведомления вложенного «' + esc(nm(tg)) + '»: сюда он шлёт уведомления о входе. Тяните на вход другого узла.</title></circle>'
          : '')
      + '</g>');
  });
  return out.join('');
}

function hitTest(wx, wy, excludeId){
  var lay = vaultLayout().nodes;
  var accounts = state.vault.accounts;
  var vis = guideVisibleIds();
  // сокеты — только у нод верхнего уровня
  for(var i = accounts.length - 1; i >= 0; i--){
    var a = accounts[i];
    if(a.parentId) continue;
    if(a.id === excludeId) continue;
    if(vis && !vis.has(a.id)) continue;
    var p = lay[a.id];
    if(!p) continue;
    if(Math.hypot(wx - p.x, wy - (p.y + SOCKET_Y)) <= 13) return { kind: 'input', nodeId: a.id };
    if(Math.hypot(wx - (p.x + NODE_W), wy - (p.y + SOCKET_Y)) <= 13) return { kind: 'output', nodeId: a.id, out: 'via' };
    if(a.type === 'telegram' && Math.hypot(wx - (p.x + NODE_W), wy - (p.y + SOCKET_Y + 16)) <= 13) return { kind: 'output', nodeId: a.id, out: 'notify' };
    var tgs = nestedTelegramOf(a);
    if(tgs){
      if(Math.hypot(wx - (p.x + NODE_W), wy - (p.y + SOCKET_Y + 16)) <= 13) return { kind: 'output', nodeId: a.id, out: 'childVia', childId: tgs.id };
      if(Math.hypot(wx - (p.x + NODE_W), wy - (p.y + SOCKET_Y + 32)) <= 13) return { kind: 'output', nodeId: a.id, out: 'childNotify', childId: tgs.id };
    }
  }
  // строки вложенных сервисов и тела нод
  for(i = accounts.length - 1; i >= 0; i--){
    var a2 = accounts[i];
    if(a2.parentId) continue;
    if(a2.id === excludeId) continue;
    if(vis && !vis.has(a2.id)) continue;
    var p2 = lay[a2.id];
    if(!p2) continue;
    var ch = containerChildren(a2);
    if(!state.collapsedParents.has(a2.id)){
      for(var k = ch.length - 1; k >= 0; k--){
        var c = ch[k];
        if(vis && !vis.has(c.id)) continue;
        var cy = p2.y + HEADER_H + 54 + k * CHILD_H;
        if(wx >= p2.x + 6 && wx <= p2.x + NODE_W - 6 && wy >= cy && wy <= cy + CHILD_H) return { kind: 'node', nodeId: c.id };
      }
    }
    var h = nodeHeightFor(a2);
    if(wx >= p2.x && wx <= p2.x + NODE_W && wy >= p2.y && wy <= p2.y + h) return { kind: 'node', nodeId: a2.id };
  }
  var best = null, bestD = 10;
  function wireHit(a, dstId, outDy, wireKind, srcId){
    var p1 = lay[a.id], p2 = lay[dstId];
    if(!p1 || !p2) return;
    var pts = bezierPoints(p1.x + NODE_W, p1.y + SOCKET_Y + (outDy || 0), p2.x, p2.y + SOCKET_Y);
    var sid = srcId || a.id; // для вложенного Telegram провод рисуется от контейнера, но логически — от Telegram
    for(var k = 0; k < pts.length; k++){
      var dd = Math.hypot(wx - pts[k][0], wy - pts[k][1]);
      if(dd < bestD){ bestD = dd; best = { kind: 'wire', wireKind: wireKind, key: sid + (wireKind === 'notify' ? '~' : '>') + dstId, srcId: sid, dstId: dstId }; }
    }
  }
  accounts.forEach(function(a){
    if(a.id === excludeId) return;
    if(vis && !vis.has(a.id)) return;
    var via = a.recovery ? a.recovery.viaAccountId : null;
    if(via && (!vis || vis.has(via))) wireHit(a, via, 0, 'via');
    if(a.type === 'telegram' && a.notifyEmailId && (!vis || vis.has(a.notifyEmailId))) wireHit(a, a.notifyEmailId, 16, 'notify');
    var tg3 = nestedTelegramOf(a);
    if(tg3){
      var tv3 = tg3.recovery ? tg3.recovery.viaAccountId : null;
      if(tv3 && tv3 !== a.id && (!vis || vis.has(tv3))) wireHit(a, tv3, 16, 'via', tg3.id);
      var tn3 = tg3.notifyEmailId;
      if(tn3 && tn3 !== a.id && tn3 !== tv3 && (!vis || vis.has(tn3))) wireHit(a, tn3, 32, 'notify', tg3.id);
    }
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
    var ody = hit.out === 'notify' ? 16 : (hit.out === 'childNotify' ? 32 : (hit.out === 'childVia' ? 16 : 0));
    dragState = { kind: 'wire', from: 'out', nodeId: hit.nodeId, out: hit.out || 'via', childId: hit.childId || null, sx: p.x + NODE_W, sy: p.y + SOCKET_Y + ody, tempPath: tempWirePath(p.x + NODE_W, p.y + SOCKET_Y + ody, w.x, w.y) };
    renderGraph();
  } else if(hit.kind === 'input'){
    state.selected = null;
    var pin = lay[hit.nodeId];
    dragState = { kind: 'wire', from: 'in', nodeId: hit.nodeId, sx: pin.x, sy: pin.y + SOCKET_Y, tempPath: tempWirePath(w.x, w.y, pin.x, pin.y + SOCKET_Y) };
    renderGraph();
  } else if(hit.kind === 'node'){
    selectNode(hit.nodeId);
    var acc = accById(hit.nodeId);
    var np = lay[hit.nodeId];
    if(acc && acc.parentId && e.altKey){
      // Alt + перетаскивание вложенного сервиса — «вытащить» из контейнера
      dragState = { kind: 'extract', nodeId: hit.nodeId, wx: w.x, wy: w.y, startX: e.clientX, startY: e.clientY, moved: false };
    } else if(np){ // у вложенного сервиса нет своей позиции — только выбор, без перетаскивания
      dragState = { kind: 'node', nodeId: hit.nodeId, origX: np.x, origY: np.y, startX: e.clientX, startY: e.clientY, moved: false, dropTarget: null };
    }
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
    // подсветка цели для «вложить»: наводим на контейнер (или его строку) — он подсвечивается.
    // Исключаем саму перетаскиваемую ноду: она под курсором и перекрыла бы цель.
    var wd = screenToWorld(e.clientX, e.clientY);
    var hd = hitTest(wd.x, wd.y, dragState.nodeId);
    var target = null, rejectTarget = null;
    if(hd.kind === 'node'){
      var ta = accById(hd.nodeId);
      var cand = (ta && ta.parentId) ? ta.parentId : hd.nodeId; // попадание в строку ребёнка = его контейнер
      if(validDropTarget(dragState.nodeId, cand)) target = cand;
      else if(hd.nodeId !== dragState.nodeId) rejectTarget = hd.nodeId; // невалидная цель — красная подсветка + тост при отпускании
    }
    dragState.dropTarget = target;
    dragState.dropRejectTarget = rejectTarget;
    renderGraph();
  } else if(dragState.kind === 'extract'){
    var we = screenToWorld(e.clientX, e.clientY);
    dragState.wx = we.x;
    dragState.wy = we.y;
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
      } else if(d.out === 'childVia'){
        // сокет вложенного Telegram: можно кинуть и на родителя (вернуть дефолт)
        if(hit.kind === 'input') setVia(d.childId, hit.nodeId);
        else if(hit.kind === 'bg' || hit.kind === 'wire') setVia(d.childId, null);
      } else if(d.out === 'childNotify'){
        if(hit.kind === 'input') setNotify(d.childId, hit.nodeId);
        else if(hit.kind === 'bg' || hit.kind === 'wire') setNotify(d.childId, null);
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
    if(d.dropTarget) dropNestInto(d.nodeId, d.dropTarget);
    else if(d.dropRejectTarget) dropNestInto(d.nodeId, d.dropRejectTarget); // покажет тост-причину, вернёт false
    else if(d.moved){ saveCamera(); scheduleSave(); }
    renderGraph();
  } else if(d.kind === 'extract'){
    var we = screenToWorld(e.clientX, e.clientY);
    extractFromContainer(d.nodeId, we.x, we.y);
    renderGraph();
  } else if(d.kind === 'pan'){
    saveCamera();
    renderGraph();
  }
}

/* ===== Перетаскивание для вложения / извлечения =====
 * Вложить: перетащить ноду на контейнер (цель подсвечивается зелёным).
 * Вытащить: Alt + перетаскивание (или Alt+клик) вложенного сервиса — он
 * возвращается на верхний уровень в точку отпускания. */
function validDropTarget(dragId, targetId){
  if(dragId === targetId) return false;
  var d = accById(dragId), t = accById(targetId);
  if(!d || !t) return false;
  if(t.parentId) return false; // вложить можно только в верхнеуровневый контейнер
  if(containerChildren(d).length) return false; // контейнер с детьми сам вложить нельзя
  return true;
}
function dropNestInto(dragId, targetId){
  if(!validDropTarget(dragId, targetId)){
    var t = accById(targetId);
    var d = accById(dragId);
    if(d && t && dragId !== targetId && containerChildren(d).length) toast('Нельзя вложить контейнер с вложенными сервисами');
    else toast('Сюда вложить нельзя');
    return false;
  }
  var d2 = accById(dragId), t2 = accById(targetId);
  d2.parentId = targetId;
  scheduleSave();
  renderGraph();
  renderAccounts();
  renderGuide();
  toast('«' + streamName(d2) + '» вложен в «' + streamName(t2) + '»');
  return true;
}
function extractFromContainer(childId, wx, wy){
  var c = accById(childId);
  if(!c || !c.parentId) return false;
  var par = accById(c.parentId);
  c.parentId = null;
  // сервис появляется там, где его отпустили (если есть точка отпускания)
  if(typeof wx === 'number' && typeof wy === 'number'){
    vaultLayout().nodes[c.id] = { x: Math.round(wx - NODE_W / 2), y: Math.round(wy - NODE_H / 2) };
  }
  scheduleSave();
  renderGraph();
  renderAccounts();
  renderGuide();
  toast('«' + streamName(c) + '» извлечён из «' + (par ? streamName(par) : 'контейнера') + '»');
  return true;
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

function toggleContainerCollapse(id){
  if(state.collapsedParents.has(id)) state.collapsedParents.delete(id);
  else state.collapsedParents.add(id);
  renderGraph();
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
    var a = accById(id);
    var h = a ? nodeHeightFor(a) : NODE_H;
    if(p.x < minX) minX = p.x;
    if(p.y < minY) minY = p.y;
    if(p.x + NODE_W > maxX) maxX = p.x + NODE_W;
    if(p.y + h > maxY) maxY = p.y + h;
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
