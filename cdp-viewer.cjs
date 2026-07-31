/* SceneMaker viewer smoke: standalone preview.html, real browser.
   Run: sudo systemd-run --scope -p MemoryMax=3G node cdp-viewer.cjs [url]
   Loads a doc through the platform LOAD_PREVIEW protocol, then proves the
   scene is ALIVE: autoplay timelines advance, clicks press, cursor bindings
   track, all via the same engine the editor plays. */
const CDP = require('/var/www/html/mytekdev/spike-mesh2motion/mesh2motion-app/node_modules/chrome-remote-interface')
const { spawn } = require('child_process')
const fs = require('fs')
const BASE = process.argv[2] || 'https://mytekdev.com/apps/scenemaker--dev/preview.html'
const SHOT = '/tmp/claude-0/-var-www-html-mytekdev/022a5437-256d-4ef8-94aa-1e1f3888c570/scratchpad/viewer-look.png'
const PORT = 9333
let pass = 0; let fail = 0
function check (name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name) } else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 200) : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// A student-shaped doc: only objects + recipes; the viewer's normalizeDoc
// recompiles the interaction arrays itself.
const DOC = {
  v: 1,
  environment: { preset: 'meadow', ground: { visible: true }, fog: true },
  camera: { position: [4, 2.8, 5.5], target: [0, 0.8, 0], autoOrbit: 0 },
  objects: [
    { id: 'btn', name: 'Button', type: 'cylinder', params: { radius: 0.4, height: 0.3, segments: 48 },
      transform: { p: [0, 0.15, 1], r: [0, 0, 0], s: [1, 1, 1] },
      material: { color: '#ff5470', finish: 'glossy', roughness: 0.18, metalness: 0, emissiveIntensity: 0.08, opacity: 1 } },
    { id: 'gem', name: 'Gem', type: 'icosahedron', params: { radius: 0.5, detail: 0, flat: true },
      transform: { p: [-1.4, 1.2, 0], r: [0, 0, 0], s: [1, 1, 1] },
      material: { color: '#4ecdc4', finish: 'gem', roughness: 0.15, metalness: 0.1, emissiveIntensity: 0.25, opacity: 1 } },
    { id: 'duck', name: 'Duck', type: 'model', params: { url: '/apps/avatarmaker/assets/models/accessory_duck-floaty.glb', fit: 1.2 },
      transform: { p: [0, 0, -1.6], r: [0, 0, 0], s: [1, 1, 1] } },
    { id: 'head', name: 'Buddy', type: 'sphere', params: { radius: 0.45 },
      transform: { p: [1.4, 0.9, 0], r: [0, 0, 0], s: [1, 1, 1] },
      material: { color: '#ffd166', finish: 'clay', roughness: 0.8, metalness: 0, emissiveIntensity: 0, opacity: 1 } }
  ],
  recipes: [
    { id: 'rc_t_1', object: 'btn', type: 'press', params: { depth: 0.1 } },
    { id: 'rc_t_2', object: 'gem', type: 'spin', params: { secs: 4 } },
    { id: 'rc_t_3', object: 'gem', type: 'hoverGlow', params: { glow: 1.5 } },
    { id: 'rc_t_4', object: 'head', type: 'watchCursor', params: { amount: 0.6 } },
    { id: 'rc_t_5', object: 'head', type: 'jumpKey', params: { height: 1, pressKey: ' ' } },
    { id: 'rc_t_6', object: 'duck', type: 'spin', params: { secs: 5 } }
  ]
}

async function main () {
  const chrome = spawn('chromium-browser', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors',
    '--remote-debugging-port=' + PORT, '--window-size=1000,640', '--user-data-dir=/tmp/cdp-prof-smv-' + process.pid], { stdio: 'ignore' })
  await sleep(1500)
  let client
  for (let i = 0; i < 40; i++) { try { client = await CDP({ port: PORT }); break } catch (e) { await sleep(750) } }
  if (!client) { console.error('no chromium'); chrome.kill(); process.exit(1) }
  try {
    const { Page, Runtime } = client
    await Promise.all([Page.enable(), Runtime.enable()])
    const exceptions = []
    Runtime.exceptionThrown(p => exceptions.push((p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text).slice(0, 200)))
    const ev = async expr => (await Runtime.evaluate({ returnByValue: true, expression: expr })).result.value

    console.log('[1] Boot + platform protocol')
    await Page.navigate({ url: BASE })
    await sleep(8000)
    check('__smv exists', await ev('typeof window.__smv === "object"'))
    check('not loaded before LOAD_PREVIEW', JSON.parse(await ev('JSON.stringify(window.__smv.state())')).loaded === false)
    await ev(`window.postMessage({ type: 'LOAD_PREVIEW', data: ${JSON.stringify(DOC)} }, '*')`)
    await sleep(1500)
    let s = JSON.parse(await ev('JSON.stringify(window.__smv.state())'))
    check('doc loaded through the protocol', s.loaded === true && s.objects === 4, s)
    check('frames advancing', s.frames >= 2, s.frames)
    check('interaction hint shown', await ev('document.getElementById("viewer-hint").style.display !== "none"'))
    check('no exceptions on boot/load', exceptions.length === 0 && s.errors.length === 0, exceptions[0] || s.errors[0])

    console.log('[2] The scene is ALIVE')
    const r1 = JSON.parse(await ev('JSON.stringify(window.__smv.sampleNow())'))
    await sleep(500)
    const r2 = JSON.parse(await ev('JSON.stringify(window.__smv.sampleNow())'))
    check('gem spins on its own', r1.gem['transform.r'][1] !== r2.gem['transform.r'][1])
    await ev('window.__smv.inject("click", "btn")')
    await sleep(300)
    let rp = JSON.parse(await ev('JSON.stringify(window.__smv.sampleNow())'))
    check('visitor click presses the button', Math.abs(rp.btn['transform.p'][1] - 0.05) < 0.01, rp.btn['transform.p'])
    await ev('window.__smv.inject("hoverenter", "gem")')
    await sleep(300)
    rp = JSON.parse(await ev('JSON.stringify(window.__smv.sampleNow())'))
    check('hover lights the gem', Math.abs(rp.gem['material.emissiveIntensity'] - 1.5) < 0.01, rp.gem['material.emissiveIntensity'])
    await ev('window.__smv.inject("pointer", null, null, 1, 0)')
    await sleep(150)
    rp = JSON.parse(await ev('JSON.stringify(window.__smv.sampleNow())'))
    check('buddy watches the cursor', rp.head['transform.r'][1] > 0.4, rp.head['transform.r'])
    await ev('window.__smv.inject("keydown", null, " ")')
    await sleep(380)
    rp = JSON.parse(await ev('JSON.stringify(window.__smv.sampleNow())'))
    check('Space makes the buddy jump', rp.head['transform.p'][1] > 1.2, rp.head['transform.p'])

    console.log('[2b] Model by URL in the viewer')
    let mOk = false
    for (let i = 0; i < 20; i++) {
      const st = JSON.parse(await ev('JSON.stringify(window.__smv.state())'))
      if (st.modelsLoaded === 1) { mOk = true; break }
      await sleep(1000)
    }
    check('GLB model loads on the share-page viewer', mOk)
    const d1 = JSON.parse(await ev('JSON.stringify(window.__smv.sampleNow())'))
    await sleep(400)
    const d2 = JSON.parse(await ev('JSON.stringify(window.__smv.sampleNow())'))
    check('model spins via its recipe', d1.duck['transform.r'][1] !== d2.duck['transform.r'][1])

    console.log('[3] Screenshot')
    await sleep(600)
    const shot = await Page.captureScreenshot({ format: 'png' })
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
    check('screenshot saved', fs.statSync(SHOT).size > 10000)
    check('no exceptions across the run', exceptions.length === 0, exceptions[0])
  } finally {
    try { await client.close() } catch (e) {}
    chrome.kill()
  }
  console.log('')
  console.log(pass + '/' + (pass + fail) + ' green')
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
