/* SceneMaker: shared doc -> Three.js builders. Used by BOTH the editor
   viewport (editor.mjs) and the share-page viewer (viewer.mjs) so the two
   renderers can never drift apart. Pure helpers: no scene state here. */

import * as THREE from 'three'
import { GLTFLoader } from '../vendor/three/GLTFLoader.js'

const MODEL_BYTE_CAP = 20 * 1024 * 1024
const gltfLoader = new GLTFLoader()

export function geometryFor (o) {
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

export function applyMaterialValues (mat, m) {
  mat.color.set(m.color || '#ffffff')
  mat.roughness = m.roughness !== undefined ? m.roughness : 0.5
  mat.metalness = m.metalness !== undefined ? m.metalness : 0
  mat.emissive.set(m.color || '#ffffff')
  mat.emissiveIntensity = m.emissiveIntensity !== undefined ? m.emissiveIntensity : 0
  mat.opacity = m.opacity !== undefined ? m.opacity : 1
  mat.transparent = mat.opacity < 1
}

// The handmade softbox "room" baked through PMREM: the Phase 0 look recipe.
export function makeEnvScene (tint) {
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

// Standard stage rig shared by editor and viewer: renderer flags, lights,
// ground. Returns handles the caller wires into its own scene management.
export function createStage (renderer, scene) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12

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

  return { key, hemi, ground }
}

// Apply an environment preset to a stage. envCache maps preset id -> baked
// PMREM texture (bake once per preset, NEVER per call: GPU memory churn).
export function applyEnvironmentToStage (envDef, envDoc, stage, scene, pmrem, envCache) {
  scene.background = new THREE.Color(envDef.bg)
  scene.fog = envDoc.fog ? new THREE.Fog(envDef.bg, 16, 42) : null
  stage.key.color.set(envDef.key)
  stage.key.intensity = envDef.keyIntensity
  stage.hemi.color.set(envDef.hemi[0]); stage.hemi.groundColor.set(envDef.hemi[1]); stage.hemi.intensity = envDef.hemi[2]
  stage.ground.material.color.set(envDef.ground)
  stage.ground.visible = envDoc.ground.visible !== false
  if (!envCache[envDef.id]) {
    const envScene = makeEnvScene(new THREE.Color(envDef.key).getHex())
    envCache[envDef.id] = pmrem.fromScene(envScene, 0.04).texture
    envScene.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose() })
  }
  scene.environment = envCache[envDef.id]
  scene.environmentIntensity = envDef.envIntensity
}

// Build one doc object into a Group. Returns { group, mesh, material }.
// For 'model' objects the mesh is a placeholder that swaps for the loaded
// GLB asynchronously; material is null (embedded materials stay theirs).
export function buildObjectNode (o) {
  const g = new THREE.Group()
  g.userData.docId = o.id

  if (o.type === 'model') {
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#aab4c8', roughness: 0.8, transparent: true, opacity: 0.4 })
    )
    placeholder.position.y = 0.5
    placeholder.userData.docId = o.id
    g.add(placeholder)
    loadModelInto(o, g, placeholder)
    g.position.fromArray(o.transform.p)
    g.rotation.set(o.transform.r[0], o.transform.r[1], o.transform.r[2])
    g.scale.fromArray(o.transform.s)
    g.visible = o.visible !== false
    return { group: g, mesh: placeholder, material: null }
  }

  const mat = new THREE.MeshStandardMaterial({ flatShading: !!(o.params && o.params.flat) })
  applyMaterialValues(mat, o.material || {})
  const mesh = new THREE.Mesh(geometryFor(o), mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.docId = o.id
  g.add(mesh)
  g.position.fromArray(o.transform.p)
  g.rotation.set(o.transform.r[0], o.transform.r[1], o.transform.r[2])
  g.scale.fromArray(o.transform.s)
  g.visible = o.visible !== false
  return { group: g, mesh, material: mat }
}

// Fetch (size-capped) + parse a GLB, normalize it (fit to a friendly size,
// centered, feet on the floor), stamp docId + shadows on every node, then
// swap it in for the placeholder. Failures keep the placeholder and warn.
async function loadModelInto (o, group, placeholder) {
  const url = o.params && o.params.url
  const fit = (o.params && o.params.fit) || 1.5
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MODEL_BYTE_CAP) throw new Error('model too large (' + Math.round(len / 1048576) + 'MB, cap 20MB)')
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MODEL_BYTE_CAP) throw new Error('model too large')
    const gltf = await new Promise((resolve, reject) => gltfLoader.parse(buf, '', resolve, reject))
    const root = gltf.scene || (gltf.scenes && gltf.scenes[0])
    if (!root) throw new Error('empty model')
    // normalize: fit the largest dimension, center x/z, rest on y=0
    const bbox = new THREE.Box3().setFromObject(root)
    const size = bbox.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const k = fit / maxDim
    const wrapper = new THREE.Group()
    wrapper.scale.setScalar(k)
    const center = bbox.getCenter(new THREE.Vector3())
    root.position.set(-center.x, -bbox.min.y, -center.z)
    wrapper.add(root)
    wrapper.traverse(n => {
      n.userData.docId = o.id
      if (n.isMesh) { n.castShadow = true; n.receiveShadow = true }
    })
    group.remove(placeholder)
    placeholder.geometry.dispose()
    placeholder.material.dispose()
    group.add(wrapper)
    group.userData.modelLoaded = true
  } catch (err) {
    console.warn('SceneMaker: could not load model "' + url + '":', err.message || err)
    placeholder.material.color.set('#e05c74')
    placeholder.material.opacity = 0.3
    group.userData.modelError = String(err.message || err)
  }
}

// Apply engine-resolved channels to built nodes each frame (play/viewer).
export function applyResolvedToNodes (res, nodes, materials) {
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
