// Сборка одного самодостаточного password-guide.html из src/.
// Запуск: node build.mjs   (или npm run build)
//
//   src/template.html  — каркас: <head> + разметка <body>, с плейсхолдерами
//                        {{STYLES}} (внутри <style>) и {{SCRIPT}} (внутри <script>)
//   src/styles.css     — CSS целиком
//   src/js/*.js        — JS-модули, конкатенируются в порядке имён файлов
//
// Модули — это обычный ES5 в общей области видимости (как и был монолит):
// порядок файлов важен, но var/function и так хойстятся; исполняемые строки
// (слушатели, var-инициализаторы) сохраняют порядок конкатенации.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

const styles = readFileSync(path.join(root, 'src', 'styles.css'), 'utf8').trimEnd();

const jsDir = path.join(root, 'src', 'js');
const modules = readdirSync(jsDir)
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => readFileSync(path.join(jsDir, f), 'utf8').trimEnd());
const script = "'use strict';\n\n" + modules.join('\n\n');

const template = readFileSync(path.join(root, 'src', 'template.html'), 'utf8');
let out = template.replace('{{STYLES}}', styles).replace('{{SCRIPT}}', script);
// Хвостовой перевод строки после </html> браузер отбрасывает при парсинге,
// поэтому сериализация DOM и файл разошлись бы на этот символ (хэш не совпал бы).
out = out.replace(/\s+$/, '');

/* ===== Линт сериализационной стабильности =====
 * Хэш приложения в file://-копиях считается по сериализации DOM
 * (document.documentElement.outerHTML) ДО мутаций страницы. Чтобы он совпадал
 * с опубликованным SHA-256, DOM-сериализация должна быть байт-в-байт равна файлу.
 * Парсер браузера нормализует: пробелы между <html>/<head>, </body>/</html>,
 * хвостовой перенос, минимизированные булевы атрибуты (checked → checked=""),
 * одинарные кавычки атрибутов → двойные, сырые & вне сущностей. Этот линт
 * ловит такие регрессии при сборке (CI тоже гоняет npm run build). */
function lintSerialization(t) {
  const problems = [];
  const markup = t
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '');
  if (/<html[^>]*>\s+<head/i.test(t)) problems.push('пробел между <html> и <head> — парсер его отбрасывает');
  if (/<\/body>\s+<\/html>/i.test(t)) problems.push('пробел между </body> и </html> — парсер переносит его в <body>');
  if (/[ \t\r]+$/.test(t)) problems.push('хвостовой пробел после </html>');
  const bools = markup.match(/\s(checked|readonly|disabled|required|selected|multiple|autofocus|novalidate)(?![=\w])/g);
  if (bools) problems.push('минимизированные булевы атрибуты (пишите checked=""): ' + bools.join(', '));
  // сначала вырезаем значения двойных атрибутов: одинарные кавычки ВНУТРИ
  // значения (например, в data-URI favicon'а) — это ок и round-trip'ится
  const noValues = markup.replace(/"[^"]*"/g, '""');
  const sgl = noValues.match(/\s[\w-]+='[^']*'/g);
  if (sgl) problems.push('атрибуты в одинарных кавычках (пишите двойные): ' + sgl.join(', '));
  const amp = markup.match(/&(?!(amp|lt|gt|quot|nbsp|#\d+|#x[0-9a-fA-F]+);)/g);
  if (amp) problems.push('сырой & вне сущности: ' + amp.join(' '));
  return problems;
}
const lint = lintSerialization(template);
if (lint.length) {
  console.error('\nСБОРКА ОСТАНОВЛЕНА — сериализация DOM не будет байт-в-байт равна файлу:\n - ' + lint.join('\n - ') + '\n');
  process.exit(1);
}

// Версия приложения: CI пересобирает с PVG_VERSION="v1.0.<run_number>" ПЕРЕД
// расчётом хэша и публикацией — поэтому версия попадает и в локальные копии,
// и в опубликованный хэш. Локальная сборка (без env) остаётся детерминированной.
const version = process.env.PVG_VERSION || '1.0';
out = out.replace(/var APP_VERSION = '[^']*';/, "var APP_VERSION = '" + version + "';");

writeFileSync(path.join(root, 'password-guide.html'), out);
console.log('built password-guide.html (' + modules.length + ' js-модулей, версия ' + version + ')');
