/* SceneMaker Phase 0 gate (b): engine spine truth tables.
   Run: node suite.cjs
   Pure Node, no browser. Asserts the spec-66 engine contract: interpolation,
   sparse state stacking, per-channel independence, interruption/retargeting
   (continuity, never snap), toggle semantics, timeline eval + play-state,
   timeline/state channel stealing, pointer bindings, and determinism
   (pure resolve == incremental session, same inputs = same outputs). */

let pass = 0; let fail = 0
function check (name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name) } else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')) }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps
const nearV = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => near(v, b[i], eps))

async function main () {
  const E = await import('./engine/resolver.mjs')
  const { EASINGS, applyEasing, lerpValue, resolve, createSession } = E

  console.log('[1] Easings: the MotionMaker 17, endpoints exact')
  const names = Object.keys(EASINGS)
  check('17 easings present', names.length === 17, names.length)
  let endpointsOk = true
  for (const n of names) {
    if (!near(EASINGS[n](0), 0, 1e-6) || !near(EASINGS[n](1), 1, 1e-6)) { endpointsOk = false; console.log('    bad endpoints: ' + n) }
  }
  check('every easing maps 0->0 and 1->1', endpointsOk)
  check('unknown easing falls back to linear', near(applyEasing(0.37, 'nope'), 0.37))

  console.log('[2] Value interpolation')
  check('numbers lerp', near(lerpValue(2, 6, 0.25), 3))
  check('vectors lerp componentwise', nearV(lerpValue([0, 10, -4], [10, 20, 4], 0.5), [5, 15, 0]))
  check('hex colors lerp in RGB', lerpValue('#000000', '#ff0000', 0.5) === '#800000')
  check('booleans snap to target', lerpValue(false, true, 0.01) === true)

  // ------------------------------------------------------------------ fixtures
  const doc = () => ({
    objects: [
      {
        id: 'btn', type: 'cylinder',
        transform: { p: [0, 1, 0], r: [0, 0, 0], s: [1, 1, 1] },
        material: { color: '#ff5470', emissiveIntensity: 0 },
        states: {
          Pressed: { 'transform.p': [0, 0.5, 0], 'material.color': '#803040' },
          Glow: { 'material.emissiveIntensity': 2 }
        }
      },
      { id: 'rock', type: 'box', transform: { p: [3, 0, 0] }, material: { color: '#888888' } }
    ],
    events: [
      { trigger: 'click', target: 'btn', action: 'toggle', states: ['Base', 'Pressed'], duration: 1, easing: 'linear' },
      { trigger: 'hoverenter', target: 'btn', action: 'state', state: 'Glow', duration: 1, easing: 'linear' },
      { trigger: 'hoverexit', target: 'btn', action: 'state', state: 'Base', duration: 1, easing: 'linear' }
    ],
    timelines: [],
    bindings: []
  })

  console.log('[3] Base resolution, no events')
  let r = resolve(doc(), [], 0)
  check('base transform', nearV(r.btn['transform.p'], [0, 1, 0]))
  check('base color', r.btn['material.color'] === '#ff5470')
  check('untouched object present', nearV(r.rock['transform.p'], [3, 0, 0]))

  console.log('[4] State transitions')
  const clickLog = [{ type: 'click', target: 'btn', t: 10 }]
  r = resolve(doc(), clickLog, 10)
  check('at trigger time value = from', nearV(r.btn['transform.p'], [0, 1, 0]))
  r = resolve(doc(), clickLog, 10.5)
  check('midway linear = midpoint', nearV(r.btn['transform.p'], [0, 0.75, 0]))
  check('color transitions too', r.btn['material.color'] !== '#ff5470' && r.btn['material.color'] !== '#803040')
  r = resolve(doc(), clickLog, 11)
  check('at end value = state target', nearV(r.btn['transform.p'], [0, 0.5, 0]) && r.btn['material.color'] === '#803040')
  r = resolve(doc(), clickLog, 99)
  check('holds after end', nearV(r.btn['transform.p'], [0, 0.5, 0]))

  console.log('[5] Sparse override stacking + channel independence')
  r = resolve(doc(), clickLog, 11)
  check('Pressed leaves untouched channels at base', near(r.btn['material.emissiveIntensity'], 0) && nearV(r.btn['transform.s'], [1, 1, 1]))
  // hover (emissiveIntensity) mid-flight of click (position+color): independent channels
  const both = [{ type: 'click', target: 'btn', t: 10 }, { type: 'hoverenter', target: 'btn', t: 10.4 }]
  r = resolve(doc(), both, 10.5)
  check('click channel unaffected by hover', nearV(r.btn['transform.p'], [0, 0.75, 0]))
  check('hover channel animating concurrently', near(r.btn['material.emissiveIntensity'], 0.2, 1e-6))

  console.log('[6] Toggle semantics')
  const twoClicks = [{ type: 'click', target: 'btn', t: 10 }, { type: 'click', target: 'btn', t: 20 }]
  r = resolve(doc(), twoClicks, 21)
  check('even click returns to Base', nearV(r.btn['transform.p'], [0, 1, 0]) && r.btn['material.color'] === '#ff5470')
  const threeClicks = twoClicks.concat([{ type: 'click', target: 'btn', t: 30 }])
  r = resolve(doc(), threeClicks, 31)
  check('odd click is Pressed again', nearV(r.btn['transform.p'], [0, 0.5, 0]))

  console.log('[7] Interruption: retarget from current value, never snap')
  // click at t=10 (1s to Pressed). Second click at t=10.5 interrupts at midpoint.
  const interrupted = [{ type: 'click', target: 'btn', t: 10 }, { type: 'click', target: 'btn', t: 10.5 }]
  const justBefore = resolve(doc(), [interrupted[0]], 10.4999999).btn['transform.p'][1]
  const atInterrupt = resolve(doc(), interrupted, 10.5).btn['transform.p'][1]
  check('continuity across the interrupt (no snap)', near(justBefore, atInterrupt, 1e-5), { justBefore, atInterrupt })
  check('interrupt starts from the midpoint, not the state value', near(atInterrupt, 0.75, 1e-6))
  const after = resolve(doc(), interrupted, 11.5).btn['transform.p'][1]
  check('interrupted transition lands on Base', near(after, 1))
  // hoverexit mid glow-in
  const hoverMid = [{ type: 'hoverenter', target: 'btn', t: 0 }, { type: 'hoverexit', target: 'btn', t: 0.5 }]
  const gBefore = resolve(doc(), [hoverMid[0]], 0.4999999).btn['material.emissiveIntensity']
  const gAt = resolve(doc(), hoverMid, 0.5).btn['material.emissiveIntensity']
  check('hoverexit mid-transition is continuous', near(gBefore, gAt, 1e-5))
  check('glow returns to 0', near(resolve(doc(), hoverMid, 1.5).btn['material.emissiveIntensity'], 0))

  console.log('[8] Instant transitions (duration 0)')
  const d0 = doc(); d0.events[0].duration = 0
  r = resolve(d0, clickLog, 10)
  check('duration 0 applies immediately', nearV(r.btn['transform.p'], [0, 0.5, 0]))

  console.log('[9] Timelines: eval, loop, pingpong, once')
  const tdoc = () => ({
    objects: [{ id: 'gem', type: 'box', transform: { p: [0, 1, 0] }, material: {}, states: { Big: { 'transform.s': [2, 2, 2] } } }],
    events: [
      { trigger: 'start', action: 'timeline', op: 'play', timeline: 'bob' },
      { trigger: 'keydown', key: ' ', action: 'timeline', op: 'restart', timeline: 'bob' },
      { trigger: 'click', target: 'gem', action: 'timeline', op: 'pause', timeline: 'bob' },
      { trigger: 'hoverenter', target: 'gem', action: 'state', state: 'Big', duration: 1, easing: 'linear' }
    ],
    timelines: [{
      id: 'bob', object: 'gem', duration: 2, loop: 'loop',
      tracks: [{ channel: 'transform.p', keys: [{ t: 0, v: [0, 1, 0], easing: 'linear' }, { t: 1, v: [0, 2, 0], easing: 'linear' }, { t: 2, v: [0, 1, 0], easing: 'linear' }] }]
    }],
    bindings: []
  })
  const startLog = [{ type: 'start', t: 0 }]
  check('timeline at t=0.5 interpolates', near(resolve(tdoc(), startLog, 0.5).gem['transform.p'][1], 1.5))
  check('timeline at t=1 hits key', near(resolve(tdoc(), startLog, 1).gem['transform.p'][1], 2))
  check('loop wraps: t=2.5 == t=0.5', near(resolve(tdoc(), startLog, 2.5).gem['transform.p'][1], 1.5))
  const pp = tdoc(); pp.timelines[0].loop = 'pingpong'; pp.timelines[0].tracks[0].keys.pop(); pp.timelines[0].duration = 1
  check('pingpong reflects: t=1.25 == t=0.75', near(resolve(pp, startLog, 1.25).gem['transform.p'][1], resolve(pp, startLog, 0.75).gem['transform.p'][1]))
  const once = tdoc(); once.timelines[0].loop = 'once'
  check('once clamps and holds at the last key', near(resolve(once, startLog, 50).gem['transform.p'][1], 1))

  console.log('[10] Timeline play-state: pause freezes, play resumes, restart zeroes')
  const pauseLog = [{ type: 'start', t: 0 }, { type: 'click', target: 'gem', t: 0.5 }]
  check('paused value frozen at pause point', near(resolve(tdoc(), pauseLog, 5).gem['transform.p'][1], 1.5))
  const restartLog = pauseLog.concat([{ type: 'keydown', key: ' ', t: 10 }])
  check('restart zeroes local time', near(resolve(tdoc(), restartLog, 10).gem['transform.p'][1], 1))
  check('restart then plays', near(resolve(tdoc(), restartLog, 10.5).gem['transform.p'][1], 1.5))

  console.log('[11] States steal channels from timelines (and restart re-takes)')
  const sdoc = tdoc()
  sdoc.objects[0].states.Down = { 'transform.p': [0, 0, 0] }
  sdoc.events.push({ trigger: 'keydown', key: 'd', object: 'gem', action: 'state', state: 'Down', duration: 1, easing: 'linear' })
  const stealLog = [{ type: 'start', t: 0 }, { type: 'keydown', key: 'd', t: 0.5 }]
  const tlValueAtSteal = 1.5 // timeline value at t=0.5
  const vAtSteal = resolve(sdoc, stealLog, 0.5).gem['transform.p'][1]
  check('steal is continuous: from = timeline value at trigger', near(vAtSteal, tlValueAtSteal))
  check('state wins the channel after steal', near(resolve(sdoc, stealLog, 1.5).gem['transform.p'][1], 0))
  const retakeLog = stealLog.concat([{ type: 'keydown', key: ' ', t: 5 }])
  check('timeline restart re-takes the channel', near(resolve(sdoc, retakeLog, 5.5).gem['transform.p'][1], 1.5))

  console.log('[12] Pointer bindings: follow + lookAt, latest sample wins')
  const bdoc = () => ({
    objects: [
      { id: 'eye', type: 'sphere', transform: { p: [0, 2, 0] }, material: {} },
      { id: 'head', type: 'sphere', transform: { p: [0, 2, 0], r: [0, 0, 0] }, material: {} }
    ],
    events: [],
    timelines: [],
    bindings: [
      { type: 'follow', object: 'eye', channel: 'transform.p', map: { x: [-0.1, 0.1], y: [-0.06, 0.06] } },
      { type: 'lookAt', object: 'head', maxYaw: 0.5, maxPitch: 0.3 }
    ]
  })
  r = resolve(bdoc(), [{ type: 'pointer', x: 1, y: 0, t: 1 }], 2)
  check('follow: pointer right pushes eye +x by map max', near(r.eye['transform.p'][0], 0.1))
  check('lookAt: pointer right yaws head +maxYaw', near(r.head['transform.r'][1], 0.5))
  r = resolve(bdoc(), [{ type: 'pointer', x: 1, y: 0, t: 1 }, { type: 'pointer', x: -1, y: 1, t: 2 }], 3)
  check('latest pointer sample wins', near(r.eye['transform.p'][0], -0.1) && near(r.eye['transform.p'][1], 2.06))
  check('lookAt: pointer up pitches head up (negative rx)', near(r.head['transform.r'][0], -0.3))
  r = resolve(bdoc(), [], 1)
  check('no pointer yet: bindings at rest', near(r.eye['transform.p'][0], 0) && near(r.head['transform.r'][1], 0))

  console.log('[13] Determinism and the session/resolve parity guarantee')
  const busyLog = [
    { type: 'start', t: 0 }, { type: 'pointer', x: 0.5, y: -0.2, t: 0.2 },
    { type: 'click', target: 'btn', t: 10 }, { type: 'hoverenter', target: 'btn', t: 10.4 },
    { type: 'click', target: 'btn', t: 10.5 }, { type: 'hoverexit', target: 'btn', t: 10.9 }
  ]
  const a = JSON.stringify(resolve(doc(), busyLog, 10.7))
  const b = JSON.stringify(resolve(doc(), busyLog, 10.7))
  check('same doc + log + t = identical output', a === b)
  const s = createSession(doc())
  for (const ev of busyLog.filter(e => e.t <= 10.7)) s.push(ev)
  check('incremental session == pure resolve (the parity contract)', JSON.stringify(s.sample(10.7)) === a)
  const t1then2 = JSON.stringify(resolve(doc(), busyLog, 10.7))
  resolve(doc(), busyLog, 99) // query far future first on a fresh doc
  check('no hidden state: query order irrelevant', JSON.stringify(resolve(doc(), busyLog, 10.7)) === t1then2)
  const shuffled = busyLog.slice().reverse()
  check('resolve sorts an unordered log', JSON.stringify(resolve(doc(), shuffled, 10.7)) === a)
  let threw = false
  try { const s2 = createSession(doc()); s2.push({ type: 'click', target: 'btn', t: 5 }); s2.push({ type: 'click', target: 'btn', t: 1 }) } catch (e) { threw = true }
  check('session rejects out-of-order pushes', threw)

  console.log('')
  console.log(pass + '/' + (pass + fail) + ' green')
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
