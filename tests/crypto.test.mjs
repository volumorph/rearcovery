// Тесты криптографического пути «Путеводителя по паролям».
// Запуск:  node --test   (или npm test)

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadApp, b64, clone, deriveAt } from './helpers.mjs';

const LEGACY_KEY = 'pvg.blob.v1'; // устаревший одиночный формат
const VAULTS_KEY = 'pvg.vaults.v1'; // реестр хранилищ

function flipMiddleChar(str) {
  const i = Math.floor(str.length / 2);
  return str.slice(0, i) + (str[i] === 'A' ? 'B' : 'A') + str.slice(i + 1);
}

/* ================= 1. encrypt/decrypt round-trip ================= */

test('encrypt/decrypt: round-trip с юникодом, подмена шифртекста и чужой ключ', async () => {
  const { sandbox } = loadApp();
  const { key } = await deriveAt(sandbox, 'правильный пароль', 1000);
  const obj = { name: 'Почта А', emoji: '🔐', n: 42, nested: { list: [1, 'два', null] } };

  const enc = await sandbox.encryptWithKey(obj, key);
  assert.equal(typeof enc.iv, 'string');
  assert.equal(typeof enc.ct, 'string');

  const dec = await sandbox.decryptWithKey(enc, key);
  assert.deepEqual(clone(dec), obj);

  // изменение любого символа шифртекста ломает GCM-аутентификацию
  await assert.rejects(sandbox.decryptWithKey({ iv: enc.iv, ct: flipMiddleChar(enc.ct) }, key));

  // чужой ключ не расшифровывает
  const { key: other } = await deriveAt(sandbox, 'другой пароль', 1000);
  await assert.rejects(sandbox.decryptWithKey(enc, other));
});

test('buildBlob: полный путь с реальными 1.2M итераций и расшифровкой обратно', async () => {
  const { sandbox } = loadApp();
  assert.equal(sandbox.KDF_ITERATIONS, 1200000);
  assert.equal(sandbox.KDF_VERSION, 2);

  const { saltB64, key } = await deriveAt(sandbox, 'мастер-пароль', sandbox.KDF_ITERATIONS);
  sandbox.state.salt = saltB64;
  sandbox.state.key = key;

  const vault = { version: 1, accounts: [{ id: 'a1', type: 'google', name: 'Почта', password: 'секрет' }] };
  const blob = await sandbox.buildBlob(vault);

  assert.equal(blob.app, 'password-vault');
  assert.equal(blob.version, 1);
  assert.equal(blob.kdf, 'PBKDF2-SHA256');
  assert.equal(blob.kdfVersion, 2);
  assert.equal(blob.iterations, 1200000);
  assert.equal(blob.salt, saltB64);
  assert.equal(typeof blob.iv, 'string');
  assert.equal(typeof blob.ct, 'string');
  // «когда сохранён» пишется прямо в блоб (для показа при импорте)
  assert.equal(typeof blob.savedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(blob.savedAt)));

  const dec = await sandbox.decryptWithKey(blob, key);
  assert.deepEqual(clone(dec), vault);
});

test('kdf: старый блоб v1 (600k, без kdfVersion) остаётся читаемым', async () => {
  const { sandbox } = loadApp();
  const vault = { version: 1, accounts: [{ id: 'a1', name: 'Почта' }] };
  const oldSalt = b64(randomBytes(16));
  const oldKey = await sandbox.deriveKey('пароль', oldSalt, 600000);
  const enc = await sandbox.encryptWithKey(vault, oldKey);
  const oldBlob = {
    app: 'password-vault', version: 1, kdf: 'PBKDF2-SHA256',
    iterations: 600000, salt: oldSalt, iv: enc.iv, ct: enc.ct,
  };
  assert.equal(sandbox.validBlob(oldBlob), true);
  assert.deepEqual(clone(await sandbox.decryptWithKey(oldBlob, oldKey)), vault);
});

test('kdf: re-KDF 600k → 1.2M через doStrengthenKdf', async () => {
  const { sandbox, doc } = loadApp();
  const vault = { version: 1, accounts: [{ id: 'a1', name: 'Почта' }] };
  const oldSalt = b64(randomBytes(16));
  const oldKey = await sandbox.deriveKey('пароль', oldSalt, 600000);
  const enc = await sandbox.encryptWithKey(vault, oldKey);
  const blob = {
    app: 'password-vault', version: 1, kdf: 'PBKDF2-SHA256',
    iterations: 600000, salt: oldSalt, iv: enc.iv, ct: enc.ct,
  };
  sandbox.state.salt = oldSalt;
  sandbox.state.key = oldKey;
  sandbox.state.vault = vault;
  sandbox.state.blob = blob;
  sandbox.state.vaults = [{ id: 'v1', name: 'V', blob: blob, updatedAt: 1000, lastExportAt: null }];
  sandbox.state.vaultId = 'v1';

  doc.el('st-pass').value = 'пароль';
  await sandbox.doStrengthenKdf();

  const newBlob = sandbox.state.vaults[0].blob;
  assert.equal(newBlob.iterations, 1200000);
  assert.equal(newBlob.kdfVersion, 2);
  assert.notEqual(newBlob.salt, oldSalt);

  // тот же пароль по-прежнему открывает данные
  const newKey = await sandbox.deriveKey('пароль', newBlob.salt, newBlob.iterations);
  assert.deepEqual(clone(await sandbox.decryptWithKey(newBlob, newKey)), vault);
});

/* ================= 2. validBlob ================= */

test('validBlob: принимает корректный блоб и отклоняет повреждённые', () => {
  const { sandbox } = loadApp();
  const valid = {
    app: 'password-vault', version: 1, kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    salt: b64(randomBytes(16)), iv: b64(randomBytes(12)), ct: b64(randomBytes(32)),
  };

  assert.equal(sandbox.validBlob(valid), true);

  // для null/undefined validBlob возвращает сам falsy-операнд (null/undefined),
  // а не строго false — поэтому проверяем отрицание
  for (const bad of [null, undefined, 'строка', 42, []]) {
    assert.ok(!sandbox.validBlob(bad), 'отклоняет: ' + String(bad));
  }

  for (const field of ['app', 'salt', 'iv', 'ct', 'iterations']) {
    const broken = { ...valid };
    delete broken[field];
    assert.equal(sandbox.validBlob(broken), false, 'отсутствует поле ' + field);
  }

  assert.equal(sandbox.validBlob({ ...valid, app: 'other-app' }), false);
  assert.equal(sandbox.validBlob({ ...valid, iterations: '600000' }), false);

  // лишние поля не должны ломать формат (совместимость вперёд)
  assert.equal(sandbox.validBlob({ ...valid, future: true }), true);
});

/* ================= 3. migrateLegacy ================= */

test('migrateLegacy: переносит одиночное хранилище и отказывает на битых данных', () => {
  const { sandbox, storage } = loadApp();
  const legacyBlob = {
    app: 'password-vault', version: 1, kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    salt: b64(randomBytes(16)), iv: b64(randomBytes(12)), ct: b64(randomBytes(32)),
  };

  // пустое хранилище — ничего не делает
  sandbox.migrateLegacy();
  assert.equal(storage.getItem(VAULTS_KEY), null);

  // валидный legacy-блоб переносится в реестр, legacy-ключ удаляется
  storage.setItem(LEGACY_KEY, JSON.stringify(legacyBlob));
  sandbox.migrateLegacy();
  const vaults = JSON.parse(storage.getItem(VAULTS_KEY));
  assert.equal(vaults.length, 1);
  assert.equal(vaults[0].name, 'Моё хранилище');
  assert.deepEqual(vaults[0].blob, legacyBlob);
  assert.equal(storage.getItem(LEGACY_KEY), null);

  // битый JSON — не роняет и ничего не меняет
  storage.setItem(LEGACY_KEY, '{не json');
  sandbox.migrateLegacy();
  assert.equal(storage.getItem(LEGACY_KEY), '{не json');
  assert.equal(JSON.parse(storage.getItem(VAULTS_KEY)).length, 1);

  // валидный JSON, но не блоб — не мигрируется
  storage.setItem(LEGACY_KEY, JSON.stringify({ foo: 1 }));
  sandbox.migrateLegacy();
  assert.equal(storage.getItem(LEGACY_KEY), JSON.stringify({ foo: 1 }));
});

/* ================= 4. applyImport (повреждённый файл) ================= */

test('applyImport: повреждённый файл не проходит и ничего не добавляет', () => {
  const { sandbox, doc } = loadApp();
  const before = sandbox.state.vaults.length;

  sandbox.applyImport('{не json');
  assert.match(doc.el('import-err').textContent, /Не удалось разобрать JSON/);
  assert.equal(sandbox.state.vaults.length, before);

  sandbox.applyImport(JSON.stringify({ foo: 1 }));
  assert.match(doc.el('import-err').textContent, /не похож на бэкап/);
  assert.equal(sandbox.state.vaults.length, before);

  sandbox.applyImport('{}');
  assert.match(doc.el('import-err').textContent, /не похож на бэкап/);
  assert.equal(sandbox.state.vaults.length, before);
});

test('applyImport: структурно валидный, но битый шифртекст не расшифровывается', async () => {
  const { sandbox } = loadApp();
  const { saltB64, key } = await deriveAt(sandbox, 'мастер', sandbox.KDF_ITERATIONS);
  sandbox.state.salt = saltB64;
  sandbox.state.key = key;

  const blob = await sandbox.buildBlob({ version: 1, accounts: [] });
  const corrupted = { ...blob, ct: flipMiddleChar(blob.ct) };

  sandbox.applyImport(JSON.stringify(corrupted));
  assert.equal(sandbox.state.vaults.length, 1);
  assert.deepEqual(clone(sandbox.state.vaults[0].blob), corrupted);

  // структура прошла валидацию, но расшифровать нельзя даже правильным ключом
  await assert.rejects(sandbox.decryptWithKey(sandbox.state.vaults[0].blob, key));
});
