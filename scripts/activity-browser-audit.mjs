// Local-only QA for Portfolio UP. Requires Chrome CDP on 127.0.0.1:9230 and demo seed accounts.
// Run from repository root: node scripts/activity-browser-audit.mjs [rights|shots|colors]
import fs from 'node:fs/promises'
const origin='http://127.0.0.1:5173', api='http://127.0.0.1:8099/api/v1'
for(const t of await fetch('http://127.0.0.1:9230/json/list').then(r=>r.json())) { if(t.type==='page') await fetch('http://127.0.0.1:9230/json/close/'+t.id) }
const target=await fetch('http://127.0.0.1:9230/json/new?'+origin,{method:'PUT'}).then(r=>r.json())
const ws=new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
let seq=0;const pending=new Map(),errors=[],reports=[]
ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result)} else if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text)})
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
await call('Page.enable');await call('Runtime.enable');await call('Network.enable')
await call('Page.navigate',{url:origin});await pause(1200)
async function login(role) { const response=await evaluate(`(async()=>{const r=await fetch('${api}/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'demo.${role}@teenteched.kz',password:'demo12345'})});const d=await r.json();window.auditToken=d.access_token;return {status:r.status,role:d.user?.role}})()`);if(response.status!==200)throw new Error('login failed '+role);console.log('role',response.role) }
async function apiGet(path){return evaluate(`(async()=>{const r=await fetch('${api}${path}',{headers:{Authorization:'Bearer '+window.auditToken}});const d=await r.json();return {status:r.status,data:d}})()`)}
async function inspect(name,theme,width,save=true){await pause(350);const valid=await evaluate(`!!document.querySelector('main h1') && !location.pathname.includes('/login')`);if(!valid || await evaluate(`location.pathname.includes('/login')`)) throw new Error('Screen did not load: '+name+' '+theme+' '+width);const audit=await evaluate(`(()=>{const main=document.querySelector('main')||document.body;return {pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,text:main.innerText.slice(0,250),badges:[...main.querySelectorAll('[class*="text-dir-"]')].slice(0,3).map(el=>({text:el.textContent,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor})),overflow:[...main.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0 && (r.right>innerWidth+2 || r.left < -2) && !e.closest('[class*="overflow-x-auto"]')}).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,70)}))}})()`);reports.push({name,theme,width,...audit});await fs.writeFile(process.argv[2]==='mentor-cards'?'docs/activity-redesign/mentor-preview-audit.json':process.argv[2]==='shots'?'docs/activity-redesign/browser-final-audit.json':'docs/activity-redesign/browser-audit.json',JSON.stringify({reports,errors},null,2));if(audit.pageWidth>width+1 || audit.overflow.length) console.log('OVERFLOW',name,theme,width,JSON.stringify(audit.overflow));if(save) {const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`docs/activity-redesign/screenshots/${name}-${theme}-${width}.png`,Buffer.from(r.data,'base64'))} }
async function navigate(path,theme,width){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate(`localStorage.setItem('teenteched-theme-v2','${theme}')`);await call('Page.navigate',{url:origin+path});for(let n=0;n<20;n++){await pause(250);if(await evaluate(`!!document.querySelector('[role=tablist]') && document.querySelector('main')?.innerText.includes('Активности') || document.querySelector('main')?.innerText.includes('Кто может участвовать')`))break}await pause(1000);await evaluate('document.fonts.ready.then(()=>true)')}
if(process.argv[2]==='rights') {
 const checks=[];let ownStudent;
 for(const role of ['admin','head','mentor','mentor2','student']) {
  await login(role);
  const catalog=await apiGet('/activities');
  const board=await apiGet('/activities/staff/participations?limit=500');
  const students=await apiGet('/activities/staff/students');
  if(role==='mentor')ownStudent=students.data[0]?.id;
  const other=ownStudent && role==='mentor2'?await apiGet('/activities/students/'+ownStudent+'/participations'):null;
  const item={role,catalog:catalog.status,board:board.status,students:students.status,visible:board.data.total ?? null,otherStudent:other?.status};
  checks.push(item);console.log('rights',item);
  if(role==='student' && (board.status!==403||students.status!==403)) throw new Error('student scope leak');
  if(role==='mentor2' && other?.status!==404 && !students.data.some(s=>s.id===ownStudent)) throw new Error('mentor scope leak');
 }
 await fs.writeFile('docs/activity-redesign/role-audit.json',JSON.stringify(checks,null,2));ws.close();process.exit(0);
}
if(process.argv[2]==='mentor-cards') {
 await login('mentor');
 for(const theme of ['dark','light'])for(const width of [320,768,1024,1440]) {
  await navigate('/workspace/activities',theme,width);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Карточками').click()`);
  await inspect('mentor-cards',theme,width,width===320||width===1440);
  if(width===1440) {
   await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Подробнее')).click()`);await pause(600);
   if(!await evaluate(`[...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some(t=>t.textContent==='Превью')`))throw new Error('Preview not opened');
   await inspect('mentor-card-preview',theme,width);
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await evaluate(`document.querySelector('summary').click()`);await inspect('mentor-guide',theme,width);
  }
 }
 console.log('mentor cards checked',reports.length,'errors',errors);ws.close();process.exit(errors.length?1:0);
}
if(process.argv[2]==='shots') {
 await login('student');const c=await apiGet('/activities');const id=c.data.find(a=>a.title.includes('FAO')).id;
 for(const theme of ['dark','light'])for(const width of [320,768,1024,1440])for(const [name,path] of [['student-plan','/portal/activities'],['student-catalog','/portal/activities?view=catalog'],['student-detail','/portal/activities/'+id]]){await navigate(path,theme,width);await inspect(name,theme,width,width===320||width===1440)}
 await login('mentor');for(const theme of ['dark','light']) {await navigate('/workspace/activities',theme,1440);await evaluate(`[...document.querySelectorAll('tbody button')].find(b=>b.textContent.includes('Research Assistant'))?.click()`);await pause(600);await evaluate(`[...document.querySelectorAll('[role="tab"]')].find(b=>b.textContent==='Превью')?.click()`);await inspect('mentor-drawer-preview',theme,1440);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}
 await fs.writeFile('docs/activity-redesign/browser-final-audit.json',JSON.stringify({reports,errors},null,2));console.log('final screenshots',reports.length,'errors',errors);ws.close();process.exit(0);
}
if(process.argv[2]==='colors') {
 await login('mentor');await navigate('/workspace/activities','light',1440);
 console.log('colors',await evaluate(`(()=>{const e=document.querySelector('[class*="text-dir-"]');return {text:document.body.innerText.slice(0,200),style:e?.className,var:getComputedStyle(document.documentElement).getPropertyValue('--dir-8-rgb'),color:e&&getComputedStyle(e).color,rules:[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules].map(r=>r.cssText).filter(t=>t.includes('text-dir-8'))}catch{return []}})}})()`));ws.close();process.exit(0);
}
await login('mentor')
let read=await apiGet('/activities/staff/participations?limit=500');console.log('board API',read.status,read.data.counts)
for(const theme of ['dark','light']) for(const width of [320,768,1024,1440]) for(const [name,path] of [['mentor-catalog','/workspace/activities'],['mentor-board','/workspace/activities?view=overview']]){await navigate(path,theme,width);if(name==='mentor-board') await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Все ученики'))?.click()`);await inspect(name,theme,width,width===1440||width===320)}
for(const theme of ['dark','light']){await navigate('/workspace/activities',theme,1440);await evaluate(`[...document.querySelectorAll('tbody button')].find(b=>b.textContent.includes('Research Assistant'))?.click()`);await pause(600);await inspect('mentor-drawer-data',theme,1440);await evaluate(`[...document.querySelectorAll('[role="tab"]')].find(b=>b.textContent==='Рекомендовать')?.click()`);await inspect('mentor-drawer-recommend',theme,1440);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}
await login('student')
let catalog=await apiGet('/activities');const id=catalog.data.find(a=>a.title.includes('FAO'))?.id || catalog.data[0].id
console.log('student catalog',catalog.status,catalog.data.length)
for(const theme of ['dark','light']) for(const width of [320,768,1024,1440]) for(const [name,path] of [['student-plan','/portal/activities'],['student-catalog','/portal/activities?view=catalog'],['student-detail','/portal/activities/'+id]]){await navigate(path,theme,width);await inspect(name,theme,width,width===1440||width===320)}
await fs.writeFile('docs/activity-redesign/browser-audit.json',JSON.stringify({reports,errors},null,2));console.log('verified',reports.length,'errors',errors)
ws.close()
