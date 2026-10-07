import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CircuitBoard, FileUp, FlipHorizontal2, Layers3, Minus, Plus, RotateCcw, RotateCw, Search, Target, X } from 'lucide-react'
import './boardview.css'
import { buildEnergyGraph, traceEnergy } from './graph/energyGraph.js'
import { defaultEnergyRules, normalizeEnergyRules } from './rules/energyRules.js'
import { emptyAnnotations, loadAnnotations, loadEnergyRules, normalizeAnnotations, parseAnnotationBackup, saveAnnotations, saveEnergyRules, annotationBackup } from './storage/annotations.js'
import { clearBoardviewCache, loadBoardviewCache, saveBoardviewCache } from './storage/boardCache.js'
import { BoardviewLocalAnnotationsPanel } from './ui/BoardviewAnalysisPanel.jsx'
import { classifyDesignator, normalizeComponentTypeRules } from './model/componentTypes.js'
import { loadComponentTypeRules, saveComponentTypeRules } from './storage/componentTypes.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const sideLabel = side => side === 'bottom' ? 'Inferior (Bottom)' : side === 'both' ? 'Ambos os lados' : 'Superior (Top)'
const formatNumber = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2).replace(/\.00$/, '') : '—'
const componentStateLabels = { suspect: 'Suspeito', verified: 'Verificado OK', defective: 'Defeituoso' }

function buildRatsnest(points, limit = 180) {
  if (points.length < 2) return []
  const stride = Math.max(1, Math.ceil(points.length / limit))
  const sample = points.filter((_, index) => index % stride === 0).slice(0, limit)
  if (sample.length < 2) return []
  const connected = [0]
  const remaining = new Set(sample.map((_, index) => index).slice(1))
  const segments = []
  while (remaining.size) {
    let best = null
    for (const fromIndex of connected) {
      for (const toIndex of remaining) {
        const from = sample[fromIndex]; const to = sample[toIndex]
        const distance = Math.hypot(from.x - to.x, from.y - to.y)
        if (!best || distance < best.distance) best = { fromIndex, toIndex, distance }
      }
    }
    if (!best) break
    segments.push([sample[best.fromIndex], sample[best.toIndex]])
    connected.push(best.toIndex)
    remaining.delete(best.toIndex)
  }
  return segments
}

function netEntries(board, netName, anchor) {
  if (!board || !netName) return []
  const entries = []
  for (const component of board.components) {
    for (const pin of component.pins) {
      if (pin.netName !== netName) continue
      entries.push({ component, pin, distance: anchor ? Math.hypot(pin.x - anchor.x, pin.y - anchor.y) : 0 })
    }
  }
  return entries.sort((left, right) => left.distance - right.distance || left.component.designator.localeCompare(right.component.designator, 'pt-BR', { numeric: true }))
}

function hashBuffer(buffer) {
  if (globalThis.crypto?.subtle) return crypto.subtle.digest('SHA-256', buffer).then(bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''))
  let hash = 2166136261
  for (const value of new Uint8Array(buffer)) hash = Math.imul(hash ^ value, 16777619)
  return Promise.resolve((hash >>> 0).toString(16).padStart(8, '0'))
}

const importantComponentTypes = new Set(['ic', 'mosfet', 'connector', 'fuse', 'inductor', 'diode', 'switch', 'crystal', 'battery'])
const componentFallbackSize = type => ({ ic: [75, 55], mosfet: [34, 24], connector: [58, 42], diode: [30, 18], capacitor: [24, 14], resistor: [32, 14], inductor: [34, 18], fuse: [36, 15], switch: [36, 24], crystal: [32, 18] }[type] || [28, 22])
const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); return }
  ctx.beginPath(); ctx.rect(x, y, width, height)
}

function drawComponentSymbol(ctx, component, anchor, width, height, isSelected, colors, viewRotation = 0) {
  const type = component.componentType || 'unknown'
  const rotation = ((Number(component.rotation) || 0) + viewRotation) * Math.PI / 180
  const packageName = String(component.package || '').toUpperCase()
  const bodyFill = type === 'ic' ? '#1b3037' : type === 'mosfet' ? '#24383d' : type === 'connector' ? '#263c42' : colors.fill
  const padFill = isSelected ? '#ffe4a3' : '#c7a15d'
  const padStroke = isSelected ? '#fff0c2' : '#80683b'
  ctx.save()
  ctx.translate(anchor.x, anchor.y)
  ctx.rotate(rotation)
  ctx.strokeStyle = colors.stroke; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.lineWidth = isSelected ? 2.2 : 1.15
  const x = -width / 2; const y = -height / 2
  const pad = (padX, padY, padWidth, padHeight) => { drawRoundedRect(ctx, padX, padY, padWidth, padHeight, Math.min(2, padHeight / 3)); ctx.fillStyle = padFill; ctx.fill(); ctx.strokeStyle = padStroke; ctx.lineWidth = .7; ctx.stroke() }
  const body = (bodyX, bodyY, bodyWidth, bodyHeight, radius = 2, fill = bodyFill) => { drawRoundedRect(ctx, bodyX, bodyY, bodyWidth, bodyHeight, radius); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = colors.stroke; ctx.lineWidth = isSelected ? 1.8 : 1.05; ctx.stroke() }
  const endPadWidth = Math.max(width * .17, 2.5); const endPadHeight = Math.max(height * .52, 2.5)
  if (isSelected) { ctx.globalAlpha = .25; ctx.strokeStyle = colors.stroke; ctx.lineWidth = 4; drawRoundedRect(ctx, x - 3, y - 3, width + 6, height + 6, 4); ctx.stroke(); ctx.globalAlpha = 1 }
  if (type === 'resistor') {
    pad(x + width * .02, -endPadHeight / 2, endPadWidth, endPadHeight); pad(x + width * .81, -endPadHeight / 2, endPadWidth, endPadHeight)
    body(x + width * .2, y + height * .16, width * .6, height * .68, 2, '#5d5141')
    ctx.fillStyle = '#d1b77a'; ctx.fillRect(x + width * .42, y + height * .2, Math.max(1.5, width * .055), height * .6); ctx.fillRect(x + width * .58, y + height * .2, Math.max(1.5, width * .055), height * .6)
  } else if (type === 'capacitor') {
    pad(x + width * .02, -endPadHeight / 2, endPadWidth, endPadHeight); pad(x + width * .81, -endPadHeight / 2, endPadWidth, endPadHeight)
    body(x + width * .22, y + height * .08, width * .56, height * .84, 2, '#b9a57b')
    ctx.strokeStyle = '#806f4d'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(0, y + height * .16); ctx.lineTo(0, y + height * .84); ctx.stroke()
  } else if (type === 'inductor' || type === 'ferrite') {
    pad(x + width * .02, -endPadHeight / 2, endPadWidth, endPadHeight); pad(x + width * .81, -endPadHeight / 2, endPadWidth, endPadHeight)
    body(x + width * .2, y + height * .13, width * .6, height * .74, 2, '#4d5552')
    ctx.strokeStyle = '#a9c0b1'; ctx.lineWidth = 1; for (let index = -1; index <= 1; index += 1) { ctx.beginPath(); ctx.moveTo(index * width * .13, y + height * .22); ctx.lineTo(index * width * .13, y + height * .78); ctx.stroke() }
  } else if (type === 'diode') {
    pad(x + width * .02, -endPadHeight / 2, endPadWidth, endPadHeight); pad(x + width * .81, -endPadHeight / 2, endPadWidth, endPadHeight)
    body(x + width * .2, y + height * .08, width * .6, height * .84, 2, '#5c6460')
    ctx.strokeStyle = '#e8eee6'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + width * .62, y + height * .16); ctx.lineTo(x + width * .62, y + height * .84); ctx.stroke()
  } else if (type === 'fuse') {
    pad(x + width * .02, -endPadHeight / 2, endPadWidth, endPadHeight); pad(x + width * .81, -endPadHeight / 2, endPadWidth, endPadHeight); body(x + width * .2, y + height * .13, width * .6, height * .74, 2, '#7a6652')
    ctx.strokeStyle = '#f3d38a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + width * .3, 0); ctx.lineTo(x + width * .7, 0); ctx.stroke()
  } else if (type === 'mosfet') {
    body(x + width * .18, y, width * .64, height, 3, '#1f353a'); ctx.fillStyle = '#87a69d'; ctx.beginPath(); ctx.arc(x + width * .29, y + height * .18, Math.max(1.5, height * .07), 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#75a598'; ctx.lineWidth = .9; ctx.beginPath(); ctx.moveTo(x + width * .42, y + height * .2); ctx.lineTo(x + width * .42, y + height * .8); ctx.stroke(); for (const offset of [-.3, -.1, .1, .3]) { ctx.strokeStyle = padStroke; ctx.beginPath(); ctx.moveTo(x + width * .03, offset * height); ctx.lineTo(x + width * .18, offset * height); ctx.moveTo(x + width * .82, offset * height); ctx.lineTo(x + width * .97, offset * height); ctx.stroke() }
  } else if (type === 'ic') {
    const qfn = /QFN|DFN|BGA|LGA/i.test(packageName); body(x, y, width, height, qfn ? 5 : 3, qfn ? '#182c31' : bodyFill)
    ctx.fillStyle = colors.stroke; ctx.beginPath(); ctx.arc(x + width * .18, y + height * .2, Math.max(1.5, height * .06), 0, Math.PI * 2); ctx.fill()
    if (qfn) { ctx.strokeStyle = '#6eaba0'; ctx.lineWidth = .8; ctx.strokeRect(x + width * .2, y + height * .2, width * .6, height * .6) }
  } else if (type === 'connector') {
    body(x, y, width, height, 3, bodyFill); const holes = Math.min(8, Math.max(2, component.pins.length)); for (let index = 0; index < holes; index += 1) { const px = x + width * (.16 + (index / Math.max(1, holes - 1)) * .68); ctx.beginPath(); ctx.arc(px, y + height * .5, Math.max(1.5, height * .1), 0, Math.PI * 2); ctx.fillStyle = colors.pin; ctx.fill(); ctx.strokeStyle = '#0b171b'; ctx.stroke() }
  } else if (type === 'switch' || type === 'crystal' || type === 'battery') {
    body(x, y, width, height, 3, bodyFill); ctx.strokeStyle = '#a8c7bc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + width * .25, y + height * .65); ctx.lineTo(x + width * .72, y + height * .35); ctx.stroke()
  } else {
    body(x, y, width, height, 2, '#17272c'); ctx.strokeStyle = '#78928f'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(x + width * .25, 0); ctx.lineTo(x + width * .75, 0); ctx.moveTo(0, y + height * .25); ctx.lineTo(0, y + height * .75); ctx.stroke()
  }
  ctx.restore()
}

function BoardCanvas({ board, side, mirror, zoom, pan, onViewChange, selectedDesignator, selectedNet, showNetConnectivity, outlineEditing, outlineDraft, onOutlinePoint, onSelect, energyTrace, annotations }) {
  const canvasRef = useRef(null)
  const pointerRef = useRef(null)
  const metricsRef = useRef(null)
  const [rotation, setRotation] = useState(0)

  useEffect(() => { setRotation(0) }, [board])

  const visibleComponents = useMemo(() => board.components.filter(component => component.componentType !== 'test-point' && (side === 'both' || component.side === 'both' || component.side === side)), [board, side])

  const getBounds = () => {
    const points = board.contour.length ? board.contour : board.components.flatMap(component => component.pins.length ? component.pins : [{ x: component.x, y: component.y }])
    if (!points.length) return { minX: -100, maxX: 100, minY: -100, maxY: 100, centerX: 0, centerY: 0, scale: 1 }
    const xs = points.map(point => point.x); const ys = points.map(point => point.y)
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2; const centerY = (Math.min(...ys) + Math.max(...ys)) / 2
    const radians = rotation * Math.PI / 180; const cos = Math.cos(radians); const sin = Math.sin(radians)
    const rotated = points.map(point => { const dx = point.x - centerX; const dy = point.y - centerY; return { x: centerX + dx * cos - dy * sin, y: centerY + dx * sin + dy * cos } })
    const rotatedXs = rotated.map(point => point.x); const rotatedYs = rotated.map(point => point.y)
    return { minX: Math.min(...rotatedXs), maxX: Math.max(...rotatedXs), minY: Math.min(...rotatedYs), maxY: Math.max(...rotatedYs), centerX, centerY }
  }

  const transform = (worldX, worldY, metrics, view = { zoom, pan, mirror, rotation }) => {
    const mirrorX = (view.mirror ? -1 : 1) * (worldX - metrics.centerX)
    const mirrorY = worldY - metrics.centerY
    const radians = (view.rotation || 0) * Math.PI / 180
    const x = metrics.centerX + mirrorX * Math.cos(radians) - mirrorY * Math.sin(radians)
    const y = metrics.centerY + mirrorX * Math.sin(radians) + mirrorY * Math.cos(radians)
    return {
      x: metrics.width / 2 + view.pan.x + (x - metrics.centerX) * metrics.scale * view.zoom,
      y: metrics.height / 2 + view.pan.y + (y - metrics.centerY) * metrics.scale * view.zoom,
    }
  }

  const inverse = (screenX, screenY, metrics, view = { zoom, pan, mirror, rotation }) => {
    const rotatedX = metrics.centerX + (screenX - metrics.width / 2 - view.pan.x) / (metrics.scale * view.zoom)
    const rotatedY = metrics.centerY + (screenY - metrics.height / 2 - view.pan.y) / (metrics.scale * view.zoom)
    const radians = (view.rotation || 0) * Math.PI / 180
    const dx = rotatedX - metrics.centerX; const dy = rotatedY - metrics.centerY
    const unrotatedX = dx * Math.cos(radians) + dy * Math.sin(radians)
    const unrotatedY = -dx * Math.sin(radians) + dy * Math.cos(radians)
    return {
      x: metrics.centerX + (view.mirror ? -1 : 1) * unrotatedX,
      y: metrics.centerY + unrotatedY,
    }
  }

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas || !board) return
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    const width = Math.max(1, rect.width); const height = Math.max(1, rect.height)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#081116'; ctx.fillRect(0, 0, width, height)
    const bounds = getBounds()
    const worldWidth = Math.max(bounds.maxX - bounds.minX, 1); const worldHeight = Math.max(bounds.maxY - bounds.minY, 1)
    const scale = Math.min((width - 68) / worldWidth, (height - 68) / worldHeight)
    const metrics = { ...bounds, width, height, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 }
    metricsRef.current = metrics
    const detailLevel = zoom < .95 ? 0 : zoom < 1.45 ? 1 : zoom < 2.35 ? 2 : 3

    ctx.strokeStyle = '#142a32'; ctx.lineWidth = 1
    for (let x = width / 2 + (pan.x % 42); x < width; x += 42) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke() }
    for (let x = width / 2 + (pan.x % 42); x > 0; x -= 42) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke() }
    for (let y = height / 2 + (pan.y % 42); y < height; y += 42) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
    for (let y = height / 2 + (pan.y % 42); y > 0; y -= 42) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }

    if (board.contour.length > 2) {
      ctx.beginPath()
      board.contour.forEach((point, index) => { const screen = transform(point.x, point.y, metrics); index ? ctx.lineTo(screen.x, screen.y) : ctx.moveTo(screen.x, screen.y) })
      ctx.closePath(); ctx.fillStyle = '#112a2a'; ctx.fill(); ctx.strokeStyle = '#3d8a7a'; ctx.lineWidth = 2; ctx.stroke()
    }

    ctx.fillStyle = board.contourSource === 'estimated' ? '#e2bb67' : '#9dbab5'
    ctx.font = '600 11px DM Sans, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(board.contourLabel || 'Contorno não informado', 14, 13)

    const drawEnergyNets = (netNames, color, lineWidth) => {
      for (const netName of netNames || []) {
        const selectedPins = visibleComponents.flatMap(component => component.pins.filter(pin => pin.netName === netName).map(pin => ({ ...pin, component: component.designator })))
        for (const [from, to] of buildRatsnest(selectedPins, 120)) {
          const fromPoint = transform(from.x, from.y, metrics); const toPoint = transform(to.x, to.y, metrics)
          ctx.beginPath(); ctx.moveTo(fromPoint.x, fromPoint.y); ctx.lineTo(toPoint.x, toPoint.y)
          ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke()
        }
      }
    }
    if (energyTrace?.active) drawEnergyNets(energyTrace.redNets, '#ef5555cc', 2.4)
    const selectedNetSize = Number(board.nets.find(net => net.name === selectedNet)?.pins?.length || 0)
    const focusedNetDesignators = new Set()
    if (selectedNet) {
      const netComponents = visibleComponents.filter(component => component.pins.some(pin => pin.netName === selectedNet))
      const anchor = netComponents.find(component => component.designator === selectedDesignator) || netComponents[0]
      if (anchor) {
        focusedNetDesignators.add(anchor.designator)
        const nearest = netComponents.filter(component => component.designator !== anchor.designator).sort((left, right) => Math.hypot(left.x - anchor.x, left.y - anchor.y) - Math.hypot(right.x - anchor.x, right.y - anchor.y))[0]
        if (nearest) focusedNetDesignators.add(nearest.designator)
      }
    }
    const shouldDrawSelectedNet = Boolean(selectedNet && showNetConnectivity)
    if (shouldDrawSelectedNet) {
      const selectedPins = visibleComponents.flatMap(component => component.pins.filter(pin => pin.netName === selectedNet).map(pin => ({ ...pin, component: component.designator })))
      for (const [from, to] of buildRatsnest(selectedPins)) {
        const fromPoint = transform(from.x, from.y, metrics); const toPoint = transform(to.x, to.y, metrics)
        ctx.beginPath(); ctx.moveTo(fromPoint.x, fromPoint.y); ctx.lineTo(toPoint.x, toPoint.y)
        ctx.strokeStyle = '#5be0bd99'; ctx.lineWidth = 1; ctx.stroke()
      }
    }
    const largeNetSelection = selectedNetSize > 80
    for (const component of visibleComponents) {
      const anchor = transform(component.x, component.y, metrics)
      if (anchor.x < -60 || anchor.x > width + 60 || anchor.y < -60 || anchor.y > height + 60) continue
      const isSelected = component.designator === selectedDesignator
      const hasSearchNet = selectedNet && focusedNetDesignators.has(component.designator)
      const isTraceRed = energyTrace?.redComponents?.has(component.designator)
      const isTraceOrange = energyTrace?.orangeComponents?.has(component.designator)
      const isProbablyOk = energyTrace?.probablyOkComponents?.has(component.designator)
      const isMeasuredOk = annotations?.measurements?.some(measurement => measurement.componentDesignator === component.designator && (measurement.status === 'ok' || measurement.status === 'voltage'))
      const netMember = selectedNet && focusedNetDesignators.has(component.designator)
      const fallback = componentFallbackSize(component.componentType)
      const worldWidth = Number(component.dimensions?.width) || fallback[0] / Math.max(metrics.scale * zoom, .001)
      const worldHeight = Number(component.dimensions?.height) || fallback[1] / Math.max(metrics.scale * zoom, .001)
      const importantByType = importantComponentTypes.has(component.componentType) || component.pins.length >= 8
      const minimumWidth = importantByType ? fallback[0] * .65 : detailLevel >= 3 ? fallback[0] * .5 : detailLevel >= 2 ? 5 : 2.5
      const minimumHeight = importantByType ? fallback[1] * .65 : detailLevel >= 3 ? fallback[1] * .5 : detailLevel >= 2 ? 3.5 : 2
      const maximumWidth = importantByType ? Math.max(fallback[0] * 3.2, 8) : detailLevel >= 3 ? Math.max(fallback[0] * 2.4, 8) : 14
      const maximumHeight = importantByType ? Math.max(fallback[1] * 3.2, 7) : detailLevel >= 3 ? Math.max(fallback[1] * 2.4, 7) : 10
      const symbolWidth = clamp(worldWidth * metrics.scale * zoom, minimumWidth, maximumWidth)
      const symbolHeight = clamp(worldHeight * metrics.scale * zoom, minimumHeight, maximumHeight)
      const important = importantComponentTypes.has(component.componentType) || component.pins.length >= 8 || symbolWidth >= 25 || symbolHeight >= 25
      const forceVisible = isSelected || netMember || isTraceRed || isTraceOrange || isProbablyOk || isMeasuredOk
      if (detailLevel <= 1 && !important && !forceVisible) continue
      if (detailLevel === 2 && !important && symbolWidth < 12 && symbolHeight < 8 && !forceVisible) continue
      const showPins = detailLevel >= 3 || isSelected || Boolean(netMember) || Boolean(isTraceRed) || Boolean(isTraceOrange) || important && detailLevel >= 2
      const showLabel = isSelected || detailLevel >= 3 || detailLevel === 2 && (important || symbolWidth >= 18 || component.pins.length >= 2) || detailLevel === 1 && important
      const pinRadius = clamp(2.6 / Math.sqrt(zoom), 1.7, 4.5)
      const footprintColors = { fill: isSelected ? '#d5f8ec' : isTraceRed ? '#5b2227' : isTraceOrange ? '#5b3b1e' : isProbablyOk ? '#30383b' : netMember ? '#315c53' : component.side === 'bottom' ? '#30204a' : '#132d36', stroke: isSelected ? '#67dfbc' : isTraceRed ? '#ef5555' : isTraceOrange ? '#e7a145' : isMeasuredOk ? '#49c58d' : isProbablyOk ? '#929b9d' : netMember ? '#65cdb0' : component.side === 'bottom' ? '#aa7de0' : '#5e8990', pin: netMember ? '#65e0ba' : component.side === 'bottom' ? '#aa7de0' : '#4eabc0' }
      ctx.save(); if (largeNetSelection && !netMember && !isSelected) ctx.globalAlpha = .24
      if (showPins) for (const pin of component.pins) {
        const point = transform(pin.x, pin.y, metrics)
        if (point.x < -10 || point.x > width + 10 || point.y < -10 || point.y > height + 10) continue
        const active = selectedNet && pin.netName === selectedNet
        const energyPin = energyTrace?.redNets?.has(pin.netName)
        const size = active ? pinRadius * 2.7 : pinRadius * 1.9
        if (detailLevel >= 2 || active) { drawRoundedRect(ctx, point.x - size / 2, point.y - size / 2, size, size, Math.min(2, size / 3)); ctx.fillStyle = active ? '#65e0ba' : energyPin ? '#ef5555' : (hasSearchNet ? '#b9d66d' : footprintColors.pin); ctx.fill(); if (active) { ctx.strokeStyle = '#c1ffe9'; ctx.lineWidth = 1.5; ctx.stroke() } } else { ctx.beginPath(); ctx.arc(point.x, point.y, active ? pinRadius + 3 : pinRadius, 0, Math.PI * 2); ctx.fillStyle = active ? '#65e0ba' : energyPin ? '#ef5555' : (hasSearchNet ? '#b9d66d' : footprintColors.pin); ctx.fill() }
      }
      drawComponentSymbol(ctx, component, anchor, symbolWidth, symbolHeight, isSelected, footprintColors, rotation)
      if (showLabel) {
        ctx.fillStyle = isSelected ? '#eafff7' : '#bbd1d0'; ctx.font = `${isSelected ? '600 ' : ''}${clamp(10 + zoom * 2, 10, 15)}px DM Sans, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(component.designator, anchor.x, anchor.y - symbolHeight / 2 - 3)
      }
      if (isMeasuredOk) { ctx.beginPath(); ctx.arc(anchor.x + symbolWidth * .38, anchor.y - symbolHeight * .38, 3.2, 0, Math.PI * 2); ctx.fillStyle = '#49c58d'; ctx.fill() }
      ctx.restore()
    }
    if (outlineEditing && outlineDraft?.length) {
      ctx.beginPath(); outlineDraft.forEach((point, index) => { const screen = transform(point.x, point.y, metrics); index ? ctx.lineTo(screen.x, screen.y) : ctx.moveTo(screen.x, screen.y) }); ctx.strokeStyle = '#f3c66d'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([])
      outlineDraft.forEach(point => { const screen = transform(point.x, point.y, metrics); ctx.beginPath(); ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#f3c66d'; ctx.fill() })
    }
    ctx.fillStyle = '#769192'; ctx.font = '11px DM Sans, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${board.stats.components.toLocaleString('pt-BR')} componentes · ${board.stats.pins.toLocaleString('pt-BR')} pinos`, 14, height - 13)
  }

  useEffect(() => {
    draw()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw)
    if (observer && canvasRef.current) observer.observe(canvasRef.current)
    return () => observer?.disconnect()
  }, [board, side, mirror, rotation, zoom, pan, selectedDesignator, selectedNet, showNetConnectivity, outlineEditing, outlineDraft, energyTrace, annotations])

  const hitTest = event => {
    const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect(); const metrics = metricsRef.current
    if (!metrics) return null
    const world = inverse(event.clientX - rect.left, event.clientY - rect.top, metrics)
    const pointRadius = 10 / (metrics.scale * zoom)
    let closestPin = null; let closestDistance = Infinity
    for (const component of visibleComponents) {
      for (const pin of component.pins) {
        const distance = Math.hypot(pin.x - world.x, pin.y - world.y)
        if (distance < pointRadius && distance < closestDistance) { closestPin = { component, pin }; closestDistance = distance }
      }
    }
    if (closestPin) return { type: 'pin', ...closestPin }
    const component = visibleComponents.find(item => {
      const distance = Math.hypot(item.x - world.x, item.y - world.y)
      return distance < 16 / (metrics.scale * zoom)
    })
    return component ? { type: 'component', component } : null
  }

  const onPointerDown = event => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan, moved: false }
  }
  const onPointerMove = event => {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return
    const dx = event.clientX - pointer.x; const dy = event.clientY - pointer.y
    if (Math.hypot(dx, dy) > 3) pointer.moved = true
    if (pointer.moved) onViewChange({ pan: { x: pointer.pan.x + dx, y: pointer.pan.y + dy } })
  }
  const onPointerUp = event => {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return
    if (!pointer.moved) {
      if (outlineEditing) onOutlinePoint?.(inverse(event.clientX - canvasRef.current.getBoundingClientRect().left, event.clientY - canvasRef.current.getBoundingClientRect().top, metricsRef.current))
      else onSelect(hitTest(event))
    }
    pointerRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  const onWheel = event => {
    event.preventDefault()
    event.stopPropagation()
    const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect(); const metrics = metricsRef.current
    if (!metrics) return
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const before = inverse(cursor.x, cursor.y, metrics)
    const nextZoom = clamp(zoom * (event.deltaY < 0 ? 1.14 : .88), .2, 8)
    const after = transform(before.x, before.y, metrics, { zoom: nextZoom, pan, mirror, rotation })
    onViewChange({ zoom: nextZoom, pan: { x: pan.x + cursor.x - after.x, y: pan.y + cursor.y - after.y } })
  }

  return <div className="boardview-canvas-wrap"><canvas ref={canvasRef} className={`boardview-canvas${outlineEditing ? ' outline-editing' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { pointerRef.current = null }} onWheel={onWheel} aria-label="Mapa da placa" /><button type="button" className="boardview-rotate-button" onClick={() => setRotation(current => (current + 90) % 360)} title={`Girar placa 90 graus · rotação atual ${rotation} graus`}><RotateCw size={15} /><span>Girar 90°</span></button><span className="boardview-rotation-badge" aria-live="polite">{rotation}°</span></div>
}

const netMeaning = name => {
  const value = String(name || '')
  if (/GND|GROUND|VSS|AGND/i.test(value)) return { label: 'Terra / referência elétrica', icon: '🌎', confidence: 'identificado pelo nome' }
  const voltage = value.match(/(?:^|[^0-9])((?:1V8)|(?:3V3)|(?:5V)|(?:12V)|(?:19V))(?=[^0-9]|$)/i)?.[1]
  if (voltage || /VIN|VCC|VDD|VBAT|VBUS|DCIN|ADAPTER|POWER/i.test(value)) return { label: voltage ? `Alimentação · provável ${voltage.toUpperCase()}` : 'Alimentação · tensão não informada', icon: '🟠', confidence: 'inferido pelo nome' }
  if (/USB|SATA|PCI|PCIE|HDMI|LVDS|RX|TX|CLK|DATA|SCL|SDA/i.test(value)) return { label: 'Sinal / comunicação', icon: '🔵', confidence: 'inferido pelo nome' }
  return { label: 'Rede elétrica sem tipo deduzido', icon: '◌', confidence: 'desconhecido' }
}

function NetPanel({ netName, entries = [], totalPins = entries.length, componentStates = {}, showConnectivity = false, onToggleConnectivity = () => {}, onStateChange = () => {}, onFocusEntry = () => {} }) {
  if (!netName) return null
  const meaning = netMeaning(netName)
  const huge = totalPins > 80
  return <section className="boardview-net-panel">
    <div className="boardview-net-heading"><div><span className="boardview-kicker">NET SELECIONADA</span><h3>{netName}</h3></div><small>{totalPins.toLocaleString('pt-BR')} ponto(s)</small></div>
    <div className="boardview-net-meaning"><b>{meaning.icon} {meaning.label}</b><small>{meaning.confidence}</small></div>
    <p className="boardview-net-help">Esta conexão possui {totalPins.toLocaleString('pt-BR')} pontos. Todos os pontos destacados pertencem à mesma rede elétrica (net); isso não significa que um componente seja causa ou consequência do outro.</p>
    <button type="button" className={`boardview-net-lines-button${showConnectivity ? ' active' : ''}`} onClick={() => onToggleConnectivity(!showConnectivity)}>{showConnectivity ? 'Ocultar linhas de conectividade' : huge ? 'Desenhar linhas desta net' : 'Mostrar linhas de conectividade'}</button>
    <div className="boardview-net-list">{entries.length ? entries.map(entry => {
      const state = componentStates[entry.component.designator] || ''
      return <div className={`boardview-net-item${state ? ` ${state}` : ''}`} key={`${entry.component.designator}-${entry.pin.number}-${entry.pin.x}-${entry.pin.y}`}>
        <button type="button" className="boardview-net-focus" onClick={() => onFocusEntry(entry)}>
          <span><b>{entry.component.designator}</b><small>{entry.component.value || 'Valor não informado'} · pino {entry.pin.number}</small></span>
          <em>{formatNumber(entry.distance)} u</em>
        </button>
        <select value={state} aria-label={`Estado de ${entry.component.designator}`} onChange={event => onStateChange(entry.component.designator, event.target.value)}>
          <option value="">Sem marcar</option>
          <option value="suspect">{componentStateLabels.suspect}</option>
          <option value="verified">{componentStateLabels.verified}</option>
          <option value="defective">{componentStateLabels.defective}</option>
        </select>
      </div>
    }) : <p className="boardview-muted">Nenhum componente visível está ligado a esta net.</p>}</div>
  </section>
}

function ComponentPanel({ component, selectedNet, selectedNetTotal, showConnectivity, onToggleConnectivity, onSelectNet, netEntries, componentStates, onStateChange, onFocusEntry }) {
  if (!component && !selectedNet) return <aside className="boardview-inspector boardview-empty-inspector"><Target size={23} /><h2>Selecione um componente</h2><p>Clique em um corpo ou pino no mapa para ver os dados e destacar a net.</p></aside>
  const activeEntries = netEntries || component?.__netEntries || []
  const activeStates = componentStates || component?.__componentStates || {}
  const changeState = onStateChange || component?.__onStateChange || (() => {})
  const focusEntry = onFocusEntry || component?.__onFocusEntry || (() => {})
  return <aside className="boardview-inspector">
    {component && <>
      <div className="boardview-inspector-title"><div><span className="boardview-kicker">COMPONENTE</span><h2>{component.designator}</h2><b className="boardview-component-type">{component.typeLabel || 'Tipo desconhecido'}</b></div><span className={`boardview-side-pill ${component.side}`}>{sideLabel(component.side)}</span></div>
      <div className="boardview-component-meta"><span><small>Valor</small><b>{component.value || 'Valor não fornecido pelo arquivo'}</b></span><span><small>Encapsulamento</small><b>{component.package || 'Não fornecido pelo arquivo'}</b></span><span><small>Lado</small><b>{sideLabel(component.side)} {component.side && `(${component.side === 'top' ? 'Top' : component.side === 'bottom' ? 'Bottom' : 'ambos'})`}</b></span><span><small>Posição</small><b>X {formatNumber(component.x)} · Y {formatNumber(component.y)}</b></span></div>
      <div className="boardview-pins-head"><h3>Pinos</h3><small>{component.pins.length} encontrado(s)</small></div>
      <div className="boardview-pin-list">{component.pins.length ? component.pins.map(pin => <button type="button" className={selectedNet === pin.netName ? 'boardview-pin active' : 'boardview-pin'} key={`${component.designator}-${pin.number}-${pin.x}-${pin.y}`} onClick={() => onSelectNet(pin.netName, pin)}><span className="pin-number">{pin.number}</span><span><b>P{pin.number} → {pin.netName || 'UNCONNECTED'}</b><small>X {formatNumber(pin.x)} · Y {formatNumber(pin.y)}</small></span><span className="pin-action">Destacar</span></button>) : <p className="boardview-muted">Este componente não possui posição de pino utilizável.</p>}</div>
      <details className="boardview-technical-data" open><summary>Dados técnicos</summary><pre>{JSON.stringify({ designator: component.designator, value: component.value, package: component.package, side: component.side, position: component.position, rotation: component.rotation, dimensions: component.dimensions, dataConfidence: component.dataConfidence }, null, 2)}</pre></details>
    </>}
    <NetPanel netName={selectedNet} entries={activeEntries} totalPins={selectedNetTotal || activeEntries.length} showConnectivity={showConnectivity} onToggleConnectivity={onToggleConnectivity} componentStates={activeStates} onStateChange={changeState} onFocusEntry={focusEntry} />
  </aside>
}

export class BoardviewErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('BoardView falhou ao renderizar.', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <section className="boardview-error boardview-module-error"><AlertTriangle size={18} /><span><b>O módulo BoardView encontrou um erro e foi interrompido para proteger o restante do Fix.io.</b><small>{this.state.error?.message || 'Erro de renderização desconhecido.'}</small></span><button type="button" onClick={() => window.location.reload()}>Recarregar</button></section>
  }
}

export function BoardviewWorkspace() {
  const [board, setBoard] = useState(null)
  const [fileName, setFileName] = useState('')
  const [fileHash, setFileHash] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedDesignator, setSelectedDesignator] = useState('')
  const [selectedPinNumber, setSelectedPinNumber] = useState('')
  const [selectedNet, setSelectedNet] = useState('')
  const [netAnchor, setNetAnchor] = useState(null)
  const [model, setModel] = useState('')
  const [revision, setRevision] = useState('')
  const [annotations, setAnnotations] = useState(emptyAnnotations)
  const [rules, setRules] = useState(() => loadEnergyRules(defaultEnergyRules))
  const [side, setSide] = useState('top')
  const [mirror, setMirror] = useState(false)
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const [assisted, setAssisted] = useState(true)
  const [showNetConnectivity, setShowNetConnectivity] = useState(false)
  const [componentMode, setComponentMode] = useState('all')
  const [debugOpen, setDebugOpen] = useState(false)
  const [outlineEditing, setOutlineEditing] = useState(false)
  const [outlineDraft, setOutlineDraft] = useState([])
  const [componentTypeRules, setComponentTypeRules] = useState(() => loadComponentTypeRules())
  const [typeRulesText, setTypeRulesText] = useState(() => JSON.stringify(loadComponentTypeRules(), null, 2))
  const workerRef = useRef(null)
  const mountedRef = useRef(true)
  const identityBeforeEditRef = useRef({ model: '', revision: '' })
  const identityEditingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      workerRef.current?.terminate()
    }
  }, [])

  useEffect(() => {
    if (board && !identityEditingRef.current) saveAnnotations(model, revision, annotations)
  }, [board, model, revision, annotations])

  useEffect(() => { saveEnergyRules(rules) }, [rules])
  useEffect(() => { saveComponentTypeRules(componentTypeRules) }, [componentTypeRules])

  useEffect(() => {
    if (!board || !selectedNet || netAnchor) return
    const pin = board.nets.find(net => net.name === selectedNet)?.pins?.[0]
    if (pin) setNetAnchor({ x: pin.x, y: pin.y })
  }, [board, selectedNet, netAnchor])

  const selectedComponentBase = board?.components.find(component => component.designator === selectedDesignator)
  const selectedNetEntries = useMemo(() => netEntries(board, selectedNet, netAnchor || selectedComponentBase), [board, selectedNet, netAnchor, selectedComponentBase])
  const graph = useMemo(() => board ? buildEnergyGraph(board, annotations, rules) : null, [board, annotations, rules])
  const trace = useMemo(() => graph ? traceEnergy(graph, annotations, { depth: annotations.traceDepth }) : { active: false, redComponents: new Set(), redNets: new Set(), orangeComponents: new Set(), probablyOkComponents: new Set(), testOrder: [] }, [graph, annotations])
  const selectedTarget = selectedComponentBase ? { componentDesignator: selectedComponentBase.designator, pinNumber: selectedPinNumber, netName: selectedNet || undefined } : selectedNet ? { netName: selectedNet } : null
  const selectedComponent = selectedComponentBase ? {
    ...selectedComponentBase,
    __netEntries: selectedNetEntries,
    __componentStates: annotations.componentStates,
    __onStateChange: (designator, state) => setAnnotations(current => normalizeAnnotations({ ...current, componentStates: { ...current.componentStates, [designator]: state } })),
    __onFocusEntry: entry => { setSelectedDesignator(entry.component.designator); setSelectedPinNumber(entry.pin.number); setSelectedNet(entry.pin.netName); setNetAnchor({ x: entry.pin.x, y: entry.pin.y }) },
  } : undefined
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query || !board) return { components: [], nets: [] }
    const components = board.components.filter(component => component.componentType !== 'test-point' && (component.designator.toLowerCase().includes(query) || component.value.toLowerCase().includes(query) || component.package.toLowerCase().includes(query) || String(component.typeLabel || '').toLowerCase().includes(query) || String(component.componentType || '').toLowerCase().includes(query))).slice(0, 30)
    const nets = board.nets.filter(net => net.name.toLowerCase().includes(query)).slice(0, 30)
    return { components, nets }
  }, [board, search])

  const updateComponentTypeRules = value => {
    const next = normalizeComponentTypeRules(value)
    setComponentTypeRules(next)
    setTypeRulesText(JSON.stringify(next, null, 2))
    setBoard(current => current ? { ...current, componentTypeRules: next, components: current.components.map(component => { const type = classifyDesignator(component.designator, next); return { ...component, componentType: type.type, typeLabel: type.label, typeDescription: type.description, typeConfidence: type.confidence } }) } : current)
  }

  const parseBoardBuffer = (buffer, name, hash, { saveCache = false } = {}) => {
    setBusy(true); setError(''); setBoard(null); setSelectedDesignator(''); setSelectedPinNumber(''); setSelectedNet(''); setNetAnchor(null); setAnnotations(emptyAnnotations())
    const cacheBuffer = saveCache ? buffer.slice(0) : null
    workerRef.current?.terminate()
    const worker = new Worker(new URL('./parsers/boardview.worker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = event => {
      if (!mountedRef.current) return
      if (event.data?.type === 'success') {
        const importedBoard = event.data.board
        const nextModel = importedBoard.model || name.replace(/\.[^.]+$/, '')
        const nextRevision = importedBoard.revision || ''
        const loadedAnnotations = loadAnnotations(nextModel, nextRevision)
        const manualOutline = loadedAnnotations.outline
        const typedBoard = { ...importedBoard, componentTypeRules, components: importedBoard.components.map(component => { const type = classifyDesignator(component.designator, componentTypeRules); return { ...component, componentType: type.type, typeLabel: type.label, typeDescription: type.description, typeConfidence: type.confidence, dataConfidence: { ...component.dataConfidence, type: type.confidence } } }) }
        const boardWithManualOutline = manualOutline?.length >= 3 ? { ...typedBoard, boardOutline: manualOutline, contour: manualOutline, outlineSource: 'manual', contourSource: 'manual', contourLabel: 'Contorno manual salvo para este modelo/revisão', debug: typedBoard.debug ? { ...typedBoard.debug, explicitOutline: true, outlineSource: 'manual', outlineAlgorithm: 'manual' } : typedBoard.debug } : typedBoard
        setBoard(boardWithManualOutline); setFileName(name); setFileHash(hash); setModel(nextModel); setRevision(nextRevision); setAnnotations(loadedAnnotations); identityBeforeEditRef.current = { model: nextModel, revision: nextRevision }; identityEditingRef.current = false; setSelectedPinNumber(''); setSelectedNet(''); setShowNetConnectivity(false); setSide('top'); setMirror(false); setView({ zoom: 1, pan: { x: 0, y: 0 } }); setOutlineEditing(false); setOutlineDraft([]); setBusy(false)
        if (cacheBuffer) void saveBoardviewCache({ fileName: name, fileHash: hash, buffer: cacheBuffer })
        worker.terminate()
      } else {
        setError(event.data?.message || 'Não foi possível ler o arquivo de boardview.'); setBusy(false); worker.terminate()
      }
    }
    worker.onerror = () => { if (mountedRef.current) { setError('O leitor do boardview falhou ao processar o arquivo. O arquivo original não foi alterado.'); setBusy(false) } worker.terminate() }
    worker.postMessage({ buffer, fileName: name }, [buffer])
  }

  const importBoard = async file => {
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const hash = await hashBuffer(buffer.slice(0))
      parseBoardBuffer(buffer, file.name, hash, { saveCache: true })
    } catch (exception) {
      setError(exception.message || 'Falha ao abrir o boardview.'); setBusy(false)
    }
  }

  const closeBoard = async () => {
    workerRef.current?.terminate()
    workerRef.current = null
    await clearBoardviewCache()
    setBoard(null)
    setFileName('')
    setFileHash('')
    setSelectedDesignator('')
    setSelectedPinNumber('')
    setSelectedNet('')
    setNetAnchor(null)
    setModel('')
    setRevision('')
    setAnnotations(emptyAnnotations())
    setSearch('')
    setOutlineEditing(false)
    setOutlineDraft([])
    setBusy(false)
    setError('')
  }

  useEffect(() => {
    let active = true
    const restoreLastBoard = async () => {
      const cached = await loadBoardviewCache()
      if (!active || !cached?.buffer || !cached.fileName) return
      parseBoardBuffer(cached.buffer, cached.fileName, cached.fileHash || '', { saveCache: false })
    }
    void restoreLastBoard()
    return () => { active = false }
  }, [])

  const selectComponent = component => { setSelectedDesignator(component?.designator || ''); setSelectedPinNumber(''); setSelectedNet(''); setNetAnchor(null); setShowNetConnectivity(false) }
  const selectNet = (net, anchor = null) => { setSelectedNet(current => current === net ? '' : net); setSelectedPinNumber(''); setShowNetConnectivity(false); setNetAnchor(current => current?.x === anchor?.x && current?.y === anchor?.y ? null : anchor) }
  const selectHit = hit => hit?.type === 'pin' ? (setSelectedDesignator(hit.component.designator), setSelectedPinNumber(hit.pin.number), setSelectedNet(hit.pin.netName), setNetAnchor({ x: hit.pin.x, y: hit.pin.y })) : hit?.component ? selectComponent(hit.component) : undefined
  const focusComponent = component => { setSelectedDesignator(component.designator); setSelectedPinNumber(''); setSelectedNet(''); setNetAnchor(null) }
  const focusNetEntry = entry => { setSelectedDesignator(entry.component.designator); setSelectedPinNumber(entry.pin.number); setSelectedNet(entry.pin.netName); setNetAnchor({ x: entry.pin.x, y: entry.pin.y }) }
  const updateAnnotations = patch => setAnnotations(current => normalizeAnnotations({ ...current, ...patch }))
  const updateRules = patch => setRules(current => normalizeEnergyRules({ ...current, ...patch }))
  const beginIdentityEdit = () => {
    if (!identityEditingRef.current) identityBeforeEditRef.current = { model, revision }
    identityEditingRef.current = true
  }
  const changeIdentity = (field, value) => {
    if (field === 'model') setModel(value)
    if (field === 'revision') setRevision(value)
  }
  const commitIdentity = () => {
    const previous = identityBeforeEditRef.current
    if (identityEditingRef.current && (previous.model !== model || previous.revision !== revision)) {
      saveAnnotations(previous.model, previous.revision, annotations)
      setAnnotations(loadAnnotations(model, revision))
    } else saveAnnotations(model, revision, annotations)
    identityBeforeEditRef.current = { model, revision }
    identityEditingRef.current = false
  }
  const exportBackup = () => {
    const payload = annotationBackup({ board, fileName, fileHash, model, revision, annotations, rules })
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${model || 'boardview'}-${revision || 'anotacoes'}.json`; link.click(); URL.revokeObjectURL(url)
  }
  const importBackup = async file => {
    if (!file) return
    try {
      const backup = parseAnnotationBackup(await file.text())
      const importedModel = backup.annotations.model || backup.board?.model || model
      const importedRevision = backup.annotations.revision || backup.board?.revision || revision
      setAnnotations(backup.annotations); setModel(importedModel); setRevision(importedRevision); identityBeforeEditRef.current = { model: importedModel, revision: importedRevision }; identityEditingRef.current = false
      if (backup.rules) setRules(normalizeEnergyRules(backup.rules))
      setError('Anotações importadas e salvas para este modelo/revisão.')
    } catch (exception) { setError(exception.message || 'Não foi possível importar as anotações.') }
  }
  const resetView = () => setView({ zoom: 1, pan: { x: 0, y: 0 } })
  const changeZoom = factor => setView(current => ({ ...current, zoom: clamp(current.zoom * factor, .2, 8) }))
  const beginOutlineEdit = () => { setOutlineEditing(true); setOutlineDraft(board?.outlineSource === 'manual' ? [...(board.boardOutline || board.contour || [])] : []); setError('Clique no mapa para adicionar os pontos do contorno. Depois clique em Salvar contorno.') }
  const addOutlinePoint = point => setOutlineDraft(current => [...current, point])
  const cancelOutlineEdit = () => { setOutlineEditing(false); setOutlineDraft([]); setError('') }
  const saveManualOutline = () => {
    if (outlineDraft.length < 3) { setError('O contorno manual precisa de pelo menos 3 pontos.'); return }
    const normalized = outlineDraft.map(point => ({ x: Number(point.x), y: Number(point.y) }))
    setBoard(current => ({ ...current, boardOutline: normalized, contour: normalized, outlineSource: 'manual', contourSource: 'manual', contourLabel: 'Contorno manual salvo para este modelo/revisão', debug: current.debug ? { ...current.debug, explicitOutline: true, outlineSource: 'manual', outlineAlgorithm: 'manual' } : current.debug }))
    updateAnnotations({ outline: normalized })
    setOutlineEditing(false); setOutlineDraft([]); setError('Contorno manual salvo separado do arquivo original.')
  }
  const boardForMode = useMemo(() => {
    if (!board || componentMode === 'all') return board
    const filtered = board.components.filter(component => {
      if (componentMode === 'main') return component.componentType !== 'resistor' && component.componentType !== 'capacitor'
      if (componentMode === 'power') return component.pins.some(pin => /GND|GROUND|VIN|VCC|VDD|VBAT|VBUS|DCIN|ADAPTER|3V3|5V|1V8|19V/i.test(pin.netName || ''))
      if (componentMode.startsWith('type:')) return component.componentType === componentMode.slice(5)
      if (componentMode.startsWith('system:')) return component.systemCategory === componentMode.slice(7)
      return true
    })
    return { ...board, components: filtered }
  }, [board, componentMode])
  const selectedNetTotal = board?.nets.find(net => net.name === selectedNet)?.pins?.length || 0

  const debugPanel = board?.debug ? <details className="boardview-debug-panel" open={debugOpen} onToggle={event => setDebugOpen(event.currentTarget.open)}><summary>DEBUG temporário do importador</summary><div className="boardview-debug-grid"><div><span>Formato detectado</span><b>{board.debug.formatDetected}</b></div><div><span>Unidade original</span><b>{board.debug.originalUnit}</b></div><div><span>Fator para mil</span><b>{board.debug.conversionFactor}</b></div><div><span>Unidade renderizada</span><b>{board.debug.normalizedUnit}</b></div><div><span>Componentes</span><b>{board.debug.counts.components.toLocaleString('pt-BR')}</b></div><div><span>Pads / pinos</span><b>{board.debug.counts.pads.toLocaleString('pt-BR')} / {board.debug.counts.pins.toLocaleString('pt-BR')}</b></div><div><span>Nets</span><b>{board.debug.counts.nets.toLocaleString('pt-BR')}</b></div><div><span>Primitivas</span><b>{board.debug.primitiveTotal.toLocaleString('pt-BR')}</b></div><div><span>Linhas / arcos / polígonos</span><b>{board.debug.primitives.lines} / {board.debug.primitives.arcs} / {board.debug.primitives.polygons}</b></div><div><span>Furos / vias / keepouts</span><b>{board.debug.primitives.holes} / {board.debug.primitives.vias} / {board.debug.primitives.keepouts}</b></div><div><span>Outline explícito</span><b>{board.debug.explicitOutline ? 'Sim' : 'Não'}</b></div><div><span>Outline usado</span><b>{board.debug.outlineSource} · {board.debug.outlineAlgorithm}</b></div></div><div className="boardview-debug-box"><span>Bounding box original</span><code>{JSON.stringify(board.debug.originalBoundingBox)}</code></div><div className="boardview-debug-box"><span>Bounding box normalizado</span><code>{JSON.stringify(board.debug.normalizedBoundingBox)}</code></div>{board.debug.notes?.length > 0 && <p>{board.debug.notes.join(' ')}</p>}<details className="boardview-type-rules"><summary>Tabela editável de tipos por prefixo</summary><p>Edite somente o JSON dos prefixos. O renderer não inventa tipos fora desta tabela.</p><textarea value={typeRulesText} onChange={event => setTypeRulesText(event.target.value)} onBlur={() => { try { updateComponentTypeRules(JSON.parse(typeRulesText)); setError('Tabela de tipos salva.') } catch { setError('JSON de tipos inválido; a tabela anterior foi mantida.') } }} spellCheck="false" /></details></details> : null

  return <section className="boardview-workspace"><div className="boardview-header"><div><p className="eyebrow">VISUALIZADOR DE PLACA</p><h1>Mapa de placa</h1><p className="muted">Mapa normalizado com modo assistido e técnico. O arquivo original é preservado.</p></div><label className="boardview-upload primary"><FileUp size={17} />{busy ? 'Lendo arquivo…' : 'Importar boardview'}<input type="file" accept=".brd,.cad,.bdv,.fz,.asc,text/plain,application/octet-stream" disabled={busy} onChange={event => { void importBoard(event.target.files?.[0]); event.target.value = '' }} /></label></div>{error && <div className="boardview-error"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fechar erro"><X size={16} /></button></div>}{!board ? <section className="boardview-empty panel"><div className="boardview-empty-icon"><CircuitBoard size={30} /></div><h2>Abra um boardview para começar</h2><p>Formatos abertos são lidos localmente em um Web Worker. O arquivo original não é enviado nem modificado.</p><label className="outline boardview-empty-action"><FileUp size={16} />Selecionar boardview<input type="file" accept=".brd,.cad,.bdv,.fz,.asc,text/plain,application/octet-stream" disabled={busy} onChange={event => { void importBoard(event.target.files?.[0]); event.target.value = '' }} /></label></section> : <><section className="boardview-toolbar panel"><div className="boardview-file"><CircuitBoard size={18} /><span><b>{fileName}</b><small>SHA-256: {fileHash.slice(0, 16)}… · {board.stats.components.toLocaleString('pt-BR')} componentes · {board.stats.nets.toLocaleString('pt-BR')} nets · {board.debug?.outlineSource === 'original' ? 'outline original' : 'outline estimado'}</small></span><button type="button" className="outline boardview-close-button" onClick={() => { void closeBoard() }}><X size={15} />Fechar placa</button></div><div className="boardview-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar designador, tipo ou net" /><button type="button" onClick={() => setSearch('')} disabled={!search} aria-label="Limpar busca"><X size={14} /></button>{search && (searchResults.components.length > 0 || searchResults.nets.length > 0) && <div className="boardview-search-results">{searchResults.components.map(component => <button type="button" key={`component-${component.designator}`} onClick={() => { focusComponent(component); setSearch('') }}><b>{component.designator}</b><small>{component.typeLabel || 'Tipo desconhecido'} · {component.pins.length} pinos</small></button>)}{searchResults.nets.map(net => <button type="button" key={`net-${net.name}`} onClick={() => { setSelectedNet(net.name); setSelectedDesignator(net.pins[0]?.component || ''); setSelectedPinNumber(net.pins[0]?.pin || ''); setShowNetConnectivity(false); setSearch('') }}><b>{net.name}</b><small>Net · {net.pins.length.toLocaleString('pt-BR')} pontos</small></button>)}</div>}{search && !searchResults.components.length && !searchResults.nets.length && <span className="boardview-no-results">Nenhum resultado</span>}</div><div className="boardview-controls"><span className="boardview-control-label"><Layers3 size={15} /> Lado</span>{['top', 'bottom', 'both'].map(value => <button type="button" key={value} className={side === value ? 'active' : ''} onClick={() => setSide(value)}>{sideLabel(value)}</button>)}<button type="button" className={mirror ? 'active' : ''} onClick={() => setMirror(value => !value)}><FlipHorizontal2 size={15} /> Espelhar</button><button type="button" onClick={resetView} title="Recentrar mapa"><RotateCcw size={15} /> Recentrar</button></div><div className="boardview-filter-controls"><span>Mostrar</span><button type="button" className={componentMode === 'all' ? 'active' : ''} onClick={() => setComponentMode('all')}>Todos</button><button type="button" className={componentMode === 'main' ? 'active' : ''} onClick={() => setComponentMode('main')}>Principais</button><button type="button" className={componentMode === 'power' ? 'active' : ''} onClick={() => setComponentMode('power')}>Energia</button><select value={componentMode.startsWith('type:') || componentMode.startsWith('system:') ? componentMode : ''} onChange={event => setComponentMode(event.target.value || 'all')}><option value="">Tipo…</option>{[['ic','CIs'],['mosfet','MOSFETs'],['inductor','Indutores'],['diode','Diodos'],['connector','Conectores'],['resistor','Resistores'],['capacitor','Capacitores'],['test-point','Pontos de teste']].map(([value,label]) => <option value={`type:${value}`} key={value}>{label}</option>)}<optgroup label="Sistema">{[['energia','Energia'],['memória','Memória'],['CPU','CPU'],['USB','USB'],['SATA','SATA'],['PCIe','PCIe'],['áudio','Áudio'],['rede','Rede'],['carregamento','Carregamento'],['outros','Outros']].map(([value,label]) => <option value={`system:${value}`} key={`system-${value}`}>{label}</option>)}</optgroup></select><button type="button" className="outline" onClick={beginOutlineEdit}>✏️ Editar contorno</button>{outlineEditing && <><button type="button" className="outline" onClick={() => setOutlineDraft([])}>Limpar pontos</button><button type="button" className="primary" onClick={saveManualOutline}>Salvar contorno</button><button type="button" className="outline" onClick={cancelOutlineEdit}>Cancelar</button></>}</div></section><section className="boardview-main"><div className="boardview-left-rail"><ComponentPanel component={selectedComponent} selectedNet={selectedNet} selectedNetTotal={selectedNetTotal} showConnectivity={showNetConnectivity} onToggleConnectivity={setShowNetConnectivity} assisted={assisted} onToggleAssisted={setAssisted} onSelectNet={(net, pin) => { setSelectedPinNumber(pin?.number || ''); setSelectedNet(current => current === net ? '' : net); setShowNetConnectivity(false) }} /><details className="boardview-analysis-details" open><summary><span><b>Anotações locais</b><small>salvas para este modelo e revisão</small></span></summary><BoardviewLocalAnnotationsPanel target={selectedTarget} selectedComponent={selectedComponentBase} annotations={annotations} onUpdate={updateAnnotations} /></details></div><div className="boardview-map panel"><BoardCanvas board={boardForMode} side={side} mirror={mirror} zoom={view.zoom} pan={view.pan} onViewChange={next => setView(current => ({ ...current, ...next }))} selectedDesignator={selectedDesignator} selectedNet={selectedNet} showNetConnectivity={showNetConnectivity} outlineEditing={outlineEditing} outlineDraft={outlineDraft} onOutlinePoint={addOutlinePoint} onSelect={selectHit} energyTrace={trace} annotations={annotations} /><div className="boardview-map-legend"><span><i className="top" />Topo</span><span><i className="bottom" />Base</span>{selectedNet && <span><i className="net" />{selectedNetTotal > 80 ? 'Net grande: pads iluminados' : `Net: ${selectedNet}`}</span>}{trace.active && <><span><i className="energy-red" />Sem energia</span><span><i className="energy-orange" />Possível curto</span></>}</div><div className="boardview-zoom-controls"><button type="button" onClick={() => changeZoom(.84)} title="Diminuir zoom"><Minus size={15} /></button><span>{Math.round(view.zoom * 100)}%</span><button type="button" onClick={() => changeZoom(1.19)} title="Aumentar zoom"><Plus size={15} /></button><button type="button" onClick={resetView} title="Recentrar mapa"><RotateCcw size={14} /></button></div><div className="boardview-map-help">Roda: zoom · arraste: mover · clique: selecionar{outlineEditing ? ' · pontos do contorno' : ''}</div></div></section>{board.warnings?.length > 0 && <div className="boardview-notice"><AlertTriangle size={16} /><span>{board.warnings.join(' ')}</span></div>}<p className="boardview-disclaimer">As linhas são conectividade lógica, não trilhas físicas. Tipos identificados por dados do arquivo ou designador; dados ausentes permanecem informados como desconhecidos.</p></>}</section>
}
