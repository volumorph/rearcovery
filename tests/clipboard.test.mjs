// Тесты очистки буфера обмена после копирования пароля (copyText + secret).

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers.mjs';

function setupClipboard() {
  const { sandbox } = loadApp();
  const ctl = { clip: '', timerCb: null };
  sandbox.navigator.clipboard = {
    writeText(t) { ctl.clip = String(t); return Promise.resolve(); },
    readText() { return Promise.resolve(ctl.clip); },
  };
  sandbox.setTimeout = (fn) => { ctl.timerCb = fn; return 1; };
  sandbox.clearTimeout = () => {};
  return { sandbox, ctl };
}
const tick = () => new Promise((r) => setImmediate(r));

test('копирование пароля: пишет в буфер и очищает его через 30 с', async () => {
  const { sandbox, ctl } = setupClipboard();
  sandbox.copyText('s3cret', { secret: true });
  await tick();
  assert.equal(ctl.clip, 's3cret');
  assert.equal(sandbox.clipboardSecret, 's3cret');
  assert.equal(typeof ctl.timerCb, 'function');

  ctl.timerCb(); // сработал таймер очистки
  await tick(); await tick();
  assert.equal(ctl.clip, '');
  assert.equal(sandbox.clipboardSecret, null);
});

test('очистка не затирает чужое: если буфер изменился за 30 с — не трогаем', async () => {
  const { sandbox, ctl } = setupClipboard();
  sandbox.copyText('s3cret', { secret: true });
  await tick();
  ctl.clip = 'что-то другое'; // пользователь скопировал другое до очистки
  ctl.timerCb();
  await tick(); await tick();
  assert.equal(ctl.clip, 'что-то другое');
});

test('обычное копирование (не пароль) не планирует очистку', async () => {
  const { sandbox, ctl } = setupClipboard();
  sandbox.copyText('username');
  await tick();
  assert.equal(ctl.clip, 'username');
  assert.equal(sandbox.clipboardSecret, null);
});

test('если буфер нельзя прочитать — очищаем безусловно', async () => {
  const { sandbox, ctl } = setupClipboard();
  sandbox.navigator.clipboard.readText = () => Promise.reject(new Error('no permission'));
  sandbox.copyText('s3cret', { secret: true });
  await tick();
  assert.equal(ctl.clip, 's3cret');
  ctl.timerCb();
  await tick(); await tick();
  assert.equal(ctl.clip, '');
});
