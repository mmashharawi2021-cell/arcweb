// Isolated Chrome QA: production bundle, real file input, Long Tasks + CPU profile.
// Usage: node scripts/qa/profile-browser.mjs [dist-root] [output.json]
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import JSZip from 'jszip'

if (process.argv.includes('--compare')) {
  const outDir = path.dirname(path.resolve(process.argv[3] ?? 'tmp/performance/profile.json'))
  const samples = []
  for (let run = 1; run <= 3; run++) for (const variant of ['baseline', 'optimized']) {
    const bundle = variant === 'baseline' ? path.resolve(process.env.ARCWEB_QA_BASELINE ?? path.join(outDir, 'baseline-dist')) : path.resolve(process.argv[2] ?? 'dist')
    const sample = path.join(outDir, `${variant}-run-${run}.json`)
    const child = spawn(process.execPath, [process.argv[1], bundle, sample, '--no-cpu'], { windowsHide: true, stdio: 'inherit' })
    const [code] = await once(child, 'exit')
    if (code !== 0) process.exit(code ?? 1)
    const data = JSON.parse(fs.readFileSync(sample, 'utf8'))
    samples.push({ variant, run, fixtureBytes: data.fixtureBytes, importTiming: data.importTiming,
      maximumTaskMs: Math.max(0, ...data.measurements.tasks.map((task) => task.duration)),
      blockingTimeMs: data.measurements.tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
      tasks: data.measurements.tasks, errors: data.errors.length })
  }
  fs.writeFileSync(path.join(outDir, 'comparison.json'), JSON.stringify(samples, null, 2))
  console.log(JSON.stringify(samples.map(({ tasks: _tasks, ...summary }) => summary)))
  process.exit(0)
}

const root = path.resolve(process.argv[2] ?? 'dist')
const output = path.resolve(process.argv[3] ?? 'tmp/performance/profile.json')
fs.mkdirSync(path.dirname(output), { recursive: true })
const chromePath = process.env.ARCWEB_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profileDir = process.env.ARCWEB_QA_PROFILE ? path.resolve(process.env.ARCWEB_QA_PROFILE) : path.join(path.dirname(output), `chrome-${Date.now()}`)
const fixturePath = process.env.ARCWEB_QA_FIXTURE ? path.resolve(process.env.ARCWEB_QA_FIXTURE) : path.join(path.dirname(output), 'points-60000.geojson')
const persistedExpression = `(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('arcweb-library-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const tx=db.transaction(['meta','projects','chunks']);const id=await request(tx.objectStore('meta').get('active'));const row=await request(tx.objectStore('projects').get(id));const reads=row.snapshot.project.layers.map(async layer=>({id:layer.id,name:layer.name,chunks:await Promise.all(layer.data.chunks.map(key=>request(tx.objectStore('chunks').get(key))))}));const layers=await Promise.all(reads);db.close();const hashes=await Promise.all(layers.map(async layer=>{const data=layer.chunks.flat();const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));return {id:layer.id,name:layer.name,features:data.length,hash:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}}));return {id,name:row.name,features:row.featureCount,layers:hashes,offlineBasemap:row.snapshot.offlineBasemap?.name}})()`
if (process.env.ARCWEB_QA_FIXTURE && !fs.existsSync(fixturePath)) throw new Error('QA fixture file does not exist')
if (!fs.existsSync(fixturePath)) fs.writeFileSync(fixturePath, JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 60_000 }, (_, i) => ({
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
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__qa = { tasks: [], stages: [], mark: 0 };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__qa.tasks.push({start:entry.startTime, duration:entry.duration}); }).observe({entryTypes:['longtask']});
    const instrument = (object, key) => { const original=object[key]; object[key]=function(...args) { const t=performance.now(); try { return original.apply(this,args); } finally { const duration=performance.now()-t; if(duration>1) window.__qa.stages.push({name:key, start:t, duration}); } }; };
    instrument(JSON,'stringify'); instrument(IDBObjectStore.prototype,'put'); instrument(Worker.prototype,'postMessage');
  ` })
  const navigationStarted = Date.now()
  if (process.argv.includes('--reopen')) {
    if (!process.env.ARCWEB_QA_PROFILE || !process.env.ARCWEB_QA_PORT || !process.env.ARCWEB_QA_EXPECTED) throw new Error('Cold-reopen QA requires the prior isolated profile, port and expected snapshot path')
    await cdp('Network.enable')
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  }
  await cdp('Page.navigate', { url: appUrl })
  await waitFor(`!!document.querySelector('input[aria-label="Choose data files to add"]')`)
  const resetCamera = async () => {
    await evaluate(`Array.from(document.querySelectorAll('.ribbon-tab')).find(button=>button.textContent.trim()==='Map').click()`)
    const fullExtent = `Array.from(document.querySelectorAll('button')).find(button=>!button.closest('.arcweb-exit-ghost')&&button.textContent.trim()==='Full extent')`
    await waitFor(`!!(${fullExtent})`)
    await evaluate(`(${fullExtent}).click()`)
    await new Promise(resolve => setTimeout(resolve, 1500))
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
  }
  if (process.argv.includes('--prime')) {
    const cacheName = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const CACHE = '([^']+)'/)[1]
    await evaluate(`(async()=>{const registration=await navigator.serviceWorker.ready;await registration.update()})()`)
    await waitFor(`(async()=>{const cache=await caches.open(${JSON.stringify(cacheName)});return !!(await cache.match(new URL('index.html',location.href).href))})()`)
    await new Promise(resolve => setTimeout(resolve, 1000))
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`, 60_000)
    await resetCamera()
    if (process.argv.includes('--clear-render-cache')) {
      await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('arcweb-library-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite');const r=tx.objectStore('meta').openCursor();r.onsuccess=()=>{const c=r.result;if(c){if(String(c.key).startsWith('map-render-v1:'))c.delete();c.continue()}};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close()})()`)
    }
    fs.writeFileSync(output, JSON.stringify({ primed: cacheName, errors }, null, 2))
    await send('Browser.close')
    return
  }
  if (process.argv.includes('--reopen')) {
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`, 60_000)
    const readyMs = Date.now() - navigationStarted
    const entry = await evaluate(`document.querySelector('script[type="module"][src]').src`)
    const expectedEntry = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script[^>]+src="([^"]+)"/)[1]
    if (new URL(entry).pathname !== new URL(expectedEntry, appUrl).pathname) throw new Error('Offline session loaded a different production bundle; prime the selected build first')
    await new Promise(resolve => setTimeout(resolve, 5000))
    const startup = await evaluate(`({tasks:window.__qa.tasks,stages:window.__qa.stages})`)
    const canvas = await evaluate(`(()=>{const r=document.querySelector('.maplibregl-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await evaluate(`window.__qa.tasks=[];window.__qa.stages=[];window.__qa.frames=[];window.__qa.frameEnd=performance.now()+1800;requestAnimationFrame(function frame(t){window.__qa.frames.push(t);if(t<window.__qa.frameEnd)requestAnimationFrame(frame)})`)
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvas.x, y: canvas.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 10; i++) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvas.x + i * 12, y: canvas.y + i * 3, button: 'left', buttons: 1 })
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvas.x + 120, y: canvas.y + 30, button: 'left', clickCount: 1 })
    await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvas.x, y: canvas.y, deltaY: -240, deltaX: 0 })
    await new Promise(resolve => setTimeout(resolve, 2000))
    const navigation = await evaluate(`({tasks:window.__qa.tasks,stages:window.__qa.stages,frameIntervals:window.__qa.frames.slice(1).map((t,i)=>t-window.__qa.frames[i])})`)
    // Reset the camera through the UI so consecutive samples start at the same extent.
    await resetCamera()
    const persisted = await evaluate(persistedExpression)
    const renderCaches = await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('arcweb-library-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const rows=await new Promise((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();return rows.filter(row=>row&&row.blob instanceof Blob&&Array.isArray(row.chunks)).map(row=>({bytes:row.blob.size,chunks:row.chunks.length}))})()`)
    const expected = JSON.parse(fs.readFileSync(process.env.ARCWEB_QA_EXPECTED, 'utf8'))
    if (JSON.stringify(persisted) !== JSON.stringify(expected)) throw new Error('Cold-reopen data differs from the committed project snapshot')
    const screen = await cdp('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(output.replace(/\.json$/, '.png'), Buffer.from(screen.data, 'base64'))
    fs.writeFileSync(output, JSON.stringify({ coldBrowserRestart: true, networkOffline: true, entry, renderCaches, readyMs, startup, navigation, exactDataMatch: true, persisted, errors }, null, 2))
    console.log(JSON.stringify({ coldBrowserRestart: true, networkOffline: true, readyMs, exactDataMatch: true, features: persisted.features, errors: errors.length }))
    await send('Browser.close')
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const cpu = !process.argv.includes('--no-cpu')
  if (cpu) { await cdp('Profiler.enable'); await cdp('Profiler.start') }
  await evaluate('window.__qa.mark=performance.now(); window.__qa.stages=[]')
  const { root: documentNode } = await cdp('DOM.getDocument')
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: documentNode.nodeId, selector: 'input[aria-label="Choose data files to add"]' })
  const importStarted = Date.now()
  await cdp('DOM.setFileInputFiles', { nodeId, files: [fixturePath] })
  await waitFor(`document.querySelectorAll('.layer-name-button').length===1`, 30_000)
  const layerAvailableMs = Date.now() - importStarted
  await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`, 90_000)
  const durableSaveMs = Date.now() - importStarted
  await new Promise((resolve) => setTimeout(resolve, 3500))
  const { profile } = cpu ? await cdp('Profiler.stop') : { profile: { nodes: [] } }
  const measurements = await evaluate(`({ ...window.__qa, layers: document.querySelectorAll('.layer-name-button').length, text:document.body.innerText.slice(-1200), viewport:[innerWidth,innerHeight] })`)
  measurements.tasks = measurements.tasks.filter((task) => task.start >= measurements.mark)
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const totals = new Map()
  profile.samples?.forEach((id, index) => {
    const frame = nodes.get(id)?.callFrame
    const key = JSON.stringify(frame)
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0))
  })
  const hotFunctions = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([frame, microseconds]) => ({ frame: JSON.parse(frame), milliseconds: microseconds / 1000 }))
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(output.replace(/\.json$/, '.png'), Buffer.from(screenshot.data, 'base64'))
  fs.writeFileSync(output.replace(/\.json$/, '.cpuprofile'), JSON.stringify(profile))
  const result = { root, fixtureBytes: fs.statSync(fixturePath).size, importTiming: { layerAvailableMs, durableSaveMs }, browser: await send('Browser.getVersion'), measurements, hotFunctions, errors }
  if (process.argv.includes('--memory')) {
    const samples = []
    const sample = async name => {
      await new Promise(resolve => setTimeout(resolve, 1500))
      await cdp('HeapProfiler.collectGarbage')
      const main = await cdp('Runtime.getHeapUsage')
      const { targetInfos } = await send('Target.getTargets')
      const workers = []
      for (const target of targetInfos.filter(target => target.type === 'worker')) {
        try {
          const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, undefined, 2000)
          try { workers.push({ url: target.url, ...await send('Runtime.getHeapUsage', {}, attached.sessionId, 2000) }) }
          finally { await send('Target.detachFromTarget', { sessionId: attached.sessionId }, undefined, 2000) }
        } catch (error) { workers.push({ url: target.url, unavailable: String(error) }) }
      }
      samples.push({ name, main, workers })
      fs.writeFileSync(output.replace(/\.json$/, '.memory-progress.json'), JSON.stringify(samples, null, 2))
    }
    const click = async text => {
      const button = `Array.from(document.querySelectorAll('button')).find(button=>!button.closest('.arcweb-exit-ghost')&&button.textContent.trim()===${JSON.stringify(text)})`
      await waitFor(`!!(${button})`)
      await evaluate(`(${button}).click()`)
    }
    await sample('loaded')
    const original = await evaluate(persistedExpression)
    await click('Map'); await click('Table')
    await waitFor(`!!document.querySelector('.table-cell.editable')`)
    const column = await evaluate(`Array.from(document.querySelectorAll('.table-column > button > span')).findIndex(node=>node.textContent==='featurecla')`)
    if (column < 0) throw new Error('Memory QA requires the Natural Earth featurecla string column')
    const cell = `document.querySelector('.attribute-table-row').querySelectorAll('.table-cell.editable')[${column}]`
    const originalText = await evaluate(`(${cell}).textContent`)
    const edit = async text => {
      await evaluate(`(${cell}).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
      await waitFor(`!!document.querySelector('.table-cell.editing input')`)
      await evaluate(`{const input=document.querySelector('.table-cell.editing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));}`)
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await waitFor(`!!document.querySelector('.ctx-commit:not(:disabled)')`)
      await evaluate(`document.querySelector('.ctx-commit:not(:disabled)').click()`)
      await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
    }
    await edit('QA memory edited')
    await sample('edited-and-saved')
    await edit(originalText)
    await sample('attribute-restored')
    const restored = await evaluate(persistedExpression)
    if (JSON.stringify(restored.layers) !== JSON.stringify(original.layers)) throw new Error('Memory exercise changed original data after restoring the edit')
    await click('Projects'); await waitFor(`document.querySelector('.project-library')?.getAttribute('aria-busy')==='false'`)
    await click('New project')
    await waitFor(`document.querySelectorAll('.layer-name-button').length===0&&document.querySelector('.save-state')?.textContent==='Saved locally'`)
    await sample('switched-to-empty-project')
    await click('Projects'); await waitFor(`document.querySelector('.project-library')?.getAttribute('aria-busy')==='false'`)
    await evaluate(`Array.from(document.querySelectorAll('.library-project-card')).find(card=>card.querySelector('small').textContent.includes(${JSON.stringify(original.features.toLocaleString('en-US') + ' features')})).querySelector('button').click()`)
    await waitFor(`document.querySelectorAll('.layer-name-button').length===1&&!document.querySelector('.project-library')&&document.querySelector('.save-state')?.textContent==='Saved locally'`)
    await sample('reopened-original-project')
    const reopened = await evaluate(persistedExpression)
    if (JSON.stringify(reopened) !== JSON.stringify(original)) throw new Error('Project switching changed saved data')
    result.memory = { samples, exactDataMatch: true, metric: 'Main CDP JS heap after explicit GC; worker heaps are sampled without forced GC and may be unavailable. Excludes total process/GPU/native Blob memory.' }
  }
  if (process.argv.includes('--navigation-motion')) {
    const systemReducedMotion = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    const samples = []
    await evaluate(`void(window.__ribbonBefore=document.querySelector('.ribbon-toolbar'))`)
    for (const tab of ['Analysis', 'Map', 'Layout', 'Map']) {
      const sample = await evaluate(`(async()=>{Array.from(document.querySelectorAll('.ribbon-tab')).find(button=>button.textContent.trim()===${JSON.stringify(tab)}).click();await new Promise(requestAnimationFrame);const node=document.querySelector('.ribbon-toolbar');return {tab:${JSON.stringify(tab)},sameNode:node===window.__ribbonBefore,animations:node.getAnimations().map(a=>({duration:a.effect.getTiming().duration,firstOpacity:a.effect.getKeyframes()[0].opacity})),opacity:getComputedStyle(node).opacity}})()`)
      if (!sample.sameNode || !sample.animations.some(a => a.duration === 300 && Number(a.firstOpacity) === 0.3)) throw new Error('Navigation did not replay motion on the existing ribbon')
      samples.push(sample)
    }
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await waitFor(`document.querySelector('.ribbon-toolbar').getAnimations().filter(a=>a.playState==='running').length===0`)
    const reduced = true
    if (!reduced) throw new Error('Navigation animation did not cancel for reduced motion')
    result.navigationMotion = { systemReducedMotion, samples, reducedMotionCancelled: reduced }
    await cdp('Emulation.setEmulatedMedia', { features: [] })
  }
  if (process.argv.includes('--motion')) {
    await evaluate(`Array.from(document.querySelectorAll('.ribbon-tab')).find(button=>button.textContent.trim()==='Layout').click()`)
    await waitFor(`Boolean(document.querySelector('.layout-panel .arcweb-reveal.is-visible'))`)
    await new Promise((resolve) => setTimeout(resolve, 700))
    const normal = await evaluate(`Array.from(document.querySelectorAll('.arcweb-reveal.is-visible')).map(el=>({opacity:getComputedStyle(el).opacity,willChange:el.style.willChange,transition:getComputedStyle(el).transitionProperty}))`)
    if (!normal.length || normal.some(el => el.opacity !== '1' || el.willChange)) throw new Error('Reveal did not finish or retained its promotion hint')
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const reduced = await evaluate(`Array.from(document.querySelectorAll('.arcweb-reveal')).every(el=>{const s=getComputedStyle(el);return s.opacity==='1'&&s.transform==='none'&&s.transitionDuration==='0s'})`)
    if (!reduced) throw new Error('Reduced motion leaves layout controls hidden or animated')
    await cdp('Emulation.setEmulatedMedia', { features: [] })
    result.motion = { revealedSections: normal.length, promotionHintsReleased: true, reducedMotionVisible: reduced }
  }
  if (process.argv.includes('--qa')) {
    const checks = []
    const key = async (value, modifiers = 0) => {
      const windowsVirtualKeyCode = value === 'Tab' ? 9 : value === 'Enter' ? 13 : 27
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value, modifiers, windowsVirtualKeyCode })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value, modifiers, windowsVirtualKeyCode })
    }
    await evaluate(`Array.from(document.querySelectorAll('.ribbon-tab')).find(button=>button.textContent.trim()==='Map').click()`)
    for (const selector of ['By attributes', 'By location', 'Properties']) {
      const buttonExpression = `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(selector)})`
      await waitFor(`!!(${buttonExpression})`)
      await evaluate(`{const button=${buttonExpression};button.focus();window.__qaOpener=button;button.click();}`)
      await waitFor(`!!document.querySelector('[role="dialog"]')`)
      const initialInside = await evaluate(`document.querySelector('[role="dialog"]').contains(document.activeElement)`)
      await evaluate(`{const items=document.querySelector('[role="dialog"]').querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');items[items.length-1].focus();}`)
      await key('Tab')
      const wrapsForward = await evaluate(`document.activeElement===document.querySelector('[role="dialog"]').querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')`)
      await key('Tab', 8)
      const wrapsBack = await evaluate(`{const items=document.querySelector('[role="dialog"]').querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');document.activeElement===items[items.length-1]}`)
      if (process.argv.includes('--fade')) await new Promise((resolve) => setTimeout(resolve, 350))
      await key('Escape')
      await waitFor(`!document.querySelector('[role="dialog"]')`)
      const restoresOpener = await evaluate(`document.activeElement===window.__qaOpener`)
      if (process.argv.includes('--fade')) {
        const decorativeExit = await evaluate(`{const el=document.querySelector('.arcweb-exit-ghost');!!el&&el.inert&&el.getAttribute('aria-hidden')==='true'&&!el.querySelector('[id],[role],[autofocus]')&&getComputedStyle(el).pointerEvents==='none'}`)
        if (!decorativeExit) throw new Error('Missing or interactive modal fade-out snapshot')
        await waitFor(`!document.querySelector('.arcweb-exit-ghost')`)
        checks.push({ check: selector+' fade-out', decorativeExit, cleanedUp: true })
      }
      checks.push({ check: selector, initialInside, wrapsForward, wrapsBack, restoresOpener })
      if (![initialInside, wrapsForward, wrapsBack, restoresOpener].every(Boolean)) throw new Error(`Modal focus regression: ${JSON.stringify(checks.at(-1))}`)
    }
    if (process.argv.includes('--fade')) {
      const propertiesButton = `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Properties')`
      for (let i = 0; i < 5; i++) {
        await evaluate(`(${propertiesButton}).click()`)
        await waitFor(`!!document.querySelector('[role="dialog"]')`)
        await key('Escape')
        await waitFor(`!document.querySelector('[role="dialog"]')`)
      }
      const bounded = await evaluate(`document.querySelectorAll('.arcweb-exit-ghost').length<=4`)
      await waitFor(`!document.querySelector('.arcweb-exit-ghost')`)
      await evaluate(`document.querySelector('button[title="Toggle theme"]').click()`)
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await evaluate(`(${propertiesButton}).click()`)
      await waitFor(`!!document.querySelector('[role="dialog"]')`)
      const noEntry = await evaluate(`getComputedStyle(document.querySelector('.modal')).animationName==='none'`)
      await key('Escape')
      await waitFor(`!document.querySelector('[role="dialog"]')`)
      const noExit = await evaluate(`!document.querySelector('.arcweb-exit-ghost')`)
      if (!bounded || !noEntry || !noExit) throw new Error('Rapid reopen or reduced-motion fade regression')
      checks.push({ check: 'rapid reopen, alternate theme and reduced-motion close', bounded, noEntry, noExit })
      await cdp('Emulation.setEmulatedMedia', { features: [] })
      await evaluate(`document.querySelector('button[title="Toggle theme"]').click()`)
    }
    const downloads = path.join(path.dirname(output), `downloads-${Date.now()}`)
    fs.mkdirSync(downloads, { recursive: true })
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Save Project').click()`)
    let savedFile
    for (let i = 0; i < 100; i++) {
      savedFile = fs.readdirSync(downloads).find((file) => file.endsWith('.arcweb.json'))
      if (savedFile) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!savedFile) throw new Error('Project download did not complete')
    const savedProjectPath = path.join(downloads, savedFile)
    const savedProject = JSON.parse(fs.readFileSync(savedProjectPath, 'utf8'))
    if (savedProject.layers[0].data.features.length !== 60_000) throw new Error('Downloaded project lost features')
    await cdp('Page.reload')
    await waitFor(`document.querySelectorAll('.layer-name-button').length===1`)
    const reloaded = await evaluate(`document.querySelector('.app-footer').textContent.includes('60,000 features')`)
    if (!reloaded) throw new Error('Session reload lost features')
    checks.push({ check: 'session reload', features: 60_000, passed: reloaded })
    await evaluate(`document.querySelector('button.clear-session').click()`)
    await waitFor(`document.querySelectorAll('.layer-name-button').length===0`)
    const doc = await cdp('DOM.getDocument')
    const projectInput = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[aria-label="Choose an ArcWeb project file"]' })
    await cdp('DOM.setFileInputFiles', { nodeId: projectInput.nodeId, files: [savedProjectPath] })
    await waitFor(`document.querySelectorAll('.layer-name-button').length===1`)
    checks.push({ check: 'reopen exact downloaded project', bytes: fs.statSync(savedProjectPath).size, features: savedProject.layers[0].data.features.length })
    const clickText = async (text) => {
      const expression = `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)})`
      await waitFor(`!!(${expression})`)
      await evaluate(`(${expression}).click()`)
    }
    const setInput = async (selector, value) => {
      await evaluate(`{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));}`)
    }
    const importFile = async (file) => {
      const document = await cdp('DOM.getDocument')
      const input = await cdp('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[aria-label="Choose data files to add"]' })
      await cdp('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] })
    }
    const tiny = path.join(path.dirname(output), 'محطات QA.csv')
    fs.writeFileSync(tiny, 'name,lat,lon\noriginal,31,35\nsecond,31.01,35.01\n')
    await importFile(tiny)
    await waitFor(`document.querySelectorAll('.layer-name-button').length===2`)
    const arabicToast = await evaluate(`document.querySelector('.toast')?.textContent ?? ''`)
    if (!arabicToast.includes('\u2068محطات QA.csv\u2069')) throw new Error('Arabic import filename is not isolated')
    checks.push({ check: 'Arabic filename feedback', text: arabicToast, isolated: true })
    await clickText('Table')
    await waitFor(`!!document.querySelector('.table-cell.editable')`)
    const editFirstCell = async (text) => {
      await evaluate(`document.querySelector('.table-cell.editable').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
      await waitFor(`!!document.querySelector('.table-cell.editing input')`)
      await setInput('.table-cell.editing input', text)
      await key('Enter')
      await waitFor(`!!document.querySelector('.ctx-commit:not(:disabled)')`)
    }
    await editFirstCell('QA saved')
    await clickText('Save')
    await editFirstCell('QA discard')
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
    await cdp('Page.reload')
    await waitFor(`document.querySelectorAll('.layer-name-button').length===2`)
    await waitFor(`!!document.querySelector('.contextual-edit')`)
    await evaluate(`document.querySelector('.contextual-edit').click()`)
    await waitFor(`!!document.querySelector('.ctx-commit:not(:disabled)')`)
    await clickText('Discard')
    // Reopen the latest layer's table after restoring the session.
    await clickText('Map')
    await clickText('Table')
    await waitFor(`!!document.querySelector('.table-cell.editable')`)
    const discarded = await evaluate(`document.querySelector('.table-cell.editable').textContent==='QA saved'`)
    if (!discarded) throw new Error('Discard after reload failed to restore saved attributes')
    checks.push({ check: 'Save, unsaved edit, reload, Discard', passed: true })
    // Cancel a second large import while its worker is reading/preparing the data.
    await importFile(fixturePath)
    await waitFor(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Cancel')`)
    await clickText('Cancel')
    await waitFor(`document.querySelector('.toast')?.textContent.includes('cancelled')`)
    const cancelPreserved = await evaluate(`document.querySelectorAll('.layer-name-button').length===2`)
    if (!cancelPreserved) throw new Error('Cancelled import added partial layers')
    checks.push({ check: 'cancel large import', layersUnchanged: true })
    await clickText('Analysis')
    await waitFor(`!!document.querySelector('input[aria-label="Find tools"]')`)
    await setInput('input[aria-label="Find tools"]', 'Buffer')
    await waitFor(`Array.from(document.querySelectorAll('.toolbox-tree-tool')).some(button=>button.querySelector('strong')?.textContent==='Buffer')`)
    await evaluate(`Array.from(document.querySelectorAll('.toolbox-tree-tool')).find(button=>button.querySelector('strong')?.textContent==='Buffer').click()`)
    await waitFor(`!!document.querySelector('.toolbox-tool-form')`)
    const selectLayer = async (name) => evaluate(`{const select=document.querySelector('.toolbox-parameters select');select.value=Array.from(select.options).find(option=>option.textContent===${JSON.stringify(name)}).value;select.dispatchEvent(new Event('change',{bubbles:true}));}`)
    await selectLayer('points-60000')
    await evaluate(`{const select=Array.from(document.querySelectorAll('.toolbox-parameters select')).find(select=>Array.from(select.options).some(option=>option.value==='ALL'));select.value='ALL';select.dispatchEvent(new Event('change',{bubbles:true}));}`)
    await clickText('Run')
    await waitFor(`Array.from(document.querySelectorAll('.toolbox-tool-form button')).some(button=>button.textContent.trim()==='Cancel')`)
    await clickText('Cancel')
    await waitFor(`document.querySelector('.toast')?.textContent.includes('cancelled')`)
    await evaluate(`document.querySelector('.toolbox-view-tabs button:nth-child(2)').click()`)
    await waitFor(`!!document.querySelector('.toolbox-history-entry.failed')`)
    const cancelHistory = await evaluate(`document.querySelector('.toolbox-history-entry.failed').textContent.includes('Cancelled by user.')`)
    if (!cancelHistory) throw new Error('Cancelled tool was not recorded as failed')
    checks.push({ check: 'cancel large Buffer', failedHistory: true })
    await clickText('Toolboxes')
    await selectLayer('محطات QA')
    await evaluate(`{const select=Array.from(document.querySelectorAll('.toolbox-parameters select')).find(select=>Array.from(select.options).some(option=>option.value==='ALL'));select.value='NONE';select.dispatchEvent(new Event('change',{bubbles:true}));}`)
    await clickText('Run')
    await waitFor(`document.querySelectorAll('.layer-name-button').length===3`)
    checks.push({ check: 'next Buffer succeeds with unrelated 60k layer retained', layers: 3 })
    const waitForDownload = async (name) => {
      for (let i = 0; i < 150; i++) {
        const file = path.join(downloads, name)
        if (fs.existsSync(file)) return file
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error(`Missing download: ${name}`)
    }
    await clickText('Share')
    await clickText('Map PNG')
    const mapImage = fs.readFileSync(await waitForDownload('arcweb-map.png'))
    if (mapImage.readUInt32BE(16) < 100 || mapImage.readUInt32BE(20) < 100) throw new Error('Map image has invalid dimensions')
    checks.push({ check: 'map PNG export', width: mapImage.readUInt32BE(16), height: mapImage.readUInt32BE(20), bytes: mapImage.length })
    await clickText('Layout PNG')
    const layoutImage = fs.readFileSync(await waitForDownload('arcweb-layout.png'))
    checks.push({ check: 'layout PNG export', width: layoutImage.readUInt32BE(16), height: layoutImage.readUInt32BE(20), bytes: layoutImage.length })
    await clickText('Layout PDF')
    const pdf = fs.readFileSync(await waitForDownload('arcweb-layout.pdf'))
    if (!pdf.subarray(0, 8).toString().startsWith('%PDF-') || !pdf.toString('latin1').includes('%%EOF')) throw new Error('Layout PDF is incomplete')
    checks.push({ check: 'layout PDF export', bytes: pdf.length, complete: true })
    const finalScreen = await cdp('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(output.replace(/\.json$/, '.qa.png'), Buffer.from(finalScreen.data, 'base64'))
    result.qa = checks
    console.log(JSON.stringify({ qa: checks }))
  }
  if (process.argv.includes('--library')) {
    const checks = []
    const click = async (label) => {
      const selector = `Array.from(document.querySelectorAll('button')).find(button=>!button.closest('.arcweb-exit-ghost')&&button.textContent.trim()===${JSON.stringify(label)})`
      await waitFor(`Boolean(${selector}) && !(${selector}).disabled`)
      await evaluate(`(${selector}).click()`)
    }
    const upload = async (label, file) => {
      const doc = await cdp('DOM.getDocument')
      const input = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `input[aria-label="${label}"]` })
      await cdp('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] })
    }
    await evaluate(`void(window.__libraryRecords=()=>new Promise((resolve,reject)=>{const open=indexedDB.open('arcweb-library-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const req=db.transaction('projects').objectStore('projects').getAll();req.onsuccess=()=>{resolve(req.result.map(r=>({id:r.id,name:r.name,revision:r.revision,features:r.featureCount,layers:r.layerCount,assets:r.snapshot.assetIds??[],offline:r.snapshot.offlineBasemap})));db.close()};req.onerror=()=>reject(req.error)}}))`)
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
    if (process.argv.includes('--storage-faults')) {
      const original = await evaluate(persistedExpression)
      const rename = (name) => `(()=>{const input=document.querySelector('input[aria-label="Project name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`
      await evaluate(`void(window.__beforeFaultPut=IDBObjectStore.prototype.put);IDBObjectStore.prototype.put=function(...args){if(this.name==='projects')throw new DOMException('QA simulated quota exceeded','QuotaExceededError');return window.__beforeFaultPut.apply(this,args)}`)
      await evaluate(rename('Quota recovery QA'))
      await waitFor(`document.querySelector('.save-state')?.textContent==='Save failed'`)
      const protectedOriginal = await evaluate(`(async()=>{const rows=await window.__libraryRecords();return rows.find(row=>row.id===${JSON.stringify(original.id)}).name===${JSON.stringify(original.name)}})()`)
      if (!protectedOriginal) throw new Error('Failed storage write changed the committed project')
      await evaluate(`void(IDBObjectStore.prototype.put=window.__beforeFaultPut)`)
      await click('Projects'); await click('Save now')
      await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
      await evaluate(`document.querySelector('button[title="Close project library"]').click()`)
      checks.push({ check: 'browser quota fault injection preserves committed data and retries', passed: true })
      const { targetId: otherTarget } = await send('Target.createTarget', { url: 'about:blank' })
      const { sessionId: otherSession } = await send('Target.attachToTarget', { targetId: otherTarget, flatten: true })
      const other = (method, params) => send(method, params, otherSession)
      const otherEvaluate = async expression => {
        const reply = await other('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
        if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails))
        return reply.result.value
      }
      const otherWait = async expression => {
        const deadline = Date.now() + 60_000
        while (Date.now() < deadline) { if (await otherEvaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)) }
        throw new Error(`Second tab condition failed: ${expression}`)
      }
      await other('Runtime.enable'); await other('Page.enable'); await other('Page.navigate', { url: appUrl })
      await otherWait(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
      await evaluate(rename('Primary tab QA'))
      await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
      await otherEvaluate(rename('Secondary unsaved QA'))
      await otherWait(`document.querySelector('.save-state')?.textContent==='Save failed'`)
      const conflictShown = await otherEvaluate(`document.querySelector('.save-state').title.includes('another tab')`)
      const newerPreserved = await evaluate(`(async()=>{const rows=await window.__libraryRecords();return rows.find(row=>row.id===${JSON.stringify(original.id)}).name==='Primary tab QA'})()`)
      if (!conflictShown || !newerPreserved) throw new Error('Two-tab conflict protection failed')
      await otherEvaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Projects').click()`)
      await otherWait(`Boolean(document.querySelector('[aria-label="Project library"]'))`)
      await otherEvaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Save as new copy').click()`)
      await otherWait(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
      const forked = await evaluate(`(async()=>{const rows=await window.__libraryRecords();return rows.some(row=>row.name==='Secondary unsaved QA — copy'&&row.id!==${JSON.stringify(original.id)})})()`)
      if (!forked) throw new Error('Conflicted work could not be saved as a separate project')
      await send('Target.closeTarget', { targetId: otherTarget })
      checks.push({ check: 'two live tabs reject stale writes and preserve a separate copy', passed: true })
    }
    const before = await evaluate('window.__libraryRecords()')
    await click('Projects')
    await waitFor(`Boolean(document.querySelector('[aria-label="Project library"]'))`)
    await click('Save as new copy')
    await waitFor(`document.querySelector('[aria-label="Project library"]')?.getAttribute('aria-busy')==='false'`)
    const copied = await evaluate('window.__libraryRecords()')
    if (copied.length !== before.length + 1) throw new Error('Save as copy did not preserve the original project')
    checks.push({ check: 'project copy preserves existing work', projects: copied.length })
    const downloads = path.join(path.dirname(output), `library-downloads-${Date.now()}`)
    fs.mkdirSync(downloads, { recursive: true })
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
    await click('Export full backup')
    let backupPath
    for (let i = 0; i < 300; i++) {
      const file = fs.readdirSync(downloads).find(file => file.endsWith('.zip'))
      if (file) { backupPath = path.join(downloads, file); break }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!backupPath) throw new Error('Library backup download did not finish')
    const archive = await JSZip.loadAsync(fs.readFileSync(backupPath))
    const manifest = JSON.parse(await archive.file('library.json').async('string'))
    if (manifest.projects.length !== copied.length) throw new Error('Backup omitted saved projects')
    checks.push({ check: 'full backup download', bytes: fs.statSync(backupPath).size, projects: manifest.projects.length })
    await waitFor(`document.querySelector('[aria-label="Project library"]')?.getAttribute('aria-busy')==='false'`)
    await upload('Choose library backup', backupPath)
    await waitFor(`document.querySelector('.project-library')?.textContent.includes('projects as separate copies.')`, 60_000)
    const restored = await evaluate('window.__libraryRecords()')
    if (restored.length !== copied.length * 2 || !copied.every(record => restored.some(value => value.id === record.id))) throw new Error('Backup restore did not preserve original projects')
    checks.push({ check: 'backup restore adds separate projects', projects: restored.length })
    const png = await evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='#78b9c7';ctx.fillRect(0,0,256,256);return canvas.toDataURL('image/png').split(',')[1]})()`)
    const tileZip = new JSZip()
    tileZip.file('metadata.json', JSON.stringify({ name: 'QA offline basemap', attribution: 'QA generated tiles', minZoom: 0, maxZoom: 0, tileSize: 256, bounds: [-180, -85, 180, 85], format: 'png' }))
    tileZip.file('tiles/0/0/0.png', Buffer.from(png, 'base64'))
    const tilePath = path.join(downloads, 'qa-offline.zip')
    fs.writeFileSync(tilePath, await tileZip.generateAsync({ type: 'nodebuffer' }))
    let offlineName = 'QA offline basemap'
    if (process.argv.includes('--download-area')) {
      await evaluate(`document.querySelector('.offline-area-download').open=true;{const select=document.querySelector('select[aria-label="Offline maximum zoom"]');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}))}`)
      await click('Download and save area')
      await click('Cancel download')
      await waitFor(`document.querySelector('[aria-label="Project library"]')?.getAttribute('aria-busy')==='false'`)
      const cancelled = await evaluate(`document.querySelector('.library-error')?.textContent.includes('cancelled')`)
      if (!cancelled) throw new Error('Area download cancellation did not complete')
      checks.push({ check: 'cancel online area download before storage commit', passed: true })
      await click('Download and save area')
      await waitFor(`document.querySelector('.project-library')?.textContent.includes('Downloaded and saved:')&&document.querySelector('.project-library')?.textContent.includes('NASA Blue Marble')`, 90_000)
      offlineName = 'NASA Blue Marble — saved area'
      checks.push({ check: 'download NASA imagery area', zooms: [0, 1], tiles: 5, passed: true })
    } else {
      await upload('Choose offline tile package', tilePath)
      await waitFor(`document.querySelector('.project-library')?.textContent.includes('Offline basemap ready:')&&document.querySelector('.project-library')?.textContent.includes('QA offline basemap')`)
    }
    const offlineRecord = await evaluate(`(async()=>{const rows=await window.__libraryRecords();return rows.find(row=>row.offline?.name===${JSON.stringify(offlineName)})})()`)
    if (!offlineRecord || !offlineRecord.assets.includes(offlineRecord.offline.assetId)) throw new Error('Offline package was not saved with the project')
    await evaluate(`document.querySelector('button[title="Close project library"]').click()`)
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
    await waitFor(`Boolean(navigator.serviceWorker.controller)`)
    await cdp('Network.enable')
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await cdp('Page.reload')
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`, 60_000)
    await waitFor(`document.querySelectorAll('.layer-name-button').length===${offlineRecord.layers}`)
    checks.push({ check: 'offline reload restores app, project and local basemap', features: offlineRecord.features, passed: true })
    // Hydration precedes worker tile parsing; give the map time to paint restored data.
    await new Promise(resolve => setTimeout(resolve, 2500))
    if (!process.argv.includes('--qa') && !process.argv.includes('--download-area')) {
      const paintExpression = `(()=>{const map=document.querySelector('.maplibregl-canvas');const canvas=document.createElement('canvas');canvas.width=map.width;canvas.height=map.height;const ctx=canvas.getContext('2d');ctx.drawImage(map,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let gold=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180&&pixels[i+1]>100&&pixels[i+1]<240&&pixels[i+2]<220)gold++;window.__paintedGold=gold;return gold>10})()`
      await waitFor(paintExpression, 30_000)
      const paintedFeatures = await evaluate('window.__paintedGold')
      checks.push({ check: 'restored features visibly painted offline', goldPixels: paintedFeatures })
    }
    const screen = await cdp('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(output.replace(/\.json$/, '.library.png'), Buffer.from(screen.data, 'base64'))
    await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    result.library = checks
    console.log(JSON.stringify({ library: checks }))
  }
  if (process.argv.includes('--local-basemap')) {
    const png = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle='#78b9c7';x.fillRect(0,0,256,256);return c.toDataURL('image/png').split(',')[1]})()`)
    const archive = new JSZip()
    archive.file('metadata.json', JSON.stringify({ name: 'QA local basemap', attribution: 'QA generated tiles', minZoom: 0, maxZoom: 0, tileSize: 256, bounds: [-180, -85, 180, 85], format: 'png' }))
    archive.file('tiles/0/0/0.png', Buffer.from(png, 'base64'))
    const file = output.replace(/\.json$/, '.tiles.zip')
    fs.writeFileSync(file, await archive.generateAsync({ type: 'nodebuffer' }))
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Projects').click()`)
    await waitFor(`document.querySelector('.project-library')?.getAttribute('aria-busy')==='false'`)
    const doc = await cdp('DOM.getDocument')
    const input = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[aria-label="Choose offline tile package"]' })
    await cdp('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] })
    await waitFor(`document.querySelector('.project-library')?.getAttribute('aria-busy')==='false'&&document.querySelector('.project-library')?.textContent.includes('QA local basemap')`)
    await evaluate(`document.querySelector('.project-library .modal-header button').click()`)
    await waitFor(`document.querySelector('.save-state')?.textContent==='Saved locally'`)
  }
  if (process.argv.includes('--saved-project')) await new Promise(resolve => setTimeout(resolve, 1500))
  if (process.argv.includes('--library') || process.argv.includes('--memory') || process.argv.includes('--saved-project')) {
    result.persisted = await evaluate(persistedExpression)
    result.renderCaches = await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('arcweb-library-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const rows=await new Promise((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();return rows.filter(row=>row&&row.blob instanceof Blob&&Array.isArray(row.chunks)).map(row=>({bytes:row.blob.size,chunks:row.chunks.length}))})()`)
    fs.writeFileSync(output.replace(/\.json$/, '.persisted.json'), JSON.stringify(result.persisted, null, 2))
  }
  fs.writeFileSync(output, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ output, fixtureBytes: result.fixtureBytes, tasks: measurements.tasks, stages: measurements.stages, hotFunctions: hotFunctions.slice(0, 8), errors: errors.length }))
  await send('Browser.close')
} finally {
  socket?.close()
  chrome.kill()
  server.close()
}
}
await runBrowser()
