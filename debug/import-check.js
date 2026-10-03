const { chromium } = require('/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright');
const path=require('path'),http=require('http'),fs=require('fs');
(async()=>{
  const srv=http.createServer((req,res)=>{const p=path.join(process.cwd(),decodeURIComponent(req.url.split('?')[0]));fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.wasm')?'application/wasm':p.endsWith('.html')?'text/html':'application/octet-stream'});res.end(d);});}).listen(8767);
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const page=await browser.newPage();
  await page.addInitScript(()=>{window.__tessOpts={scriptSrc:'/node_modules/tesseract.js/dist/tesseract.min.js',workerOpts:{workerPath:'/node_modules/tesseract.js/dist/worker.min.js',corePath:'/node_modules/tesseract.js-core/',langPath:'/lang/',gzip:true}};});
  await page.goto('http://localhost:8767/index.html');
  await (await page.$('input[type=file]')).setInputFiles(process.argv.slice(2));
  await page.waitForFunction(()=>/✓|✕/.test(document.getElementById('importStatus').innerText),null,{timeout:180000});
  await page.waitForTimeout(1000);
  console.log(await page.evaluate(()=>document.getElementById('importStatus').innerText));
  console.log(await page.evaluate(()=>state.players.map(p=>{const s=state.scores[p.id];const j=a=>a.map(v=>v==null?'·':v===true?'●':v===false?'x':v).join(' ');return `${p.name} hcp${p.handicap}\n  strokes ${j(s.map(h=>h.strokes))} = ${s.reduce((a,h)=>a+(h.strokes||0),0)}\n  putts   ${j(s.map(h=>h.putts))} = ${s.reduce((a,h)=>a+(h.putts||0),0)}\n  dots    ${j(s.map(h=>h.dots))} = ${s.reduce((a,h)=>a+(h.dots||0),0)}\n  fir     ${j(s.map(h=>h.fir))}\n  gir     ${j(s.map(h=>h.gir))}`;}).join('\n')));
  await browser.close();srv.close();
})();
