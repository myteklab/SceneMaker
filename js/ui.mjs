/* SceneMaker: panels and toolbar. Renders FROM state, calls actions.
   No Three.js here; no direct doc mutation. */

import { PRIMITIVES, FINISHES, ENVIRONMENTS, RECIPES, KEY_CHOICES, recipeByType } from './doc.mjs?v=5'

const $ = sel => document.querySelector(sel)

export function initUI (state, actions) {
  const treeEl = $('#tree')
  const propsEl = $('#props')
  const addEl = $('#add-palette')

  // ---------------------------------------------------------------- add palette
  const SHAPE_GLYPHS = {
    box: '<rect x="5" y="7" width="14" height="12" rx="1.5"/><path d="M5 7l3-3h14l-3 3M19 7l3-3v12l-3 3" fill="none"/>',
    sphere: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3" fill="none"/>',
    cylinder: '<path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><ellipse cx="12" cy="6" rx="7" ry="3"/>',
    cone: '<path d="M12 3L4 18h16z"/><ellipse cx="12" cy="18" rx="8" ry="2.6"/>',
    torus: '<circle cx="12" cy="12" r="8" fill="none" stroke-width="4.5"/>',
    capsule: '<rect x="7" y="4" width="10" height="16" rx="5"/>',
    icosahedron: '<path d="M12 2l8 6-3 10H7L4 8z"/><path d="M12 2v20M4 8l8 4 8-4M7 18l5-6 5 6" fill="none"/>'
  }
  for (const p of PRIMITIVES) {
    const b = document.createElement('button')
    b.className = 'add-btn'
    b.title = 'Add ' + p.label
    b.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" fill="currentColor" fill-opacity="0.25" stroke-width="1.6" stroke-linejoin="round">${SHAPE_GLYPHS[p.type]}</svg><span>${p.label}</span>`
    b.addEventListener('click', () => actions.addPrimitive(p.type))
    addEl.appendChild(b)
  }

  // ---------------------------------------------------------------- add model
  const modelUrl = $('#model-url')
  const modelErr = $('#model-error')
  $('#model-add').addEventListener('click', () => {
    const r = actions.addModel(modelUrl.value)
    if (r.ok) { modelUrl.value = ''; modelErr.textContent = '' } else { modelErr.textContent = r.error }
  })
  modelUrl.addEventListener('keydown', e => { if (e.key === 'Enter') $('#model-add').click() })

  // ---------------------------------------------------------------- toolbar
  const modeBtns = { translate: $('#tb-move'), rotate: $('#tb-rotate'), scale: $('#tb-scale') }
  modeBtns.translate.addEventListener('click', () => actions.setGizmoMode('translate'))
  modeBtns.rotate.addEventListener('click', () => actions.setGizmoMode('rotate'))
  modeBtns.scale.addEventListener('click', () => actions.setGizmoMode('scale'))
  $('#tb-snap').addEventListener('click', () => actions.toggleSnap())
  $('#tb-undo').addEventListener('click', () => actions.undo())
  $('#tb-redo').addEventListener('click', () => actions.redo())
  $('#tb-dup').addEventListener('click', () => actions.duplicateSelected())
  $('#tb-del').addEventListener('click', () => actions.deleteSelected())
  $('#tb-theme').addEventListener('click', () => actions.toggleTheme())
  $('#tb-play').addEventListener('click', () => actions.togglePlay())

  function refreshToolbar () {
    for (const [mode, btn] of Object.entries(modeBtns)) btn.classList.toggle('active', state.gizmoMode === mode)
    $('#tb-snap').classList.toggle('active', state.snap)
    $('#tb-undo').disabled = !state.undo.length || state.playing
    $('#tb-redo').disabled = !state.redo.length || state.playing
    const has = !!state.selectedId && !state.playing
    $('#tb-dup').disabled = !has
    $('#tb-del').disabled = !has
    const play = $('#tb-play')
    play.classList.toggle('playing', state.playing)
    $('#play-label').textContent = state.playing ? 'Stop' : 'Play'
    $('#play-icon-go').style.display = state.playing ? 'none' : ''
    $('#play-icon-stop').style.display = state.playing ? '' : 'none'
  }

  // ---------------------------------------------------------------- keyboard
  window.addEventListener('keydown', e => {
    if (state.playing) return // play mode owns the keyboard (engine events)
    const tag = (e.target.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); actions.undo(); return }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); actions.redo(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); actions.duplicateSelected(); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { actions.deleteSelected(); return }
    if (e.key === 'w' || e.key === 'W') actions.setGizmoMode('translate')
    if (e.key === 'e' || e.key === 'E') actions.setGizmoMode('rotate')
    if (e.key === 'r' || e.key === 'R') actions.setGizmoMode('scale')
  })

  // ---------------------------------------------------------------- scene tree
  function refreshTree () {
    treeEl.innerHTML = ''
    for (const o of state.doc.objects) {
      const row = document.createElement('div')
      row.className = 'tree-row' + (o.id === state.selectedId ? ' selected' : '') + (o.visible === false ? ' hidden-obj' : '')
      const eye = document.createElement('button')
      eye.className = 'eye'
      eye.title = o.visible === false ? 'Show' : 'Hide'
      eye.textContent = o.visible === false ? '◌' : '●'
      eye.addEventListener('click', ev => { ev.stopPropagation(); actions.toggleVisible(o.id) })
      const name = document.createElement('span')
      name.className = 'tree-name'
      name.textContent = o.name
      name.title = 'Double-click to rename'
      name.addEventListener('dblclick', ev => {
        ev.stopPropagation()
        const input = document.createElement('input')
        input.value = o.name
        input.maxLength = 60
        name.replaceWith(input)
        input.focus(); input.select()
        const done = () => { actions.rename(o.id, input.value || o.name); refreshTree() }
        input.addEventListener('blur', done)
        input.addEventListener('keydown', ke => { if (ke.key === 'Enter') input.blur(); if (ke.key === 'Escape') { input.value = o.name; input.blur() } })
      })
      row.appendChild(eye)
      row.appendChild(name)
      row.addEventListener('click', () => actions.select(o.id))
      treeEl.appendChild(row)
    }
    $('#tree-empty').style.display = state.doc.objects.length ? 'none' : 'block'
    refreshToolbar()
  }

  // ---------------------------------------------------------------- properties
  function numInput (value, step, onInput, onCommit) {
    const i = document.createElement('input')
    i.type = 'number'
    i.step = step
    i.value = Math.round(value * 1000) / 1000
    i.addEventListener('input', () => { const v = parseFloat(i.value); if (!isNaN(v)) onInput(v) })
    i.addEventListener('change', () => { const v = parseFloat(i.value); if (!isNaN(v)) onCommit(v) })
    return i
  }

  function vecRow (label, vec, step, apply) {
    const row = document.createElement('div')
    row.className = 'prop-row'
    row.innerHTML = `<label>${label}</label>`
    const wrap = document.createElement('div')
    wrap.className = 'vec3'
    vec.forEach((v, idx) => {
      wrap.appendChild(numInput(v, step,
        nv => { const c = vec.slice(); c[idx] = nv; apply(c, false) },
        nv => { const c = vec.slice(); c[idx] = nv; apply(c, true) }))
    })
    row.appendChild(wrap)
    return row
  }

  function sliderRow (label, value, min, max, step, onStream, onCommit) {
    const row = document.createElement('div')
    row.className = 'prop-row'
    row.innerHTML = `<label>${label}</label>`
    const s = document.createElement('input')
    s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value
    s.addEventListener('input', () => onStream(parseFloat(s.value)))
    s.addEventListener('change', () => onCommit(parseFloat(s.value)))
    row.appendChild(s)
    return row
  }

  const R2D = 180 / Math.PI
  const D2R = Math.PI / 180

  function refreshProperties () {
    propsEl.innerHTML = ''
    const o = state.doc.objects.find(x => x.id === state.selectedId)
    if (!o) { refreshEnvironmentPanel(); return }

    const h = document.createElement('h3')
    h.textContent = o.name
    propsEl.appendChild(h)

    const sec1 = section('Position, rotation, size')
    sec1.appendChild(vecRow('Position', o.transform.p, 0.25, (v, commit) => actions.setTransform(o.id, { p: v }, commit)))
    sec1.appendChild(vecRow('Rotation°', o.transform.r.map(r => Math.round(r * R2D)), 15, (v, commit) => actions.setTransform(o.id, { r: v.map(d => d * D2R) }, commit)))
    sec1.appendChild(vecRow('Scale', o.transform.s, 0.1, (v, commit) => actions.setTransform(o.id, { s: v }, commit)))
    propsEl.appendChild(sec1)

    if (o.type === 'model') {
      const secM = section('Model')
      secM.appendChild(sliderRow('Size', o.params.fit || 1.5, 0.3, 4, 0.1,
        () => {}, // rebuilding per input tick would re-fetch; commit only
        v => actions.setModelFit(o.id, v, true)))
      const link = document.createElement('p')
      link.className = 'panel-hint model-link'
      link.textContent = o.params.url
      link.title = o.params.url
      secM.appendChild(link)
      const status = window.SceneMakerApp && SceneMakerApp.modelStatus(o.id)
      if (status && status.error) {
        const err = document.createElement('p')
        err.className = 'panel-hint model-error-note'
        err.textContent = 'Could not load this model. Check the link points to a .glb file.'
        secM.appendChild(err)
      }
      propsEl.appendChild(secM)
      propsEl.appendChild(recipeSection(o))
      return
    }

    const sec2 = section('Material')
    const colorRow = document.createElement('div')
    colorRow.className = 'prop-row'
    colorRow.innerHTML = '<label>Color</label>'
    const color = document.createElement('input')
    color.type = 'color'
    color.value = o.material.color
    color.addEventListener('input', () => actions.setMaterial(o.id, { color: color.value }, false))
    color.addEventListener('change', () => actions.setMaterial(o.id, { color: color.value }, true))
    colorRow.appendChild(color)
    sec2.appendChild(colorRow)

    const finishRow = document.createElement('div')
    finishRow.className = 'finish-grid'
    for (const f of FINISHES) {
      const b = document.createElement('button')
      b.className = 'finish-btn' + (o.material.finish === f.id ? ' active' : '')
      b.textContent = f.label
      b.addEventListener('click', () => { actions.applyFinish(o.id, f.id, f.values); refreshProperties() })
      finishRow.appendChild(b)
    }
    sec2.appendChild(finishRow)

    sec2.appendChild(sliderRow('Shine', 1 - (o.material.roughness ?? 0.5), 0, 1, 0.01,
      v => actions.setMaterial(o.id, { roughness: 1 - v }, false),
      v => actions.setMaterial(o.id, { roughness: 1 - v }, true)))
    sec2.appendChild(sliderRow('Metal', o.material.metalness ?? 0, 0, 1, 0.01,
      v => actions.setMaterial(o.id, { metalness: v }, false),
      v => actions.setMaterial(o.id, { metalness: v }, true)))
    sec2.appendChild(sliderRow('Glow', o.material.emissiveIntensity ?? 0, 0, 2, 0.01,
      v => actions.setMaterial(o.id, { emissiveIntensity: v }, false),
      v => actions.setMaterial(o.id, { emissiveIntensity: v }, true)))
    sec2.appendChild(sliderRow('Solid', o.material.opacity ?? 1, 0.15, 1, 0.01,
      v => actions.setMaterial(o.id, { opacity: v }, false),
      v => actions.setMaterial(o.id, { opacity: v }, true)))
    propsEl.appendChild(sec2)

    propsEl.appendChild(recipeSection(o))
  }

  // "Bring it to life": add interaction recipes, tune them, press Play.
  function recipeSection (o) {
    const sec = section('Bring it to life')

    const mine = state.doc.recipes.filter(r => r.object === o.id)
    for (const r of mine) {
      const def = recipeByType(r.type)
      const chip = document.createElement('div')
      chip.className = 'recipe-chip'
      const head = document.createElement('div')
      head.className = 'recipe-head'
      const title = document.createElement('span')
      title.textContent = def.label
      const del = document.createElement('button')
      del.className = 'recipe-del'
      del.title = 'Remove'
      del.textContent = '✕'
      del.addEventListener('click', () => actions.removeRecipe(r.id))
      head.appendChild(title)
      head.appendChild(del)
      chip.appendChild(head)

      chip.appendChild(sliderRow(def.param.label, r.params[def.param.key], def.param.min, def.param.max, def.param.step,
        v => actions.setRecipeParam(r.id, def.param.key, v, false),
        v => actions.setRecipeParam(r.id, def.param.key, v, true)))

      if (def.keyParam) {
        const row = document.createElement('div')
        row.className = 'prop-row'
        row.innerHTML = '<label>Which key</label>'
        const sel = document.createElement('select')
        for (const k of KEY_CHOICES) {
          const opt = document.createElement('option')
          opt.value = k.id; opt.textContent = k.label
          if (r.params.pressKey === k.id) opt.selected = true
          sel.appendChild(opt)
        }
        sel.addEventListener('change', () => actions.setRecipeParam(r.id, 'pressKey', sel.value, true))
        row.appendChild(sel)
        chip.appendChild(row)
      }
      sec.appendChild(chip)
    }

    const grid = document.createElement('div')
    grid.className = 'recipe-grid'
    for (const def of RECIPES) {
      if (o.type === 'model' && def.materialOnly) continue
      const has = mine.find(r => r.type === def.type)
      const b = document.createElement('button')
      b.className = 'recipe-btn'
      b.textContent = '+ ' + def.label
      b.disabled = !!has
      b.addEventListener('click', () => actions.addRecipe(o.id, def.type))
      grid.appendChild(b)
    }
    sec.appendChild(grid)

    const hint = document.createElement('p')
    hint.className = 'panel-hint recipe-hint'
    hint.textContent = mine.length
      ? 'Press Play to try it!'
      : 'Pick one, then press Play to try it.'
    sec.appendChild(hint)
    return sec
  }

  function section (title) {
    const d = document.createElement('div')
    d.className = 'prop-section'
    const t = document.createElement('h4')
    t.textContent = title
    d.appendChild(t)
    return d
  }

  // Environment panel shows when nothing is selected.
  function refreshEnvironmentPanel () {
    const h = document.createElement('h3')
    h.textContent = 'Scene'
    propsEl.appendChild(h)
    const sec = section('Environment')
    const grid = document.createElement('div')
    grid.className = 'env-grid'
    for (const env of ENVIRONMENTS) {
      const b = document.createElement('button')
      b.className = 'env-btn' + (state.doc.environment.preset === env.id ? ' active' : '')
      b.innerHTML = `<span class="env-chip" style="background:linear-gradient(180deg, ${env.bg} 55%, ${env.ground} 55%)"></span>${env.label}`
      b.addEventListener('click', () => { actions.setEnvironment({ preset: env.id }); refreshProperties() })
      grid.appendChild(b)
    }
    sec.appendChild(grid)

    const groundRow = document.createElement('div')
    groundRow.className = 'prop-row'
    groundRow.innerHTML = '<label>Floor</label>'
    const g = document.createElement('input')
    g.type = 'checkbox'
    g.checked = state.doc.environment.ground.visible !== false
    g.addEventListener('change', () => { actions.setEnvironment({ ground: { visible: g.checked } }); })
    groundRow.appendChild(g)
    sec.appendChild(groundRow)

    const fogRow = document.createElement('div')
    fogRow.className = 'prop-row'
    fogRow.innerHTML = '<label>Distance fog</label>'
    const f = document.createElement('input')
    f.type = 'checkbox'
    f.checked = state.doc.environment.fog !== false
    f.addEventListener('change', () => { actions.setEnvironment({ fog: f.checked }) })
    fogRow.appendChild(f)
    sec.appendChild(fogRow)

    propsEl.appendChild(sec)
    const hint = document.createElement('p')
    hint.className = 'panel-hint'
    hint.textContent = 'Click a shape to edit it. W move, E rotate, R scale. Double-click a name to rename.'
    propsEl.appendChild(hint)
  }

  function refreshAll () {
    refreshTree()
    refreshProperties()
    refreshToolbar()
  }

  return { refreshAll, refreshTree, refreshProperties, refreshToolbar }
}
