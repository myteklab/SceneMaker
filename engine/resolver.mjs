/* SceneMaker Phase 0: the engine spine.
   Pure module: no DOM, no Three.js. Runs identically in Node (suite.cjs) and
   the browser (js/main.mjs). This file IS the spec-66 contract:
     resolve(doc, eventLog, t) -> { objectId: { channelPath: value } }
   plus the incremental form the renderer uses:
     createSession(doc) -> { push(ev), sample(t) }
   with the guarantee (asserted by the suite) that a session fed the same
   events produces byte-identical output to the pure resolve(). */

// ---------------------------------------------------------------------------
// Easings: imported wholesale from MotionMaker (same 17, same names).
// ---------------------------------------------------------------------------
export const EASINGS = {
  linear: t => t,
  easeInQuad: t => t * t,
  easeOutQuad: t => t * (2 - t),
  easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: t => t * t * t,
  easeOutCubic: t => (--t) * t * t + 1,
  easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInQuart: t => t * t * t * t,
  easeOutQuart: t => 1 - (--t) * t * t * t,
  easeInOutQuart: t => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
  easeInBack: t => { const c1 = 1.70158; const c3 = c1 + 1; return c3 * t * t * t - c1 * t * t },
  easeOutBack: t => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2) },
  easeInOutBack: t => {
    const c1 = 1.70158; const c2 = c1 * 1.525
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
  },
  easeInElastic: t => {
    const c4 = (2 * Math.PI) / 3
    return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)
  },
  easeOutElastic: t => {
    const c4 = (2 * Math.PI) / 3
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  },
  easeInOutElastic: t => {
    const c5 = (2 * Math.PI) / 4.5
    return t === 0 ? 0 : t === 1 ? 1 : t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1
  },
  easeOutBounce: t => {
    const n1 = 7.5625; const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    else if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    else if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    else return n1 * (t -= 2.625 / d1) * t + 0.984375
  }
}

export function applyEasing (k, name) {
  const f = EASINGS[name] || EASINGS.linear
  return f(k)
}

// ---------------------------------------------------------------------------
// Values: numbers, [x,y,z] vectors, '#rrggbb' colors, booleans.
// ---------------------------------------------------------------------------
const lerpNum = (a, b, k) => a + (b - a) * k

function hexToRgb (hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0]
}

function rgbToHex (r, g, b) {
  return '#' + [r, g, b].map(x => {
    const h = Math.max(0, Math.min(255, Math.round(x))).toString(16)
    return h.length === 1 ? '0' + h : h
  }).join('')
}

export function lerpValue (a, b, k) {
  if (typeof a === 'number' && typeof b === 'number') return lerpNum(a, b, k)
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => lerpNum(v, b[i], k))
  if (typeof a === 'string' && typeof b === 'string' && a[0] === '#' && b[0] === '#') {
    const ca = hexToRgb(a); const cb = hexToRgb(b)
    return rgbToHex(lerpNum(ca[0], cb[0], k), lerpNum(ca[1], cb[1], k), lerpNum(ca[2], cb[2], k))
  }
  // Booleans and anything non-interpolable snap at the start of a transition.
  return b
}

// ---------------------------------------------------------------------------
// Doc helpers.
// ---------------------------------------------------------------------------
// Base channels are the flattened animatable properties of an object.
export function baseChannels (obj) {
  const ch = {}
  const tr = obj.transform || {}
  ch['transform.p'] = (tr.p || [0, 0, 0]).slice()
  ch['transform.r'] = (tr.r || [0, 0, 0]).slice()
  ch['transform.s'] = (tr.s || [1, 1, 1]).slice()
  const m = obj.material || {}
  if (m.color !== undefined) ch['material.color'] = m.color
  if (m.emissive !== undefined) ch['material.emissive'] = m.emissive
  if (m.emissiveIntensity !== undefined) ch['material.emissiveIntensity'] = m.emissiveIntensity
  if (m.roughness !== undefined) ch['material.roughness'] = m.roughness
  if (m.metalness !== undefined) ch['material.metalness'] = m.metalness
  if (m.opacity !== undefined) ch['material.opacity'] = m.opacity
  if (obj.visible !== undefined) ch.visible = obj.visible
  return ch
}

function stateChannels (obj, stateName, base) {
  if (stateName === 'Base') return null // caller resolves against base + union
  return (obj.states && obj.states[stateName]) || {}
}

// Union of every channel any state of the object touches. Transitioning to
// 'Base' means returning all of these to their base values.
function statesUnion (obj) {
  const set = new Set()
  for (const name of Object.keys(obj.states || {})) {
    for (const ch of Object.keys(obj.states[name])) set.add(ch)
  }
  return set
}

// ---------------------------------------------------------------------------
// Timeline evaluation.
// ---------------------------------------------------------------------------
function evalTrack (track, tl) {
  const keys = track.keys
  if (!keys.length) return undefined
  if (tl <= keys[0].t) return keys[0].v
  if (tl >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]; const b = keys[i + 1]
    if (a.t <= tl && b.t >= tl) {
      const k = (tl - a.t) / (b.t - a.t)
      return lerpValue(a.v, b.v, applyEasing(k, a.easing || 'linear'))
    }
  }
  return keys[keys.length - 1].v
}

// Local timeline time given its play-state and global t.
function timelineLocal (tlState, def, t) {
  let local
  if (tlState.mode === 'playing') local = tlState.offset + (t - tlState.startT)
  else local = tlState.offset // paused or stopped: frozen
  const d = def.duration
  const loop = def.loop || 'once'
  if (loop === 'once') return Math.min(local, d)
  if (loop === 'loop') return ((local % d) + d) % d
  if (loop === 'pingpong') {
    const cycle = Math.floor(local / d)
    const frac = ((local % d) + d) % d
    return cycle % 2 === 1 ? d - frac : frac
  }
  return Math.min(local, d)
}

// ---------------------------------------------------------------------------
// The session: incremental engine. push() events in time order, sample(t).
// ---------------------------------------------------------------------------
export function createSession (doc) {
  const objects = {}
  for (const o of doc.objects || []) objects[o.id] = o

  // writers: objId -> channel -> writer
  //   {kind:'const', value}
  //   {kind:'transition', from, to, start, dur, easing}
  //   {kind:'timeline', id, track}
  const writers = {}
  for (const id of Object.keys(objects)) {
    writers[id] = {}
    const base = baseChannels(objects[id])
    for (const ch of Object.keys(base)) writers[id][ch] = { kind: 'const', value: base[ch] }
  }

  // timeline play state
  const tls = {}
  for (const tl of doc.timelines || []) {
    tls[tl.id] = { mode: 'stopped', startT: 0, offset: 0 }
  }

  const toggles = {} // event definition index -> fire count
  let pointer = { x: 0, y: 0 }
  let lastT = -Infinity

  function writerValue (objId, ch, t) {
    const w = writers[objId] && writers[objId][ch]
    if (!w) return undefined
    if (w.kind === 'const') return w.value
    if (w.kind === 'transition') {
      if (t <= w.start) return w.from
      const k = Math.min(1, (t - w.start) / w.dur)
      if (typeof w.from === 'boolean' || typeof w.to === 'boolean') return w.to // snap at start
      return lerpValue(w.from, w.to, applyEasing(k, w.easing))
    }
    if (w.kind === 'timeline') {
      const def = (doc.timelines || []).find(x => x.id === w.id)
      const st = tls[w.id]
      return evalTrack(w.track, timelineLocal(st, def, t))
    }
    return undefined
  }

  function startTransition (objId, ch, to, t, dur, easing) {
    const from = writerValue(objId, ch, t)
    if (dur > 0) writers[objId][ch] = { kind: 'transition', from, to, start: t, dur, easing: easing || 'linear' }
    else writers[objId][ch] = { kind: 'const', value: to }
  }

  function transitionToState (objId, stateName, t, dur, easing) {
    const obj = objects[objId]
    if (!obj) return
    const base = baseChannels(obj)
    if (stateName === 'Base') {
      for (const ch of statesUnion(obj)) startTransition(objId, ch, base[ch], t, dur, easing)
    } else {
      const st = stateChannels(obj, stateName, base) || {}
      for (const ch of Object.keys(st)) startTransition(objId, ch, st[ch], t, dur, easing)
    }
  }

  function timelineOp (op, tlId, t) {
    const def = (doc.timelines || []).find(x => x.id === tlId)
    const st = tls[tlId]
    if (!def || !st) return
    if (op === 'play') {
      if (st.mode === 'playing') return
      st.mode = 'playing'; st.startT = t // resume from offset
    } else if (op === 'restart') {
      st.mode = 'playing'; st.startT = t; st.offset = 0
    } else if (op === 'pause') {
      if (st.mode === 'playing') { st.offset = st.offset + (t - st.startT); st.mode = 'paused' }
    } else if (op === 'stop') {
      st.mode = 'stopped'; st.offset = 0
    }
    if (op === 'play' || op === 'restart') {
      // Timeline takes ownership of its tracks' channels.
      for (const track of def.tracks) {
        writers[def.object][track.channel] = { kind: 'timeline', id: tlId, track }
      }
    }
  }

  function matches (def, ev) {
    if (def.trigger !== ev.type) return false
    if (def.trigger === 'keydown' || def.trigger === 'keyup') return def.key === ev.key
    if (def.target) return def.target === ev.target
    return true
  }

  function push (ev) {
    if (ev.t < lastT) throw new Error('events must be pushed in time order')
    lastT = ev.t
    if (ev.type === 'pointer') { pointer = { x: ev.x, y: ev.y }; return }
    const defs = doc.events || []
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i]
      if (!matches(def, ev)) continue
      const objId = def.object || def.target
      if (def.action === 'state') {
        transitionToState(objId, def.state, ev.t, def.duration || 0, def.easing)
      } else if (def.action === 'toggle') {
        toggles[i] = (toggles[i] || 0) + 1
        const which = toggles[i] % 2 === 1 ? def.states[1] : def.states[0]
        transitionToState(objId, which, ev.t, def.duration || 0, def.easing)
      } else if (def.action === 'timeline') {
        timelineOp(def.op, def.timeline, ev.t)
      }
    }
  }

  function sample (t) {
    const out = {}
    for (const id of Object.keys(objects)) {
      out[id] = {}
      for (const ch of Object.keys(writers[id])) {
        out[id][ch] = writerValue(id, ch, t)
      }
    }
    // Bindings evaluate last and own their channels outright.
    for (const b of doc.bindings || []) {
      if (!out[b.object]) continue
      if (b.type === 'follow') {
        const base = out[b.object][b.channel]
        const v = Array.isArray(base) ? base.slice() : [0, 0, 0]
        if (b.map.x) v[0] = v[0] + lerpNum(b.map.x[0], b.map.x[1], (pointer.x + 1) / 2)
        if (b.map.y) v[1] = v[1] + lerpNum(b.map.y[0], b.map.y[1], (pointer.y + 1) / 2)
        out[b.object][b.channel] = v
      } else if (b.type === 'lookAt') {
        const r = (out[b.object]['transform.r'] || [0, 0, 0]).slice()
        r[0] = r[0] - pointer.y * (b.maxPitch || 0.3)
        r[1] = r[1] + pointer.x * (b.maxYaw || 0.5)
        out[b.object]['transform.r'] = r
      }
    }
    return out
  }

  return { push, sample, _pointer: () => pointer }
}

// ---------------------------------------------------------------------------
// The pure form. Same doc + same log + same t = same output, always.
// ---------------------------------------------------------------------------
export function resolve (doc, eventLog, t) {
  const s = createSession(doc)
  const log = eventLog.filter(e => e.t <= t).slice().sort((a, b) => a.t - b.t)
  for (const ev of log) s.push(ev)
  return s.sample(t)
}
