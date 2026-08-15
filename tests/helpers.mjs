// Общий харнесс для тестов: загружает <script> из password-guide.html в
// изолированный vm-контекст с фейковыми DOM / localStorage / navigator,
// чтобы проверять чистую логику без браузера и без сетевых запросов.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(path.join(ROOT, 'password-guide.html'), 'utf8');

const scriptMatch = HTML.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error('Не найден <script> в password-guide.html');
const SCRIPT = scriptMatch[1];

function makeStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
  };
}

function makeElement() {
  return {
    value: '', textContent: '', innerHTML: '', checked: false, files: [],
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    focus() {}, blur() {}, click() {}, select() {}, remove() {}, appendChild() {},
  };
}

function makeDocument() {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, makeElement()); return els.get(id); };
  return {
    getElementById: el,
    el, // доступ из тестов к значениям полей (textContent и т.п.)
    addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return makeElement(); },
    createElementNS() { return makeElement(); },
    activeElement: null,
    documentElement: { outerHTML: '<html></html>' },
    body: { appendChild() {} },
    execCommand() { return false; },
  };
}

export function loadApp() {
  const storage = makeStorage();
  const doc = makeDocument();
  // vm-контекст получает собственные ECMAScript-интринсики (Object/JSON/Math/
  // Set/Uint8Array/...), но НЕ host-глобалы Node — их кладём вручную.
  const sandbox = {};
  const own = (name, value) => Object.defineProperty(sandbox, name, {
    value, writable: true, configurable: true, enumerable: true,
  });
  own('document', doc);
  own('localStorage', storage);
  own('crypto', globalThis.crypto);
  own('btoa', globalThis.btoa);
  own('atob', globalThis.atob);
  own('TextEncoder', globalThis.TextEncoder);
  own('TextDecoder', globalThis.TextDecoder);
  own('console', globalThis.console);
  own('navigator', {});
  own('location', { href: 'file:///password-guide.html', protocol: 'file:' });
  own('alert', () => {});
  own('confirm', () => true);
  own('prompt', () => null);
  own('fetch', () => Promise.reject(new Error('network disabled in tests')));
  own('FileReader', class { readAsText() {} });
  // не даём таймерам приложения висеть в event loop тестов
  own('setTimeout', () => 0);
  own('clearTimeout', () => {});
  own('setInterval', () => 0);
  own('clearInterval', () => {});
  own('addEventListener', () => {});
  own('removeEventListener', () => {});
  own('window', sandbox);
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: 'password-guide.html (script)' });
  return { sandbox, storage, doc };
}

export function b64(bytes) { return Buffer.from(bytes).toString('base64'); }

// объекты, прочитанные из vm-контекста, принадлежат чужому realm (другой
// Object.prototype) — приводим к нашему realm через JSON, чтобы deepEqual работал
export function clone(x) { return JSON.parse(JSON.stringify(x)); }

export async function deriveAt(sandbox, pass, iterations) {
  const saltB64 = b64(randomBytes(16));
  const key = await sandbox.deriveKey(pass, saltB64, iterations);
  return { saltB64, key };
}
