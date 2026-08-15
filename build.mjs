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
const out = template.replace('{{STYLES}}', styles).replace('{{SCRIPT}}', script);

writeFileSync(path.join(root, 'password-guide.html'), out);
console.log('built password-guide.html (' + modules.length + ' js-модулей)');
