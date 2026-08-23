// Тесты настроек (09-settings.js): тема (тёмная/светлая/системная), таймаут
// автоблокировки, время очистки буфера, сохранение в localStorage.
//
// Запуск:  node --test   (или npm test)

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers.mjs';

test('настройки: дефолты, загрузка из localStorage и сохранение', () => {
  const { sandbox, storage } = loadApp();
  const s = sandbox.loadSettings();
  assert.equal(s.theme, 'dark', 'тема по умолчанию — тёмная');
  assert.equal(s.idleMin, 15);
  assert.equal(s.clipSec, 30);
  assert.equal(sandbox.state.settings, s, 'state.settings заполнен');

  sandbox.state.settings.theme = 'light';
  sandbox.state.settings.idleMin = 5;
  sandbox.state.settings.clipSec = 60;
  sandbox.saveSettings();
  assert.ok(storage.getItem('pvg.settings.v1'), 'настройки записаны в localStorage');

  const s2 = sandbox.loadSettings();
  assert.equal(s2.theme, 'light');
  assert.equal(s2.idleMin, 5);
  assert.equal(s2.clipSec, 60);
});

test('настройки: битые данные в localStorage не ломают загрузку', () => {
  const { sandbox, storage } = loadApp();
  storage.setItem('pvg.settings.v1', '{не-json');
  const s = sandbox.loadSettings();
  assert.equal(s.theme, 'dark');
  assert.equal(s.idleMin, 15);
  assert.equal(s.clipSec, 30);
});

test('тема: applyTheme ставит data-theme по настройке', () => {
  const { sandbox, doc } = loadApp();
  sandbox.state.settings = { theme: 'dark', idleMin: 15, clipSec: 30 };
  sandbox.applyTheme();
  assert.equal(doc.documentElement.dataset['data-theme'], 'dark');
  assert.equal(doc.documentElement.dataset['data-color-scheme'], 'dark');

  sandbox.state.settings.theme = 'light';
  sandbox.applyTheme();
  assert.equal(doc.documentElement.dataset['data-theme'], 'light');
});

test('тема: system следует за prefers-color-scheme', () => {
  const { sandbox, doc } = loadApp();
  sandbox.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  sandbox.state.settings = { theme: 'system', idleMin: 15, clipSec: 30 };
  sandbox.applyTheme();
  assert.equal(doc.documentElement.dataset['data-theme'], 'dark', 'system + тёмная ОС → тёмная');

  sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  sandbox.applyTheme();
  assert.equal(doc.documentElement.dataset['data-theme'], 'light', 'system + светлая ОС → светлая');
});

test('автоблокировка: idleMs из настроек, 0 = выключена', () => {
  const { sandbox } = loadApp();
  sandbox.state.settings = { theme: 'dark', idleMin: 15, clipSec: 30 };
  assert.equal(sandbox.idleMs(), 15 * 60000);
  sandbox.state.settings.idleMin = 1;
  assert.equal(sandbox.idleMs(), 60000);
  sandbox.state.settings.idleMin = 0;
  assert.equal(sandbox.idleMs(), 0);
});

test('буфер: clipClearMs и подпись следуют за настройкой', () => {
  const { sandbox, doc } = loadApp();
  sandbox.state.settings = { theme: 'dark', idleMin: 15, clipSec: 30 };
  assert.equal(sandbox.clipClearMs(), 30000);
  assert.equal(sandbox.clipClearLabel(), 'буфер очистится через 30 с');

  sandbox.state.settings.clipSec = 60;
  assert.equal(sandbox.clipClearMs(), 60000);
  assert.equal(sandbox.clipClearLabel(), 'буфер очистится через 1 мин');

  sandbox.state.settings.clipSec = 0;
  assert.equal(sandbox.clipClearMs(), 0);
  assert.equal(sandbox.clipClearLabel(), 'очистка буфера выключена');
});

test('буфер: без state.settings (до loadSettings) — дефолт 30 с, ничего не падает', () => {
  const { sandbox } = loadApp();
  sandbox.state.settings = null;
  assert.equal(sandbox.clipClearMs(), 30000);
  assert.equal(sandbox.clipClearLabel(), 'буфер очистится через 30 с');
});

test('настройки: форма сохраняет значения из полей', () => {
  const { sandbox, doc } = loadApp();
  sandbox.loadSettings();
  doc.el('set-theme').value = 'light';
  doc.el('set-idle').value = '5';
  doc.el('set-clip').value = '60';
  sandbox.saveSettingsForm();
  assert.equal(sandbox.state.settings.theme, 'light');
  assert.equal(sandbox.state.settings.idleMin, 5);
  assert.equal(sandbox.state.settings.clipSec, 60);
  assert.equal(doc.el('modal-settings').classList.contains('hidden'), true, 'модалка закрыта');
});
