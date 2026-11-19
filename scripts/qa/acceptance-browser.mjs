// Isolated production acceptance QA; never uses the user's Chrome profile.
// Run fresh, then --verify with the same ARCWEB_QA_PROFILE and ARCWEB_QA_PORT.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
const root = path.resolve(process.argv[2] ?? 'dist')
const output = path.resolve(process.argv[3] ?? 'tmp/acceptance/run.json')
fs.mkdirSync(path.dirname(output), { recursive: true })
const chromePath = process.env.ARCWEB_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profileDir = process.env.ARCWEB_QA_PROFILE ? path.resolve(process.env.ARCWEB_QA_PROFILE) : path.join(path.dirname(output), `chrome-${Date.now()}`)
const fixturePath = process.env.ARCWEB_QA_FIXTURE ? path.resolve(process.env.ARCWEB_QA_FIXTURE) : path.join(path.dirname(output), 'acceptance-points.geojson')
const persistedExpression = `(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('arcweb-library-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const tx=db.transaction(['meta','projects','chunks']);const id=await request(tx.objectStore('meta').get('active'));const row=await request(tx.objectStore('projects').get(id));const reads=row.snapshot.project.layers.map(async layer=>({id:layer.id,name:layer.name,chunks:await Promise.all(layer.data.chunks.map(key=>request(tx.objectStore('chunks').get(key))))}));const layers=await Promise.all(reads);db.close();const hashes=await Promise.all(layers.map(async layer=>{const data=layer.chunks.flat();const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));return {id:layer.id,name:layer.name,features:data.length,hash:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}}));return {id,name:row.name,features:row.featureCount,layers:hashes,layout:row.snapshot.project.layout,editedValue:layers.some(layer=>layer.chunks.flat().some(feature=>Object.values(feature.properties??{}).includes('Acceptance edited'))),offlineBasemap:row.snapshot.offlineBasemap?.name}})()`
if (process.env.ARCWEB_QA_FIXTURE && !fs.existsSync(fixturePath)) throw new Error('QA fixture file does not exist')
if (!fs.existsSync(fixturePath)) fs.writeFileSync(fixturePath, JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 3 }, (_, i) => ({
  type: 'Feature', properties: { name: `محطة ${i}`, value: i, kind: `class-${i % 10}`, description: 'deterministic GIS performance fixture '.repeat(2) },
  geometry: { type: 'Point', coordinates: [-100 + (i % 300) * 0.01, 38 + Math.floor(i / 300) * 0.01] },
})) }))
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '')
  let file = path.resolve(root, relative || 'index.html')
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
  res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream')
  fs.createReadStream(file).pipe(res)
})
server.listen(Number(process.env.ARCWEB_QA_PORT ?? 0), '127.0.0.1')
await once(server, 'listening')
const appUrl = `http://127.0.0.1:${server.address().port}`
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--window-size=1366,860', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
chrome.stderr.on('data', (chunk) => fs.appendFileSync(output.replace(/\.json$/, '.chrome.log'), chunk))
async function runBrowser() {
let socket
try {
  const endpoint = await new Promise((resolve, reject) => {
    let text = ''
    const timer = setTimeout(() => reject(new Error('Chrome did not expose its QA endpoint')), 20_000)
    chrome.once('error', reject)
    chrome.stderr.on('data', (chunk) => {
      text += chunk
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  socket = new WebSocket(endpoint)
  await once(socket, 'open')
  let nextId = 0
  const pending = new Map()
  const errors = []
  socket.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(String(data))
    if (reply.id) {
      const call = pending.get(reply.id)
      if (call) {
        clearTimeout(call.timer)
        pending.delete(reply.id)
        if (reply.error) call.reject(new Error(JSON.stringify(reply.error)))
        else call.resolve(reply.result)
      }
    } else if (reply.method === 'Runtime.exceptionThrown' || reply.method === 'Log.entryAdded') errors.push(reply)
  })
  function send(method, params = {}, sessionId, timeoutMs = 30_000) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)) }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const cdp = (method, params) => send(method, params, sessionId)
  async function evaluate(expression) {
    const reply = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails))
    return reply.result.value
  }
  async function waitFor(expression, timeout = 30_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    fs.writeFileSync(output.replace(/\.json$/, '.failure.json'), JSON.stringify(await evaluate(`({text:document.body.innerText, activeTab:document.querySelector('.ribbon-tab.active')?.textContent, buttons:Array.from(document.querySelectorAll('button')).map(button=>({title:button.title,text:button.textContent}))})`), null, 2))
    throw new Error(`Condition not met: ${expression}`)
  }
  await cdp('Runtime.enable')
  await cdp('Page.enable')
  await cdp('Log.enable')
  if (process.argv.includes('--download-area')) await cdp('Network.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1366, height: 860, deviceScaleFactor: 1, mobile: false })
  const checks = []
  const check = (name, value) => { if (!value) throw new Error(name); checks.push(name); console.log('PASS ' + name) }
  const click = async (selector) => { await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await new Promise(r=>setTimeout(r,100)) }
  const textClick = async (text,scope='document') => { const expression=`Array.from(${scope}.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)})`; await waitFor(`!!(${expression})`); await evaluate(`(${expression}).click()`); await new Promise(r=>setTimeout(r,100)) }
  const set = async (selector,value) => { await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));}`); await new Promise(r=>setTimeout(r,50)) }
  const tab = name => textClick(name,"document.querySelector('.ribbon-tabs')")
  const file = async (selector,filename) => { const doc=await cdp('DOM.getDocument'); const {nodeId}=await cdp('DOM.querySelector',{nodeId:doc.root.nodeId,selector});await cdp('DOM.setFileInputFiles',{nodeId,files:[filename]}) }
  await cdp('Page.navigate',{url:appUrl})
  await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
  if(process.argv.includes('--verify')) {
    await waitFor(`document.querySelectorAll('.layer-name-button').length===3`)
    const actual=await evaluate(persistedExpression),expected=JSON.parse(fs.readFileSync(path.join(path.dirname(output),'expected.json'),'utf8'))
    check('cold browser restart retains exact layer data',JSON.stringify(actual.layers)===JSON.stringify(expected.layers))
    check('cold browser restart retains project identity',actual.id===expected.id)
    check('cold browser restart retains edited value',actual.editedValue)
    check('cold browser restart retains layout',JSON.stringify(actual.layout)===JSON.stringify(expected.layout))
  } else {
    const legacy=path.join(path.dirname(output),'legacy.arcweb.json')
    fs.writeFileSync(legacy,JSON.stringify({format:'arcweb-project',version:1,name:'Acceptance legacy project',map:{basemap:'osm',displayCrs:'EPSG:4326',camera:{center:[-100,38],zoom:8,bearing:0,pitch:0},bookmarks:[]},layers:[{id:'legacy',name:'Legacy points',geometry:'Point',data:{type:'FeatureCollection',features:[{type:'Feature',id:'legacy-point',properties:{name:'Legacy',value:1},geometry:{type:'Point',coordinates:[-100,38]}}]}}],layout:{paper:'A4',orientation:'landscape',elements:[{id:'map',type:'map',x:10,y:20,w:270,h:160,border:true}]}}))
    await file('input[aria-label="Choose an ArcWeb project file"]',legacy)
    await waitFor(`document.querySelectorAll('.layer-name-button').length===1&&document.querySelector('.project-name').value==='Acceptance legacy project'`)
    check('version-1 project opens with missing optional settings',true)
    await file('input[aria-label="Choose data files to add"]',fixturePath)
    await waitFor(`document.querySelectorAll('.layer-name-button').length===2`)
    check('real GeoJSON file imports beside legacy layer',true)
    await tab('Map');await click('[data-command="select-by-attributes"]')
    await set('[aria-label="Field"]','value');await set('[aria-label="Operator"]','>');await set('[aria-label="Value"]','0')
    await textClick('Apply',"document.querySelector('.selection-dialog')")
    check('attribute selection selects matching records',await evaluate(`document.querySelector('.selection-dialog').textContent.includes('selected')`))
    await textClick('OK',"document.querySelector('.selection-dialog')")
    await tab('Analysis');await click('[data-command="tool-buffer"]')
    await waitFor(`document.querySelector('.toolbox-tool-title strong')?.textContent==='Buffer'`)
    await evaluate(`{const label=Array.from(document.querySelectorAll('.toolbox-parameter')).find(x=>x.textContent.includes('Distance (negative'));const input=label.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));}`)
    await textClick('Run',"document.querySelector('.toolbox-dock')")
    await waitFor(`document.querySelectorAll('.layer-name-button').length===3`)
    check('Buffer runs through the worker and adds a result layer',true)
    await tab('View');await click('[data-command="open-table"]')
    await waitFor(`!!document.querySelector('.table-cell.editable')`)
    await evaluate(`document.querySelector('.table-cell.editable').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
    await waitFor(`!!document.querySelector('.table-cell.editing input')`)
    await set('.table-cell.editing input','Acceptance edited')
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await tab('Edit');await click('[data-command="save-edits"]')
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
    check('View opens the result table without closing the original table',await evaluate(`document.querySelectorAll('[aria-label="Open attribute tables"] [role=tab]').length===2`))
    check('attribute edit commits and saves',await evaluate(`document.querySelector('.attribute-table')?.textContent.includes('Acceptance edited')||document.body.innerText.includes('Acceptance edited')`))
    await tab('Map');await click('[data-command="full-extent"]');await new Promise(r=>setTimeout(r,1800))
    await tab('Insert');await click('[data-command="new-layout"]');await textClick('Classic',"document.querySelector('[role=menu]')")
    await waitFor(`!!document.querySelector('.layout-page')&&!!document.querySelector('.layout-element-title')`)
    check('New Layout creates the Classic composition',true)
    await click('.contextual-layout button:last-child')
    const downloads=path.join(path.dirname(output),'downloads');fs.mkdirSync(downloads,{recursive:true})
    await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
    await click('[data-command="layout-export-png"]')
    await waitFor(`!document.querySelector('[data-command="layout-export-png"]').disabled`)
    await click('[data-command="layout-export-pdf"]')
    await waitFor(`!document.querySelector('[data-command="layout-export-pdf"]').disabled`)
    await new Promise(r=>setTimeout(r,500))
    check('PNG and PDF are downloaded',fs.readdirSync(downloads).some(name=>name.endsWith('.png'))&&fs.readdirSync(downloads).some(name=>name.endsWith('.pdf')))
    await click('[data-command="layout-close"]')
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
    const expected=await evaluate(persistedExpression)
    fs.writeFileSync(path.join(path.dirname(output),'expected.json'),JSON.stringify(expected,null,2))
    check('all three layers are committed to IndexedDB',expected.layers.length===3)
  }
  const exceptions=errors.filter(row=>row.method==='Runtime.exceptionThrown')
  check('no uncaught runtime exceptions',exceptions.length===0)
  fs.writeFileSync(output,JSON.stringify({checks,errors},null,2))
  await send('Browser.close')
} finally { socket?.close();chrome.kill();server.close() }
}
await runBrowser()
