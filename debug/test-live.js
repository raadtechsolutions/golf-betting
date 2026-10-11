// Run from the repo: node debug/test-live.js  (needs: npm i playwright; set PW_CHROME to a chromium/headless-shell binary if Playwright's own isn't installed)
// Headless test of the v16 live-round mode. Serves index.html locally (tesseract CDN is
// not needed for live mode) and drives the UI via clicks + the page's own functions.
const {chromium}=require('playwright');
const http=require('http');const fs=require('fs');const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'));
const srv=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html);}).listen(8765);
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const br=await chromium.launch(process.env.PW_CHROME?{executablePath:process.env.PW_CHROME}:{});
  const ctx=await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const pg=await ctx.newPage();
  pg.on('pageerror',e=>{console.log('PAGEERROR',e.message);fails++;});
  pg.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
  await pg.goto('http://localhost:8765/');
  // setup players
  await pg.evaluate(()=>{
    state.players=[{id:'p1',name:'Rod',handicap:14},{id:'p2',name:'Jon',handicap:5},{id:'p3',name:'Max',handicap:21},{id:'p4',name:'Leo',handicap:11}];
    init();
  });
  ok(await pg.$('#liveWrap button'),'start button rendered');
  await pg.click('#liveWrap button');
  ok(await pg.evaluate(()=>state.live&&state.live.hole===0),'live started at hole 1');
  ok((await pg.textContent('.live-title b'))==='Hole 1','title shows Hole 1');
  // tap strokes value for Rod -> par
  const lp=await pg.$$('.lp');
  ok(lp.length===4,'4 player rows');
  await lp[0].$eval('.stp .val',el=>el.click());
  ok(await pg.evaluate(()=>state.scores.p1[0].strokes===state.holes[0].par),'tap sets par');
  // + twice on Rod strokes
  await pg.$$eval('.lp',els=>{els[0].querySelectorAll('.stp')[0].querySelectorAll('button')[1].click();});
  ok(await pg.evaluate(()=>state.scores.p1[0].strokes===state.holes[0].par+1),'+ increments');
  // putts tap on Jon with no strokes: putts set to 2
  await pg.$$eval('.lp',els=>{els[1].querySelectorAll('.stp')[1].querySelector('.val').click();});
  ok(await pg.evaluate(()=>state.scores.p2[0].putts===2),'putts tap -> 2');
  // toggles
  await pg.$$eval('.lp',els=>{const t=els[0].querySelectorAll('.tog');t[0].click();t[1].click();t[2].click();});
  ok(await pg.evaluate(()=>{const s=state.scores.p1[0];return s.dots===1&&s.fir===true&&s.gir===true;}),'dots/FW/GR toggles');
  ok((await pg.textContent('#liveWrap')).includes('Still to enter: Jon, Max, Leo'),'missing players listed');
  // fill a whole 18-hole round deterministically through liveSet and compare with a direct engine run
  await pg.evaluate(()=>{
    const rng=mulberry32(7);
    state.players.forEach(p=>{state.scores[p.id]=state.holes.map(()=>({strokes:null,putts:null,dots:0,fir:false,gir:false}));});
    for(let hi=0;hi<18;hi++){
      state.live.hole=hi;
      state.players.forEach(p=>{
        liveSet(p.id,'strokes','tap');
        const d=Math.floor(rng()*4)-1;for(let k=0;k<Math.abs(d);k++)liveSet(p.id,'strokes',d>0?1:-1);
        liveSet(p.id,'putts','tap');if(rng()>0.6)liveSet(p.id,'putts',1);
        if(rng()>0.5)liveSet(p.id,'dots');
        if(state.holes[hi].par!==3&&rng()>0.5)liveSet(p.id,'fir');
        if(rng()>0.5)liveSet(p.id,'gir');
      });
      if(state.holes[hi].par===3&&rng()>0.3)liveCtp(state.players[Math.floor(rng()*4)].id);
    }
  });
  const through=await pg.textContent('.live-stand h3');
  ok(through.includes('Through hole 18'),'standings through hole 18: '+through);
  const liveTot=await pg.evaluate(()=>{const r=computeAll(buildRound());return r.total;});
  // reload -> resumed from localStorage
  await pg.reload();
  ok(await pg.evaluate(()=>!!state.live&&state.live.hole===17&&state.scores.p1[17].strokes!=null),'resumed after reload with data intact');
  const resumedTot=await pg.evaluate(()=>computeAll(buildRound()).total);
  ok(JSON.stringify(liveTot)===JSON.stringify(resumedTot),'totals identical after reload');
  // finish -> normal results with full segments must equal the live totals (all 18 played)
  await pg.evaluate(()=>endLive());
  ok(await pg.evaluate(()=>!state.live&&localStorage.getItem('gbLive')==null),'endLive clears live state + storage');
  const finalTot=await pg.evaluate(()=>computeAll(buildRound()).total);
  ok(JSON.stringify(liveTot)===JSON.stringify(finalTot),'live totals == final totals: '+JSON.stringify(finalTot));
  const z=Object.values(finalTot).reduce((a,b)=>a+b,0);
  ok(Math.abs(z)<0.01,'zero-sum ('+z.toFixed(2)+')');
  // partial round: 7 holes -> no "skipped entirely" warnings in live standings
  await pg.evaluate(()=>{startLive();startLive();});
  await pg.evaluate(()=>{for(let hi=0;hi<7;hi++){state.live.hole=hi;state.players.forEach(p=>{liveSet(p.id,'strokes','tap');liveSet(p.id,'putts','tap');});}});
  const txt=await pg.textContent('#liveWrap');
  ok(txt.includes('Through hole 7')&&!txt.includes('not scored for everyone'),'partial round: through 7, no skipped-hole warning');
  const res=await pg.textContent('#resultsWrap');
  ok(res.includes('through hole 7')&&!res.includes('skipped entirely'),'results section says live through hole 7');
  // sample / import paths still work and clear live
  await pg.evaluate(()=>loadSample());
  ok(await pg.evaluate(()=>!state.live&&localStorage.getItem('gbLive')==null),'loadSample clears live');
  const sampleRes=await pg.textContent('#resultsWrap');
  ok(sampleRes.includes('Who owes what')&&!sampleRes.includes('Live —'),'sample results render normally');
  await pg.screenshot({path:'live-shot.png',fullPage:false});
  // screenshot of the live panel for a visual check
  await pg.evaluate(()=>{startLive();startLive();state.live.hole=2;liveSet('p1','strokes','tap');liveSet('p1','putts','tap');liveSet('p2','strokes','tap');});
  await pg.evaluate(()=>document.getElementById('liveCard').scrollIntoView());
  await pg.screenshot({path:'live-shot.png',fullPage:false});
  await br.close();srv.close();
  console.log(fails?`\n${fails} FAILED`:'\nALL PASSED');process.exit(fails?1:0);
})();
