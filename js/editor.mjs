/* SceneMaker: the 3D viewport. Owns Three.js; knows nothing about panels.
   The doc is the source of truth: the viewport builds meshes FROM it and
   writes gizmo drags BACK to it through callbacks. Look defaults (ACES, soft
   shadows, PMREM softbox room) are the Phase 0 look-gate recipe. */

import * as THREE from 'three'
import { OrbitControls } from '../vendor/three/OrbitControls.js'
import { TransformControls } from '../vendor/three/TransformControls.js'
import { environmentById } from './doc.mjs'
import { createSession } from '../engine/resolver.mjs'

export function createViewport (canvas, callbacks) {
  const cb = callbacks // { onPick(id|null), onGizmoChange(id), onGizmoCommit(id) }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)

  // ------------------------------------------------------------ environment
  function makeEnvScene (tint) {
    const env = new THREE.Scene()
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(12, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x2a2e38, side: THREE.BackSide })
    )
    env.add(room)
    const box = (w, h, color, intensity, pos, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }))
      m.material.color.multiplyScalar(intensity)
      m.position.fromArray(pos); m.rotation.set(rot[0], rot[1], rot[2])
      env.add(m)
    }
    box(5, 5, 0xffffff, 6, [0, 5.9, 0], [Math.PI / 2, 0, 0])
    box(3, 4, tint, 3, [-5.9, 2.5, 0], [0, Math.PI / 2, 0])
    box(3, 4, 0xdfeaff, 2.2, [5.9, 2.5, 1], [0, -Math.PI / 2, 0])
    box(4, 2, 0xffffff, 1.4, [0, 2.5, -5.9], [0, 0, 0])
    return env
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  // One baked environment per preset, cached forever: rebaking on every
  // applyEnvironment call (undo restores included) churns GPU memory.
  const envCache = {}

  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(3.5, 6.5, 4)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -9; key.shadow.camera.right = 9
  key.shadow.camera.top = 9; key.shadow.camera.bottom = -9
  key.shadow.camera.near = 1; key.shadow.camera.far = 24
  key.shadow.bias = -0.0003
  key.shadow.normalBias = 0.02
  scene.add(key)
  const hemi = new THREE.HemisphereLight(0xcdd9f0, 0xe8dfd0, 0.35)
  scene.add(hemi)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({ color: '#dce3ee', roughness: 1, metalness: 0 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.userData.isGround = true
  scene.add(ground)

  const grid = new THREE.GridHelper(18, 36, 0x9aa6bc, 0xc3ccdc)
  grid.material.transparent = true
  grid.material.opacity = 0.28
  grid.position.y = 0.001
  scene.add(grid)

  function applyEnvironment (envDoc) {
    const env = environmentById(envDoc.preset)
    scene.background = new THREE.Color(env.bg)
    scene.fog = envDoc.fog ? new THREE.Fog(env.bg, 16, 42) : null
    key.color.set(env.key)
    key.intensity = env.keyIntensity
    hemi.color.set(env.hemi[0]); hemi.groundColor.set(env.hemi[1]); hemi.intensity = env.hemi[2]
    ground.material.color.set(env.ground)
    ground.visible = envDoc.ground.visible !== false
    grid.visible = ground.visible
    if (!envCache[env.id]) {
      const envScene = makeEnvScene(new THREE.Color(env.key).getHex())
      envCache[env.id] = pmrem.fromScene(envScene, 0.04).texture
      envScene.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose() })
    }
    scene.environment = envCache[env.id]
    scene.environmentIntensity = env.envIntensity
  }

  // ------------------------------------------------------------ doc objects
  const nodes = {}     // id -> Group
  const meshes = {}    // id -> Mesh
  const materials = {} // id -> MeshStandardMaterial

  function geometryFor (o) {
    const p = o.params || {}
    switch (o.type) {
      case 'box': return new THREE.BoxGeometry(p.w || 1, p.h || 1, p.d || 1)
      case 'sphere': return new THREE.SphereGeometry(p.radius || 0.55, 48, 32)
      case 'cylinder': return new THREE.CylinderGeometry(p.radius || 0.5, p.radius || 0.5, p.height || 1, p.segments || 48)
      case 'cone': return new THREE.ConeGeometry(p.radius || 0.55, p.height || 1.1, p.segments || 48)
      case 'torus': return new THREE.TorusGeometry(p.radius || 0.5, p.tube || 0.2, 24, 64)
      case 'capsule': return new THREE.CapsuleGeometry(p.radius || 0.35, p.length || 0.6, 8, 24)
      case 'icosahedron': return new THREE.IcosahedronGeometry(p.radius || 0.55, p.detail || 0)
      default: return new THREE.BoxGeometry(1, 1, 1)
    }
  }

  function applyMaterialValues (mat, m) {
    mat.color.set(m.color || '#ffffff')
    mat.roughness = m.roughness !== undefined ? m.roughness : 0.5
    mat.metalness = m.metalness !== undefined ? m.metalness : 0
    mat.emissive.set(m.color || '#ffffff')
    mat.emissiveIntensity = m.emissiveIntensity !== undefined ? m.emissiveIntensity : 0
    mat.opacity = m.opacity !== undefined ? m.opacity : 1
    mat.transparent = mat.opacity < 1
  }

  function addObject (o) {
    const g = new THREE.Group()
    g.userData.docId = o.id
    const mat = new THREE.MeshStandardMaterial({ flatShading: !!(o.params && o.params.flat) })
    applyMaterialValues(mat, o.material || {})
    const mesh = new THREE.Mesh(geometryFor(o), mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.docId = o.id
    g.add(mesh)
    scene.add(g)
    nodes[o.id] = g; meshes[o.id] = mesh; materials[o.id] = mat
    syncTransform(o)
    syncVisibility(o)
  }

  function removeObject (id) {
    const g = nodes[id]
    if (!g) return
    if (selectedId === id) select(null)
    scene.remove(g)
    meshes[id].geometry.dispose()
    materials[id].dispose()
    delete nodes[id]; delete meshes[id]; delete materials[id]
  }

  function syncTransform (o) {
    const g = nodes[o.id]
    if (!g) return
    g.position.fromArray(o.transform.p)
    g.rotation.set(o.transform.r[0], o.transform.r[1], o.transform.r[2])
    g.scale.fromArray(o.transform.s)
  }

  // In-place material update: never dispose+rebuild on slider input.
  function syncMaterial (o) {
    const mat = materials[o.id]
    if (!mat) return
    const wantFlat = !!(o.params && o.params.flat)
    if (mat.flatShading !== wantFlat) { mat.flatShading = wantFlat; mat.needsUpdate = true }
    applyMaterialValues(mat, o.material || {})
  }

  function syncVisibility (o) {
    if (nodes[o.id]) nodes[o.id].visible = o.visible !== false
  }

  // Geometry params changed (rare, discrete): rebuild geometry only.
  function syncGeometry (o) {
    const mesh = meshes[o.id]
    if (!mesh) return
    mesh.geometry.dispose()
    mesh.geometry = geometryFor(o)
  }

  function buildAll (doc, keepCamera) {
    for (const id of Object.keys(nodes)) removeObject(id)
    for (const o of doc.objects) addObject(o)
    applyEnvironment(doc.environment)
    if (!keepCamera) {
      camera.position.fromArray(doc.camera.position)
      orbit.target.fromArray(doc.camera.target)
    }
  }

  // ------------------------------------------------------------ controls
  const orbit = new OrbitControls(camera, canvas)
  orbit.enableDamping = true
  orbit.dampingFactor = 0.08
  orbit.minDistance = 1.5; orbit.maxDistance = 30
  orbit.maxPolarAngle = Math.PI / 2 - 0.03

  const gizmo = new TransformControls(camera, canvas)
  gizmo.setSize(0.9)
  scene.add(gizmo.getHelper())
  gizmo.addEventListener('dragging-changed', e => {
    orbit.enabled = !e.value
    if (!e.value && selectedId) cb.onGizmoCommit(selectedId)
  })
  gizmo.addEventListener('objectChange', () => {
    if (!selectedId) return
    const g = nodes[selectedId]
    const o = { p: g.position.toArray(), r: [g.rotation.x, g.rotation.y, g.rotation.z], s: g.scale.toArray() }
    cb.onGizmoChange(selectedId, o)
  })

  function setGizmoMode (mode) { gizmo.setMode(mode) }
  function setSnap (on) {
    gizmo.setTranslationSnap(on ? 0.25 : null)
    gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null)
    gizmo.setScaleSnap(on ? 0.1 : null)
  }
  setSnap(true)

  // ------------------------------------------------------------ selection
  let selectedId = null
  const selBox = new THREE.BoxHelper(undefined, 0x4c8dff)
  selBox.visible = false
  scene.add(selBox)

  function select (id) {
    selectedId = id
    if (id && nodes[id]) {
      gizmo.attach(nodes[id])
      selBox.setFromObject(nodes[id])
      selBox.visible = true
    } else {
      gizmo.detach()
      selBox.visible = false
    }
  }

  // Click-pick: click = pointerdown+up without a real drag (orbit owns drags).
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let downAt = null

  function pickAt (clientX, clientY) {
    const r = canvas.getBoundingClientRect()
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(Object.values(meshes), false)
    return hits.length ? hits[0].object.userData.docId : null
  }

  canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY] })
  canvas.addEventListener('pointerup', e => {
    if (!downAt) return
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1])
    downAt = null
    if (moved > 5 || gizmo.dragging) return
    const id = pickAt(e.clientX, e.clientY)
    if (playing) { if (id) pushPlay({ type: 'click', target: id }) } else cb.onPick(id)
  })

  // ------------------------------------------------------------ play mode
  // The editor's own engine loop: same resolver the published viewer will
  // run. Pixels come from session.sample(t); the doc is untouched.
  let playing = false
  let playSession = null
  let playT0 = 0
  let playLastT = 0
  let playHovered = null
  let playPointerDirty = false
  const playNdc = { x: 0, y: 0 }

  function playNow () { return (performance.now() - playT0) / 1000 }
  function pushPlay (ev) {
    if (!playSession) return
    ev.t = Math.max(playNow(), playLastT)
    playLastT = ev.t
    playSession.push(ev)
  }

  canvas.addEventListener('pointermove', e => {
    if (!playing) return
    const r = canvas.getBoundingClientRect()
    playNdc.x = ((e.clientX - r.left) / r.width) * 2 - 1
    playNdc.y = -((e.clientY - r.top) / r.height) * 2 + 1
    playPointerDirty = true
    const id = pickAt(e.clientX, e.clientY)
    if (id !== playHovered) {
      if (playHovered) pushPlay({ type: 'hoverexit', target: playHovered })
      if (id) pushPlay({ type: 'hoverenter', target: id })
      playHovered = id
      canvas.style.cursor = id ? 'pointer' : 'default'
    }
  })
  window.addEventListener('keydown', e => {
    if (!playing || e.repeat) return
    if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault()
    pushPlay({ type: 'keydown', key: e.key })
  })
  window.addEventListener('keyup', e => {
    if (!playing) return
    pushPlay({ type: 'keyup', key: e.key })
  })

  function setPlayMode (on, doc) {
    playing = on
    if (on) {
      select(null)
      playSession = createSession(doc)
      playT0 = performance.now()
      playLastT = 0
      playHovered = null
      pushPlay({ type: 'start' })
    } else {
      playSession = null
      canvas.style.cursor = 'default'
      buildAll(doc, true) // restore the authored scene exactly
    }
  }

  function applyResolved (res) {
    for (const id of Object.keys(res)) {
      const g = nodes[id]
      if (!g) continue
      const ch = res[id]
      if (ch['transform.p']) g.position.fromArray(ch['transform.p'])
      if (ch['transform.r']) g.rotation.set(ch['transform.r'][0], ch['transform.r'][1], ch['transform.r'][2])
      if (ch['transform.s']) g.scale.fromArray(ch['transform.s'])
      const mat = materials[id]
      if (mat) {
        if (ch['material.color']) { mat.color.set(ch['material.color']); mat.emissive.set(ch['material.color']) }
        if (ch['material.emissiveIntensity'] !== undefined) mat.emissiveIntensity = ch['material.emissiveIntensity']
        if (ch['material.opacity'] !== undefined) { mat.opacity = ch['material.opacity']; mat.transparent = mat.opacity < 1 }
      }
      if (ch.visible !== undefined) g.visible = ch.visible
    }
  }

  // Headless-CDP support: sample the engine at wall-clock t (rAF may crawl).
  function playSampleNow () {
    if (!playSession) return null
    return playSession.sample(Math.max(playNow(), playLastT))
  }
  function playInject (type, target, key, x, y) {
    const ev = { type }
    if (target) ev.target = target
    if (key !== undefined && key !== null) ev.key = key
    if (x !== undefined && x !== null) { ev.x = x; ev.y = y }
    pushPlay(ev)
    return true
  }

  // ------------------------------------------------------------ frame loop
  let frames = 0
  let frameMs = 16.7
  let last = performance.now()

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
    const t = performance.now()
    frameMs = frameMs * 0.95 + (t - last) * 0.05
    last = t
    resize()
    if (playing && playSession) {
      if (playPointerDirty) { pushPlay({ type: 'pointer', x: playNdc.x, y: playNdc.y }); playPointerDirty = false }
      const res = playSession.sample(Math.max(playNow(), playLastT))
      applyResolved(res)
    } else if (selectedId && nodes[selectedId]) {
      selBox.setFromObject(nodes[selectedId])
    }
    orbit.update()
    renderer.render(scene, camera)
    frames++
  }
  frame()

  // Render one clean frame (no gizmo/grid/selection) and capture it.
  function previewDataUrl () {
    const gizmoVisible = gizmo.getHelper().visible
    gizmo.getHelper().visible = false
    grid.visible = false
    selBox.visible = false
    renderer.render(scene, camera)
    const url = canvas.toDataURL('image/png')
    gizmo.getHelper().visible = gizmoVisible
    grid.visible = ground.visible
    if (selectedId) selBox.visible = true
    return url
  }

  return {
    buildAll,
    addObject,
    removeObject,
    syncTransform,
    syncMaterial,
    syncGeometry,
    syncVisibility,
    applyEnvironment,
    select,
    setGizmoMode,
    setSnap,
    setPlayMode,
    playSampleNow,
    playInject,
    previewDataUrl,
    stats: () => ({ frames, frameMs: Math.round(frameMs * 100) / 100 }),
    cameraState: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
    _scene: scene
  }
}
