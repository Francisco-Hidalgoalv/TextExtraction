// src/ocr/pipeline.js
import Tesseract from 'tesseract.js'

//---------------------- utilidades canvas ----------------------//
async function toCanvas(input) {
  if (input instanceof HTMLCanvasElement) return input;
  if (input instanceof HTMLImageElement) {
    const c = document.createElement('canvas');
    c.width = input.naturalWidth || input.width;
    c.height = input.naturalHeight || input.height;
    c.getContext('2d').drawImage(input, 0, 0);
    return c;
  }
  // File/Blob/URL string
  const img = new Image();
  const url = typeof input === 'string' ? input : URL.createObjectURL(input);
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  if (typeof input !== 'string') URL.revokeObjectURL(url);
  return c;
}

function cropCanvas(srcCanvas, x, y, w, h) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  out.getContext('2d').drawImage(srcCanvas, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

function invertCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const a = img.data;
  for (let i = 0; i < a.length; i += 4) {
    a[i] = 255 - a[i];       // R
    a[i + 1] = 255 - a[i+1]; // G
    a[i + 2] = 255 - a[i+2]; // B
    // alpha igual
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

//---------------------- utilidades OCR ----------------------//
function avgConf(words = []) {
  const vals = words.map(w => w.confidence).filter(c => typeof c === 'number' && c > 0);
  return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
}

async function recognizeOnce(input, { langs, psm, preserveSpaces, logger }) {
  const res = await Tesseract.recognize(input, langs, {
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: preserveSpaces ? '1' : '0',
    logger
  });
  const text = res?.data?.text ?? '';
  const meanConfidence = res?.data?.confidence ?? avgConf(res?.data?.words || []);
  return { text, meanConfidence };
}

function betterResult(a, b) {
  // 1) más texto, 2) mayor confianza
  const lenA = (a.text || '').trim().length;
  const lenB = (b.text || '').trim().length;
  if (lenA !== lenB) return lenA > lenB ? a : b;
  return (a.meanConfidence >= b.meanConfidence) ? a : b;
}

//---------------------- OCR por 3 franjas ----------------------//
/**
 * Extrae texto dividiendo el ticket en 3 franjas horizontales (con solapamiento),
 * hace una pasada normal en B/C y doble pasada (normal + invertida) en A.
 * Devuelve SOLO texto + detalles por franja (sin parseo de campos).
 *
 * @param {File|Blob|HTMLImageElement|HTMLCanvasElement|string} input
 * @param {Object} opts
 * @param {(p:number)=>void} [opts.onProgress]  // 0..1 progreso global
 * @param {string} [opts.languages='eng+spa']
 * @param {number} [opts.psm=6]                 // PSM base
 * @param {boolean} [opts.retries=true]         // probar PSM 3 si sale muy corto
 * @param {number} [opts.overlap=0.08]          // solapamiento (8%)
 * @param {boolean} [opts.verbose=false]
 * @returns {Promise<{ text:string, meanConfidence:number, pieces:Array }>}
 */
export async function extractTicketFromFile(input, opts = {}) {
  const {
    onProgress,
    languages = 'eng+spa',
    psm = 6,
    retries = true,
    overlap = 0.08,
    verbose = false,
  } = opts;

  const src = await toCanvas(input);
  const W = src.width, H = src.height;

  // límites por franja (A/B/C) con solapamiento vertical
  const h3 = H / 3;
  const ov = Math.max(0, Math.min(0.2, overlap)) * h3; // cap 20%
  const ranges = [
    { name: 'A', y: 0,           h: h3 + ov },              // top
    { name: 'B', y: Math.max(0, h3 - ov), h: h3 + 2*ov },   // middle
    { name: 'C', y: Math.max(0, 2*h3 - ov), h: H - (2*h3 - ov) } // bottom
  ];

  // mapeo de progreso por franja: 0-0.33, 0.33-0.66, 0.66-1.0
  const sliceProgBase = [0, 1/3, 2/3];
  const sliceProgSpan = 1/3;

  const pieces = [];

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const cut = cropCanvas(src, 0, Math.round(r.y), W, Math.round(r.h));

    const logger = (m) => {
      if (m?.status === 'recognizing text' && typeof onProgress === 'function') {
        const p = m.progress || 0; // 0..1
        onProgress(sliceProgBase[i] + p * sliceProgSpan);
      }
    };

    // --- pasada normal (PSM base) ---
    let best = await recognizeOnce(cut, { langs: languages, psm, preserveSpaces: true, logger });

    // --- franja A: también invertida ---
    let usedInverted = false;
    if (r.name === 'A') {
      const inv = invertCanvas(cut);
      const resInv = await recognizeOnce(inv, { langs: languages, psm, preserveSpaces: true, logger: null });
      if (verbose) console.log('[A] normal vs invertida:', best.meanConfidence.toFixed(1), 'vs', resInv.meanConfidence.toFixed(1));
      const chosen = betterResult(best, resInv);
      usedInverted = (chosen === resInv);
      best = chosen;
    }

    // --- reintentos con PSM 3 si texto muy corto ---
    const isShort = (t) => (t || '').trim().length < 25;
    if (retries && isShort(best.text)) {
      const alt = await recognizeOnce(cut, { langs: languages, psm: 3, preserveSpaces: true, logger: null });
      if (!isShort(alt.text) || alt.meanConfidence > best.meanConfidence) {
        best = alt;
      }
    }

    pieces.push({
      name: r.name,
      text: best.text || '',
      meanConfidence: best.meanConfidence || 0,
      usedInverted
    });
  }

  const text = pieces.map(p => p.text.trim()).filter(Boolean).join('\n');
  const meanConfidence = pieces.length
    ? pieces.reduce((a, b) => a + (b.meanConfidence || 0), 0) / pieces.length
    : 0;

  if (typeof onProgress === 'function') onProgress(1);

  return { text, meanConfidence, pieces };
}
