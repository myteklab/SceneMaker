/* SceneMaker: the scene document model.
   The doc is the single source of truth (spec 66 section 8). The editor edits
   it, the engine resolves it, save/load round-trips it verbatim. Everything
   here is plain data helpers: no DOM, no Three.js. */

export const DOC_VERSION = 1

// ---------------------------------------------------------------- primitives
export const PRIMITIVES = [
  { type: 'box', label: 'Box', params: { w: 1, h: 1, d: 1 } },
  { type: 'sphere', label: 'Ball', params: { radius: 0.55 } },
  { type: 'cylinder', label: 'Cylinder', params: { radius: 0.5, height: 1, segments: 48 } },
  { type: 'cone', label: 'Cone', params: { radius: 0.55, height: 1.1, segments: 48 } },
  { type: 'torus', label: 'Donut', params: { radius: 0.5, tube: 0.2 } },
  { type: 'capsule', label: 'Capsule', params: { radius: 0.35, length: 0.6 } },
  { type: 'icosahedron', label: 'Gem', params: { radius: 0.55, detail: 0, flat: true } }
]

// Height above the ground so a fresh object sits on the floor.
export function restingY (type, params) {
  switch (type) {
    case 'box': return (params.h || 1) / 2
    case 'sphere': return params.radius || 0.55
    case 'cylinder': case 'cone': return (params.height || 1) / 2
    case 'torus': return (params.radius || 0.5) + (params.tube || 0.2)
    case 'capsule': return (params.length || 0.6) / 2 + (params.radius || 0.35)
    case 'icosahedron': return params.radius || 0.55
    default: return 0.5
  }
}

// A friendly rotating palette so new objects never start dull gray.
export const SPAWN_COLORS = ['#ff5470', '#4ecdc4', '#ffd166', '#7c8cf8', '#f78fb3', '#5cd85a', '#ff9f68', '#9b7cf8']

// ---------------------------------------------------------------- finishes
// A finish is a bundle of material values applied on top of the object's
// color. Presets-first is the spec's call: minute-one scenes must look good.
export const FINISHES = [
  { id: 'clay', label: 'Clay', values: { roughness: 0.8, metalness: 0, emissiveIntensity: 0, opacity: 1, flat: false } },
  { id: 'glossy', label: 'Glossy', values: { roughness: 0.18, metalness: 0, emissiveIntensity: 0.08, opacity: 1, flat: false } },
  { id: 'candy', label: 'Candy', values: { roughness: 0.3, metalness: 0.05, emissiveIntensity: 0.15, opacity: 1, flat: false } },
  { id: 'metal', label: 'Metal', values: { roughness: 0.32, metalness: 1, emissiveIntensity: 0, opacity: 1, flat: false } },
  { id: 'chrome', label: 'Chrome', values: { roughness: 0.06, metalness: 1, emissiveIntensity: 0, opacity: 1, flat: false } },
  { id: 'glow', label: 'Glow', values: { roughness: 0.5, metalness: 0, emissiveIntensity: 1.2, opacity: 1, flat: false } },
  { id: 'glass', label: 'Glass', values: { roughness: 0.08, metalness: 0, emissiveIntensity: 0.05, opacity: 0.55, flat: false } },
  { id: 'gem', label: 'Faceted', values: { roughness: 0.15, metalness: 0.1, emissiveIntensity: 0.25, opacity: 1, flat: true } }
]

export function finishById (id) {
  return FINISHES.find(f => f.id === id) || FINISHES[0]
}

// ---------------------------------------------------------------- environments
export const ENVIRONMENTS = [
  { id: 'studio', label: 'Studio', bg: '#e8ecf2', ground: '#dce3ee', key: '#fff2e2', keyIntensity: 2.4, envIntensity: 0.55, hemi: ['#cdd9f0', '#e8dfd0', 0.35] },
  { id: 'sunset', label: 'Sunset', bg: '#ffe0cc', ground: '#f2cdb2', key: '#ffb37a', keyIntensity: 2.6, envIntensity: 0.5, hemi: ['#ffd9c4', '#d9a37e', 0.4] },
  { id: 'meadow', label: 'Meadow', bg: '#dff2e4', ground: '#c8e6c8', key: '#fff8dc', keyIntensity: 2.5, envIntensity: 0.55, hemi: ['#d8f0dc', '#e6ddc4', 0.38] },
  { id: 'night', label: 'Night', bg: '#1c2233', ground: '#252d42', key: '#a8c4ff', keyIntensity: 1.5, envIntensity: 0.35, hemi: ['#39456b', '#1a1f30', 0.5] }
]

export function environmentById (id) {
  return ENVIRONMENTS.find(e => e.id === id) || ENVIRONMENTS[0]
}

// ---------------------------------------------------------------- doc factory
export function createDefaultDoc () {
  return {
    v: DOC_VERSION,
    environment: { preset: 'studio', ground: { visible: true }, fog: true },
    camera: { position: [4.2, 3, 6], target: [0, 0.8, 0], autoOrbit: 0 },
    objects: [
      makeObject('box', { counter: 1, color: '#ff5470' })
    ],
    recipes: [],
    events: [],
    timelines: [],
    bindings: []
  }
}

let idCounter = 0
export function freshId () {
  idCounter++
  return 'obj_' + Date.now().toString(36) + '_' + idCounter
}

export function makeObject (type, opts = {}) {
  const def = PRIMITIVES.find(p => p.type === type)
  if (!def) throw new Error('unknown primitive: ' + type)
  const params = { ...def.params }
  const color = opts.color || SPAWN_COLORS[(opts.counter || 0) % SPAWN_COLORS.length]
  const finish = finishById(opts.finish || 'clay')
  const finishValues = { ...finish.values }
  if ('flat' in finishValues) { if (finishValues.flat) params.flat = true; delete finishValues.flat }
  return {
    id: opts.id || freshId(),
    name: opts.name || (def.label + ' ' + (opts.counter || 1)),
    type,
    params,
    transform: {
      p: opts.p || [0, restingY(type, params), 0],
      r: [0, 0, 0],
      s: [1, 1, 1]
    },
    material: { color, finish: finish.id, ...finishValues },
    visible: true,
    states: {}
  }
}

// Auto-number names per primitive label: "Box 1", "Box 2", ...
export function nextCounter (doc, type) {
  const def = PRIMITIVES.find(p => p.type === type)
  let n = 0
  for (const o of doc.objects) {
    const m = o.name && o.name.match(new RegExp('^' + def.label + ' (\\d+)$'))
    if (m) n = Math.max(n, parseInt(m[1], 10))
  }
  return n + 1
}

// ---------------------------------------------------------------- recipes
// A recipe is the kid-facing authoring unit: "press like a button", "spin",
// "watch the cursor". Each compiles into the REAL spec-66 vocabulary
// (states + events + timelines + bindings) with namespaced ids, referencing
// the object's CURRENT base values. Recompile after any doc mutation so
// moving an object keeps its interactions anchored. The published viewer
// only ever sees the compiled arrays: recipes are an editor concept.

function shade (hex, k) { // k in [-1, 1]: darken negative, lighten positive
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#888888')
  if (!m) return hex
  const c = [m[1], m[2], m[3]].map(x => parseInt(x, 16))
  const t = k < 0 ? 0 : 255
  const a = Math.abs(k)
  return '#' + c.map(v => {
    const n = Math.round(v + (t - v) * a)
    const h = Math.max(0, Math.min(255, n)).toString(16)
    return h.length === 1 ? '0' + h : h
  }).join('')
}

export const KEY_CHOICES = [
  { id: ' ', label: 'Space' },
  { id: 'Enter', label: 'Enter' },
  { id: 'ArrowUp', label: 'Up arrow' },
  { id: 'j', label: 'J' }
]

export const RECIPES = [
  {
    type: 'press',
    label: 'Press like a button',
    param: { key: 'depth', label: 'How far down', min: 0.05, max: 0.6, step: 0.01, def: 0.12 },
    compile (o, params, rid) {
      const p = o.transform.p
      return {
        states: {
          [`r_${rid}_down`]: { 'transform.p': [p[0], p[1] - params.depth, p[2]], 'material.color': shade(o.material.color, -0.22) },
          [`r_${rid}_up`]: { 'transform.p': p.slice(), 'material.color': o.material.color }
        },
        events: [{ trigger: 'click', target: o.id, object: o.id, action: 'toggle', states: [`r_${rid}_up`, `r_${rid}_down`], duration: 0.16, easing: 'easeOutBack' }]
      }
    }
  },
  {
    type: 'hoverGrow',
    label: 'Grow on hover',
    param: { key: 'amount', label: 'How much bigger', min: 1.05, max: 1.7, step: 0.01, def: 1.15 },
    compile (o, params, rid) {
      const s = o.transform.s
      return {
        states: {
          [`r_${rid}_big`]: { 'transform.s': s.map(v => v * params.amount) },
          [`r_${rid}_calm`]: { 'transform.s': s.slice() }
        },
        events: [
          { trigger: 'hoverenter', target: o.id, object: o.id, action: 'state', state: `r_${rid}_big`, duration: 0.14, easing: 'easeOutQuad' },
          { trigger: 'hoverexit', target: o.id, object: o.id, action: 'state', state: `r_${rid}_calm`, duration: 0.3, easing: 'easeOutQuad' }
        ]
      }
    }
  },
  {
    type: 'hoverGlow',
    label: 'Glow on hover',
    param: { key: 'glow', label: 'How bright', min: 0.4, max: 2, step: 0.05, def: 1.2 },
    compile (o, params, rid) {
      const base = o.material.emissiveIntensity || 0
      return {
        states: {
          [`r_${rid}_lit`]: { 'material.emissiveIntensity': params.glow },
          [`r_${rid}_dim`]: { 'material.emissiveIntensity': base }
        },
        events: [
          { trigger: 'hoverenter', target: o.id, object: o.id, action: 'state', state: `r_${rid}_lit`, duration: 0.15, easing: 'easeOutQuad' },
          { trigger: 'hoverexit', target: o.id, object: o.id, action: 'state', state: `r_${rid}_dim`, duration: 0.35, easing: 'easeOutQuad' }
        ]
      }
    }
  },
  {
    type: 'spin',
    label: 'Spin',
    param: { key: 'secs', label: 'Seconds per turn', min: 1.5, max: 15, step: 0.5, def: 6 },
    compile (o, params, rid) {
      const r = o.transform.r
      return {
        timelines: [{
          id: `tl_${rid}`, object: o.id, duration: params.secs, loop: 'loop',
          tracks: [{ channel: 'transform.r', keys: [{ t: 0, v: r.slice(), easing: 'linear' }, { t: params.secs, v: [r[0], r[1] + 2 * Math.PI, r[2]], easing: 'linear' }] }]
        }],
        events: [{ trigger: 'start', action: 'timeline', op: 'play', timeline: `tl_${rid}` }]
      }
    }
  },
  {
    type: 'bob',
    label: 'Bob up and down',
    param: { key: 'height', label: 'How high', min: 0.1, max: 1.2, step: 0.05, def: 0.3 },
    compile (o, params, rid) {
      const p = o.transform.p
      return {
        timelines: [{
          id: `tl_${rid}`, object: o.id, duration: 1, loop: 'pingpong',
          tracks: [{ channel: 'transform.p', keys: [{ t: 0, v: p.slice(), easing: 'easeInOutQuad' }, { t: 1, v: [p[0], p[1] + params.height, p[2]], easing: 'easeInOutQuad' }] }]
        }],
        events: [{ trigger: 'start', action: 'timeline', op: 'play', timeline: `tl_${rid}` }]
      }
    }
  },
  {
    type: 'jumpKey',
    label: 'Jump on a key',
    param: { key: 'height', label: 'How high', min: 0.3, max: 2.5, step: 0.1, def: 1 },
    keyParam: true,
    compile (o, params, rid) {
      const p = o.transform.p
      const h = params.height
      return {
        timelines: [{
          id: `tl_${rid}`, object: o.id, duration: 0.95, loop: 'once',
          tracks: [{ channel: 'transform.p',
            keys: [
              { t: 0, v: p.slice(), easing: 'easeOutQuad' },
              { t: 0.38, v: [p[0], p[1] + h, p[2]], easing: 'easeInQuad' },
              { t: 0.62, v: [p[0], p[1] + 0.02, p[2]], easing: 'easeOutBounce' },
              { t: 0.95, v: p.slice(), easing: 'linear' }
            ] }]
        }],
        events: [
          { trigger: 'keydown', key: params.pressKey || ' ', action: 'timeline', op: 'restart', timeline: `tl_${rid}` },
          { trigger: 'click', target: o.id, action: 'timeline', op: 'restart', timeline: `tl_${rid}` }
        ]
      }
    }
  },
  {
    type: 'watchCursor',
    label: 'Watch the cursor',
    param: { key: 'amount', label: 'How much it turns', min: 0.15, max: 1, step: 0.05, def: 0.5 },
    compile (o, params) {
      return { bindings: [{ type: 'lookAt', object: o.id, maxYaw: params.amount, maxPitch: params.amount * 0.55 }] }
    }
  },
  {
    type: 'followCursor',
    label: 'Follow the cursor',
    param: { key: 'range', label: 'How far it moves', min: 0.1, max: 1.5, step: 0.05, def: 0.5 },
    compile (o, params) {
      const r = params.range
      return { bindings: [{ type: 'follow', object: o.id, channel: 'transform.p', map: { x: [-r, r], y: [-r * 0.7, r * 0.7] } }] }
    }
  }
]

export function recipeByType (type) {
  return RECIPES.find(r => r.type === type)
}

export function makeRecipe (objectId, type) {
  const def = recipeByType(type)
  const params = { [def.param.key]: def.param.def }
  if (def.keyParam) params.pressKey = ' '
  return { id: 'rc_' + Date.now().toString(36) + '_' + (++recipeCounter), object: objectId, type, params }
}
let recipeCounter = 0

// Regenerate the compiled interaction arrays from doc.recipes. Replaces all
// recipe-owned entries (r_/tl_ prefixes); anything else (future hand-authored
// states) is left alone.
export function compileRecipes (doc) {
  for (const o of doc.objects) {
    for (const k of Object.keys(o.states || {})) if (k.startsWith('r_')) delete o.states[k]
  }
  doc.events = (doc.events || []).filter(e => !isRecipeEvent(e))
  doc.timelines = (doc.timelines || []).filter(t => !String(t.id).startsWith('tl_rc'))
  doc.bindings = []
  doc.recipes = (doc.recipes || []).filter(r => doc.objects.find(o => o.id === r.object))
  for (const r of doc.recipes) {
    const def = recipeByType(r.type)
    const obj = doc.objects.find(o => o.id === r.object)
    if (!def || !obj) continue
    const out = def.compile(obj, r.params, r.id)
    if (out.states) Object.assign(obj.states, out.states)
    if (out.events) doc.events.push(...out.events.map(e => ({ ...e, _recipe: r.id })))
    if (out.timelines) doc.timelines.push(...out.timelines)
    if (out.bindings) doc.bindings.push(...out.bindings)
  }
}

function isRecipeEvent (e) {
  return !!e._recipe || (e.action === 'timeline' && String(e.timeline).startsWith('tl_rc'))
}

// ---------------------------------------------------------------- normalize
// Loaded docs pass through here: fills gaps, drops unknowns, never throws.
// This is the forward-compatibility seam for later doc versions.
export function normalizeDoc (raw) {
  const doc = createDefaultDoc()
  doc.objects = []
  if (!raw || typeof raw !== 'object') return doc
  if (raw.environment && typeof raw.environment === 'object') {
    doc.environment.preset = environmentById(raw.environment.preset).id
    if (raw.environment.ground && typeof raw.environment.ground === 'object') {
      doc.environment.ground.visible = raw.environment.ground.visible !== false
    }
    doc.environment.fog = raw.environment.fog !== false
  }
  if (raw.camera && Array.isArray(raw.camera.position)) doc.camera.position = raw.camera.position.slice(0, 3).map(Number)
  if (raw.camera && Array.isArray(raw.camera.target)) doc.camera.target = raw.camera.target.slice(0, 3).map(Number)
  const seen = new Set()
  for (const o of Array.isArray(raw.objects) ? raw.objects : []) {
    if (!o || typeof o !== 'object' || !o.type) continue
    if (!PRIMITIVES.find(p => p.type === o.type)) continue
    const id = typeof o.id === 'string' && o.id && !seen.has(o.id) ? o.id : freshId()
    seen.add(id)
    const base = makeObject(o.type, { id, name: typeof o.name === 'string' ? o.name.slice(0, 60) : undefined, counter: doc.objects.length + 1 })
    if (o.params && typeof o.params === 'object') base.params = { ...base.params, ...o.params }
    const tr = o.transform || {}
    if (Array.isArray(tr.p)) base.transform.p = tr.p.slice(0, 3).map(Number)
    if (Array.isArray(tr.r)) base.transform.r = tr.r.slice(0, 3).map(Number)
    if (Array.isArray(tr.s)) base.transform.s = tr.s.slice(0, 3).map(Number)
    if (o.material && typeof o.material === 'object') base.material = { ...base.material, ...o.material }
    if ('flat' in base.material) { if (base.material.flat) base.params.flat = true; delete base.material.flat }
    base.material.finish = finishById(base.material.finish).id
    base.visible = o.visible !== false
    if (o.states && typeof o.states === 'object') base.states = o.states
    doc.objects.push(base)
  }
  const seenR = new Set()
  for (const r of Array.isArray(raw.recipes) ? raw.recipes : []) {
    if (!r || typeof r !== 'object' || !recipeByType(r.type)) continue
    if (typeof r.id !== 'string' || seenR.has(r.id)) continue
    if (!seen.has(r.object)) continue
    seenR.add(r.id)
    const def = recipeByType(r.type)
    const params = { [def.param.key]: def.param.def }
    if (def.keyParam) params.pressKey = ' '
    if (r.params && typeof r.params === 'object') {
      if (typeof r.params[def.param.key] === 'number') {
        params[def.param.key] = Math.min(def.param.max, Math.max(def.param.min, r.params[def.param.key]))
      }
      if (def.keyParam && KEY_CHOICES.find(k => k.id === r.params.pressKey)) params.pressKey = r.params.pressKey
    }
    doc.recipes.push({ id: r.id, object: r.object, type: r.type, params })
  }
  // Interaction arrays are always regenerated from recipes: the compiled form
  // in a saved doc is for the viewer, never re-imported.
  compileRecipes(doc)
  return doc
}
