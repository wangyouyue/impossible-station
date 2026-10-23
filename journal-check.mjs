// Independent integration checks for travel journals and exported SVG postcards.
// Runs the unchanged application script. No browser, network, or storage services.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'dist/app.js'), 'utf8');

class Element {
  constructor(tag = 'button', id = '') {
    Object.assign(this, {id, tagName: tag.toUpperCase(), textContent: '', value: '', style: {}, dataset: {}, attributes: {}, listeners: {}, children: [], hidden: false, open: false, disabled: false, parentNode: null, removed: false});
    const classes = new Set();
    this.classList = {add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle(name, force) {const enabled = force ?? !classes.has(name); if (enabled) classes.add(name); else classes.delete(name); return enabled;}};
  }
  addEventListener(type, fn) {(this.listeners[type] ??= []).push(fn);}
  fire(type, event = {}) {return (this.listeners[type] ?? []).map(fn => fn({target: this, ...event}));}
  setAttribute(key, value) {this.attributes[key] = String(value);}
  getAttribute(key) {return this.attributes[key];}
  append(...children) {for (const child of children) {child.parentNode = this; this.children.push(child);}}
  replaceChildren(...children) {for (const child of this.children) child.parentNode = null; this.children = []; this.append(...children);}
  remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; this.removed = true;}
  click() {this.fire('click');}
  closest(selector) {return selector === 'button,a' && ['BUTTON', 'A'].includes(this.tagName) ? this : null;}
  getBoundingClientRect() {return {width: 1000, height: 700, left: 0, top: 0, right: 1000, bottom: 700};}
  scrollIntoView() {}
  showModal() {this.open = true;}
  close() {this.open = false; this.fire('close');}
}

function createHarness({failDownload = false} = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const node = new Element(match[1], match[3]);
    node.hidden = /\bhidden\b/.test(match[2]);
    for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attr[1], attr[2]);
    elements.set(node.id, node);
  }
  const element = id => {assert(elements.has(id), `Missing element ${id}`); return elements.get(id);};
  const stations = Array.from({length: 5}, (_, index) => {const node = new Element(); node.dataset.station = String(index); node.hidden = index === 4; return node;});
  const stamps = Array.from({length: 4}, (_, index) => {const node = new Element(); node.dataset.stamp = String(index); return node;});
  const drawing = new Proxy({}, {get: (target, key) => target[key] ?? ((...args) => {for (const value of args) if (typeof value === 'number') assert(Number.isFinite(value), `Non-finite canvas ${String(key)}`);}), set: (target, key, value) => {target[key] = value; return true;}});
  element('scene').getContext = () => drawing;
  const document = new Element('body');
  document.hidden = false;
  document.body = document;
  document.documentElement = new Element('html');
  document.getElementById = id => elements.get(id);
  document.querySelectorAll = selector => selector === '[data-station]' ? stations : selector === '[data-stamp]' ? stamps : [];
  document.querySelector = selector => selector === '[data-station="4"]' ? stations[4] : null;
  const downloads = [], objects = [], revoked = [], timers = [];
  document.createElement = tag => {
    const node = new Element(tag);
    if (tag === 'a') node.click = () => {if (failDownload) throw new Error('Download unavailable'); downloads.push({href: node.href, name: node.download, node});};
    return node;
  };
  let callback, clock = 0;
  const context = {document, window: {devicePixelRatio: 1}, Blob,
    URL: {createObjectURL(blob) {const url = `blob:test-${objects.length}`; objects.push({url, blob}); return url;}, revokeObjectURL: url => revoked.push(url)},
    matchMedia: () => ({matches: true, addEventListener() {}}),
    ResizeObserver: class {constructor(fn) {this.fn = fn;} observe() {this.fn();}},
    requestAnimationFrame: fn => {callback = fn;},
    setTimeout: (fn, delay = 0) => {timers.push({fn, at: clock + delay}); return timers.length;}, console};
  vm.runInNewContext(script, context, {filename: 'app.js'});
  const runTimers = () => {for (const timer of timers) if (!timer.done && timer.at <= clock) {timer.done = true; timer.fn();}};
  const frameAt = ms => {assert(ms >= clock); clock = ms; callback(ms); runTimers();};
  const advance = (seconds, step = 50) => {const end = clock + seconds * 1000; while (clock < end) frameAt(Math.min(end, clock + step));};
  const click = id => element(id).click();
  const selectJournal = index => {element('journal-station').value = String(index); element('journal-station').fire('change');};
  const note = (value, event = {}) => {element('journal-note').value = value; element('journal-note').fire('input', event);};
  const openJournal = () => {click('open-book'); click('show-journal');};
  const visit = index => {stations[index].click(); click('depart'); advance(20, 1000);};
  const journalSnapshot = () => {openJournal(); return element('journal-station').children.map(option => {selectJournal(Number(option.value)); return {station: option.value, meta: element('journal-meta').textContent, note: element('journal-note').value};});};
  const key = (value, target = element('journal-note')) => document.fire('keydown', {target, key: value, code: value === ' ' ? 'Space' : value, preventDefault() {throw new Error('Journal input unexpectedly invoked global shortcut');}});
  frameAt(0);
  return {element, click, frameAt, advance, stations, stamps, document, downloads, objects, revoked, selectJournal, note, openJournal, visit, journalSnapshot, key};
}

const results = [];
async function test(name, fn) {await fn(); results.push(name); console.log(`PASS ${name}`);}
const decodeXml = text => text.replace(/&(lt|gt|amp|quot|apos);/g, (_, entity) => ({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}[entity]));
const spans = svg => [...svg.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map(match => decodeXml(match[1]));
const artifacts = path.join(root, 'test-artifacts');
fs.mkdirSync(artifacts, {recursive: true});

await test('Empty journals and unvisited stations cannot generate a postcard; unlock alone does not add the fifth station.', () => {
  const h = createHarness();
  h.openJournal();
  assert.equal(h.element('journal-empty').hidden, false);
  assert.equal(h.element('journal-editor').hidden, true);
  h.click('export-postcard'); assert.equal(h.objects.length, 0);
  h.click('close-book'); h.stations[2].click(); h.openJournal();
  assert.equal(h.element('journal-station').children.length, 0);
  h.click('close-book');
  for (const index of [0, 1, 2, 3]) h.visit(index);
  h.openJournal();
  assert.equal(h.stations[4].hidden, false);
  assert.deepEqual(h.element('journal-station').children.map(option => option.value), ['0','1','2','3']);
  assert.equal(h.element('journal-editor').hidden, false);
});

await test('Arrival is recorded against the current train, not the queued destination; repeat visits retain the first train and note.', () => {
  const h = createHarness();
  h.click('depart'); h.advance(3); h.stations[2].click(); h.advance(9);
  h.openJournal(); assert.equal(h.element('postcard-name').textContent, '折纸海');
  assert.equal(h.element('journal-meta').textContent, '首次抵达：第 01 班 · 已到访 1 次');
  assert.deepEqual(h.element('journal-station').children.map(option => option.value), ['0']);
  h.note('潮声留在口袋里。'); h.click('close-book'); h.advance(8);
  h.visit(2); h.visit(0); h.openJournal(); h.selectJournal(0);
  assert.equal(h.element('journal-meta').textContent, '首次抵达：第 01 班 · 已到访 2 次');
  assert.equal(h.element('journal-note').value, '潮声留在口袋里。');
  h.selectJournal(2); assert.equal(h.element('journal-meta').textContent, '首次抵达：第 02 班 · 已到访 1 次');
});

await test('Journal counts and first-train numbers are invariant under long-frame automatic catch-up.', () => {
  const regular = createHarness(), stalled = createHarness();
  for (const h of [regular, stalled]) {h.click('speed'); h.click('speed'); h.click('auto');}
  regular.advance(40.1); stalled.frameAt(100); stalled.frameAt(40100);
  const a = regular.journalSnapshot(), b = stalled.journalSnapshot();
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  assert.equal(a[0].meta, '首次抵达：第 01 班 · 已到访 2 次');
  assert.equal(a[4].meta, '首次抵达：第 05 班 · 已到访 1 次');
});

await test('Independent drafts survive switching stations, book views, close/reopen and fifth-station renaming.', async () => {
  const h = createHarness(); for (const index of [0,1,2,3,4]) h.visit(index);
  h.openJournal(); h.selectJournal(0); h.note('纸船的便条');
  h.selectJournal(1); assert.equal(h.element('journal-note').value, ''); h.note('果园的便条');
  h.selectJournal(0); assert.equal(h.element('journal-note').value, '纸船的便条');
  h.selectJournal(4); h.note('门外还有新的名字。'); h.click('show-tickets');
  h.element('station-name').value = '<b>&纸门'; h.element('secret-naming').fire('submit', {preventDefault() {}});
  h.click('show-journal'); assert.equal(h.element('postcard-name').textContent, '<b>&纸门');
  assert.equal(h.element('journal-note').value, '门外还有新的名字。');
  assert.equal(h.element('journal-meta').textContent, '首次抵达：第 05 班 · 已到访 1 次');
  h.click('close-book'); h.openJournal(); assert.equal(h.element('journal-station').value, '4');
  assert.equal(h.element('journal-note').value, '门外还有新的名字。');
  h.click('export-postcard'); const svg = await h.objects.at(-1).blob.text();
  assert(svg.includes('&lt;b&gt;&amp;纸门')); assert(svg.includes('门外还有新的名字。')); assert(!svg.includes('<b>'));
  h.selectJournal(1); assert.equal(h.element('journal-note').value, '果园的便条');
});

await test('The 160-character limit counts Unicode code points and does not modify in-progress composition.', async () => {
  const h = createHarness(); h.visit(0); h.openJournal();
  assert.equal(h.element('journal-note').getAttribute('maxlength'), undefined, 'A UTF-16 maxlength would reject 160 emoji prematurely');
  for (const value of ['文'.repeat(160), '😀'.repeat(160), '文😀'.repeat(80)]) {
    h.note(value); assert.equal(h.element('journal-note').value, value); assert.equal(h.element('journal-count').textContent, '160 / 160');
  }
  h.note('😀'.repeat(161)); assert.equal(Array.from(h.element('journal-note').value).length, 160); assert.match(h.element('journal-save-status').textContent, /前 160/);
  const pending = '新'.repeat(161);
  h.note(pending, {isComposing: true}); assert.equal(h.element('journal-note').value, pending); assert.equal(h.element('postcard-note').textContent, '😀'.repeat(160));
  h.element('journal-note').fire('compositionend'); assert.equal(h.element('journal-note').value, '新'.repeat(160));
  h.note('😀'.repeat(160)); h.click('export-postcard'); const svg = await h.objects.at(-1).blob.text();
  assert.equal(spans(svg).join('').match(/😀/gu)?.length, 160, 'All 160 emoji must remain visible SVG text');
  fs.writeFileSync(path.join(artifacts, 'journal-emoji-160.svg'), svg);
});

await test('Journal editing and view changes freeze active travel; closing preserves prior pause and idle auto wait.', () => {
  const h = createHarness(); h.visit(0); h.click('depart'); h.advance(3); h.openJournal();
  const progress = h.element('journey-progress').getAttribute('aria-valuenow'), destination = h.element('destination-name').textContent;
  h.note('R V 12345 也可以写进手记');
  for (const key of [' ', 'r', 'v', 'm', '1', '5']) h.key(key);
  h.click('show-tickets'); h.click('show-journal'); h.advance(60);
  assert.equal(h.element('journey-progress').getAttribute('aria-valuenow'), progress);
  assert.equal(h.element('destination-name').textContent, destination);
  h.click('close-book'); h.advance(1); assert(Number(h.element('journey-progress').getAttribute('aria-valuenow')) > Number(progress));
  h.click('depart'); h.openJournal(); h.click('close-book'); assert.equal(h.element('depart-text').textContent, '继续旅程');
  const idle = createHarness(); idle.click('auto'); idle.advance(20); idle.openJournal(); idle.advance(30);
  assert.equal(idle.element('depart-text').textContent, '发车，去看看');
  idle.click('close-book'); idle.advance(1.5); assert.equal(idle.element('depart-text').textContent, '暂停列车');
});

await test('Hostile-looking text remains literal, XML-invalid input is cleaned, and the visible SVG preserves 160 characters.', async () => {
  const h = createHarness(); h.visit(0); h.openJournal();
  const hostile = '<style>@import url("https://evil.invalid");</style><script>alert(1)</script>&\'\n';
  const note = hostile + '😀'.repeat(160 - Array.from(hostile).length);
  assert.equal(Array.from(note).length, 160);
  h.note(note); assert.equal(h.element('postcard-note').textContent, note); assert.equal(h.element('postcard-note').children.length, 0);
  h.click('export-postcard'); const svg = await h.objects.at(-1).blob.text();
  assert.equal(h.objects.at(-1).blob.type, 'image/svg+xml;charset=utf-8');
  assert.match(svg, /width="1200" height="800" viewBox="0 0 1200 800"/);
  assert(!/<(?:script|style|foreignObject|iframe|image|a)\b/i.test(svg));
  assert(!/\b(?:href|onload|onclick)\s*=/i.test(svg));
  assert(svg.includes('&lt;script&gt;')); assert(svg.includes('&lt;style&gt;')); assert(svg.includes('&amp;&apos;'));
  assert(spans(svg).join('').includes(note.trim().replace(/\s+/g, ' ')), 'Visible lines must include the complete normalized note');
  fs.writeFileSync(path.join(artifacts, 'journal-escaped-text.svg'), svg);
  h.note('甲\u0000\u000b\ufffe\uffff\u202e\ud800乙'); assert.equal(h.element('journal-note').value, '甲�乙');
  h.click('export-postcard'); const sanitized = await h.objects.at(-1).blob.text();
  assert(!/[\u0000\u000b\ufffe\uffff\u202e\ud800]/u.test(sanitized));
  assert(sanitized.includes('甲�乙'));
});

await test('Blank notes export a placeholder; repeated downloads remove temporary links and defer URL cleanup even on failure.', async () => {
  const h = createHarness(); h.visit(0); h.openJournal(); h.note(' \n ');
  h.click('export-postcard'); h.click('export-postcard');
  assert.equal(h.downloads.length, 2); assert.equal(h.objects.length, 2); assert.equal(h.revoked.length, 0);
  for (const download of h.downloads) {assert.equal(download.name, '不可能车站-明信片-01.svg'); assert(download.node.removed); assert.equal(download.node.parentNode, null);}
  assert.equal(h.document.children.length, 0);
  assert((await h.objects[0].blob.text()).includes('这一格，留给以后的自己。'));
  h.advance(59); assert.equal(h.revoked.length, 0); h.advance(1); assert.deepEqual(h.revoked, h.objects.map(item => item.url));
  const failed = createHarness({failDownload: true}); failed.visit(0); failed.openJournal(); failed.note('仍在这里。'); failed.click('export-postcard');
  assert.match(failed.element('postcard-export-status').textContent, /未能导出/); assert.equal(failed.element('journal-note').value, '仍在这里。');
  assert.equal(failed.document.children.length, 0); failed.advance(60); assert.deepEqual(failed.revoked, failed.objects.map(item => item.url));
});

console.log(`\n${results.length} journal integration groups passed. SVG samples: ${artifacts}`);
console.log('Browser layout, real download prompts and audible playback remain unverified.');
