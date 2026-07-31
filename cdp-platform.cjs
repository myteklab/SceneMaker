/* Platform-flow E2E: real /create page, authenticated save/load through the
 * real adapter and bridge, dirty tracking, preview.
 * Usage: php mint-token.php > /tmp/sm-tok.json
 *        sudo systemd-run --scope -p MemoryMax=3G node cdp-platform.cjs /tmp/sm-tok.json [scenemaker--dev]
 * Access tokens live 15 minutes: mint immediately before running. */
const CDP = require('/var/www/html/mytekdev/spike-mesh2motion/mesh2motion-app/node_modules/chrome-remote-interface')
const { spawn } = require('child_process')
const fs = require('fs')
const PORT = 9329
const TOK = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/sm-tok.json', 'utf8'))
const APP = process.argv[3] || 'scenemaker--dev'
const BASE = 'https://mytekdev.com'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0; let fail = 0
function check (name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name) } else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 200) : '')) }
}

async function main () {
  const chrome = spawn('chromium-browser', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors',
    '--remote-debugging-port=' + PORT, '--window-size=1280,800', '--user-data-dir=/tmp/cdp-prof-smplat-' + process.pid], { stdio: 'ignore' })
  await sleep(1500)
  let client
  for (let i = 0; i < 40; i++) { try { client = await CDP({ port: PORT }); break } catch (e) { await sleep(750) } }
  if (!client) { console.error('no chromium'); chrome.kill(); process.exit(1) }
  try {
    const { Page, Runtime, Network } = client
    await Promise.all([Page.enable(), Runtime.enable(), Network.enable()])
    const ev = async expr => (await Runtime.evaluate({ returnByValue: true, expression: expr, awaitPromise: true })).result.value
    await Network.setCookie({ name: 'has_session', value: '1', domain: 'mytekdev.com', path: '/', sameSite: 'Lax' })
    await Page.addScriptToEvaluateOnNewDocument({ source: `
      try {
        localStorage.setItem('auth_tokens', JSON.stringify({ access_token: ${JSON.stringify(TOK.access_token)}, token_type: 'Bearer' }));
        localStorage.setItem('auth_user', JSON.stringify(${JSON.stringify(TOK.user)}));
      } catch (e) {}
    ` })

    console.log('[1] Boot the real create page')
    await Page.navigate({ url: BASE + '/create?app=' + APP })
    await sleep(15000)
    const boot = JSON.parse(await ev(`(function(){
      var f = document.getElementById('app-frame');
      var w = f && f.contentWindow;
      return JSON.stringify({
        frame: !!f,
        app: !!(w && w.SceneMakerApp),
        adapter: !!(w && w.__smAdapter),
        objects: (w && w.SceneMakerApp) ? w.SceneMakerApp.state().objects.length : null,
        projectId: (typeof currentProject !== 'undefined' && currentProject) ? currentProject.id : null
      });
    })()`))
    check('app iframe booted, SceneMakerApp up', boot.frame && boot.app, boot)
    check('adapter installed', boot.adapter)
    check('project created/loaded (' + boot.projectId + ')', !!boot.projectId)
    check('starter scene present', boot.objects >= 1, boot.objects)

    console.log('[2] Edit -> dirty -> save -> clean')
    await ev(`(function(){ var w = document.getElementById('app-frame').contentWindow;
      w.SceneMakerApp.actions.addPrimitive('torus');
      w.SceneMakerApp.actions.setEnvironment({ preset: 'sunset' }); })()`)
    await sleep(800)
    check('edit marks platform unsaved', await ev('typeof hasUnsavedChanges !== "undefined" ? hasUnsavedChanges : null') === true)
    await ev(`(function(){ var w = document.getElementById('app-frame').contentWindow;
      w.dispatchEvent(new CustomEvent('platform:requestSave')); })()`)
    await sleep(4000)
    check('save marks clean', await ev('hasUnsavedChanges') === false)
    const pid = boot.projectId

    console.log('[3] Reload the project: the edit must come back')
    await Page.navigate({ url: BASE + '/create?app=' + APP + '&project=' + pid })
    await sleep(15000)
    const round = JSON.parse(await ev(`(function(){
      var w = document.getElementById('app-frame').contentWindow;
      var st = w && w.SceneMakerApp ? w.SceneMakerApp.state() : null;
      return JSON.stringify({
        objects: st ? st.objects.length : null,
        names: st ? st.objects.map(function(o){return o.type}) : null,
        env: st ? st.environment : null,
        dirty: (typeof hasUnsavedChanges !== 'undefined') ? hasUnsavedChanges : null
      });
    })()`))
    check('saved torus survives reload', round.objects === 2 && round.names.indexOf('torus') !== -1, round)
    check('saved environment survives reload', round.env === 'sunset', round.env)
    check('fresh load is NOT dirty', round.dirty === false)

    console.log('[4] Preview through the real adapter path')
    const prev = JSON.parse(await ev(`(function(){
      var w = document.getElementById('app-frame').contentWindow;
      var got = null, orig = w.Platform.sendPreview;
      w.Platform.sendPreview = function (d) { got = d; try { orig.apply(w.Platform, arguments); } catch (e) {} };
      w.dispatchEvent(new CustomEvent('platform:requestPreview'));
      return JSON.stringify({ isPng: typeof got === 'string' && got.indexOf('data:image/png') === 0, len: got ? got.length : 0 });
    })()`))
    check('preview generated (' + prev.len + ' chars)', prev.isPng && prev.len > 5000, prev)
  } finally {
    try { await client.close() } catch (e) {}
    chrome.kill()
  }
  console.log('')
  console.log(pass + '/' + (pass + fail) + ' green')
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
