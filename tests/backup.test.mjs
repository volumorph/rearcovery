// Тесты индикатора «бэкап устарел» (backupInfo / refreshBackupStatus /
// markExported / exportFileName), точной dirty-логики saveBlob и сохранения
// имени файла при импорте.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, deriveAt, b64 } from './helpers.mjs';
import { randomBytes } from 'node:crypto';

function seedVault(sandbox, opts) {
  // минимальное разблокированное состояние для тестов индикатора
  sandbox.state.vault = { version: 1, accounts: opts.accounts || [] };
  sandbox.state.vaults = [{
    id: 'v1', name: opts.name ?? 'V', blob: opts.blob ?? null,
    updatedAt: opts.updatedAt || 0,
    lastExportAt: opts.lastExportAt || null,
    fileName: opts.fileName || null,
  }];
  sandbox.state.vaultId = 'v1';
}

// календарные дни с гарантированной разницей (локальное время)
const DAY1 = new Date(2026, 7, 16, 10, 0, 0).getTime(); // 16.08.2026
const DAY2 = new Date(2026, 7, 17, 10, 0, 0).getTime(); // 17.08.2026

test('backupInfo: без аккаунтов индикатор скрыт, без экспорта — «не создан»', () => {
  const { sandbox, doc } = loadApp();

  // нет данных → скрыто
  seedVault(sandbox, { accounts: [] });
  sandbox.refreshBackupStatus();
  assert.equal(doc.el('backup-status').style.display, 'none');

  // данные есть, экспорта не было → красная плашка «не создан»
  seedVault(sandbox, { accounts: [{ id: 'a1' }] });
  sandbox.refreshBackupStatus();
  const el = doc.el('backup-status');
  assert.equal(el.style.display, '');
  assert.equal(el.className, 'bup-danger');
  assert.match(el.textContent, /не создан/);
});

test('backupInfo: устарел только если изменение — в более поздний ДЕНЬ, чем экспорт', () => {
  const { sandbox, doc } = loadApp();

  // изменение на следующий день после экспорта → устарел
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: DAY2, lastExportAt: DAY1 });
  assert.equal(sandbox.backupInfo().stale, true);
  sandbox.refreshBackupStatus();
  assert.equal(doc.el('backup-status').className, 'bup-warn');
  assert.match(doc.el('backup-status').textContent, /устарел/);

  // изменение ПОСЛЕ экспорта, но в тот же день → «день в день» = актуален
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: DAY1 + 5000, lastExportAt: DAY1 });
  assert.equal(sandbox.backupInfo().stale, false);
  sandbox.refreshBackupStatus();
  assert.equal(doc.el('backup-status').className, 'bup-ok');
  assert.match(doc.el('backup-status').textContent, /актуален/);

  // экспорт на следующий день после изменения → актуален
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: DAY1, lastExportAt: DAY2 });
  assert.equal(sandbox.backupInfo().stale, false);
  sandbox.refreshBackupStatus();
  assert.equal(doc.el('backup-status').className, 'bup-ok');
});

test('markExported: фиксирует время экспорта, делает бэкап актуальным', () => {
  const { sandbox, doc, storage } = loadApp();
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: DAY1 });

  sandbox.markExported();
  assert.ok(sandbox.state.vaults[0].lastExportAt > 0);
  assert.equal(doc.el('backup-status').className, 'bup-ok');

  // время экспорта попадает в localStorage-реестр
  const saved = JSON.parse(storage.getItem('pvg.vaults.v1'));
  assert.ok(saved[0].lastExportAt > 0);
});

test('exportFileName: имя файла = имя хранилища, иначе дефолтное с датой', () => {
  const { sandbox } = loadApp();

  // без имени — дефолтное paroli-vault-ГГГГ-ММ-ДД.json
  seedVault(sandbox, { accounts: [{ id: 'a1' }], name: '' });
  assert.match(sandbox.exportFileName(), /^paroli-vault-\d{4}-\d{2}-\d{2}\.json$/);

  // имя файла = имя хранилища + .json (не отдельное fileName)
  seedVault(sandbox, { accounts: [{ id: 'a1' }], name: 'Мой сейф' });
  assert.equal(sandbox.exportFileName(), 'Мой сейф.json');
});

test('applyImport: сохраняет имя файла и сообщает дату сохранения + версию формата', async () => {
  const { sandbox, doc } = loadApp();
  const { saltB64, key } = await deriveAt(sandbox, 'пароль', 1000);
  sandbox.state.salt = saltB64;
  sandbox.state.key = key;
  sandbox.state.vault = { version: 1, accounts: [] };
  const blob = await sandbox.buildBlob(sandbox.state.vault);

  sandbox.applyImport(JSON.stringify(blob), 'Мой сейф.json');
  const entry = sandbox.state.vaults[0];
  assert.equal(entry.name, 'Мой сейф');
  assert.equal(entry.fileName, undefined);
  assert.equal(entry.blob.app, 'password-vault');
  // в тосте — «сохранено» и «формат v1.2»
  assert.match(doc.el('toast').textContent, /сохранено:/);
  assert.match(doc.el('toast').textContent, /формат v1\.2/);

  // импорт из текста (без имени файла) — дефолтное имя
  sandbox.applyImport(JSON.stringify(blob));
  const second = sandbox.state.vaults[1];
  assert.match(second.name, /Импорт/);
});

test('saveBlob: updatedAt поднимается только при реальных изменениях (dirty)', async () => {
  const { sandbox } = loadApp();
  const { saltB64, key } = await deriveAt(sandbox, 'пароль', 1000);
  sandbox.state.salt = saltB64;
  sandbox.state.key = key;
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: DAY1 });

  // пересохранение без изменений (как при блокировке) не трогает updatedAt
  sandbox.state.dirty = false;
  await sandbox.saveBlob();
  assert.equal(sandbox.state.vaults[0].updatedAt, DAY1);

  // реальное изменение — updatedAt сдвигается вперёд
  sandbox.state.dirty = true;
  await sandbox.saveBlob();
  assert.ok(sandbox.state.vaults[0].updatedAt > DAY1);
});
