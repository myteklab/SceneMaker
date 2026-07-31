/* SceneMaker: the share-page viewer. Loads a scene doc, renders it with the
   SAME stage recipe and runs the SAME engine as the editor, and feeds real
   visitor input (hover, click, keys, cursor) into it. No editor chrome.
   Speaks the platform preview protocol: posts PREVIEW_READY, receives
   LOAD_PREVIEW {data}, posts PREVIEW_LOADED. */

import * as THREE from 'three'
import { OrbitControls } from '../vendor/three/OrbitControls.js'
import { normalizeDoc, environmentById } from './doc.mjs?v=5'
import { createSession } from '../engine/resolver.mjs?v=5'
import { createStage, applyEnvironmentToStage, buildObjectNode, applyResolvedToNodes } from './scene-build.mjs?v=5'

const canvas = document.getElementById('viewer-canvas')
const hintEl = document.getElementById('viewer-hint')

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
const stage = createStage(renderer, scene)
const pmrem = new THREE.PMREMGenerator(renderer)
const envCache = {}

const orbit = new OrbitControls(camera, canvas)
orbit.enableDamping = true
orbit.dampingFactor = 0.08
orbit.enablePan = false
orbit.minDistance = 2; orbit.maxDistance = 18
orbit.maxPolarAngle = Math.PI / 2 - 0.05
orbit.autoRotate = true
orbit.autoRotateSpeed = 0.5
canvas.addEventListener('pointerdown', () => { orbit.autoRotate = false })

// ---------------------------------------------------------------- scene state
let doc = null
let nodes = {}
let materials = {}
let meshes = {}
let session = null
let t0 = 0
let lastT = 0
let hovered = null
let pointerDirty = false
const ndcState = { x: 0, y: 0 }

function loadDoc (raw) {
  for (const id of Object.keys(nodes)) {
    scene.remove(nodes[id])
    nodes[id].traverse(n => {
      if (n.geometry) n.geometry.dispose()
      if (n.material && n.material.dispose) n.material.dispose()
    })
  }
  nodes = {}; materials = {}; meshes = {}
  doc = normalizeDoc(raw)
  for (const o of doc.objects) {
    const built = buildObjectNode(o)
    scene.add(built.group)
    nodes[o.id] = built.group; meshes[o.id] = built.mesh; materials[o.id] = built.material
  }
  applyEnvironmentToStage(environmentById(doc.environment.preset), doc.environment, stage, scene, pmrem, envCache)
  camera.position.fromArray(doc.camera.position)
  orbit.target.fromArray(doc.camera.target)
  session = createSession(doc)
  t0 = performance.now()
  lastT = 0
  hovered = null
  push({ type: 'start' })
  // Invite interaction only when the scene actually has any.
  const interactive = (doc.events || []).some(e => ['click', 'hoverenter', 'keydown'].includes(e.trigger)) || (doc.bindings || []).length
  if (hintEl) {
    hintEl.style.display = interactive ? '' : 'none'
    if (interactive) setTimeout(() => hintEl.classList.add('faded'), 6000)
  }
}

const now = () => (performance.now() - t0) / 1000
function push (ev) {
  if (!session) return
  ev.t = Math.max(now(), lastT)
  lastT = ev.t
  session.push(ev)
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()

function pickAt (clientX, clientY) {
  const r = canvas.getBoundingClientRect()
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObjects(Object.values(nodes), true)
  for (const h of hits) {
    let n = h.object
    while (n) {
      if (n.userData.docId && nodes[n.userData.docId]) return n.userData.docId
      n = n.parent
    }
  }
  return null
}

let downAt = null
canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY] })
canvas.addEventListener('pointerup', e => {
  if (!downAt) return
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1])
  downAt = null
  if (moved > 5) return
  const id = pickAt(e.clientX, e.clientY)
  if (id) push({ type: 'click', target: id })
})
canvas.addEventListener('pointermove', e => {
  const r = canvas.getBoundingClientRect()
  ndcState.x = ((e.clientX - r.left) / r.width) * 2 - 1
  ndcState.y = -((e.clientY - r.top) / r.height) * 2 + 1
  pointerDirty = true
  const id = pickAt(e.clientX, e.clientY)
  if (id !== hovered) {
    if (hovered) push({ type: 'hoverexit', target: hovered })
    if (id) push({ type: 'hoverenter', target: id })
    hovered = id
    canvas.style.cursor = id ? 'pointer' : 'grab'
  }
})
window.addEventListener('keydown', e => {
  if (e.repeat || !session) return
  if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault()
  push({ type: 'keydown', key: e.key })
})
window.addEventListener('keyup', e => { if (session) push({ type: 'keyup', key: e.key }) })

// ---------------------------------------------------------------- frame loop
let frames = 0
function resize () {
  const w = canvas.clientWidth; const h = canvas.clientHeight
  if (w && h && (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio()))) {
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
}
function frame () {
  requestAnimationFrame(frame)
  resize()
  if (session) {
    if (pointerDirty) { push({ type: 'pointer', x: ndcState.x, y: ndcState.y }); pointerDirty = false }
    applyResolvedToNodes(session.sample(Math.max(now(), lastT)), nodes, materials)
  }
  orbit.update()
  renderer.render(scene, camera)
  frames++
}
frame()

// ---------------------------------------------------------------- platform protocol
window.addEventListener('message', e => {
  const msg = e.data || {}
  if (msg.type === 'LOAD_PREVIEW') {
    try {
      loadDoc(msg.data)
      window.parent.postMessage({ type: 'PREVIEW_LOADED' }, '*')
    } catch (err) {
      console.error('SceneMaker viewer failed to load doc:', err)
      window.parent.postMessage({ type: 'PREVIEW_LOADED' }, '*')
    }
  }
})
window.parent.postMessage({ type: 'PREVIEW_READY' }, '*')

// ---------------------------------------------------------------- test API
const errors = []
window.addEventListener('error', e => errors.push(String(e.message).slice(0, 200)))
window.__smv = {
  state: () => ({
    loaded: !!doc,
    objects: doc ? doc.objects.length : 0,
    modelsLoaded: Object.keys(nodes).filter(id => nodes[id].userData.modelLoaded).length,
    frames,
    errors
  }),
  inject (type, target, key, x, y) {
    const ev = { type }
    if (target) ev.target = target
    if (key !== undefined && key !== null) ev.key = key
    if (x !== undefined && x !== null) { ev.x = x; ev.y = y }
    push(ev)
    return true
  },
  sampleNow: () => session ? session.sample(Math.max(now(), lastT)) : null,
  loadDoc // direct load for standalone testing
}
