// Тесты ролей Telegram (v1.0.44+): старый «telegram» с двумя выходами мигрирует
// в две отдельные роли — «telegram-recovery» (красный выход: исходная почта) и
// «telegram-notify» (зелёный выход: уведомления). ТГ с обеими связями
// принудительно разбивается на две ноды; оригинальный id остаётся у
// «восстановления», чтобы внешние ссылки не оборвались.
//
// Запуск:  node --test   (или npm test)

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers.mjs';

function vaultWith(accounts) {
  return { version: 1, accounts, layout: null };
}

test('migrateVaultTg: ТГ с обеими связями разбивается на две ноды, id остаётся у восстановления', () => {
  const { sandbox } = loadApp();
  const v = vaultWith([
    { id: 'p', name: 'Почта' },
    { id: 'tg', name: 'Мой ТГ', type: 'telegram', parentId: 'p', username: 'user', password: 'pw', recovery: { viaAccountId: 'x', codes: '123', phone: '+7', notes: 'n', questions: [{ q: 'q', a: 'a' }] }, notifyEmailId: 'y', shared: [{ name: 's' }] },
    { id: 'x', name: 'Исходная' },
    { id: 'y', name: 'Уведомления' },
    { id: 'mail', name: 'Обычный', type: 'mail' },
  ]);
  const changed = sandbox.migrateVaultTg(v);
  assert.equal(changed, 1, 'изменён один аккаунт');
  assert.equal(v.accounts.length, 6, 'один ТГ стал двумя');
  const rec = v.accounts.find((a) => a.id === 'tg');
  const ntf = v.accounts.find((a) => a.type === 'telegram-notify');
  assert.ok(rec && rec.type === 'telegram-recovery', 'оригинальный id — у восстановления');
  assert.equal(rec.recovery.viaAccountId, 'x', 'via остался у восстановления');
  assert.equal(rec.notifyEmailId, null, 'у восстановления нет уведомлений');
  assert.equal(rec.parentId, 'p', 'вложенность сохранена');
  assert.equal(rec.password, 'pw', 'данные у восстановления сохранены');
  assert.equal(rec.recovery.codes, '123', 'коды у восстановления');
  assert.deepEqual(rec.shared, [{ name: 's' }], 'общий доступ у восстановления');
  assert.ok(ntf && ntf.id !== 'tg', 'клон уведомлений — новый id');
  assert.equal(ntf.notifyEmailId, 'y', 'уведомления у клона');
  assert.equal(ntf.name, 'Мой ТГ (уведомления)', 'суффикс в имени клона');
  assert.equal(ntf.recovery.viaAccountId, null, 'у клона нет via');
  assert.equal(ntf.parentId, 'p', 'клон тоже вложен');
  assert.equal(ntf.password, 'pw', 'у клона есть пароль');
  // идемпотентность: повторный прогон ничего не меняет
  assert.equal(sandbox.migrateVaultTg(v), 0, 'второй прогон — без изменений');
});

test('migrateVaultTg: только via → telegram-recovery, только notify → telegram-notify, ничего → recovery', () => {
  const { sandbox } = loadApp();
  const v = vaultWith([
    { id: 'a', name: 'A', type: 'telegram', recovery: { viaAccountId: 'x' } },
    { id: 'b', name: 'B', type: 'telegram', notifyEmailId: 'y' },
    { id: 'c', name: 'C', type: 'telegram' },
    { id: 'x', name: 'X' },
    { id: 'y', name: 'Y' },
  ]);
  sandbox.migrateVaultTg(v);
  assert.equal(v.accounts.find((a) => a.id === 'a').type, 'telegram-recovery');
  assert.equal(v.accounts.find((a) => a.id === 'b').type, 'telegram-notify');
  assert.equal(v.accounts.find((a) => a.id === 'b').notifyEmailId, 'y');
  assert.equal(v.accounts.find((a) => a.id === 'b').recovery.viaAccountId, null);
  assert.equal(v.accounts.find((a) => a.id === 'c').type, 'telegram-recovery');
  assert.equal(v.accounts.length, 5, 'без разбиения');
});

test('migrateVaultTg: новые типы и не-аккаунты не трогаются', () => {
  const { sandbox } = loadApp();
  const v = vaultWith([
    { id: 'r', name: 'R', type: 'telegram-recovery', recovery: { viaAccountId: 'x' } },
    { id: 'n', name: 'N', type: 'telegram-notify', notifyEmailId: 'y' },
    { id: 'm', name: 'M', type: 'mail' },
  ]);
  assert.equal(sandbox.migrateVaultTg(v), 0, 'ничего не меняется');
  assert.equal(sandbox.migrateVaultTg(null), 0, 'null — 0');
  assert.equal(sandbox.migrateVaultTg({}), 0, 'пустой — 0');
});

test('tgSplitPair: пара recovery+notify из одного разбиения — не дубль пароля', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([
    { id: 'r', name: 'Мой ТГ', type: 'telegram-recovery', password: 'same', parentId: 'p' },
    { id: 'n', name: 'Мой ТГ (уведомления)', type: 'telegram-notify', password: 'same', parentId: 'p' },
    { id: 'p', name: 'Почта' },
  ]);
  assert.equal(sandbox.dupPasswordIds().size, 0, 'пара из разбиения не флагуется');
  sandbox.state.vault.accounts[0].name = 'Другой ТГ';
  assert.ok(sandbox.dupPasswordIds().has('r'), 'разные имена — уже дубль');
});

test('saveAccount: у telegram-notify нет via, у telegram-recovery нет notify', () => {
  const { sandbox } = loadApp();
  sandbox.state.vault = vaultWith([{ id: 'x', name: 'X', type: 'mail' }]);
  sandbox.state.currentAccountId = null;
  sandbox.state.pendingAction = null;
  // подменяем readEditorForm, чтобы проверить очистку полей по роли
  const saved = [];
  const orig = sandbox.readEditorForm;
  sandbox.readEditorForm = () => ({
    id: 'n1', type: 'telegram-notify', name: 'ТГ увед', username: '', password: '',
    notes: '', parentId: null,
    recovery: { viaAccountId: 'x', codes: '', phone: '', notes: '', questions: [] },
    notifyEmailId: 'x', shared: [],
  });
  const origClose = sandbox.closeModal;
  sandbox.closeModal = () => {};
  const origRender = sandbox.renderAccounts;
  sandbox.renderAccounts = () => {};
  sandbox.renderGuide = () => {};
  sandbox.scheduleSave = () => {};
  sandbox.saveAccount();
  const a = sandbox.state.vault.accounts.find((x) => x.id === 'n1');
  assert.equal(a.type, 'telegram-notify');
  assert.equal(a.notifyEmailId, 'x', 'уведомления сохранены');
  assert.equal(a.recovery.viaAccountId, null, 'via очищен у notify-роли');
  sandbox.readEditorForm = orig;
  sandbox.closeModal = origClose;
});
