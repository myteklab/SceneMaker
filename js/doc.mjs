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
    material: { color, finish: finish.id, ...finish.values },
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
    base.material.finish = finishById(base.material.finish).id
    base.visible = o.visible !== false
    if (o.states && typeof o.states === 'object') base.states = o.states
    doc.objects.push(base)
  }
  if (Array.isArray(raw.events)) doc.events = raw.events
  if (Array.isArray(raw.timelines)) doc.timelines = raw.timelines
  if (Array.isArray(raw.bindings)) doc.bindings = raw.bindings
  return doc
}
