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
      // buscar monto en la misma línea o siguientes
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
  // 1) 04/10/2024 3:58 PM  ó  04/10/2024
  let m = text.match(/\b(0?[1-9]|1[0-2])\/([0-2]?\d|3[01])\/(\d{4})(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?\b/i)
  if (m) {
    const [ , mm, dd, yyyy ] = m
    const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
    return { value: iso, raw: m[0], source: 'mdy', confidence: 0.9 }
  }
  // 2) “Apr 10, 2024” por si acaso
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

function parseIntermex(text) {
  const L = linesOf(text)

  // ---------- IDs/encabezados útiles ----------
  const refMatch = text.match(/\b[A-Z]{2,3}-\d{3,5}\s*-\s*\d{3,}\b/) // p.ej. NY-1255 - 16997
  const referencia = refMatch ? { value: refMatch[0].replace(/\s+/g,' ').trim(), source: 'pattern', confidence: 0.8 } : null

  const fecha = findDate(text)

  // ---------- Montos por etiqueta ----------
  const amount = findByLabel(L, [/monto\/?transfer amount/i, /\bamount\b/i])
  const fees = findByLabel(L, [/cargos\/?transf\.? en cash/i, /fees paid in cash/i, /\bfees\b/i])
  const other = findByLabel(L, [/otros\s*\/\s*other chg/i, /\bother/i])
  const taxes = findByLabel(L, [/estado cargos\s*\/\s*transfer\s*taxes/i, /\btaxes?\b/i])
  const discount = findByLabel(L, [/descuento\s*\/\s*discount/i, /\bdiscount\b/i])
  const totalDue = findByLabel(L, [/total a pagar\s*\/\s*total due/i, /\btotal due\b/i], 2)
  const recipient = findByLabel(L, [/monto a entregar\s*\/\s*total to recipient/i, /total to recipient/i], 2)
  const xrate = (() => {
    // Tipo de Cambio / Exchange Rate: $ 1.0000
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

  // ---------- Validación/Corrección contable ----------
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

  // 1) Alinea Amount con Recipient si ambos existen y difieren poco
  if (f.amount != null && f.recipient != null && Math.abs(f.amount - f.recipient) <= 0.5 && f.amount !== f.recipient) {
    issues.push(`Ajuste: amount ${f.amount} → ${f.recipient} (igualado a recipient).`)
    f.amount = f.recipient
  }

  // 2) Si falta amount pero hay recipient, usa recipient
  if (f.amount == null && f.recipient != null) {
    f.amount = f.recipient
    issues.push('Inferido amount desde recipient.')
  }

  // 3) Calcula total esperado
  const plus = (a) => (typeof a === 'number') ? a : 0
  const expected = plus(f.amount) + plus(f.fees) + plus(f.other) + plus(f.taxes) - plus(f.discount)
  const round2 = (x) => Math.round(x * 100) / 100
  const exp2 = round2(expected)

  if (f.totalDue == null && exp2 > 0) {
    f.totalDue = exp2
    issues.push(`Inferido totalDue=${exp2} a partir de amount/fees/other/taxes/discount.`)
  } else if (f.totalDue != null && Math.abs(f.totalDue - exp2) > 0.06 && exp2 > 0) {
    // si difiere, si recipient presente y cuadra mejor usando recipient como amount, corrige
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

  // ---------- Confianzas ----------
  const conf = {
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

  // si la ecuación cuadra, subimos ligeramente confianzas de los montos implicados
  const okEquation = Math.abs((f.totalDue ?? 0) - round2(plus(f.amount) + plus(f.fees) + plus(f.other) + plus(f.taxes) - plus(f.discount))) <= 0.06
  if (okEquation) {
    ['amount','fees','other','taxes','discount','totalDue'].forEach(k => { if (f[k] != null) conf[k] = Math.min(0.98, (conf[k] || 0) + 0.05) })
  }

  const overall = Object.values(conf).reduce((a,b)=>a+b,0) / Math.max(1, Object.values(conf).length)

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
    },
    confidence: { ...conf, overall },
    issues
  }
}

export function parseTicket(ocrText /*, profileKey = 'mi_tienda' */) {
  const text = norm(ocrText)
  return parseIntermex(text)
}
