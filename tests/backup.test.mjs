// Тесты индикатора «бэкап устарел» (backupInfo / refreshBackupStatus /
// markExported) и точной dirty-логики saveBlob.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, deriveAt } from './helpers.mjs';

function seedVault(sandbox, opts) {
  // минимальное разблокированное состояние для тестов индикатора
  sandbox.state.vault = { version: 1, accounts: opts.accounts || [] };
  sandbox.state.vaults = [{
    id: 'v1', name: 'V', blob: null,
    updatedAt: opts.updatedAt || 0,
    lastExportAt: opts.lastExportAt || null,
  }];
  sandbox.state.vaultId = 'v1';
}

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

test('backupInfo: изменения после экспорта → «устарел», без изменений → «актуален»', () => {
  const { sandbox, doc } = loadApp();

  // данные менялись ПОСЛЕ экспорта → устарел
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: 2000, lastExportAt: 1000 });
  assert.equal(sandbox.backupInfo().stale, true);
  sandbox.refreshBackupStatus();
  assert.equal(doc.el('backup-status').className, 'bup-warn');
  assert.match(doc.el('backup-status').textContent, /устарел/);

  // экспорт свежее последнего изменения → актуален
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: 1000, lastExportAt: 2000 });
  assert.equal(sandbox.backupInfo().stale, false);
  sandbox.refreshBackupStatus();
  assert.equal(doc.el('backup-status').className, 'bup-ok');
  assert.match(doc.el('backup-status').textContent, /актуален/);
});

test('markExported: фиксирует время экспорта и делает бэкап актуальным', () => {
  const { sandbox, doc, storage } = loadApp();
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: 1000 });

  sandbox.markExported();
  assert.ok(sandbox.state.vaults[0].lastExportAt > 0);
  assert.equal(doc.el('backup-status').className, 'bup-ok');

  // lastExportAt попадает в localStorage-реестр
  const saved = JSON.parse(storage.getItem('pvg.vaults.v1'));
  assert.ok(saved[0].lastExportAt > 0);
});

test('saveBlob: updatedAt поднимается только при реальных изменениях (dirty)', async () => {
  const { sandbox } = loadApp();
  const { saltB64, key } = await deriveAt(sandbox, 'пароль', 1000);
  sandbox.state.salt = saltB64;
  sandbox.state.key = key;
  seedVault(sandbox, { accounts: [{ id: 'a1' }], updatedAt: 1000 });

  // пересохранение без изменений (как при блокировке) не трогает updatedAt
  sandbox.state.dirty = false;
  await sandbox.saveBlob();
  assert.equal(sandbox.state.vaults[0].updatedAt, 1000);

  // реальное изменение — updatedAt сдвигается вперёд
  sandbox.state.dirty = true;
  await sandbox.saveBlob();
  assert.ok(sandbox.state.vaults[0].updatedAt > 1000);
});
