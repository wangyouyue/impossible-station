// Build standalone, offline editions with an explicit initial language.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'dist/styles.css'),'utf8');
let bundled=html.replace('<link rel="stylesheet" href="styles.css">',()=>`<style>\n${css}\n</style>`);
for(const filename of ['theme.js','app.js']){
  const tag=`<script src="${filename}"></script>`;
  if(!bundled.includes(tag))throw new Error(`Missing source script: ${filename}`);
  const source=fs.readFileSync(path.join(root,'dist',filename),'utf8');
  bundled=bundled.replace(tag,()=>`<script>\n${source}\n</script>`);
}
for(const [language,filename] of [['zh-CN','不可能车站.html'],['en','impossible-station.html'],['ja','impossible-station-ja.html']]){
  const edition=bundled.replace('<html lang="zh-CN">',`<html lang="${language}" data-default-language="${language}">`);
  if(!edition.includes(`data-default-language="${language}"`))throw new Error('Missing HTML language root');
  fs.writeFileSync(path.join(root,filename),edition);
  console.log(filename);
}
