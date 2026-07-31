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

    console.log('[9] Preview capture')
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
