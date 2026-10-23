// Isolated regressions for timing, rendering cadence, train/window continuity and aspect ratio.
// Runs the unchanged application script against a small DOM/canvas recorder.
// This is not a browser, layout engine, screenshot test, or audible-playback test.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'dist/app.js'), 'utf8');

class Element {
  constructor(id = '') {
    this.id = id;
    this.textContent = '';
    this.value = '';
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.hidden = false;
    this.open = false;
    this.tagName = 'BUTTON';
    this.box = {width: 1000, height: 700};
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
    };
  }
  addEventListener(type, callback) {
    (this.listeners[type] ??= []).push(callback);
  }
  fire(type, event = {}) {
    return (this.listeners[type] ?? []).map(callback => callback({target: this, ...event}));
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  closest() { return null; }
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  getBoundingClientRect() {
    return {left: 0, top: 0, right: this.box.width, bottom: this.box.height, ...this.box};
  }
}

function createHarness({viewport = [1000, 700], reducedMotion = false, dpr = 1} = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const element = id => {
    assert(elements.has(id), `Missing application element: ${id}`);
    return elements.get(id);
  };
  const stations = Array.from({length: 5}, (_, index) => {
    const station = new Element();
    station.dataset.station = String(index);
    station.hidden = index === 4;
    return station;
  });
  const stamps = Array.from({length: 4}, (_, index) => {
    const stamp = new Element();
    stamp.dataset.stamp = String(index);
    return stamp;
  });
  element('scene-viewport').box = {width: viewport[0], height: viewport[1]};

  const drawing = {paints: 0, transform: null, translations: [], scenery: []};
  const properties = {globalAlpha: 1};
  const canvasStack = [];
  let clipDepth = null;
  const methods = new Map();
  const canvasContext = new Proxy(properties, {
    get(target, key) {
      if (key in target) return target[key];
      if (!methods.has(key)) methods.set(key, (...args) => {
        for (const arg of args) if (typeof arg === 'number') {
          assert(Number.isFinite(arg), `Non-finite canvas argument in ${String(key)}`);
        }
        if (key === 'save') canvasStack.push({...properties});
        else if (key === 'restore') {
          if (canvasStack.length === clipDepth) clipDepth = null;
          const saved = canvasStack.pop();
          assert(saved, 'Unbalanced canvas restore');
          for (const property of Object.keys(properties)) delete properties[property];
          Object.assign(properties, saved);
        } else if (key === 'clip') {
          clipDepth = canvasStack.length;
          drawing.scenery = [];
        } else if (clipDepth !== null) {
          const entry = {op: key, args: [...args]};
          if (['fill', 'stroke', 'fillText'].includes(key)) {
            entry.color = key === 'stroke' ? properties.strokeStyle : properties.fillStyle;
            entry.alpha = properties.globalAlpha;
            assert(entry.alpha >= 0 && entry.alpha <= 1, 'Invalid scenery opacity');
          }
          drawing.scenery.push(entry);
        }
        if (key === 'setTransform') {
          drawing.paints++;
          drawing.transform = [...args];
          drawing.translations = [];
        } else if (key === 'translate') {
          drawing.translations.push([...args]);
        }
      });
      return methods.get(key);
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  element('scene').getContext = () => canvasContext;

  const document = new Element();
  document.tagName = 'BODY';
  document.hidden = false;
  document.documentElement = new Element('html-root');
  document.getElementById = id => elements.get(id);
  document.createElement = tag => { const node = new Element(); node.tagName = tag.toUpperCase(); return node; };
  document.querySelectorAll = selector => selector === '[data-station]' ? stations : selector === '[data-stamp]' ? stamps : [];
  document.querySelector = selector => selector === '[data-station="4"]' ? stations[4] : null;

  let callback;
  let clock = 0;
  const context = {
    document,
    window: {devicePixelRatio: dpr},
    matchMedia: () => ({matches: reducedMotion, addEventListener() {}}),
    ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } },
    requestAnimationFrame: fn => { callback = fn; },
    setTimeout: fn => { fn(); },
    console,
  };
  vm.runInNewContext(script, context, {filename: 'app.js'});
  const click = id => element(id).fire('click');
  const frameAt = ms => {
    assert(ms >= clock, 'Animation timestamps must be monotonic');
    clock = ms;
    callback(ms);
  };
  const advanceTo = (ms, step = 50) => {
    while (clock < ms) frameAt(Math.min(ms, clock + step));
  };
  // Establish an explicit t=0 frame before any input. Otherwise a first nonzero
  // requestAnimationFrame timestamp would intentionally initialise, not advance, time.
  frameAt(0);

  return {
    document, element, click, frameAt, advanceTo, drawing, stations, stamps,
    windowScenery() { click('view-window'); return structuredClone(drawing.scenery); },
    setLanguage: language => context.window.StationI18n.setLanguage(language),
    snapshot() {
      return {
        tickets: element('ticket-count').textContent,
        destination: element('destination-name').textContent,
        status: element('train-status').textContent,
        phase: element('journey-phase').textContent,
        remaining: element('journey-remaining').textContent,
        progress: element('journey-progress').getAttribute('aria-valuenow'),
        depart: element('depart-text').textContent,
        visited: stamps.map(stamp => stamp.classList.contains('earned')),
        unlocked: !stations[4].hidden,
      };
    },
    trainPositions() {
      // In map mode, the three last translations belong to the three carriages.
      // A view click requests an immediate real application render at its current time.
      click('view-map');
      assert(drawing.translations.length >= 3, 'Expected three carriage translations');
      return drawing.translations.slice(-3).map(point => [...point]);
    },
  };
}

const results = [];
function report(message) { results.push(message); console.log(`PASS ${message}`); }

{
  const regular = createHarness();
  const stalled = createHarness();
  for (const harness of [regular, stalled]) {
    harness.click('speed');
    harness.click('speed');
    harness.click('auto');
  }
  regular.advanceTo(20100, 50);
  stalled.frameAt(100);
  stalled.frameAt(20100);
  assert.deepEqual(stalled.snapshot(), regular.snapshot(), 'A 20-second frame must preserve complete automatic journeys and waiting time');
  assert.equal(regular.snapshot().tickets, '03');
  assert.match(regular.snapshot().status, /第 04 班.*未寄出的城/);
  report('Equal 20.1 s at 4× auto roam: 50 ms frames and a 20 s stalled frame produce the same state.');
}

{
  const counts = [];
  for (const hz of [60, 120]) {
    const harness = createHarness();
    const initial = harness.drawing.paints;
    for (let index = 1; index <= hz * 10; index++) harness.frameAt(index * 1000 / hz);
    const paints = harness.drawing.paints - initial;
    assert(paints >= 299 && paints <= 301, `${hz} Hz input yielded ${paints} paints, expected about 300`);
    counts.push(`${hz} Hz → ${paints}`);
  }
  report(`Ten-second rendering cadence stays near 30 fps (${counts.join('; ')}).`);
}

{
  const harness = createHarness({reducedMotion: true});
  const parked = harness.trainPositions();
  harness.click('depart');
  const departure = harness.trainPositions();
  assert.deepEqual(departure, parked, 'All three carriages must start at their parked coordinates');
  harness.frameAt(19999.9);
  assert.match(harness.element('journey-phase').textContent, /返程/);
  const almostParked = harness.trainPositions();
  harness.frameAt(20000);
  assert.equal(harness.element('depart-text').textContent, '发车，去看看');
  const returned = harness.trainPositions();
  assert.deepEqual(returned, parked, 'The parked coordinates must be the same after a complete journey');
  const jumps = returned.map((point, index) => Math.hypot(point[0] - almostParked[index][0], point[1] - almostParked[index][1]));
  assert(jumps.every(distance => distance < 1e-5), `Return-to-idle jump exceeds tolerance: ${jumps}`);
  report(`All three carriages are continuous at departure and parking; largest final 0.1 ms displacement is ${Math.max(...jumps).toExponential(3)} canvas units.`);
}

{
  const sizes = [[1000, 700], [356, 263], [286, 210]];
  for (const viewport of sizes) {
    const harness = createHarness({viewport});
    const surface = harness.element('scene-surface');
    const width = parseFloat(surface.style.width);
    const height = parseFloat(surface.style.height);
    assert(width > 0 && height > 0, 'Scene surface must have positive explicit dimensions');
    assert(Math.abs(width / height - 10 / 7) < 1e-12, `Scene ratio is distorted in viewport ${viewport}`);
    assert(width <= viewport[0] + 1e-9 && height <= viewport[1] + 1e-9, `Scene surface exceeds viewport ${viewport}`);
    const [scaleX, skewY, skewX, scaleY] = harness.drawing.transform;
    assert.equal(scaleX, scaleY, `Canvas scaling differs by axis in viewport ${viewport}`);
    assert.equal(skewX, 0);
    assert.equal(skewY, 0);
  }
  report('1000×700, 356×263 and 286×210 viewports preserve a 10:7 surface and identical canvas-axis scaling.');
}

// Compare recorded drawing commands at a boundary, allowing only tiny numeric drift.
function nearScenery(actual, expected, tolerance = 1e-6) {
  function compare(a, b) {
    if (typeof a === 'number') {assert.equal(typeof b, 'number'); assert(Math.abs(a - b) <= tolerance, `Scenery jump: ${a} vs ${b}`);}
    else if (a && typeof a === 'object') {
      assert.deepEqual(Object.keys(a), Object.keys(b));
      for (const key of Object.keys(a)) compare(a[key], b[key]);
    } else assert.equal(a, b);
  }
  compare(actual, expected);
}

{
  const h = createHarness({reducedMotion: true});
  const parked = h.windowScenery();
  assert.equal(h.element('view-caption').textContent, '窗外 / 此时此地');
  for (let index = 0; index < 4; index++) {
    h.stations[index].fire('click');
    assert.deepEqual(h.windowScenery(), parked, 'An idle route selection must not replace the parked scenery');
    assert.equal(h.element('view-caption').textContent, '窗外 / 此时此地');
  }
  h.click('depart');
  assert.deepEqual(h.windowScenery(), parked, 'Departure must start at the same platform');
  h.frameAt(7000);
  const travelling = h.windowScenery();
  assert.equal(h.element('view-caption').textContent, '窗外 / 旅途中');
  h.stations[2].fire('click');
  assert.deepEqual(h.windowScenery(), travelling, 'A queued route must not alter the current view');
  h.click('depart');
  h.frameAt(17000);
  assert.deepEqual(h.windowScenery(), travelling, 'Pausing must freeze the scenery transition');
  h.click('depart');
  h.frameAt(30000);
  assert.deepEqual(h.windowScenery(), parked, 'Returning must show the platform, even with another route queued');
  h.click('depart');
  assert.deepEqual(h.windowScenery(), parked, 'The next train must leave from the same platform');
  report('Initial view, idle selection, queued routes, pause and consecutive departures preserve the correct physical location.');
}

{
  const h = createHarness({reducedMotion: true});
  const opacity = color => h.windowScenery().filter(op => op.op === 'fill' && op.color === color).at(0)?.alpha ?? 0;
  h.click('depart');
  h.frameAt(2000);
  const homeEarly = opacity('#315451');
  assert(homeEarly > 0 && homeEarly < 1, 'The platform must fade gradually');
  assert.equal(opacity('#71968b'), 0, 'The destination must not appear immediately');
  h.frameAt(4000);
  assert(opacity('#315451') < homeEarly);
  h.frameAt(6000);
  assert.equal(opacity('#315451'), 0);
  assert.equal(opacity('#71968b'), 0);
  assert.equal(opacity('#274348'), 1, 'The journey must have its own scenery');
  h.frameAt(8000);
  const destinationEarly = opacity('#71968b');
  assert(destinationEarly > 0 && destinationEarly < 1);
  h.frameAt(10000);
  assert(opacity('#71968b') > destinationEarly);
  h.frameAt(12000);
  assert.equal(opacity('#71968b'), 1);
  h.frameAt(15000);
  assert(opacity('#71968b') > 0 && opacity('#71968b') < 1, 'Returning must fade out the destination');
  h.frameAt(19000);
  assert(opacity('#315451') > 0 && opacity('#315451') < 1, 'The home platform must return gradually');
  h.frameAt(20000);
  assert.equal(opacity('#315451'), 1);
  report('Actual canvas opacities show gradual platform → countryside → destination transitions, reversed on return, with reduced motion enabled.');
}

{
  for (const reducedMotion of [false, true]) {
    const h = createHarness({reducedMotion});
    const parked = h.windowScenery();
    h.click('depart');
    h.frameAt(11999.9);
    const approach = h.windowScenery();
    h.frameAt(12000);
    nearScenery(approach, h.windowScenery(), .003);
    h.frameAt(13999.9);
    const dwell = h.windowScenery();
    h.frameAt(14000);
    nearScenery(dwell, h.windowScenery(), .003);
    h.frameAt(19999.9);
    const almostHome = h.windowScenery();
    h.frameAt(20000);
    nearScenery(almostHome, h.windowScenery());
    assert.deepEqual(h.windowScenery(), parked);
  }
  report('Window scenery stays continuous across arrival, return departure and parking in both motion modes.');
}

{
  const h = createHarness();
  h.click('depart');
  h.frameAt(3000);
  const outbound = h.windowScenery();
  h.click('depart');
  h.frameAt(5000);
  assert.deepEqual(h.windowScenery(), outbound);
  h.click('depart');
  h.document.hidden = true;
  h.document.fire('visibilitychange');
  h.frameAt(65000);
  h.document.hidden = false;
  h.document.fire('visibilitychange');
  h.frameAt(65001);
  assert.deepEqual(h.windowScenery(), outbound, 'Background time must not advance scenery');
  h.frameAt(80501);
  nearScenery(h.windowScenery(), outbound);
  report('Moving scenery freezes on pause/background and retraces the same countryside position on the return leg.');
}

{
  const h = createHarness({reducedMotion: true});
  const skies = ['#71968b', '#536b54', '#192d3b', '#9a927e', '#304d47'];
  for (let index = 0; index < 5; index++) {
    h.stations[index].fire('click');
    h.click('depart');
    h.frameAt(index * 20000 + 12000);
    const scene = h.windowScenery();
    assert(scene.some(op => op.op === 'fill' && op.color === skies[index] && op.alpha === 1));
    assert.equal(h.element('view-caption').textContent, '窗外 / ' + h.element('destination-name').textContent);
    h.frameAt((index + 1) * 20000);
    assert.equal(h.element('view-caption').textContent, '窗外 / 此时此地');
  }
  for (const [language, name] of [['zh-CN', '此时此地'], ['en', 'Here and now'], ['ja', 'いま、ここ']]) {
    h.setLanguage(language);
    h.windowScenery();
    assert(h.element('view-caption').textContent.endsWith(name));
  }
  report('All five destinations render only on their own journeys; the returned platform caption is localised in all three languages.');
}

console.log(`\n${results.length} isolated regression groups passed. Browser layout and audible playback remain unverified.`);
