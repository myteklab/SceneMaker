/* SceneMaker: application state + actions. Owns the doc, selection, undo,
   and the dirty flag. The UI calls actions; the viewport reflects the doc.
   Exposes window.SceneMakerApp: the neutral surface the platform adapter
   drives (no Platform.* anywhere in app code). */

import { createDefaultDoc, normalizeDoc, makeObject, nextCounter, freshId, restingY, makeRecipe, compileRecipes, makeModelObject, validModelUrl } from './doc.mjs?v=6'
import { createViewport } from './editor.mjs?v=6'
import { initUI } from './ui.mjs?v=6'

const canvas = document.getElementById('viewport')

const state = {
  doc: createDefaultDoc(),
  selectedId: null,
  gizmoMode: 'translate',
  snap: true,
  playing: false,
  dirty: false,
  undo: [],
  redo: []
}

const dirtyCbs = []
function setDirty (d) {
  // Every committed mutation funnels through here: recompile so interactions
  // stay anchored to the objects' current base values.
  if (d) compileRecipes(state.doc)
  state.dirty = d
  for (const f of dirtyCbs) f(d)
}

// ---------------------------------------------------------------- undo/redo
const UNDO_DEPTH = 100
function snapshot () {
  stopPlayIfPlaying()
  state.undo.push(JSON.stringify(state.doc))
  if (state.undo.length > UNDO_DEPTH) state.undo.shift()
  state.redo.length = 0
}

// Any edit while playing drops back to edit mode first: the scene on screen
// is engine output, not the doc, and editing through it would lie.
function stopPlayIfPlaying () {
  if (state.playing) actions.stopPlay()
}

function restore (json) {
  state.doc = normalizeDoc(JSON.parse(json))
  const stillThere = state.doc.objects.find(o => o.id === state.selectedId)
  viewport.buildAll(state.doc, true)
  actions.select(stillThere ? state.selectedId : null)
  ui.refreshAll()
  setDirty(true)
}

// ---------------------------------------------------------------- viewport
const viewport = createViewport(canvas, {
  onPick (id) { actions.select(id) },
  onGizmoChange (id, tr) {
    const o = byId(id)
    if (!o) return
    o.transform.p = tr.p; o.transform.r = tr.r; o.transform.s = tr.s
    ui.refreshProperties()
  },
  onGizmoCommit () {
    commit()
  }
})

function byId (id) { return state.doc.objects.find(o => o.id === id) }

// First free floor slot near the center: deterministic ring scan.
function freeSpot () {
  const taken = state.doc.objects.map(x => x.transform.p)
  const free = ([x, z]) => taken.every(p => Math.hypot(p[0] - x, p[2] - z) > 0.85)
  for (let ring = 0; ring <= 4; ring++) {
    for (let ix = -ring; ix <= ring; ix++) {
      for (let iz = -ring; iz <= ring; iz++) {
        if (Math.max(Math.abs(ix), Math.abs(iz)) !== ring) continue
        const cand = [ix * 1.15, iz * 1.15]
        if (free(cand)) return cand
      }
    }
  }
  return [0, 0]
}

// A committed mutation: undo point + dirty. Call AFTER the doc changed for
// discrete edits; for drags, once at the end.
let preDrag = null
function commit () {
  if (preDrag !== null) { state.undo.push(preDrag); if (state.undo.length > UNDO_DEPTH) state.undo.shift(); state.redo.length = 0; preDrag = null }
  setDirty(true)
  ui.refreshTree()
}

// ---------------------------------------------------------------- actions
export const actions = {
  select (id) {
    stopPlayIfPlaying()
    state.selectedId = id
    viewport.select(id)
    ui.refreshTree()
    ui.refreshProperties()
  },

  addPrimitive (type) {
    snapshot()
    const counter = nextCounter(state.doc, type)
    const o = makeObject(type, { counter })
    const spot = freeSpot()
    o.transform.p[0] = spot[0]
    o.transform.p[2] = spot[1]
    o.transform.p[1] = restingY(type, o.params)
    state.doc.objects.push(o)
    viewport.addObject(o)
    actions.select(o.id)
    setDirty(true)
  },

  // Add a 3D model by URL (GLB): our Files/exports or any https link.
  addModel (url, name) {
    const clean = validModelUrl(url)
    if (!clean) return { ok: false, error: 'Paste a link that starts with https:// (or a file on this site).' }
    snapshot()
    const counter = state.doc.objects.filter(x => x.type === 'model').length + 1
    const o = makeModelObject(clean, { counter })
    if (typeof name === 'string' && name.trim()) o.name = name.replace(/\.(glb|gltf)$/i, '').trim().slice(0, 60) || o.name
    const spot = freeSpot()
    o.transform.p = [spot[0], 0, spot[1]]
    state.doc.objects.push(o)
    viewport.addObject(o)
    actions.select(o.id)
    setDirty(true)
    return { ok: true, id: o.id }
  },

  // "Pick from my Files": the platform adapter opens the asset picker; the
  // app only announces the wish. Standalone (no adapter) explains itself.
  requestModelPick () {
    if (!window.__smAdapter) return { ok: false, error: 'Picking from your Files works inside the platform.' }
    window.dispatchEvent(new CustomEvent('scenemaker:pickModel'))
    return { ok: true }
  },

  // Fit slider on models: rebuild the node so the GLB renormalizes.
  setModelFit (id, fit, snapshotFirst) {
    const o = byId(id)
    if (!o || o.type !== 'model') return
    if (snapshotFirst) snapshot()
    o.params.fit = fit
    viewport.removeObject(id)
    viewport.addObject(o)
    if (state.selectedId === id) viewport.select(id)
    if (snapshotFirst) setDirty(true)
  },

  deleteSelected () {
    const o = byId(state.selectedId)
    if (!o) return
    snapshot()
    state.doc.objects = state.doc.objects.filter(x => x.id !== o.id)
    viewport.removeObject(o.id)
    actions.select(null)
    setDirty(true)
  },

  duplicateSelected () {
    const o = byId(state.selectedId)
    if (!o) return
    snapshot()
    const copy = JSON.parse(JSON.stringify(o))
    copy.id = freshId()
    copy.name = o.name + ' copy'
    copy.transform.p = [o.transform.p[0] + 0.6, o.transform.p[1], o.transform.p[2] + 0.6]
    state.doc.objects.push(copy)
    for (const r of state.doc.recipes.filter(x => x.object === o.id)) {
      state.doc.recipes.push({ ...makeRecipe(copy.id, r.type), params: JSON.parse(JSON.stringify(r.params)) })
    }
    viewport.addObject(copy)
    actions.select(copy.id)
    setDirty(true)
  },

  rename (id, name) {
    const o = byId(id)
    if (!o || !name.trim()) return
    snapshot()
    o.name = name.trim().slice(0, 60)
    setDirty(true)
    ui.refreshTree()
  },

  toggleVisible (id) {
    const o = byId(id)
    if (!o) return
    snapshot()
    o.visible = o.visible === false
    viewport.syncVisibility(o)
    setDirty(true)
    ui.refreshTree()
  },

  // Discrete property edit from the panel (number input / slider / picker).
  // `snapshotFirst` false lets slider "input" stream without undo spam; the
  // matching "change" event commits with snapshotFirst true.
  setTransform (id, tr, snapshotFirst) {
    const o = byId(id)
    if (!o) return
    if (snapshotFirst) snapshot()
    Object.assign(o.transform, tr)
    viewport.syncTransform(o)
    if (snapshotFirst) setDirty(true)
  },

  setMaterial (id, values, snapshotFirst) {
    const o = byId(id)
    if (!o) return
    if (snapshotFirst) snapshot()
    Object.assign(o.material, values)
    if ('flat' in values) { o.params.flat = values.flat; delete o.material.flat }
    viewport.syncMaterial(o)
    if (snapshotFirst) setDirty(true)
  },

  applyFinish (id, finishId, values) {
    const o = byId(id)
    if (!o) return
    snapshot()
    const v = { ...values }
    const flat = !!v.flat
    delete v.flat
    o.material = { color: o.material.color, finish: finishId, ...v }
    o.params.flat = flat
    viewport.syncMaterial(o)
    setDirty(true)
  },

  setEnvironment (values, snapshotFirst = true) {
    if (snapshotFirst) snapshot()
    Object.assign(state.doc.environment, values)
    viewport.applyEnvironment(state.doc.environment)
    if (snapshotFirst) setDirty(true)
  },

  setGizmoMode (mode) {
    state.gizmoMode = mode
    viewport.setGizmoMode(mode)
    ui.refreshToolbar()
  },

  toggleSnap () {
    state.snap = !state.snap
    viewport.setSnap(state.snap)
    ui.refreshToolbar()
  },

  markDragStart () {
    preDrag = JSON.stringify(state.doc)
  },

  // ---------------------------------------------------------- recipes
  addRecipe (objectId, type) {
    const o = byId(objectId)
    if (!o) return
    snapshot()
    state.doc.recipes.push(makeRecipe(objectId, type))
    compileRecipes(state.doc)
    setDirty(true)
    ui.refreshProperties()
  },

  removeRecipe (recipeId) {
    snapshot()
    state.doc.recipes = state.doc.recipes.filter(r => r.id !== recipeId)
    compileRecipes(state.doc)
    setDirty(true)
    ui.refreshProperties()
  },

  setRecipeParam (recipeId, key, value, snapshotFirst) {
    const r = state.doc.recipes.find(x => x.id === recipeId)
    if (!r) return
    if (snapshotFirst) snapshot()
    r.params[key] = value
    compileRecipes(state.doc)
    if (snapshotFirst) setDirty(true)
  },

  // ---------------------------------------------------------- play
  togglePlay () {
    if (state.playing) actions.stopPlay()
    else actions.startPlay()
  },

  startPlay () {
    if (state.playing) return
    compileRecipes(state.doc)
    state.playing = true
    viewport.setPlayMode(true, state.doc)
    ui.refreshToolbar()
  },

  stopPlay () {
    if (!state.playing) return
    state.playing = false
    viewport.setPlayMode(false, state.doc)
    ui.refreshToolbar()
  },

  toggleTheme () {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    themeOverride = next
    try { localStorage.setItem(THEME_KEY, next) } catch (e) {}
    applyTheme()
  },

  undo () {
    if (!state.undo.length) return
    state.redo.push(JSON.stringify(state.doc))
    restore(state.undo.pop())
  },

  redo () {
    if (!state.redo.length) return
    state.undo.push(JSON.stringify(state.doc))
    restore(state.redo.pop())
  }
}

// Gizmo drags: capture pre-drag state for one undo entry per drag.
canvas.addEventListener('pointerdown', () => {
  if (state.selectedId) actions.markDragStart()
})

// ---------------------------------------------------------------- theme
// UI chrome only; the 3D scene keeps its environment (that's content).
// Default follows the platform (adapter calls setDefaultTheme); the topbar
// toggle stores a per-app override that wins until toggled again.
const THEME_KEY = 'scenemaker.theme'
let themeDefault = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
let themeOverride = null
try { const t = localStorage.getItem(THEME_KEY); if (t === 'dark' || t === 'light') themeOverride = t } catch (e) {}

function currentTheme () { return themeOverride || themeDefault }

function applyTheme () {
  document.documentElement.dataset.theme = currentTheme()
  const moon = document.getElementById('theme-icon-moon')
  const sun = document.getElementById('theme-icon-sun')
  if (moon && sun) {
    moon.style.display = currentTheme() === 'dark' ? 'none' : ''
    sun.style.display = currentTheme() === 'dark' ? '' : 'none'
  }
}
applyTheme()

// ---------------------------------------------------------------- UI
const ui = initUI(state, actions)
viewport.buildAll(state.doc)
ui.refreshAll()

// ---------------------------------------------------------------- adapter API
window.SceneMakerApp = {
  getProjectData () {
    compileRecipes(state.doc)
    // Persist the current editor camera so reopening feels familiar.
    const cam = viewport.cameraState()
    state.doc.camera.position = cam.position
    state.doc.camera.target = cam.target
    return JSON.parse(JSON.stringify(state.doc))
  },
  loadProjectData (raw) {
    stopPlayIfPlaying()
    state.doc = normalizeDoc(raw)
    state.undo.length = 0
    state.redo.length = 0
    viewport.buildAll(state.doc)
    actions.select(null)
    ui.refreshAll()
    setDirty(false)
  },
  newProject () {
    stopPlayIfPlaying()
    state.doc = createDefaultDoc()
    state.undo.length = 0; state.redo.length = 0
    viewport.buildAll(state.doc)
    actions.select(null)
    ui.refreshAll()
    setDirty(false)
  },
  onDirty (cb) { dirtyCbs.push(cb) },
  // Platform default theme (adapter reads the site setting). A stored
  // per-app override wins; otherwise the UI follows the site.
  setDefaultTheme (t) {
    themeDefault = t === 'dark' ? 'dark' : 'light'
    applyTheme()
  },
  theme: () => currentTheme(),
  markClean () { setDirty(false) },
  isDirty: () => state.dirty,
  previewDataUrl: () => viewport.previewDataUrl(),
  stats: () => viewport.stats(),
  state: () => ({
    objects: state.doc.objects.map(o => ({ id: o.id, name: o.name, type: o.type })),
    selectedId: state.selectedId,
    dirty: state.dirty,
    undoDepth: state.undo.length,
    gizmoMode: state.gizmoMode,
    snap: state.snap,
    environment: state.doc.environment.preset,
    theme: currentTheme(),
    playing: state.playing,
    recipes: state.doc.recipes.map(r => ({ id: r.id, object: r.object, type: r.type })),
    frames: viewport.stats().frames,
    frameMs: viewport.stats().frameMs
  }),
  modelStatus: id => viewport.modelStatus(id),
  // Adapter feedback line under the model input (picker flow messages).
  showModelMessage (msg) {
    const el = document.getElementById('model-error')
    if (el) el.textContent = msg || ''
  },
  // Play-mode drive for tests: inject events, sample the engine at wall t.
  play: {
    inject: (type, target, key, x, y) => viewport.playInject(type, target, key, x, y),
    sampleNow: () => viewport.playSampleNow()
  },
  actions,
  _doc: () => state.doc
}

window.dispatchEvent(new CustomEvent('scenemaker:ready'))
