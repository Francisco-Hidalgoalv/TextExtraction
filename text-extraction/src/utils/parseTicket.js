// src/utils/parseTicket.js
// Parser para ticket Intermex (sin perfiles externos)

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

const linesOf = (s) =>
  norm(s).split(/\r?\n/).map(l => l.trim()).filter(Boolean)

function normalizeAmount(raw) {
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9.,-]/g, '')
  let num = cleaned
  if (cleaned.includes('.') && cleaned.includes(',')) {
    num = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (cleaned.includes(',')) {
    const parts = cleaned.split(',')
    if (parts[parts.length - 1].length === 2) {
      num = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      num = cleaned.replace(/,/g, '')
    }
  }
  const v = Number(num)
  return Number.isFinite(v) ? v : null
}

const AMT_RX = /(?:USD|US\$|\$)?\s*([0-9]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))/i

function findByLabel(lines, labelRegexes, lookAhead = 2) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (labelRegexes.some(rx => rx.test(line))) {
      for (let j = i; j <= Math.min(i + lookAhead, lines.length - 1); j++) {
        const m = lines[j].match(AMT_RX)
        if (m) {
          return { raw: m[0], value: normalizeAmount(m[1]), source: 'label', idx: i }
        }
      }
    }
  }
  return null
}

function findDate(text) {
  let m = text.match(/\b(0?[1-9]|1[0-2])\/([0-2]?\d|3[01])\/(\d{4})(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?\b/i)
  if (m) {
    const [ , mm, dd, yyyy ] = m
    const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
    return { value: iso, raw: m[0], source: 'mdy', confidence: 0.9 }
  }
  m = text.match(/\b([A-Za-z]{3,})\.?\s+([0-3]?\d),?\s+(\d{4})\b/)
  if (m) {
    const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
    const mm = MONTHS[m[1].slice(0,3).toLowerCase()]
    if (mm) {
      const dd = m[2], yyyy = m[3]
      const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
      return { value: iso, raw: m[0], source: 'monthName', confidence: 0.85 }
    }
  }
  return null
}

/* ---------------- Remitente/Sender ---------------- */

function findSenderSection(lines) {
  const startRx = /remitente\s*\/\s*sender\b/i
  const endRx = [
    /beneficiario\s*\/\s*beneficiary/i,
    /pais\s*\/\s*country/i,
    /pagador\s*\/\s*payer/i,
    /giro\s*\/\s*wire/i,
    /monto\s*\/\s*transfer amount/i,
    /total a pagar\s*\/\s*total due/i
  ]
  const i = lines.findIndex(l => startRx.test(l))
  if (i < 0) return null

  const MAX = Math.min(lines.length - 1, i + 8) // no más de 8 líneas hacia abajo
  let end = MAX
  for (let j = i + 1; j <= MAX; j++) {
    if (endRx.some(rx => rx.test(lines[j]))) { end = j - 1; break }
  }

  // limpia líneas vacías y quita la etiqueta inicial
  const section = lines.slice(i + 1, end + 1).map(s => s.trim()).filter(Boolean)
  return { index: i, lines: section }
}


// helpers mínimos en el mismo archivo (arriba del parser, si no los tienes ya)
const ALLOWED_SHORT = new Set([
  'de','del','la','las','los','y','da','do','das','dos','san','santa',
  'mc','mac','van','von','di','du','le','lo','el'
])
function lettersOnlyCount(s) {
  return (String(s).match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length
}
function cleanNameCandidate(s) {
  // 1) deja letras/espacios/guiones/apóstrofes y normaliza espacios
  let t = String(s)
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // 2) tokeniza por palabras (¡ahora sí!): 
  let parts = t.split(/\s+/)

  // 3) quita tokens de 1 letra salvo conectores válidos
  parts = parts.filter(p => p.length >= 2 || ALLOWED_SHORT.has(p.toLowerCase()))

  // 4) quita "colas" de 1–2 letras al final si no son conectores válidos
  while (parts.length >= 2) {
    const last = parts[parts.length - 1].toLowerCase()
    if (last.length <= 2 && !ALLOWED_SHORT.has(last)) parts.pop()
    else break
  }

  const name = parts.join(' ').trim()
  // 5) exige ≥5 letras totales para evitar ruido como "pe", "eas"
  if (lettersOnlyCount(name) < 5) return null
  return name
}


function parseUSPhone(s) {
  // acepta "Teléfono/Phone: 8456640506" o "(845) 664-0506"
  const m = s.match(/(?:tel[eé]fono|phone)[:\s-]*([\+\d\(\)\-\s]{7,})/i) || s.match(/([\+\d\(\)\-\s]{10,})/)
  if (!m) return null
  const digits = m[1].replace(/\D/g, '')
  if (digits.length < 10) return null
  // formatea US 10 dígitos
  const d = digits.slice(-10)
  return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`
}

function looksLikeStreet(s) {
  // heurística para 1a línea de dirección
  if (/\d/.test(s) === false) return false
  return /\b(ave|av|avenue|st|street|rd|road|blvd|suite|ste|apt|#|calle|av\.)\b/i.test(s)
}

function parseCityStateZip(s) {
  // "HAVERSTRAW, NEW YORK 10927" | "HAVERSTRAW NY 10927"
  let m = s.match(/^([A-Za-z .,'-]+)[,\s]+([A-Za-z]{2,}|[A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i)
  if (m) {
    const city = m[1].replace(/\s+/g, ' ').trim()
    let state = m[2].trim()
    const postal = m[3]
    // normaliza state a abreviatura si es larga (ej. NEW YORK -> NY)
    const MAP = { 'NEW YORK':'NY', 'CALIFORNIA':'CA', 'FLORIDA':'FL', 'TEXAS':'TX' }
    const up = state.toUpperCase()
    if (up.length > 2 && MAP[up]) state = MAP[up]
    return { city, state, postal }
  }
  return null
}

function extractSender(lines) {
  const sec = findSenderSection(lines)
  if (!sec || !sec.lines.length) return { sender: null, conf: 0 }

  let name = null, address1 = null, address2 = null, city = null, state = null, postal = null, phone = null

  // 1) nombre = primera línea no vacía que NO parezca teléfono ni dirección
  for (const ln of sec.lines) {
    if (parseUSPhone(ln)) continue
    if (looksLikeStreet(ln)) continue
    if (/\d/.test(ln)) continue // si trae muchos dígitos, probablemente no sea nombre
    if (ln.length < 4) continue // Si el nombre tiene menos de 4 letras, continúa
    const candidate = cleanNameCandidate(ln)  // ← limpia y valida
    if (!candidate) continue
    name = candidate
    break
  }

  // 2) dirección y ciudad/estado/zip + teléfono
  for (const ln of sec.lines) {
    if (!phone) {
      const ph = parseUSPhone(ln)
      if (ph) phone = ph
    }
    if (!city) {
      const csz = parseCityStateZip(ln)
      if (csz) { city = csz.city; state = csz.state; postal = csz.postal; continue }
    }
    if (!address1 && looksLikeStreet(ln)) { address1 = ln; continue }
    if (!address2 && address1 && ln !== name && !/phone|telefono/i.test(ln) && !parseCityStateZip(ln)) {
      // posible segunda línea (p. ej., APT/SUITE)
      if (/\b(apt|suite|ste|#)\b/i.test(ln) || (!/\d/.test(ln) && ln.length < 20)) {
        address2 = ln
      }
    }
  }

  // Confianzas heurísticas
  const conf = {
    senderName: name ? 0.85 : 0,
    senderPhone: phone ? 0.9 : 0,
    senderAddress: address1 ? 0.9 : 0.4,
    senderCity: city ? 0.88 : 0,
    senderState: state ? 0.88 : 0,
    senderPostal: postal ? 0.9 : 0,
  }
  // si nombre y dirección y ciudad/estado/zip están, sube un poco
  const filled = ['senderName','senderAddress','senderCity','senderState','senderPostal'].every(k => conf[k] > 0)
  if (filled) Object.keys(conf).forEach(k => conf[k] = Math.min(0.98, conf[k] + 0.04))

  return {
    sender: { name, address1, address2, city, state, postalCode: postal, phone },
    conf: { ...conf, senderOverall: Object.values(conf).reduce((a,b)=>a+b,0) / 6 }
  }
}

/* ---------------- Montos/fecha/ID como antes ---------------- */

function parseIntermex(text) {
  const L = linesOf(text)

  // ID tipo NY-1255 - 16997
  const refMatch = text.match(/\b[A-Z]{2,3}-\d{3,5}\s*-\s*\d{3,}\b/)
  const referencia = refMatch ? { value: refMatch[0].replace(/\s+/g,' ').trim(), source: 'pattern', confidence: 0.8 } : null

  const fecha = findDate(text)

  // Montos
  const amount = findByLabel(L, [/monto\/?transfer amount/i, /\bamount\b/i])
  const fees = findByLabel(L, [/cargos\/?transf\.? en cash/i, /fees paid in cash/i, /\bfees\b/i])
  const other = findByLabel(L, [/otros\s*\/\s*other chg/i, /\bother/i])
  const taxes = findByLabel(L, [/estado cargos\s*\/\s*transfer\s*taxes/i, /\btaxes?\b/i])
  const discount = findByLabel(L, [/descuento\s*\/\s*discount/i, /\bdiscount\b/i])
  const totalDue = findByLabel(L, [/total a pagar\s*\/\s*total due/i, /\btotal due\b/i], 2)
  const recipient = findByLabel(L, [/monto a entregar\s*\/\s*total to recipient/i, /total to recipient/i], 2)
  const xrate = (() => {
    const i = L.findIndex(line => /tipo de cambio|exchange rate/i.test(line))
    if (i >= 0) {
      for (let j = i; j <= Math.min(i+2, L.length-1); j++) {
        const m = L[j].match(/([0-9]+(?:[.,][0-9]{1,4})?)/)
        if (m) {
          const v = normalizeAmount(m[1])
          if (v != null) return { raw: m[0], value: v, source: 'label', confidence: 0.85 }
        }
      }
    }
    return null
  })()

  // Validación contable
  const f = {
    amount: amount?.value ?? null,
    fees: fees?.value ?? null,
    other: other?.value ?? null,
    taxes: taxes?.value ?? null,
    discount: discount?.value ?? null,
    totalDue: totalDue?.value ?? null,
    recipient: recipient?.value ?? null,
    exchangeRate: xrate?.value ?? null,
  }
  const issues = []

  if (f.amount != null && f.recipient != null && Math.abs(f.amount - f.recipient) <= 0.5 && f.amount !== f.recipient) {
    issues.push(`Ajuste: amount ${f.amount} → ${f.recipient} (igualado a recipient).`)
    f.amount = f.recipient
  }
  if (f.amount == null && f.recipient != null) {
    f.amount = f.recipient
    issues.push('Inferido amount desde recipient.')
  }

  const plus = (a) => (typeof a === 'number') ? a : 0
  const round2 = (x) => Math.round(x * 100) / 100
  const exp2 = round2(plus(f.amount) + plus(f.fees) + plus(f.other) + plus(f.taxes) - plus(f.discount))

  if (f.totalDue == null && exp2 > 0) {
    f.totalDue = exp2
    issues.push(`Inferido totalDue=${exp2} a partir de amount/fees/other/taxes/discount.`)
  } else if (f.totalDue != null && Math.abs(f.totalDue - exp2) > 0.06 && exp2 > 0) {
    if (f.recipient != null) {
      const expWithRec = round2(plus(f.recipient) + plus(f.fees) + plus(f.other) + plus(f.taxes) - plus(f.discount))
      if (Math.abs(expWithRec - f.totalDue) <= Math.abs(exp2 - f.totalDue)) {
        if (f.amount !== f.recipient) {
          issues.push(`Ajuste: amount ${f.amount ?? 'null'} → ${f.recipient} para cuadrar con totalDue.`)
          f.amount = f.recipient
        }
      } else {
        issues.push(`Aviso: totalDue (${f.totalDue}) no cuadra con suma (${exp2}).`)
      }
    } else {
      issues.push(`Aviso: totalDue (${f.totalDue}) no cuadra con suma (${exp2}).`)
    }
  }

  // Confianzas de montos/fecha/ID
  const confMoney = {
    fecha: fecha?.confidence ?? 0,
    referencia: referencia?.confidence ?? 0,
    amount: amount ? 0.9 : (f.amount != null ? 0.75 : 0),
    fees: fees ? 0.9 : (f.fees != null ? 0.7 : 0),
    other: other ? 0.85 : (f.other != null ? 0.65 : 0),
    taxes: taxes ? 0.85 : (f.taxes != null ? 0.65 : 0),
    discount: discount ? 0.85 : (f.discount != null ? 0.65 : 0),
    totalDue: totalDue ? 0.92 : (f.totalDue != null ? 0.8 : 0),
    recipient: recipient ? 0.92 : (f.recipient != null ? 0.8 : 0),
    exchangeRate: xrate ? 0.85 : (f.exchangeRate != null ? 0.7 : 0),
  }
  const okEquation = Math.abs((f.totalDue ?? 0) - round2(plus(f.amount) + plus(f.fees) + plus(f.other) + plus(f.taxes) - plus(f.discount))) <= 0.06
  if (okEquation) {
    ['amount','fees','other','taxes','discount','totalDue'].forEach(k => { if (f[k] != null) confMoney[k] = Math.min(0.98, (confMoney[k] || 0) + 0.05) })
  }

  // Remitente
  const senderRes = extractSender(L)
  const sender = senderRes.sender
  const confSender = senderRes.conf

  const overall = (() => {
    const vals = [
      ...Object.values(confMoney),
      ...(Object.values(confSender))
    ].filter(v => typeof v === 'number')
    return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0
  })()

  return {
    ok: true,
    fields: {
      fecha: fecha?.value ?? null,
      referencia: referencia?.value ?? null,
      amount: f.amount,
      fees: f.fees,
      other: f.other,
      taxes: f.taxes,
      discount: f.discount,
      totalDue: f.totalDue,
      recipient: f.recipient,
      exchangeRate: f.exchangeRate,
      // remitente:
      sender
    },
    confidence: { ...confMoney, ...confSender, overall },
    issues
  }
}

export function parseTicket(ocrText) {
  const text = norm(ocrText)
  return parseIntermex(text)
}
