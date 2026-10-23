// Check the delivered offline files, including script syntax and exact source parity.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(root, 'dist/styles.css'), 'utf8');
const sources = ['theme.js', 'app.js'].map(name => ({
  name,
  content: fs.readFileSync(path.join(root, 'dist', name), 'utf8'),
}));
for (const {name, content} of sources) new vm.Script(content, {filename: name});
for (const [language, name] of [
  ['zh-CN', '不可能车站.html'],
  ['en', 'impossible-station.html'],
  ['ja', 'impossible-station-ja.html'],
]) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  assert(html.includes(`<html lang="${language}" data-default-language="${language}">`));
  assert(html.includes(`<style>\n${css}\n</style>`), `${name}: stylesheet differs from source`);
  for (const source of sources) {
    assert(html.includes(`<script>\n${source.content}\n</script>`), `${name}: ${source.name} differs from source`);
  }
  assert.equal([...html.matchAll(/<script\b/gi)].length, sources.length, `${name}: unexpected script`);
  assert(!/<script\b[^>]*\bsrc=/i.test(html), `${name}: external script`);
  assert(!/<link\b[^>]*\brel=["']stylesheet/i.test(html), `${name}: external stylesheet`);
  console.log(`PASS ${name}: ${language}, inline sources match, JavaScript syntax valid.`);
}
console.log('Three standalone editions verified. This does not run a browser.');
