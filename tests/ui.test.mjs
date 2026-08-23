// Тесты режима версии: плашка «онлайн/локальная» и видимость кнопок
// «Скачать локальную копию» (бессмысленны в file:// — это и есть тот файл).

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers.mjs';

function makeTrackedEl() {
  const el = { _hidden: false };
  el.classList = {
    toggle(c, force) { el._hidden = !!force; },
    contains(c) { return el._hidden; },
    remove() {}, add() {},
  };
  return el;
}

test('renderModeBadge: в file:// «Скачать копию» скрыта, в http(s) — видна', () => {
  const { sandbox, doc } = loadApp();
  const btn = makeTrackedEl();
  const hint = makeTrackedEl();
  const badges = [makeTrackedEl()];
  doc.querySelectorAll = (sel) => {
    if (sel === '.dl-copy-btn, .dl-copy-hint') return [btn, hint];
    if (sel === '.mode-badge') return badges;
    return [];
  };

  sandbox.location = { protocol: 'file:' };
  sandbox.renderModeBadge();
  assert.equal(badges[0].classList.contains('hidden'), false, 'плашка есть');
  assert.equal(btn.classList.contains('hidden'), true, 'кнопка скрыта в file://');
  assert.equal(hint.classList.contains('hidden'), true, 'подсказка скрыта в file://');

  sandbox.location = { protocol: 'https:' };
  sandbox.renderModeBadge();
  assert.equal(btn.classList.contains('hidden'), false, 'кнопка видна в вебе');
  assert.equal(hint.classList.contains('hidden'), false, 'подсказка видна в вебе');
});
