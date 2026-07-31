/* SceneMaker editor smoke: standalone (no platform), real browser.
   Run: node cdp-editor.cjs [url]
   Drives SceneMakerApp.actions through the Phase 1 editor loop: add shapes,
   select, transform, finishes, environment, duplicate/delete, undo/redo,
   rename, doc roundtrip, garbage tolerance, preview capture. */
const CDP = require('/var/www/html/mytekdev/spike-mesh2motion/mesh2motion-app/node_modules/chrome-remote-interface')
const { spawn } = require('child_process')
const BASE = process.argv[2] || 'https://mytekdev.com/apps/scenemaker--dev/index.html'
const PORT = 9327
let pass = 0; let fail = 0
function check (name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name) } else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 200) : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main () {
  const chrome = spawn('chromium-browser', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors',
    '--remote-debugging-port=' + PORT, '--window-size=1280,800', '--user-data-dir=/tmp/cdp-prof-sme-' + process.pid], { stdio: 'ignore' })
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
    const S = async () => JSON.parse(await ev('JSON.stringify(SceneMakerApp.state())'))

    console.log('[1] Boot')
    await Page.navigate({ url: BASE })
    await sleep(8000)
    check('SceneMakerApp exists', await ev('typeof window.SceneMakerApp === "object"'))
    let s = await S()
    check('rendering', s.frames >= 2, s.frames)
    check('starter scene has 1 object', s.objects.length === 1, s.objects)
    check('no exceptions on boot', exceptions.length === 0, exceptions[0])

    console.log('[2] Add + select')
    await ev('SceneMakerApp.actions.addPrimitive("sphere"); SceneMakerApp.actions.addPrimitive("icosahedron")')
    s = await S()
    check('3 objects after two adds', s.objects.length === 3, s.objects.length)
    check('new object auto-selected', s.selectedId === s.objects[2].id)
    check('auto-naming counts up', s.objects[1].name === 'Ball 1' && s.objects[2].name === 'Gem 1', [s.objects[1].name, s.objects[2].name])
    check('adds mark dirty', s.dirty === true)

    console.log('[3] Transform + material + finish')
    const gemId = s.objects[2].id
    await ev(`SceneMakerApp.actions.setTransform(${JSON.stringify(gemId)}, { p: [1.5, 2, 0] }, true)`)
    let doc = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    check('setTransform lands in doc', doc.objects[2].transform.p[1] === 2, doc.objects[2].transform.p)
    await ev(`SceneMakerApp.actions.setMaterial(${JSON.stringify(gemId)}, { color: "#123456" }, true)`)
    await ev(`SceneMakerApp.actions.applyFinish(${JSON.stringify(gemId)}, "glow", { roughness: 0.5, metalness: 0, emissiveIntensity: 1.2, opacity: 1, flat: false })`)
    doc = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    check('finish applied, color preserved', doc.objects[2].material.finish === 'glow' && doc.objects[2].material.emissiveIntensity === 1.2 && doc.objects[2].material.color === '#123456', doc.objects[2].material)
    check('flat moved to params, not material', doc.objects[2].params.flat === false && !('flat' in doc.objects[2].material))

    console.log('[4] Gizmo modes + snap')
    await ev('SceneMakerApp.actions.setGizmoMode("rotate")')
    s = await S()
    check('gizmo mode rotate', s.gizmoMode === 'rotate')
    await ev('SceneMakerApp.actions.toggleSnap()')
    s = await S()
    check('snap toggles off', s.snap === false)
    await ev('SceneMakerApp.actions.toggleSnap(); SceneMakerApp.actions.setGizmoMode("translate")')

    console.log('[5] Rename + visibility + duplicate + delete')
    await ev(`SceneMakerApp.actions.rename(${JSON.stringify(gemId)}, "Crystal")`)
    await ev(`SceneMakerApp.actions.toggleVisible(${JSON.stringify(gemId)})`)
    doc = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    check('rename + hide land in doc', doc.objects[2].name === 'Crystal' && doc.objects[2].visible === false)
    await ev(`SceneMakerApp.actions.toggleVisible(${JSON.stringify(gemId)})`)
    await ev(`SceneMakerApp.actions.select(${JSON.stringify(gemId)}); SceneMakerApp.actions.duplicateSelected()`)
    s = await S()
    check('duplicate adds a copy', s.objects.length === 4 && s.objects[3].name === 'Crystal copy', s.objects[3])
    await ev('SceneMakerApp.actions.deleteSelected()')
    s = await S()
    check('delete removes the copy', s.objects.length === 3)

    console.log('[6] Undo / redo')
    const before = await S()
    await ev('SceneMakerApp.actions.undo()')
    s = await S()
    check('undo restores the deleted copy', s.objects.length === 4)
    await ev('SceneMakerApp.actions.redo()')
    s = await S()
    check('redo removes it again', s.objects.length === 3)
    let n = 0
    while (n < 30) {
      const len = (await S()).objects.length
      const depth = JSON.parse(await ev('JSON.stringify({d: SceneMakerApp.state().undoDepth})')).d
      if (depth === 0) break
      await ev('SceneMakerApp.actions.undo()')
      n++
    }
    s = await S()
    check('undo chain walks back to the starter scene', s.objects.length === 1 && s.undoDepth === 0, { len: s.objects.length, depth: s.undoDepth, steps: n })
    await ev('SceneMakerApp.actions.redo(); SceneMakerApp.actions.redo()')
    s = await S()
    check('redo replays forward', s.objects.length === 3, s.objects.length)

    console.log('[7] Environment')
    await ev('SceneMakerApp.actions.setEnvironment({ preset: "night" })')
    s = await S()
    check('environment preset applies', s.environment === 'night')

    console.log('[8] Doc roundtrip + garbage tolerance')
    const out = await ev('JSON.stringify(SceneMakerApp.getProjectData())')
    await ev(`SceneMakerApp.loadProjectData(${out})`)
    const out2 = await ev('JSON.stringify(SceneMakerApp.getProjectData())')
    check('save -> load -> save is stable', out === out2)
    s = await S()
    check('fresh load is clean', s.dirty === false)
    await ev('SceneMakerApp.loadProjectData({ bogus: true, objects: [{type:"nope"}, 42, {type:"box", params:{w:2}, transform:{p:[1,1,1]}}] })')
    s = await S()
    check('garbage doc: keeps the one valid object, no throw', s.objects.length === 1, s.objects)
    await ev('SceneMakerApp.newProject()')
    s = await S()
    check('newProject restores the default scene', s.objects.length === 1 && s.dirty === false)

    console.log('[9] Theme')
    const t0 = await ev('JSON.stringify({t: SceneMakerApp.theme(), attr: document.documentElement.dataset.theme})')
    const th0 = JSON.parse(t0)
    check('theme attr matches app theme', th0.t === th0.attr, th0)
    await ev('SceneMakerApp.actions.toggleTheme()')
    let th = JSON.parse(await ev('JSON.stringify({t: SceneMakerApp.theme(), attr: document.documentElement.dataset.theme, stored: localStorage.getItem("scenemaker.theme")})'))
    check('toggle flips theme and persists override', th.t !== th0.t && th.attr === th.t && th.stored === th.t, th)
    await ev('SceneMakerApp.setDefaultTheme("dark")')
    th = JSON.parse(await ev('JSON.stringify({t: SceneMakerApp.theme()})'))
    check('override outranks platform default', th.t === (th0.t === 'dark' ? 'light' : 'dark'), th)
    await ev('localStorage.removeItem("scenemaker.theme"); SceneMakerApp.actions.toggleTheme()') // back to original for cleanliness
    await ev('localStorage.removeItem("scenemaker.theme")')

    console.log('[10] Recipes: author interactions without code')
    await ev('SceneMakerApp.actions.addPrimitive("cylinder")')
    s = await S()
    const btnId = s.selectedId
    await ev(`SceneMakerApp.actions.addRecipe(${JSON.stringify(btnId)}, "press")`)
    await ev(`SceneMakerApp.actions.addRecipe(${JSON.stringify(btnId)}, "spin")`)
    let doc2 = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    check('recipes stored on the doc', doc2.recipes.length === 2, doc2.recipes)
    const pressStates = Object.keys(doc2.objects.find(o => o.id === btnId).states)
    check('press compiles paired states (never Base)', pressStates.length === 2 && pressStates.every(k => k.startsWith('r_')), pressStates)
    check('press compiles a click toggle event', doc2.events.some(e => e.trigger === 'click' && e.target === btnId && e.action === 'toggle'), doc2.events)
    check('spin compiles an autoplay timeline', doc2.timelines.length === 1 && doc2.events.some(e => e.trigger === 'start'), doc2.timelines.length)
    // moving the object re-anchors its compiled interactions
    await ev(`SceneMakerApp.actions.setTransform(${JSON.stringify(btnId)}, { p: [2, 0.5, 2] }, true)`)
    doc2 = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    const upState = doc2.objects.find(o => o.id === btnId).states[Object.keys(doc2.objects.find(o => o.id === btnId).states).find(k => k.endsWith('_up'))]
    check('recompile anchors states to the moved base', upState['transform.p'][0] === 2 && upState['transform.p'][2] === 2, upState)
    await ev(`SceneMakerApp.actions.setRecipeParam(${JSON.stringify(doc2.recipes[0].id)}, "depth", 0.3, true)`)
    doc2 = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    const downState = doc2.objects.find(o => o.id === btnId).states[Object.keys(doc2.objects.find(o => o.id === btnId).states).find(k => k.endsWith('_down'))]
    check('param change recompiles (depth 0.3)', Math.abs(downState['transform.p'][1] - 0.2) < 1e-9, downState)

    console.log('[11] Play mode: the engine runs the scene live')
    await ev('SceneMakerApp.actions.startPlay()')
    s = await S()
    check('playing', s.playing === true)
    await sleep(400)
    let r1 = JSON.parse(await ev('JSON.stringify(SceneMakerApp.play.sampleNow())'))
    await sleep(400)
    let r2 = JSON.parse(await ev('JSON.stringify(SceneMakerApp.play.sampleNow())'))
    check('spin timeline alive in play mode', r1[btnId]['transform.r'][1] !== r2[btnId]['transform.r'][1], { a: r1[btnId]['transform.r'][1], b: r2[btnId]['transform.r'][1] })
    await ev(`SceneMakerApp.play.inject("click", ${JSON.stringify(btnId)})`)
    await sleep(300)
    let rp = JSON.parse(await ev('JSON.stringify(SceneMakerApp.play.sampleNow())'))
    check('click in play presses the button down', Math.abs(rp[btnId]['transform.p'][1] - 0.2) < 0.01, rp[btnId]['transform.p'])
    await ev(`SceneMakerApp.play.inject("click", ${JSON.stringify(btnId)})`)
    await sleep(300)
    rp = JSON.parse(await ev('JSON.stringify(SceneMakerApp.play.sampleNow())'))
    check('second click releases it', Math.abs(rp[btnId]['transform.p'][1] - 0.5) < 0.01, rp[btnId]['transform.p'])
    await ev('SceneMakerApp.actions.stopPlay()')
    s = await S()
    check('stop restores edit mode', s.playing === false)
    await ev('SceneMakerApp.actions.addPrimitive("sphere")')
    s = await S()
    check('editing after play works (auto-stop guard)', s.objects.length === 3 && s.playing === false, s.objects.length)

    console.log('[12] Recipes survive save/load')
    const saved = await ev('JSON.stringify(SceneMakerApp.getProjectData())')
    await ev(`SceneMakerApp.loadProjectData(${saved})`)
    doc2 = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    check('recipes reload (2)', doc2.recipes.length === 2, doc2.recipes.length)
    check('compiled interactions regenerate on load', doc2.events.some(e => e.action === 'toggle') && doc2.timelines.length === 1)

    console.log('[12b] Models by URL')
    const bad = JSON.parse(await ev(`JSON.stringify(SceneMakerApp.actions.addModel('http://insecure.example.com/x.glb'))`))
    check('http URL rejected', bad.ok === false)
    const added = JSON.parse(await ev(`JSON.stringify(SceneMakerApp.actions.addModel('/apps/avatarmaker/assets/models/accessory_duck-floaty.glb'))`))
    check('same-origin glb accepted', added.ok === true, added)
    const mid = added.id
    let loaded = false
    for (let i = 0; i < 30; i++) {
      const st = JSON.parse(await ev(`JSON.stringify(SceneMakerApp.modelStatus(${JSON.stringify(mid)}))`))
      if (st && st.loaded) { loaded = true; break }
      if (st && st.error) break
      await sleep(1000)
    }
    check('GLB loads and swaps in', loaded)
    await ev(`SceneMakerApp.actions.addRecipe(${JSON.stringify(mid)}, "spin")`)
    await ev('SceneMakerApp.actions.startPlay()')
    await sleep(400)
    const m1 = JSON.parse(await ev('JSON.stringify(SceneMakerApp.play.sampleNow())'))
    await sleep(400)
    const m2 = JSON.parse(await ev('JSON.stringify(SceneMakerApp.play.sampleNow())'))
    check('transform recipes drive the model', m1[mid]['transform.r'][1] !== m2[mid]['transform.r'][1])
    await ev('SceneMakerApp.actions.stopPlay()')
    const saved2 = await ev('JSON.stringify(SceneMakerApp.getProjectData())')
    await ev(`SceneMakerApp.loadProjectData(${saved2})`)
    let d3 = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    check('model survives save/load', d3.objects.some(o => o.type === 'model'), d3.objects.map(o => o.type))
    await ev(`SceneMakerApp.loadProjectData({ objects: [{ type: 'model', params: { url: 'javascript:alert(1)' } }] })`)
    d3 = JSON.parse(await ev('JSON.stringify(SceneMakerApp._doc())'))
    check('malicious model URL normalized out', d3.objects.length === 0, d3.objects)
    const dead = JSON.parse(await ev(`JSON.stringify(SceneMakerApp.actions.addModel('/apps/scenemaker--dev/nope.glb'))`))
    await sleep(2500)
    const deadSt = JSON.parse(await ev(`JSON.stringify(SceneMakerApp.modelStatus(${JSON.stringify(dead.id)}))`))
    check('404 model reports an error, no crash', deadSt && !deadSt.loaded && !!deadSt.error, deadSt)

    console.log('[13] Preview capture')
    const prev = await ev('(function(){ var d = SceneMakerApp.previewDataUrl(); return JSON.stringify({ png: d.indexOf("data:image/png") === 0, len: d.length }) })()')
    const p = JSON.parse(prev)
    check('preview is a real png (' + p.len + ' chars)', p.png && p.len > 5000, p)

    check('no exceptions across the whole run', exceptions.length === 0, exceptions[0])
  } finally {
    try { await client.close() } catch (e) {}
    chrome.kill()
  }
  console.log('')
  console.log(pass + '/' + (pass + fail) + ' green')
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
