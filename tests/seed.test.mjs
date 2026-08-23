// Тесты seed-фразы восстановления (BIP-39, 12 слов):
// генерация/валидация, включение (миграция v1→v2), смена пароля и укрепление
// не ломают seed, восстановление доступа по фразе, отключение seed.
//
// Запуск:  node --test   (или npm test)

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadApp, b64 } from './helpers.mjs';

// поднять v1-хранилище (как doSetup: пароль → производный ключ → данные)
async function setupV1Vault(sandbox, pass) {
  const salt = b64(randomBytes(16));
  sandbox.state.salt = salt;
  const key = await sandbox.deriveKey(pass, salt, sandbox.KDF_ITERATIONS);
  sandbox.state.key = key;
  sandbox.state.vault = { version: 1, accounts: [{ id: 'a1', name: 'Почта', password: 'секрет' }] };
  sandbox.state.vaults = [{ id: 'v1', name: 'V', blob: null, updatedAt: Date.now(), lastExportAt: null, fileName: null }];
  sandbox.state.vaultId = 'v1';
  sandbox.state.selectedVaultId = 'v1';
  await sandbox.saveBlob();
  return salt;
}

// полный цикл включения seed через реальные функции интерфейса
async function enableSeed(sandbox, doc, pass) {
  doc.el('seed-pass').value = pass;
  await sandbox.doSeedGenerate();
  const phrase = sandbox.state.seedPending.phrase;
  assert.ok(phrase && phrase.split(' ').length === 12);
  await sandbox.doSeedVerifyStart();
  const ask = sandbox.state.seedPending.ask;
  const words = phrase.split(' ');
  ask.forEach((idx, k) => { doc.el('seed-vi-' + k).value = words[idx]; });
  await sandbox.doSeedSetupConfirm();
  assert.equal(sandbox.state.vaults[0].blob.version, 2);
  assert.ok(sandbox.state.vaults[0].blob.ekPass);
  assert.ok(sandbox.state.vaults[0].blob.ekSeed);
  return phrase;
}

test('seed: генерация — 12 слов из словаря, разные фразы, валидность', async () => {
  const { sandbox } = loadApp();
  const phrase = await sandbox.generateSeedPhrase();
  const ws = phrase.split(' ');
  assert.equal(ws.length, 12);
  const list = sandbox.seedWords();
  assert.equal(list.length, 2048);
  for (const w of ws) assert.ok(list.includes(w), 'слово из словаря: ' + w);
  assert.equal(await sandbox.seedPhraseValid(phrase), true);

  const phrase2 = await sandbox.generateSeedPhrase();
  assert.notEqual(phrase, phrase2);
});

test('seed: валидация отклоняет битые фразы', async () => {
  const { sandbox } = loadApp();
  const phrase = await sandbox.generateSeedPhrase();
  const ws = phrase.split(' ');
  const list = sandbox.seedWords();

  // портим контрольную сумму детерминированно: меняем нижние 4 бита индекса
  // последнего слова (энтропия та же, «want» другой → не совпадает всегда)
  const lastIdx = list.indexOf(ws[11]);
  ws[11] = list[(lastIdx ^ 0b1010) & 0x7ff];
  assert.equal(await sandbox.seedPhraseValid(ws.join(' ')), false, 'битая контрольная сумма');

  // неверное число слов
  assert.equal(await sandbox.seedPhraseValid(ws.slice(0, 11).join(' ')), false);
  assert.equal(await sandbox.seedPhraseValid(ws.join(' ') + ' abandon'), false);

  // слово не из словаря
  const bad = ws.slice(0, 11); bad.push('zzzzz');
  assert.equal(await sandbox.seedPhraseValid(bad.join(' ')), false);

  // пусто и мусор
  assert.equal(await sandbox.seedPhraseValid(''), false);
  assert.equal(await sandbox.seedPhraseValid('abandon'), false);

  // регистр и лишние пробелы не мешают валидной фразе
  assert.equal(await sandbox.seedPhraseValid(phrase.toUpperCase()), true);
  assert.equal(await sandbox.seedPhraseValid('  ' + phrase.replace(/ /g, '  ') + '  '), true);
});

test('seed: включение (v1→v2), смена пароля и укрепление не ломают восстановление', async () => {
  const { sandbox, doc } = loadApp();
  sandbox.event = {};
  await setupV1Vault(sandbox, 'мастер');
  assert.equal(sandbox.state.vaults[0].blob.version, 1); // без seed — старый формат

  const phrase = await enableSeed(sandbox, doc, 'мастер');
  const v2blob = sandbox.state.vaults[0].blob;
  assert.equal(v2blob.seedIterations, sandbox.SEED_KDF_ITERATIONS);

  // смена мастер-пароля: ekPass переоборачивается, ekSeed не трогается
  doc.el('cp-current').value = 'мастер';
  doc.el('cp-new').value = 'новый-пароль';
  doc.el('cp-confirm').value = 'новый-пароль';
  await sandbox.doChangePass();
  let blob = sandbox.state.vaults[0].blob;
  assert.equal(blob.version, 2);
  assert.ok(blob.ekSeed, 'seed сохранён после смены пароля');

  // укрепление KDF: тот же сценарий
  doc.el('st-pass').value = 'новый-пароль';
  await sandbox.doStrengthenKdf();
  blob = sandbox.state.vaults[0].blob;
  assert.equal(blob.iterations, sandbox.KDF_ITERATIONS);
  assert.ok(blob.ekSeed, 'seed сохранён после укрепления');

  // фраза по-прежнему разворачивает VK и открывает данные
  const seedKey = await sandbox.deriveSeedKey(phrase, blob.seedIterations);
  const vkRaw = await sandbox.unwrapKeyBytes(blob.ekSeed, blob.ekSeedIv, seedKey);
  const vk = await crypto.subtle.importKey('raw', vkRaw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  const vault = await sandbox.decryptWithKey(blob, vk);
  assert.equal(cloneVault(vault).accounts[0].password, 'секрет');

  // и новый пароль тоже открывает (ekPass переобёрнут)
  const dk = await sandbox.deriveKey('новый-пароль', blob.salt, blob.iterations);
  assert.equal(cloneVault(await sandbox.unlockWithKey(blob, dk)).accounts[0].name, 'Почта');
});

test('seed: восстановление доступа по фразе без знания пароля', async () => {
  const { sandbox, doc } = loadApp();
  sandbox.event = {};
  await setupV1Vault(sandbox, 'мастер');
  const phrase = await enableSeed(sandbox, doc, 'мастер');

  // «забыли пароль»: на экране входа вводим только фразу и новый пароль
  doc.el('seed-recover-input').value = phrase;
  doc.el('seed-recover-pass').value = 'после-восстановления';
  doc.el('seed-recover-pass2').value = 'после-восстановления';
  await sandbox.doSeedRecover();

  const blob = sandbox.state.vaults[0].blob;
  assert.equal(blob.version, 2);
  // новый пароль открывает данные
  const dk = await sandbox.deriveKey('после-восстановления', blob.salt, blob.iterations);
  const vault = cloneVault(await sandbox.unlockWithKey(blob, dk));
  assert.equal(vault.accounts[0].name, 'Почта');
  assert.equal(vault.accounts[0].password, 'секрет');
  // seed сохранён — фраза всё ещё открывает
  const sk = await sandbox.deriveSeedKey(phrase, blob.seedIterations);
  const raw = await sandbox.unwrapKeyBytes(blob.ekSeed, blob.ekSeedIv, sk);
  const vk = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  assert.equal(cloneVault(await sandbox.decryptWithKey(blob, vk)).accounts[0].password, 'секрет');
});

test('seed: неверная фраза не восстанавливает доступ', async () => {
  const { sandbox, doc } = loadApp();
  sandbox.event = {};
  await setupV1Vault(sandbox, 'мастер');
  const phrase = await enableSeed(sandbox, doc, 'мастер');

  // (а) чужая, но синтаксически валидная фраза — не разворачивает ekSeed
  const other = await sandbox.generateSeedPhrase();
  assert.notEqual(other, phrase, 'фраза действительно другая');
  doc.el('seed-recover-input').value = other;
  doc.el('seed-recover-pass').value = 'новый-пароль';
  doc.el('seed-recover-pass2').value = 'новый-пароль';
  await sandbox.doSeedRecover();
  assert.ok(doc.el('seed-recover-err').textContent, 'ошибка показана');
  assert.equal(sandbox.state.vault.accounts[0].name, 'Почта', 'данные не тронуты');

  // (б) фраза с битой контрольной суммой — отсекается валидацией ещё до крипты
  const ws = phrase.split(' ');
  const list = sandbox.seedWords();
  ws[11] = list[(list.indexOf(ws[11]) ^ 0b1010) & 0x7ff];
  doc.el('seed-recover-input').value = ws.join(' ');
  doc.el('seed-recover-pass').value = 'новый-пароль';
  doc.el('seed-recover-pass2').value = 'новый-пароль';
  await sandbox.doSeedRecover();
  assert.match(doc.el('seed-recover-err').textContent, /не распознана/);
});

test('seed: отключение — фраза больше не открывает хранилище', async () => {
  const { sandbox, doc } = loadApp();
  sandbox.event = {};
  await setupV1Vault(sandbox, 'мастер');
  const phrase = await enableSeed(sandbox, doc, 'мастер');

  // отключить (подтверждение мастер-паролем)
  doc.el('seed-pass').value = 'мастер';
  await sandbox.doSeedRemove();
  const blob = sandbox.state.vaults[0].blob;
  assert.ok(!blob.ekSeed, 'ekSeed удалён из блоба');
  assert.ok(!blob.ekSeedIv);

  // восстановление теперь невозможно
  doc.el('seed-recover-input').value = phrase;
  doc.el('seed-recover-pass').value = 'новый-пароль';
  doc.el('seed-recover-pass2').value = 'новый-пароль';
  await sandbox.doSeedRecover();
  assert.match(doc.el('seed-recover-err').textContent, /не настроено/);

  // но сам пароль открывает по-прежнему
  const dk = await sandbox.deriveKey('мастер', blob.salt, blob.iterations);
  assert.equal(cloneVault(await sandbox.unlockWithKey(blob, dk)).accounts[0].name, 'Почта');
});

function cloneVault(v) { return JSON.parse(JSON.stringify(v)); }
