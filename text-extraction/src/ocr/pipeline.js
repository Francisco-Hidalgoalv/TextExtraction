// src/ocr/pipeline.js
import Tesseract from 'tesseract.js'

//---------------------- utilidades canvas ----------------------//
async function toCanvas(input) {
  if (input instanceof HTMLCanvasElement) return input
  if (input instanceof HTMLImageElement) {
    const c = document.createElement('canvas')
    c.width = input.naturalWidth || input.width
    c.height = input.naturalHeight || input.height
    c.getContext('2d').drawImage(input, 0, 0)
    return c
  }
  const img = new Image()
  const url = typeof input === 'string' ? input : URL.createObjectURL(input)
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
  const c = document.createElement('canvas')
  c.width = img.naturalWidth || img.width
  c.height = img.naturalHeight || img.height
  c.getContext('2d').drawImage(img, 0, 0)
  if (typeof input !== 'string') URL.revokeObjectURL(url)
  return c
}

function cropCanvas(srcCanvas, x, y, w, h) {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(w))
  out.height = Math.max(1, Math.round(h))
  out.getContext('2d').drawImage(srcCanvas, x, y, w, h, 0, 0, out.width, out.height)
  return out
}

function invertCanvas(src) {
  const c = document.createElement('canvas')
  c.width = src.width; c.height = src.height
  const ctx = c.getContext('2d')
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const a = img.data
  for (let i = 0; i < a.length; i += 4) {
    a[i] = 255 - a[i]
    a[i + 1] = 255 - a[i + 1]
    a[i + 2] = 255 - a[i + 2]
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function canvasToDataUrl(c) {
  return c.toDataURL('image/png')
}

//---------------------- perfil de tinta + corte limpio ----------------------//
function rowInkProfile(canvas, darkThreshold = 200) {
  // Devuelve un Float32Array de alto=H con el % de píxeles "oscuros" por fila
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { width: W, height: H } = canvas
  const { data } = ctx.getImageData(0, 0, W, H)
  const ink = new Float32Array(H)
  for (let y = 0; y < H; y++) {
    let cnt = 0
    let k = y * W * 4
    for (let x = 0; x < W; x++, k += 4) {
      const r = data[k], g = data[k + 1], b = data[k + 2]
      // luminancia aprox.
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (lum < darkThreshold) cnt++
    }
    ink[y] = cnt / W // 0..1
  }
  return ink
}

function findCleanCutRow(ink, targetY, windowPx, guard = 2) {
  // Busca el "valle" (mínima tinta) dentro de [targetY-windowPx, targetY+windowPx]
  const H = ink.length
  const start = Math.max(guard, Math.floor(targetY - windowPx))
  const end   = Math.min(H - 1 - guard, Math.floor(targetY + windowPx))
  let bestY = targetY
  let bestVal = Number.POSITIVE_INFINITY
  for (let y = start; y <= end; y++) {
    // suaviza con ventana de 5 px (evita caer en huecos por ruido de 1 px)
    let v = 0
    for (let k = -2; k <= 2; k++) v += ink[y + k]
    if (v < bestVal) { bestVal = v; bestY = y }
  }
  return { y: bestY, score: bestVal / 5 } // score = tinta media local
}

//---------------------- utilidades OCR ----------------------//
function avgConf(words = []) {
  const vals = words.map(w => w.confidence).filter(c => typeof c === 'number' && c > 0)
  return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0
}

async function recognizeOnce(input, { langs, psm, preserveSpaces, logger }) {
  const res = await Tesseract.recognize(input, langs, {
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: preserveSpaces ? '1' : '0',
    logger
  })
  const text = res?.data?.text ?? ''
  const meanConfidence = res?.data?.confidence ?? avgConf(res?.data?.words || [])
  return { text, meanConfidence }
}

function betterResult(a, b) {
  const la = (a.text || '').trim().length
  const lb = (b.text || '').trim().length
  if (la !== lb) return la > lb ? a : b
  return a.meanConfidence >= b.meanConfidence ? a : b
}

function dedupeLinesKeepingOrder(s) {
  const seen = new Set()
  const out = []
  for (const raw of String(s).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const key = line.replace(/\s+/g, ' ').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out.join('\n')
}

//---------------------- OCR por 3 franjas con CORTES LIMPIOS ----------------------//
export async function extractTicketFromFile(input, opts = {}) {
  const {
    onProgress,
    languages = 'eng+spa',
    psm = 6,
    retries = true,
    verbose = false,
    returnCrops = false,
    cleanCutWindowPct = 0.06, // ventana ±6% de H alrededor del tercio
    minGapPx = 24,            // separación mínima entre cortes
  } = opts

  const src = await toCanvas(input)
  const W = src.width, H = src.height

  // 1) perfil de tinta por fila
  const ink = rowInkProfile(src)

  // 2) objetivos ideales: H/3 y 2H/3
  const t1 = H / 3
  const t2 = (2 * H) / 3
  const win = Math.max(8, Math.round(H * cleanCutWindowPct))

  // 3) buscar valles cercanos (cortes limpios)
  let c1 = findCleanCutRow(ink, t1, win)
  let c2 = findCleanCutRow(ink, t2, win)

  // 4) garantizar orden y separación mínima
  if (c2.y - c1.y < minGapPx) {
    // si están muy juntos, empuja el segundo hacia abajo dentro de su ventana
    const alt = findCleanCutRow(ink, Math.min(H - 1, t2 + win * 0.6), win)
    if (alt.y - c1.y >= minGapPx) c2 = alt
  }
  c1.y = Math.max(1, Math.min(H - 2, c1.y))
  c2.y = Math.max(c1.y + 1, Math.min(H - 2, c2.y))

  if (verbose) {
    console.log('[cuts] H=', H, 't1≈', Math.round(t1), 't2≈', Math.round(t2),
      ' -> y1=', c1.y, 'score=', c1.score.toFixed(4),
      ' | y2=', c2.y, 'score=', c2.score.toFixed(4))
  }

  // 5) franjas A: [0, y1), B: [y1, y2), C: [y2, H)  (SIN solapamiento)
  const ranges = [
    { name: 'A', y: 0,    h: c1.y - 0 },
    { name: 'B', y: c1.y, h: c2.y - c1.y },
    { name: 'C', y: c2.y, h: H - c2.y },
  ]

  const base = [0, 1/3, 2/3]
  const span = 1/3

  const pieces = []
  const crops = []
  const cuts = [{ name: 'y1', y: c1.y, score: c1.score }, { name: 'y2', y: c2.y, score: c2.score }]

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const cut = cropCanvas(src, 0, r.y, W, r.h)

    if (returnCrops) {
      crops.push({ name: r.name, y: r.y, h: r.h, w: W, dataUrl: canvasToDataUrl(cut) })
    }

    const logger = (m) => {
      if (m?.status === 'recognizing text' && typeof onProgress === 'function') {
        onProgress(base[i] + (m.progress || 0) * span)
      }
    }

    // pasada normal
    let best = await recognizeOnce(cut, { langs: languages, psm, preserveSpaces: true, logger })

    // franja A: también invertida (chips)
    let usedInverted = false
    if (r.name === 'A') {
      const inv = invertCanvas(cut)
      const invRes = await recognizeOnce(inv, { langs: languages, psm, preserveSpaces: true, logger: null })
      const chosen = betterResult(best, invRes)
      usedInverted = chosen === invRes
      best = chosen
    }

    // si sale corto, PSM 3
    const short = (t) => (t || '').trim().length < 25
    if (retries && short(best.text)) {
      const alt = await recognizeOnce(cut, { langs: languages, psm: 3, preserveSpaces: true, logger: null })
      if (!short(alt.text) || alt.meanConfidence > best.meanConfidence) best = alt
    }

    pieces.push({ name: r.name, text: best.text || '', meanConfidence: best.meanConfidence || 0, usedInverted })
  }

  const joined = pieces.map(p => p.text.trim()).filter(Boolean).join('\n')
  const text = dedupeLinesKeepingOrder(joined)
  const meanConfidence = pieces.length ? pieces.reduce((a,b)=>a+(b.meanConfidence||0),0)/pieces.length : 0

  if (typeof onProgress === 'function') onProgress(1)

  return { text, meanConfidence, pieces, crops, cuts }
}
