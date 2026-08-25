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

test('validDropTarget: правила цели перетаскивания', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'c', name: 'Сервис', parentId: 'p' },
    { id: 'm', name: 'MEGA' },
    { id: 'box', name: 'Контейнер' },
    { id: 'boxc', name: 'Внутри контейнера', parentId: 'box' },
  ]);
  sandbox.state.collapsedParents = new Set();
  assert.equal(sandbox.validDropTarget('m', 'p'), true, 'обычный на контейнер — можно');
  assert.equal(sandbox.validDropTarget('p', 'p'), false, 'в самого себя — нельзя');
  assert.equal(sandbox.validDropTarget('m', 'c'), false, 'в вложенного — нельзя');
  assert.equal(sandbox.validDropTarget('p', 'm'), false, 'контейнер с детьми вложить — нельзя');
  assert.equal(sandbox.validDropTarget('zzz', 'p'), false, 'нет такого аккаунта');
});

test('dropNestInto: перетаскивание вкладывает, запреты отклоняют', () => {
  const { sandbox, doc } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'm', name: 'MEGA' },
    { id: 'box', name: 'Контейнер' },
    { id: 'boxc', name: 'Внутри', parentId: 'box' },
  ]);
  sandbox.state.collapsedParents = new Set();
  sandbox.state.currentAccountId = null;
  sandbox.state.selected = null;
  sandbox.state.guideSearch = '';
  sandbox.state.revealedIds = new Set();

  assert.equal(sandbox.dropNestInto('m', 'p'), true, 'вложение выполнено');
  assert.equal(sandbox.state.vault.accounts.find((a) => a.id === 'm').parentId, 'p');
  assert.match(doc.el('toast').textContent, /вложен в/);

  assert.equal(sandbox.dropNestInto('p', 'p'), false, 'в себя — отклонено');
  assert.equal(sandbox.dropNestInto('p', 'boxc'), false, 'в вложенного — отклонено');
  assert.equal(sandbox.dropNestInto('box', 'p'), false, 'контейнер с детьми — отклонено');
  assert.ok(!sandbox.state.vault.accounts.find((a) => a.id === 'p').parentId, 'ничего не поменялось');
});

test('extractFromContainer: Alt-перетаскивание вытаскивает сервис в точку отпускания', () => {
  const { sandbox, doc } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'm', name: 'MEGA', parentId: 'p' },
  ]);
  sandbox.state.collapsedParents = new Set();
  sandbox.state.currentAccountId = null;
  sandbox.state.selected = null;
  sandbox.state.guideSearch = '';
  sandbox.state.revealedIds = new Set();

  assert.equal(sandbox.extractFromContainer('m', 400, 300), true, 'извлечение выполнено');
  const m = sandbox.state.vault.accounts.find((a) => a.id === 'm');
  assert.equal(m.parentId, null, 'родитель снят');
  const pos = sandbox.state.vault.layout.nodes['m'];
  assert.ok(pos, 'появилась позиция на графе');
  assert.equal(pos.x, Math.round(400 - sandbox.NODE_W / 2), 'x — точка отпускания');
  assert.match(doc.el('toast').textContent, /извлечён из/);

  assert.equal(sandbox.extractFromContainer('m', 0, 0), false, 'повторное извлечение — no-op');
  assert.equal(sandbox.extractFromContainer('zzz', 0, 0), false, 'нет такого — no-op');
});

test('nestedTelegramOf: сокеты вложенного Telegram только при одном вложенном', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'tg', name: 'Телеграм', type: 'telegram', parentId: 'p' },
    { id: 'tg2', name: 'Телеграм2', type: 'telegram', parentId: 'p' },
    { id: 'tgtop', name: 'ТГ-контейнер', type: 'telegram' },
  ]);
  const p = sandbox.state.vault.accounts.find((a) => a.id === 'p');
  const two = sandbox.nestedTelegramOf(p);
  assert.equal(two, null, 'два Telegram — сокеты не показываем');
  const only = sandbox.state.vault.accounts[1];
  sandbox.state.vault.accounts.splice(2, 1); // убираем второго Telegram
  const one = sandbox.nestedTelegramOf(p);
  assert.ok(one && one.id === 'tg', 'один Telegram — он и есть');
  assert.equal(sandbox.nestedTelegramOf({ id: 'x', type: 'telegram' }), null, 'контейнер-сам-Telegram — нет');
  assert.equal(sandbox.nestedTelegramOf({ id: 'y', type: 'mail' }), null, 'без вложенных — нет');
});

test('точки на строках: зелёная — маршрут на родителя, красная — наружу, нет точки — наследует', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'x', name: 'Другой' },
    { id: 'green', name: 'G', parentId: 'p', recovery: { viaAccountId: 'p' } },
    { id: 'red', name: 'R', parentId: 'p', recovery: { viaAccountId: 'x' } },
    { id: 'none', name: 'N', parentId: 'p' },
  ]);
  sandbox.state.vault.layout = { nodes: { p: { x: 0, y: 0 }, x: { x: 300, y: 0 } }, camera: null };
  sandbox.state.collapsedParents = new Set();
  sandbox.state.streamMode = false;
  sandbox.state.currentAccountId = null;
  sandbox.state.selected = null;
  sandbox.state.guideSearch = '';
  const html = sandbox.nodesSvg();
  assert.ok(html.includes('fill="#4caf7d"><title>'), 'зелёная точка у «маршрут на родителя»');
  assert.ok(html.includes('fill="#e05a5a"><title>'), 'красная точка у «маршрут наружу»');
  assert.ok(html.includes('g-child" data-id="none"') && !html.includes('g-child" data-id="none"' + '<g'), 'у наследующего строки без точки');
  // строка «none» не содержит кружка-точки: проверяем по отсутствию кружка в её блоке
  const noneBlock = html.slice(html.indexOf('data-id="none"'), html.indexOf('data-id="none"') + 320);
  assert.ok(!noneBlock.includes('<circle'), 'нет точки у наследуемого');
});

test('провода вложенного Telegram: красный — исходная почта наружу, зелёный — уведомления', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта', type: 'mail' },
    { id: 'tg', name: 'Телеграм', type: 'telegram', parentId: 'p', recovery: { viaAccountId: 'x' }, notifyEmailId: 'y' },
    { id: 'x', name: 'Цель', type: 'mail' },
    { id: 'y', name: 'Уведомления', type: 'mail' },
  ]);
  sandbox.state.vault.layout = {
    nodes: { p: { x: 0, y: 0 }, x: { x: 300, y: 0 }, y: { x: 300, y: 120 } },
    camera: null,
  };
  sandbox.state.collapsedParents = new Set();
  sandbox.state.currentAccountId = null;
  sandbox.state.selected = null;
  sandbox.state.guideSearch = '';
  const html = sandbox.wiresSvg();
  // esc() экранирует «>» как «&gt;» внутри атрибута
  assert.ok(html.includes('data-key="tg&gt;x"'), 'красный провод исходной почты (ключ от Telegram)');
  assert.ok(html.includes('data-src="tg"') && html.includes('garr-red'), 'красная стрелка от Telegram');
  assert.ok(html.includes('data-key="tg~y"'), 'зелёный провод уведомлений');
  assert.ok(html.includes('garr-green'), 'зелёная стрелка');
  // на родителя провод не рисуется (дефолт — зелёная точка)
  const tg = sandbox.state.vault.accounts.find((a) => a.id === 'tg');
  tg.recovery.viaAccountId = 'p';
  const html2 = sandbox.wiresSvg();
  assert.ok(!html2.includes('data-key="tg>p"'), 'via на родителя — провода нет');
});

test('hitTest: сокеты вложенного Telegram на контейнере', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'p', name: 'Почта', type: 'mail' },
    { id: 'tg', name: 'Телеграм', type: 'telegram', parentId: 'p' },
  ]);
  sandbox.state.vault.layout = { nodes: { p: { x: 0, y: 0 } }, camera: null };
  sandbox.state.collapsedParents = new Set();
  sandbox.state.guideSearch = '';
  const h1 = sandbox.hitTest(sandbox.NODE_W, sandbox.SOCKET_Y + 16);
  assert.equal(h1.kind, 'output');
  assert.equal(h1.out, 'childVia');
  assert.equal(h1.childId, 'tg');
  const h2 = sandbox.hitTest(sandbox.NODE_W, sandbox.SOCKET_Y + 32);
  assert.equal(h2.out, 'childNotify');
  assert.equal(h2.childId, 'tg');
  const h0 = sandbox.hitTest(sandbox.NODE_W, sandbox.SOCKET_Y);
  assert.equal(h0.out, 'via', 'синий сокет контейнера остался');
});
