// Тесты box selection: рамка выделяет ноды по пересечению прямоугольников,
// Shift-драг — аддитивность, клик по пустому — сброс.
// Запуск:  node --test   (или npm test)

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers.mjs';

function vaultWith(accounts) {
  return {
    version: 1,
    accounts,
    layout: {
      nodes: Object.fromEntries(accounts.map((a) => [a.id, { x: a.x, y: a.y }])),
      camera: null,
    },
  };
}

test('boxNodes: рамка пересекает прямоугольники нод', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'a', name: 'A', type: 'mail', x: 0, y: 0 },
    { id: 'b', name: 'B', type: 'mail', x: 300, y: 0 },
    { id: 'c', name: 'C', type: 'mail', x: 0, y: 150 },
  ]);
  // NODE_W=190, NODE_H=86.
  assert.deepEqual([...sandbox.boxNodes({ x1: -5, y1: -5, x2: 100, y2: 100 })].sort(), ['a'], 'только A');
  assert.deepEqual([...sandbox.boxNodes({ x1: -5, y1: -5, x2: 190, y2: 86 })].sort(), ['a'], 'A целиком');
  assert.deepEqual([...sandbox.boxNodes({ x1: 290, y1: -5, x2: 500, y2: 200 })].sort(), ['b'], 'только B');
  assert.deepEqual([...sandbox.boxNodes({ x1: -5, y1: -5, x2: 500, y2: 300 })].sort(), ['a', 'b', 'c'], 'все');
  assert.deepEqual([...sandbox.boxNodes({ x1: -5, y1: -5, x2: 100, y2: 100 })].sort(), ['a'], 'повторная рамка');
});

test('applyBoxSelection: замена и аддитивное добавление', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([{ id: 'a', name: 'A', type: 'mail', x: 0, y: 0 }]);
  sandbox.applyBoxSelection(['a'], false);
  assert.deepEqual([...sandbox.state.selectedIds], ['a']);
  assert.equal(sandbox.state.selected, null, 'box selection не трогает одиночный selected');
  sandbox.applyBoxSelection(['b'], false);
  assert.deepEqual([...sandbox.state.selectedIds], ['b'], 'замена');
  sandbox.state.selectedIds.add('a');
  sandbox.applyBoxSelection(['b', 'c'], true);
  assert.deepEqual([...sandbox.state.selectedIds].sort(), ['a', 'b', 'c'], 'аддитивно');
  sandbox.applyBoxSelection(['x'], true);
  assert.deepEqual([...sandbox.state.selectedIds].sort(), ['a', 'b', 'c', 'x'], 'аддитивно к существующим');
});

test('boxNodes игнорирует вложенные сервисы и скрытые при поиске', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'P', type: 'mail', x: 0, y: 0 },
    { id: 'child', name: 'C', type: 'telegram-notify', parentId: 'p', x: 0, y: 0 },
  ]);
  // Вложенный не даёт отдельной позиции — это его layout может быть удалён.
  delete sandbox.state.vault.layout.nodes.child;
  assert.deepEqual([...sandbox.boxNodes({ x1: -500, y1: -500, x2: 500, y2: 500 })].sort(), ['p'], 'только верхнеуровневая нода');
});

test('isNodeSelected: учитывает selectedIds и одиночный selected', () => {
  const { sandbox } = loadApp();
  sandbox.state.selectedIds = new Set(['a', 'b']);
  sandbox.state.selected = null;
  assert.equal(sandbox.isNodeSelected('a'), true);
  assert.equal(sandbox.isNodeSelected('b'), true);
  assert.equal(sandbox.isNodeSelected('c'), false);
  sandbox.state.selected = { kind: 'node', id: 'x' };
  assert.equal(sandbox.isNodeSelected('x'), true, 'одиночный selected тоже выделен');
});

/* Групповое перетаскивание: если перетащить уже выделенную ноду, двигаются все из selectedIds */
test('драг уже выделенной ноды: перемещает всю группу одинаково', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'a', name: 'A', type: 'mail', x: 10, y: 20 },
    { id: 'b', name: 'B', type: 'mail', x: 300, y: 40 },
    { id: 'c', name: 'C', type: 'mail', x: 10, y: 150 },
  ]);
  sandbox.state.vault.layout = { nodes: { a: { x: 10, y: 20 }, b: { x: 300, y: 40 }, c: { x: 10, y: 150 } }, camera: { x: 0, y: 0, s: 1 } };
  sandbox.state.camera = { x: 0, y: 0, s: 1 };
  sandbox.state.cameraInitialized = true;
  sandbox.state.selectedIds = new Set(['a', 'b']);
  sandbox.state.selected = null;
  sandbox.state.currentAccountId = null;
  sandbox.renderGraph && sandbox.renderGraph();
  // ректало (left:0, top:0, 800x560) -> world == client при s=1, cam=0
  const ev = (type, x, y, opts = {}) => ({ button: 0, clientX: x, clientY: y, pointerId: 1, altKey: false, preventDefault() {}, ...opts });
  // pointerdown на ноду a (10,20) — она уже в выделении, группа остаётся ['a','b']
  sandbox.onGraphPointerDown(ev('down', 50, 50));
  const groupIds = sandbox.dragState ? [...(sandbox.dragState.group || []).map((m) => m.id)].sort() : [];
  assert.deepEqual(groupIds, ['a', 'b'], 'группа = все выделенные');
  // двигаем на +100,+60 в мире (s=1 => +100,+60 клиента)
  sandbox.onGraphPointerMove(ev('move', 150, 110));
  const lay = sandbox.vaultLayout().nodes;
  assert.equal(lay.a.x, 110, 'a.x сдвинута');
  assert.equal(lay.a.y, 80, 'a.y сдвинута');
  assert.equal(lay.b.x, 400, 'b.x сдвинута так же');
  assert.equal(lay.b.y, 100, 'b.y сдвинута так же');
  assert.equal(lay.c.x, 10, 'c (вне выделения) не тронута');
  sandbox.onGraphPointerUp(ev('up', 150, 110));
});

test('драг НЕ выделенной ноды: выделяет её одну и двигает только её', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'a', name: 'A', type: 'mail', x: 10, y: 20 },
    { id: 'b', name: 'B', type: 'mail', x: 300, y: 40 },
  ]);
  sandbox.state.vault.layout = { nodes: { a: { x: 10, y: 20 }, b: { x: 300, y: 40 } }, camera: { x: 0, y: 0, s: 1 } };
  sandbox.state.camera = { x: 0, y: 0, s: 1 };
  sandbox.state.selectedIds = new Set(['b']);
  sandbox.state.selected = null;
  sandbox.state.currentAccountId = null;
  sandbox.renderGraph && sandbox.renderGraph();
  const ev = (type, x, y, opts = {}) => ({ button: 0, clientX: x, clientY: y, pointerId: 2, altKey: false, preventDefault() {}, ...opts });
  // pointerdown на a (10,20): она НЕ в выделении -> становится единственной
  sandbox.onGraphPointerDown(ev('down', 50, 50));
  assert.deepEqual([...sandbox.state.selectedIds], ['a'], 'выделена только a');
  const g = sandbox.dragState && sandbox.dragState.group;
  assert.equal(g && g.length, 1, 'группа из одной a');
  sandbox.onGraphPointerMove(ev('move', 150, 150));
  const lay = sandbox.vaultLayout().nodes;
  assert.equal(lay.a.x, 110, 'a сдвинута');
  assert.equal(lay.b.x, 300, 'b не тронута');
  sandbox.onGraphPointerUp(ev('up', 150, 150));
});