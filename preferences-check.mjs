// Integration checks for language and theme preferences, using actual app scripts.
// The DOM/canvas model below records content and state, not browser layout or pixels.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(match => {
  const filename = path.join(root, 'dist', match[1]);
  assert(filename.startsWith(path.join(root, 'dist') + path.sep), 'Scripts must stay in the local dist directory');
  return {name: match[1], source: fs.readFileSync(filename, 'utf8')};
});
assert(sources.some(item => item.name === 'app.js'), 'Expected the actual app script');
assert(sources.some(item => item.name === 'theme.js'), 'Expected the actual theme script');

const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
  if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
  return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0'}[entity.toLowerCase()];
});

class TextNode {
  constructor(value) {this.nodeType = 3; this.textContent = value; this.parentNode = null;}
}

class Element {
  constructor(tag = 'div') {
    Object.assign(this, {nodeType: 1, tagName: tag.toUpperCase(), id: '', value: '', style: {}, dataset: {}, attributes: {}, listeners: {}, childNodes: [], hidden: false, open: false, disabled: false, parentNode: null, removed: false});
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name),
      toggle: (name, force) => {const enabled = force ?? !this.classes.has(name); if (enabled) this.classes.add(name); else this.classes.delete(name); return enabled;},
    };
  }
  get children() {return this.childNodes.filter(node => node.nodeType === 1);}
  get options() {return this.children.filter(node => node.tagName === 'OPTION');}
  get textContent() {return this.childNodes.map(node => node.textContent).join('');}
  set textContent(value) {this.replaceChildren(new TextNode(String(value)));}
  get className() {return [...this.classes].join(' ');}
  set className(value) {this.classes = new Set(String(value).split(/\s+/).filter(Boolean));}
  addEventListener(type, listener) {(this.listeners[type] ??= []).push(listener);}
  fire(type, event = {}) {return (this.listeners[type] ?? []).map(listener => listener({target: this, ...event}));}
  dispatchEvent(event) {this.fire(event.type, event); return !event.defaultPrevented;}
  setAttribute(name, value) {
    value = String(value); this.attributes[name] = value;
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = value;
    if (name === 'value') this.value = value;
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'lang') this.lang = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  getAttribute(name) {return name === 'class' ? this.className : this.attributes[name] ?? null;}
  hasAttribute(name) {return Object.hasOwn(this.attributes, name);}
  removeAttribute(name) {delete this.attributes[name]; if (name === 'hidden') this.hidden = false; if (name === 'disabled') this.disabled = false;}
  append(...nodes) {for (let node of nodes) {if (typeof node === 'string') node = new TextNode(node); node.parentNode = this; this.childNodes.push(node);}}
  appendChild(node) {this.append(node); return node;}
  replaceChildren(...nodes) {for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; this.append(...nodes);}
  remove() {if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this); this.parentNode = null; this.removed = true;}
  click() {return this.fire('click');}
  closest(selector) {for (let node = this; node; node = node.parentNode) if (node.nodeType === 1 && matches(node, selector)) return node; return null;}
  querySelectorAll(selector) {return descendants(this).filter(node => matches(node, selector));}
  querySelector(selector) {return this.querySelectorAll(selector)[0] ?? null;}
  getBoundingClientRect() {return {width: 1000, height: 700, left: 0, top: 0, right: 1000, bottom: 700};}
  scrollIntoView() {}
  focus() {for (let node = this; node; node = node.parentNode) if (node.tagName === '#DOCUMENT') node.activeElement = this;}
  showModal() {this.open = true;}
  close() {this.open = false; this.fire('close');}
}

function descendants(node) {
  const result = [];
  for (const child of node.childNodes ?? []) if (child.nodeType === 1) {result.push(child); result.push(...descendants(child));}
  return result;
}

function matches(node, selector) {
  return selector.split(',').some(part => {
    part = part.trim();
    const tag = part.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    const id = part.match(/#([\w-]+)/)?.[1];
    if (id && node.id !== id) return false;
    for (const item of part.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(item[1])) return false;
    for (const item of part.matchAll(/\[([\w-]+)(?:=["']([^"']*)["'])?\]/g)) {
      if (!node.hasAttribute(item[1])) return false;
      if (item[2] !== undefined && node.getAttribute(item[1]) !== item[2]) return false;
    }
    return Boolean(tag || id || part.startsWith('.') || part.startsWith('['));
  });
}

function parseDocument() {
  const document = new Element('#document');
  const stack = [document];
  const voidTags = new Set(['AREA','BASE','BR','COL','EMBED','HR','IMG','INPUT','LINK','META','PARAM','SOURCE','TRACK','WBR']);
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/[^>]+>|<[^>]+>|[^<]+/g)) {
    const token = match[0];
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const tag = token.match(/^<\/\s*([\w:-]+)/)?.[1].toUpperCase();
      const index = stack.findLastIndex(node => node.tagName === tag);
      if (index > 0) stack.length = index;
    } else if (token[0] === '<') {
      const tag = token.match(/^<\s*([\w:-]+)/)?.[1];
      assert(tag, `Unparsed HTML token: ${token}`);
      const node = new Element(tag);
      const attrs = token.slice(token.indexOf(tag) + tag.length).replace(/\/?>$/, '');
      for (const attr of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
      stack.at(-1).append(node);
      if (!voidTags.has(node.tagName) && !/\/\s*>$/.test(token)) stack.push(node);
    } else stack.at(-1).append(new TextNode(decode(token)));
  }
  document.documentElement = document.querySelector('html');
  document.body = document.querySelector('body');
  document.hidden = false;
  document.getElementById = id => descendants(document).find(node => node.id === id) ?? null;
  document.createTextNode = value => new TextNode(value);
  document.createElement = tag => new Element(tag);
  for (const select of document.querySelectorAll('select')) select.value = (select.options.find(option => option.hasAttribute('selected')) ?? select.options[0])?.value ?? '';
  return document;
}

function createHarness({language = 'zh-CN', defaultLanguage, systemDark = false, reducedMotion = true, legacyMedia = false} = {}) {
  const document = parseDocument();
  if (defaultLanguage !== undefined) document.documentElement.dataset.defaultLanguage = defaultLanguage;
  const element = id => {const node = document.getElementById(id); assert(node, `Missing connected element: ${id}`); return node;};
  const media = new Map();
  function matchMedia(query) {
    if (!media.has(query)) media.set(query, {
      media: query, matches: query.includes('color-scheme') ? systemDark : reducedMotion, listeners: [],
      addEventListener(type, listener) {if (type === 'change') this.listeners.push(listener);},
      addListener(listener) {this.listeners.push(listener);},
      change(value) {this.matches = value; for (const listener of this.listeners) listener({matches: value, media: query});},
    });
    if (legacyMedia) delete media.get(query).addEventListener;
    return media.get(query);
  }
  const canvasTexts = [];
  const drawing = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({width: Array.from(String(text)).length * 10});
      return (...args) => {for (const value of args) if (typeof value === 'number') assert(Number.isFinite(value), `Non-finite canvas argument: ${String(key)}`); if (key === 'fillText') canvasTexts.push(String(args[0]));};
    },
    set(target, key, value) {target[key] = value; return true;},
  });
  element('scene').getContext = () => drawing;
  const objects = [], downloads = [], timers = [], revoked = [];
  document.createElement = tag => {
    const node = new Element(tag);
    if (tag.toLowerCase() === 'a') node.click = () => downloads.push({name: node.download, href: node.href, node});
    return node;
  };
  const navigator = {language, languages: [language]};
  const window = new Element('window');
  Object.assign(window, {devicePixelRatio: 1, navigator});
  let callback, clock = 0;
  const context = {
    document, window, navigator, Blob, Intl,
    URL: {createObjectURL(blob) {const url = `blob:preferences-${objects.length}`; objects.push({url, blob}); return url;}, revokeObjectURL: url => revoked.push(url)},
    matchMedia,
    ResizeObserver: class {constructor(listener) {this.listener = listener;} observe() {this.listener();}},
    requestAnimationFrame: listener => {callback = listener;},
    setTimeout: (fn, delay = 0) => {timers.push({fn, at: clock + delay}); return timers.length;},
    Event: class {constructor(type, options = {}) {Object.assign(this, {type}, options);} preventDefault() {this.defaultPrevented = true;}},
    CustomEvent: class {constructor(type, options = {}) {Object.assign(this, {type}, options);}},
    console,
  };
  vm.createContext(context);
  for (const source of sources) vm.runInContext(source.source, context, {filename: source.name});
  assert(window.StationI18n, 'Expected the real language controller');
  const frameAt = ms => {assert(ms >= clock); clock = ms; callback(ms); for (const timer of timers) if (!timer.done && timer.at <= clock) {timer.done = true; timer.fn();}};
  const advance = (seconds, step = 50) => {const end = clock + seconds * 1000; while (clock < end) frameAt(Math.min(end, clock + step));};
  const click = id => element(id).click();
  const change = (id, value) => {element(id).value = value; element(id).fire('change');};
  const setLanguage = value => change('language', value);
  const stations = document.querySelectorAll('[data-station]');
  const visit = index => {stations[index].click(); click('depart'); advance(20, 1000);};
  const openJournal = () => {click('open-book'); click('show-journal');};
  const selectJournal = index => change('journal-station', String(index));
  const note = value => {element('journal-note').value = value; element('journal-note').fire('input');};
  const key = (value, target) => document.fire('keydown', {target, key: value, code: value === ' ' ? 'Space' : value, preventDefault() {throw new Error(`Input key ${value} unexpectedly invoked a global shortcut`);}});
  const stableState = () => ({route: element('route-number').textContent, tickets: element('ticket-count').textContent, progress: element('journey-progress').getAttribute('aria-valuenow'), visited: stations.map(node => node.classList.contains('visited')), unlocked: !stations[4].hidden});
  frameAt(0);
  return {document, window, element, click, change, setLanguage, advance, frameAt, stations, visit, openJournal, selectJournal, note, key, stableState, media, objects, downloads, canvasTexts, revoked};
}

const results = [];
async function test(name, fn) {await fn(); results.push(name); console.log(`PASS ${name}`);}
const compact = text => text.replace(/\s+/g, '');
const visibleSvgTexts = svg => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decode(match[1].replace(/<[^>]*>/g, ''))).join('');

function fixedVisibleText(rootNode) {
  if (rootNode.nodeType === 3) return rootNode.textContent;
  if (rootNode.hidden || ['SCRIPT','STYLE','OPTION'].includes(rootNode.tagName)) return '';
  return rootNode.childNodes.map(fixedVisibleText).join(' ');
}

await test('Three language modes translate all annotated static text and attributes, including live English canvas text.', () => {
  const h = createHarness();
  for (const language of ['zh-CN', 'en', 'ja']) {
    h.setLanguage(language);
    assert.equal(h.window.StationI18n.language, language);
    assert.equal(h.document.documentElement.lang ?? h.document.documentElement.getAttribute('lang'), language);
    let checked = 0;
    for (const [data, attribute] of [['data-i18n', null], ['data-i18n-aria', 'aria-label'], ['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-content', 'content']]) {
      for (const node of h.document.querySelectorAll(`[${data}]`)) {
        const expected = h.window.StationI18n.t(node.getAttribute(data));
        assert.equal(typeof expected, 'string');
        assert.equal(attribute ? node.getAttribute(attribute) : node.textContent, expected, `Untranslated ${data}=${node.getAttribute(data)} in ${language}`);
        checked++;
      }
    }
    assert(checked >= 30, 'Static translation coverage must include the full interface');
    if (language === 'en') {
      assert(!/\p{Script=Han}/u.test(fixedVisibleText(h.document.body)), 'Visible English interface contains untranslated Chinese text');
      h.canvasTexts.length = 0;
      for (let index = 0; index < 4; index++) {h.stations[index].click(); h.click('view-window'); h.click('view-map');}
      assert(!h.canvasTexts.some(text => /\p{Script=Han}/u.test(text)), `Untranslated canvas text: ${h.canvasTexts.filter(text => /\p{Script=Han}/u.test(text)).join(' | ')}`);
    }
  }
});

await test('Changing language preserves active journey state, independent drafts and a custom fifth-station name.', () => {
  const h = createHarness();
  h.click('depart'); h.advance(3); const travelling = h.stableState();
  for (const language of ['en', 'ja', 'zh-CN']) {h.setLanguage(language); assert.deepEqual(h.stableState(), travelling);}
  h.advance(17);
  for (const index of [1,2,3,4]) h.visit(index);
  h.openJournal(); h.selectJournal(0); h.note('原样保留 / unedited / そのまま');
  h.selectJournal(4); h.note('The last station keeps its own draft.'); h.click('show-tickets');
  h.element('station-name').value = '纸门 Zero'; h.element('secret-naming').fire('submit', {preventDefault() {}});
  for (const language of ['en', 'ja', 'zh-CN']) {
    h.click('close-book'); h.setLanguage(language); h.openJournal(); h.selectJournal(4);
    assert.equal(h.element('secret-name').textContent, '纸门 Zero');
    assert.equal(h.element('postcard-name').textContent, '纸门 Zero');
    assert.equal(h.element('journal-note').value, 'The last station keeps its own draft.');
    h.selectJournal(0); assert.equal(h.element('journal-note').value, '原样保留 / unedited / そのまま');
    h.click('show-tickets');
  }
});

await test('Every language completes automatic travel, unlocks the fifth station and exports full journal content.', async () => {
  for (const language of ['zh-CN', 'en', 'ja']) {
    const h = createHarness(); h.setLanguage(language); h.click('speed'); h.click('speed'); h.click('auto'); h.advance(31); h.click('auto');
    assert.equal(h.element('ticket-count').textContent, '05');
    assert.equal(h.stations[4].hidden, false);
    h.openJournal(); assert.equal(h.element('journal-station').options.length, 5); h.selectJournal(3);
    const note = 'A small journey leaves room for another story. '.repeat(4).slice(0, 160);
    h.note(note);
    const title = h.element('postcard-name').textContent, story = h.element('postcard-story').textContent, souvenir = h.element('postcard-souvenir').textContent;
    h.click('export-postcard'); assert.equal(h.objects.length, 1); assert.equal(h.downloads.length, 1);
    const svg = await h.objects[0].blob.text();
    const visible = compact(visibleSvgTexts(svg));
    for (const [name, value] of [['station title', title], ['story', story], ['note', note]]) assert(visible.includes(compact(value)), `${language} SVG truncates ${name}`);
    assert(souvenir.length > 0);
    assert(!/<(?:script|foreignObject|iframe)\b/i.test(svg));
    for (const key of ['enclosed', 'toFuture', 'postcardFooter']) {
      assert(visible.includes(compact(h.window.StationI18n.t(key))), `${language} SVG has an untranslated ${key}`);
    }
    assert(svg.includes(h.window.StationI18n.t('postcardTitle', {name: title})), `${language} SVG title is untranslated`);
    if (language === 'en') {
      assert(!/\p{Script=Han}/u.test(visibleSvgTexts(svg)), 'English SVG contains untranslated Chinese labels');
      const artifacts = path.join(root, 'test-artifacts'); fs.mkdirSync(artifacts, {recursive: true});
      fs.writeFileSync(path.join(artifacts, 'preferences-postcard-en.svg'), svg);
    }
    h.click('show-tickets'); h.element('station-name').value = 'Future Haven';
    h.element('secret-naming').fire('submit', {preventDefault() {}});
    h.click('show-journal'); h.selectJournal(4); h.note(note);
    const secretTitle = h.element('postcard-name').textContent, secretStory = h.element('postcard-story').textContent;
    assert.equal(secretTitle, 'Future Haven');
    h.click('export-postcard');
    const secretSvg = await h.objects.at(-1).blob.text(), secretVisible = compact(visibleSvgTexts(secretSvg));
    for (const [name, value] of [['custom name', secretTitle], ['named secret story', secretStory], ['note', note]]) assert(secretVisible.includes(compact(value)), `${language} SVG truncates ${name}`);
    if (language === 'en') fs.writeFileSync(path.join(root, 'test-artifacts', 'preferences-secret-postcard-en.svg'), secretSvg);
  }
});

await test('Automatic theme follows system colour, explicit choices override it, and system changes do not alter motion.', () => {
  const h = createHarness({systemDark: true, reducedMotion: false});
  const rootNode = h.document.documentElement;
  const darkMedia = h.media.get('(prefers-color-scheme: dark)');
  const motion = h.element('motion').getAttribute('aria-pressed');
  assert.equal(rootNode.dataset.theme, 'dark'); assert.equal(rootNode.dataset.themePreference, 'auto'); assert.equal(rootNode.style.colorScheme, 'dark');
  darkMedia.change(false); assert.equal(rootNode.dataset.theme, 'light');
  h.change('theme', 'light'); darkMedia.change(true); assert.equal(rootNode.dataset.theme, 'light'); assert.equal(rootNode.dataset.themePreference, 'light');
  h.change('theme', 'dark'); darkMedia.change(false); assert.equal(rootNode.dataset.theme, 'dark');
  h.change('theme', 'auto'); assert.equal(rootNode.dataset.theme, 'light'); darkMedia.change(true); assert.equal(rootNode.dataset.theme, 'dark');
  h.change('theme', 'invalid-choice'); assert.equal(rootNode.dataset.themePreference, 'auto'); assert.equal(h.element('theme').value, 'auto');
  assert.equal(h.element('motion').getAttribute('aria-pressed'), motion);
  for (const language of ['en', 'ja', 'zh-CN']) {h.setLanguage(language); assert.equal(rootNode.dataset.theme, 'dark');}
  assert.notEqual(darkMedia, h.media.get('(prefers-reduced-motion: reduce)'));
  h.click('motion'); const overriddenMotion = h.element('motion').getAttribute('aria-pressed');
  darkMedia.change(false); darkMedia.change(true); assert.equal(h.element('motion').getAttribute('aria-pressed'), overriddenMotion);
  const legacy = createHarness({systemDark: true, legacyMedia: true});
  assert.equal(legacy.document.documentElement.dataset.theme, 'dark');
  legacy.media.get('(prefers-color-scheme: dark)').change(false);
  assert.equal(legacy.document.documentElement.dataset.theme, 'light');
});

await test('Typing into selectors, inputs and the journal never invokes journey shortcuts.', () => {
  const h = createHarness(); h.click('depart'); h.advance(3);
  const before = h.stableState();
  for (const id of ['language', 'theme', 'station-name', 'journal-note']) {
    for (const key of [' ', 'r', 'v', 'm', '1', '5']) h.key(key, h.element(id));
  }
  assert.deepEqual(h.stableState(), before);
  assert.equal(h.element('view-map').getAttribute('aria-pressed'), 'true');
  assert.equal(h.element('sound').getAttribute('aria-pressed'), 'false');
});

await test('Initial browser-language selection and session-only preferences use no persistent storage.', () => {
  assert.equal(createHarness({language: 'ja-JP'}).window.StationI18n.language, 'ja');
  assert.equal(createHarness({language: 'en-GB'}).window.StationI18n.language, 'en');
  assert.equal(createHarness({language: 'zh-TW'}).window.StationI18n.language, 'zh-CN');
  assert.equal(createHarness({language: 'fr-FR'}).window.StationI18n.language, 'en');
  assert.equal(createHarness({language: 'ja-JP', defaultLanguage: 'en'}).window.StationI18n.language, 'en');
  assert.equal(createHarness({language: 'en-GB', defaultLanguage: 'ja'}).window.StationI18n.language, 'ja');
  assert.equal(createHarness({language: 'ja-JP', defaultLanguage: 'unsupported'}).window.StationI18n.language, 'ja');
  for (const item of sources) assert(!/\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket)\b/.test(item.source), `Unexpected storage or networking in ${item.name}`);
});

console.log(`\n${results.length} language/theme integration groups passed.`);
console.log('Text preservation and state were checked in a simulated DOM; browser layout, contrast, actual SVG font metrics and audible playback remain unverified.');
