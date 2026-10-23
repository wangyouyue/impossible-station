// Dependency-free behavioural checks. This is a simulated DOM, not browser QA.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
const logs=[];
class Element {
  constructor(id='') {this.id=id;this.textContent='';this.value='';this.style={};this.dataset={};this.attributes={};this.listeners={};this.children=[];this.hidden=false;this.open=false;this.tagName='BUTTON';const values=new Set();this.classList={add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v),toggle:(v,on)=>{if(on??!values.has(v)){values.add(v);return true}values.delete(v);return false}};}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
  fire(type,event={}){return (this.listeners[type]||[]).map(fn=>fn({target:this,...event}))}
  setAttribute(k,v){this.attributes[k]=String(v)}
  getAttribute(k){return this.attributes[k]}
  append(...items){this.children.push(...items)}
  replaceChildren(...items){this.children=[...items]}
  getBoundingClientRect(){return {width:1000,height:700,left:0,top:0,right:1000,bottom:700}}
  closest(){return null}
  scrollIntoView(){}
  showModal(){this.open=true}
  close(){this.open=false;this.fire('close')}
}
const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
const stations=Array.from({length:5},(_,i)=>{const e=new Element();e.dataset.station=String(i);e.hidden=i===4;return e});
const stamps=Array.from({length:4},(_,i)=>{const e=new Element();e.dataset.stamp=String(i);return e});
let drawingCalls=0;
const drawing=new Proxy({}, {get:(o,k)=>o[k]??((...args)=>{drawingCalls++;for(const arg of args)if(typeof arg==='number')assert(Number.isFinite(arg),`${String(k)} has a non-finite coordinate`)}),set:(o,k,v)=>{o[k]=v;return true}});
elements.get('scene').getContext=()=>drawing;
const document=new Element();document.tagName='BODY';document.hidden=false;
document.documentElement=new Element('html');
document.getElementById=id=>elements.get(id);
document.createElement=()=>new Element();
document.querySelectorAll=selector=>selector==='[data-station]'?stations:selector==='[data-stamp]'?stamps:[];
document.querySelector=selector=>selector==='[data-station="4"]'?stations[4]:null;
let frame,clock=0;
let motionListener;
const context={document,window:{devicePixelRatio:1},matchMedia:()=>({matches:false,addEventListener:(type,fn)=>{motionListener=fn}}),ResizeObserver:class{constructor(fn){this.fn=fn}observe(){this.fn()}},requestAnimationFrame:fn=>{frame=fn},setTimeout:fn=>{fn()},console};
vm.runInNewContext(script,context,{filename:'app.js'});
const el=id=>elements.get(id);
const click=id=>el(id).fire('click');
const advance=seconds=>{const end=clock+seconds*1000;while(clock<end){clock=Math.min(end,clock+50);frame(clock)}};
const key=key=>document.fire('keydown',{target:document,key,code:key===' '?'Space':key,preventDefault(){}});
function pass(message){logs.push(`PASS ${message}`)}

assert.equal(el('destination-name').textContent,'折纸海');
stations[4].fire('click');assert.equal(el('destination-name').textContent,'折纸海');
assert.equal(stations[4].hidden,true);pass('Initial route is ready; secret destination is unavailable.');

click('depart');advance(3);assert.match(el('train-status').textContent,/开往折纸海/);
stations[2].fire('click');assert.equal(el('destination-name').textContent,'月亮修理铺');
assert.match(el('train-status').textContent,/开往折纸海/);pass('Selecting a destination during travel changes the next journey, not the current train.');

click('depart');advance(20);assert.equal(el('depart-text').textContent,'继续旅程');assert.equal(stamps[0].classList.contains('earned'),false);
click('depart');advance(10);assert.equal(el('ticket-count').textContent,'01');assert(stamps[0].classList.contains('earned'));
advance(8);assert.equal(el('depart-text').textContent,'发车，去看看');pass('Pause prevents progress; resume reaches the destination and returns to the depot.');

key(' ');advance(21);assert.equal(el('ticket-count').textContent,'02');assert(stamps[2].classList.contains('earned'));pass('Space dispatches the queued destination and each distinct station adds one ticket.');

stations[1].fire('click');click('depart');advance(2);click('open-book');assert(el('ticket-book').open);advance(15);assert.equal(el('ticket-count').textContent,'02');
assert.equal(el('book-content').children.length,2);click('close-book');advance(19);assert.equal(el('ticket-count').textContent,'03');pass('Opening the ticket collection pauses the journey; closing it resumes it.');

click('speed');click('speed');assert.equal(el('speed').textContent,'4×');assert.equal(el('arrival-time').textContent,'大约 3 秒后');
click('surprise');assert.equal(el('destination-name').textContent,'未寄出的城');pass('Blind selection prioritises the remaining unvisited, unlocked destination.');
stations[3].fire('click');click('auto');advance(4);assert.equal(stations[4].hidden,false);assert.equal(el('ticket-count').textContent,'04');
advance(10);assert.equal(el('ticket-count').textContent,'05');assert.equal(el('collection-counter').textContent,'5 / 5');
click('auto');advance(6);assert.equal(el('auto').getAttribute('aria-pressed'),'false');pass('4× speed, four-ticket unlock, automatic fifth-station visit, and stopping auto roam work.');

click('open-book');assert.equal(el('book-content').children.length,5);click('close-book');
const before=el('ticket-count').textContent;key('5');click('depart');advance(6);assert.equal(el('ticket-count').textContent,before);pass('All five stories are available, and repeat visits never duplicate tickets.');

key('r');assert.equal(el('destination-name').textContent,'折纸海');
assert(drawingCalls>100000);pass('Keyboard route switching works and animated canvas coordinates remain finite.');

click('auto');advance(1);stations[2].fire('click');advance(6);
assert.match(el('train-status').textContent,/开往月亮修理铺/);click('auto');advance(6);
pass('A manual route choice takes precedence over automatic exploration for the next departure.');

click('depart');click('depart');click('open-book');click('close-book');
assert.equal(el('depart-text').textContent,'继续旅程');click('depart');advance(6);
pass('Closing the ticket book preserves a journey that was already manually paused.');

click('view-window');assert.equal(el('map-labels').hidden,true);assert.equal(el('view-window').getAttribute('aria-pressed'),'true');
for(let i=0;i<5;i++){stations[i].fire('click');advance(.2)}
key('v');assert.equal(el('map-labels').hidden,false);assert.equal(el('view-map').getAttribute('aria-pressed'),'true');
pass('All five window scenes render with finite coordinates; switching views restores the map controls.');

click('open-book');assert.equal(el('secret-naming').hidden,false);
el('station-name').value=' ';el('secret-naming').fire('submit',{preventDefault(){}});assert.equal(el('station-name').getAttribute('aria-invalid'),'true');
el('station-name').value='一二三四五六七八九十一二三';el('secret-naming').fire('submit',{preventDefault(){}});assert.equal(el('station-name').getAttribute('aria-invalid'),'true');
el('station-name').value='<b>纸门</b>';el('secret-naming').fire('submit',{preventDefault(){}});assert.equal(el('secret-name').textContent,'<b>纸门</b>');assert.equal(el('secret-name').children.length,0);
el('station-name').value='  口袋里的远方  ';el('secret-naming').fire('submit',{preventDefault(){}});
assert.equal(el('secret-name').textContent,'口袋里的远方');assert.equal(el('destination-name').textContent,'口袋里的远方');assert.equal(el('station-name').getAttribute('aria-invalid'),'false');
assert.equal(el('book-content').children[4].children[1].children[0].textContent,'口袋里的远方');click('close-book');
pass('Station naming validates length, treats markup literally, and updates the map, ticket and story together.');

motionListener({matches:true});assert.equal(el('motion').getAttribute('aria-pressed'),'true');assert.equal(document.documentElement.dataset.reducedMotion,'true');click('motion');assert.equal(el('motion').getAttribute('aria-pressed'),'false');assert.equal(document.documentElement.dataset.reducedMotion,'false');motionListener({matches:true});assert.equal(el('motion').getAttribute('aria-pressed'),'false');
click('motion');click('view-window');advance(.2);click('view-map');pass('Reduced-motion follows the system until explicitly overridden, without disabling travel.');

click('speed');assert.equal(el('speed').textContent,'1×');click('depart');advance(3);
const beforeHide=el('journey-progress').getAttribute('aria-valuenow');document.hidden=true;document.fire('visibilitychange');advance(60);document.hidden=false;document.fire('visibilitychange');advance(.05);
assert.equal(el('journey-progress').getAttribute('aria-valuenow'),beforeHide);click('depart');const beforePause=el('journey-progress').getAttribute('aria-valuenow');advance(10);assert.equal(el('journey-progress').getAttribute('aria-valuenow'),beforePause);
click('depart');advance(18);assert.equal(el('depart-text').textContent,'发车，去看看');pass('Background tabs and manual pause freeze progress, and foreground/resume continue correctly.');

click('depart');advance(.1);clock+=15000;frame(clock);assert.match(el('train-status').textContent,/回到此时此地/);assert(Number(el('journey-progress').getAttribute('aria-valuenow'))>=75);advance(6);assert.equal(el('depart-text').textContent,'发车，去看看');
pass('A long visible-frame delay crosses arrival and dwell boundaries without losing elapsed time or getting stuck.');

await Promise.all(click('sound'));assert.equal(el('sound').getAttribute('aria-pressed'),'false');assert.equal(el('sound').disabled,false);
pass('An unavailable audio API fails gracefully and leaves the sound control usable.');

assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/.test(script));
assert(!/(?:src|href)=["']https?:\/\//.test(html));pass('The app has no network dependencies or persistent browser storage.');

console.log(logs.join('\n'));
console.log(`\n${logs.length} checks passed. Browser layout and audible playback remain unverified.`);
