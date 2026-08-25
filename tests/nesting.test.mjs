// Тесты вложенных сервисов (parentId): наследование маршрута восстановления,
// отрисовка контейнера со списком детей, открепление при удалении родителя,
// запрет циклов и вложения в вложенного, видимость при поиске.
//
// Запуск:  node --test   (или npm test)

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, clone } from './helpers.mjs';

function vaultWith(accounts) {
  return { version: 1, accounts, layout: null };
}

test('effectiveVia: вложенный без своего маршрута наследует родителя, свой — приоритетнее', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'c', name: 'Сервис', parentId: 'p' },
    { id: 'd', name: 'Сервис2', parentId: 'p', recovery: { viaAccountId: 'x' } },
    { id: 'x', name: 'Цель' },
  ]);
  assert.equal(sandbox.effectiveVia({ id: 'top', recovery: { viaAccountId: 'v' } }), 'v', 'свой маршрут');
  assert.equal(sandbox.effectiveVia({ id: 'c', parentId: 'p' }), 'p', 'наследует родителя');
  assert.equal(sandbox.effectiveVia({ id: 'd', parentId: 'p', recovery: { viaAccountId: 'x' } }), 'x', 'свой важнее родителя');
  assert.equal(sandbox.effectiveVia({ id: 'none' }), null, 'без всего — null');
  assert.equal(sandbox.effectiveVia(null), null, 'без аккаунта — null');
});

test('containerChildren/descendantIds: порядок и транзитивность', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'P' },
    { id: 'c1', name: 'C1', parentId: 'p' },
    { id: 'c2', name: 'C2', parentId: 'p' },
    { id: 'c1a', name: 'C1a', parentId: 'c1' }, // второй уровень — модель запрещает создавать, но хелперы честны
    { id: 'top', name: 'T' },
  ]);
  assert.deepEqual(sandbox.containerChildren({ id: 'p' }).map((x) => x.id), ['c1', 'c2'], 'порядок из массива');
  assert.deepEqual([...sandbox.descendantIds('p')].sort(), ['c1', 'c1a', 'c2'], 'транзитивно');
  assert.deepEqual([...sandbox.descendantIds('c1')], ['c1a'], 'один уровень ниже');
  assert.equal(sandbox.containerChildren({ id: 'zzz' }).length, 0, 'нет детей');
  assert.equal(sandbox.containerChildren(null).length, 0, 'без аккаунта — пусто');
});

test('nodeHeightFor: контейнер растёт под детей, свёрнутый — компактный', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'P' },
    { id: 'c1', name: 'C1', parentId: 'p' },
    { id: 'c2', name: 'C2', parentId: 'p' },
    { id: 'plain', name: 'Обычный' },
  ]);
  sandbox.state.collapsedParents = new Set();
  assert.equal(sandbox.nodeHeightFor({ id: 'plain' }), sandbox.NODE_H, 'без детей — базовый рост');
  const h2 = sandbox.nodeHeightFor({ id: 'p' });
  assert.ok(h2 > sandbox.NODE_H, 'с 2 детьми выше базового: ' + h2);
  assert.equal(h2, sandbox.HEADER_H + 54 + 2 * sandbox.CHILD_H + 8, 'точно под 2 строки');
  sandbox.state.collapsedParents.add('p');
  const hc = sandbox.nodeHeightFor({ id: 'p' });
  assert.equal(hc, sandbox.HEADER_H + 54 + 1 * sandbox.CHILD_H + 8, 'свёрнутый — одна строка-подсказка');
});

test('chainFor: маршрут вложенного начинается с родителя', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта', recovery: { viaAccountId: 'g' } },
    { id: 'c', name: 'Сервис', parentId: 'p' },
    { id: 'g', name: 'Гугл' },
  ]);
  const chain = sandbox.chainFor('c');
  assert.equal(chain.cycle, false);
  assert.deepEqual(clone(chain.steps.map((x) => x.id)), ['c', 'p', 'g'], 'сервис → родитель → родитель родителя');
});

test('analyzeRecovery: цикл через вложенность обнаруживается', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'm', name: 'Почта', recovery: { viaAccountId: 'c' } },
    { id: 'c', name: 'Сервис', parentId: 'm' }, // effectiveVia(c) = m → m→c→m цикл
  ]);
  const anal = sandbox.analyzeRecovery();
  assert.ok(anal.inCycle.has('m') && anal.inCycle.has('c'), 'оба в цикле');
});

test('nodesSvg: дети внутри контейнера, а не отдельными нодами; есть шеврон', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'c1', name: 'Сервис1', parentId: 'p' },
    { id: 'c2', name: 'Сервис2', parentId: 'p' },
    { id: 'x', name: 'Отдельный' },
  ]);
  sandbox.state.vault.layout = { nodes: { p: { x: 0, y: 0 }, x: { x: 300, y: 0 } }, camera: null };
  sandbox.state.collapsedParents = new Set();
  sandbox.state.streamMode = false;
  sandbox.state.currentAccountId = null;
  sandbox.state.selected = null;
  sandbox.state.guideSearch = '';

  const html = sandbox.nodesSvg();
  assert.ok(html.includes('class="g-child" data-id="c1"'), 'строка c1 внутри контейнера');
  assert.ok(html.includes('class="g-child" data-id="c2"'), 'строка c2 внутри контейнера');
  assert.ok(!html.includes('class="g-node" data-id="c1"') && !html.includes('class="g-node" data-id="c2"'), 'дети не отдельные ноды');
  assert.ok(html.includes('g-node" data-id="x"'), 'обычный аккаунт — отдельная нода');
  assert.ok(html.includes('toggleContainerCollapse('), 'шеврон сворачивания есть');
  assert.ok(!html.includes('вложено'), 'в развёрнутом виде строки детей — без текстовой подсказки');

  // свёрнутый контейнер: строки скрыты, вместо них подсказка со счётчиком
  sandbox.state.collapsedParents.add('p');
  const htmlC = sandbox.nodesSvg();
  assert.ok(!htmlC.includes('class="g-child" data-id="c1"'), 'свёрнуто — строк детей нет');
  assert.ok(htmlC.includes('2 вложено — развернуть'), 'подсказка со счётчиком');
});

test('renderAccounts: дети — вложенные карточки под родителем; поиск фильтрует детей', () => {
  const { sandbox, doc } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта', username: 'p@x.ru' },
    { id: 'c1', name: 'Игра', parentId: 'p', password: 'pw1' },
    { id: 'c2', name: 'Форум', parentId: 'p' },
  ]);
  sandbox.state.revealedIds = new Set();
  sandbox.state.search = '';
  sandbox.renderAccounts();
  let html = doc.el('accounts-list').innerHTML;
  assert.ok(html.includes('acc-card') && html.includes('2 вложено'), 'бейдж «N вложено» у родителя');
  assert.equal((html.match(/acc-card nested/g) || []).length, 2, 'две вложенные карточки');

  sandbox.state.search = 'игра';
  sandbox.renderAccounts();
  html = doc.el('accounts-list').innerHTML;
  assert.ok(html.includes('data-id="p"'), 'родитель показан (совпал ребёнок)');
  assert.ok(html.includes('data-id="c1"') && !html.includes('data-id="c2"'), 'показан только совпавший ребёнок');
});

test('guideVisibleIds: поиск по вложенному добавляет его контейнер', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'c1', name: 'УникальноеИмя', parentId: 'p' },
    { id: 'c2', name: 'Другое', parentId: 'p' },
  ]);
  sandbox.state.guideSearch = 'уникальноеимя';
  const vis = sandbox.guideVisibleIds();
  assert.ok(vis.has('p'), 'контейнер в видимых');
  assert.ok(vis.has('c1'), 'совпавший ребёнок в видимых');
  assert.ok(!vis.has('c2'), 'несозвучный ребёнок скрыт');
});

test('deleteAccountNow: дети открепляются, ссылки очищаются, сам родитель удаляется', () => {
  const { sandbox, doc } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'c1', name: 'Сервис1', parentId: 'p' },
    { id: 'c2', name: 'Сервис2', parentId: 'p', recovery: { viaAccountId: 'p' } },
    { id: 'b', name: 'Другой', recovery: { viaAccountId: 'p' } },
  ]);
  sandbox.state.vaults = [];
  sandbox.state.vaultId = 'p';
  sandbox.state.selected = null;
  sandbox.state.currentAccountId = null;
  sandbox.state.revealedIds = new Set();
  sandbox.state.guideSearch = '';
  sandbox.state.search = '';
  sandbox.deleteAccountNow('p');

  const ids = sandbox.state.vault.accounts.map((x) => x.id);
  assert.ok(!ids.includes('p'), 'родитель удалён');
  const c1 = sandbox.state.vault.accounts.find((x) => x.id === 'c1');
  const c2 = sandbox.state.vault.accounts.find((x) => x.id === 'c2');
  const b = sandbox.state.vault.accounts.find((x) => x.id === 'b');
  assert.equal(c1.parentId, null, 'c1 откреплён');
  assert.equal(c2.parentId, null, 'c2 откреплён');
  assert.equal(c2.recovery.viaAccountId, null, 'ссылка ребёнка на родителя очищена');
  assert.equal(b.recovery.viaAccountId, null, 'ссылка постороннего на родителя очищена');
});

test('saveAccount: нельзя вложить в вложенного аккаунта', () => {
  const { sandbox, doc } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'n', name: 'Вложенный', parentId: 'p' },
  ]);
  sandbox.state.currentAccountId = null;
  doc.el('ed-name').value = 'Новый сервис';
  doc.el('ed-parent').value = 'n'; // n сам вложен → запрет
  sandbox.saveAccount();
  assert.match(doc.el('toast').textContent, /верхнего уровня/, 'тост о запрете');
  assert.equal(sandbox.state.vault.accounts.length, 2, 'аккаунт не добавлен');

  // валидный вариант: вложение в верхнеуровневую почту
  doc.el('ed-parent').value = 'p';
  sandbox.saveAccount();
  assert.equal(sandbox.state.vault.accounts.length, 3, 'аккаунт добавлен');
  const added = sandbox.state.vault.accounts[2];
  assert.equal(added.parentId, 'p', 'parentId записан');
});
