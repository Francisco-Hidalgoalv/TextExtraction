import { profiles } from './ticketProfiles'

const MONTHS = {
    ene: 1, enero: 1, jan: 1, january: 1,
    feb: 2, febrero: 2,
    mar: 3, marzo: 3,
    abr: 4, abril: 4, apr: 4, april: 4,
    may: 5, mayo: 5,
    jun: 6, junio: 6,
    jul: 7, julio: 7,
    ago: 8, agosto: 8, aug: 8, august: 8,
    sep: 9, sept: 9, set: 9, septiembre: 9, september: 9,
    oct: 10, octubre: 10,
    nov: 11, noviembre: 11, november: 11,
    dic: 12, diciembre: 12, dec: 12, december: 12,
}

function parseMonthName(token) {
    const clean = String(token || '')
        .toLowerCase()
        .replace(/[^a-záéíóúüñ]/g, '')
    return MONTHS[clean] ?? MONTHS[clean.slice(0,3)] ?? (clean === 'ju' ? 7 : null)
}

// Corrige artefactos típicos (p. ej. "Ju]" -> "Jul")
function fixOcrMonthGlitches(s) {
    return String(s)
        .replace(/\bJu[\]\|]/gi, 'Jul') // Ju] o Ju| -> Jul
        .replace(/\bSe[p\|\]]/gi, 'Sep')
}

const norm = s =>
    String(s ?? '')
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^\S\r\n]+/g, ' ') // espacios
        .trim()

const linesOf = s => norm(s).split(/\r?\n/).map(l => l.trim()).filter(Boolean)

function findByHints(lines, hints, lookAhead = 2) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (hints?.some(h => h.test(line))) {
            // Buscar en esta línea y las siguientes 'lookAhead'
            const window = lines.slice(i, i + 1 + lookAhead)
            return { index: i, window, joined: window.join(' ') }
        }
    }
    return null
}

function findDate(text, profile) {
    const L = linesOf(text)

    const monthNameRx = /\b([A-Za-z\]\|]{2,12})\.?\s+([0-3]?\d),?\s+(\d{4})\b/
    let m = text.match(monthNameRx)
    if (m) {
        const mm = parseMonthName(m[1])
        const dd = m[2]
        const yyyy = m[3]
        if (mm) {
            const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
            return { value: iso, raw: m[0], source: 'monthName', confidence: 0.9 }
        }
    }

    // 1) por pista (“Fecha”)
    const ctx = findByHints(L, profile.dateHints, 2)
    if (ctx) {
        for (const rx of profile.dateRegexes) {
            const m = ctx.joined.match(rx)
            if (m) return { value: m[0], source: 'hint+regex', confidence: 0.9 }
        }
    }
  // 2) global por regex
    for (const rx of profile.dateRegexes) {
        const m = text.match(rx)
        if (m) return { value: m[0], source: 'regex', confidence: 0.7 }
    }
    return null
}

function normalizeAmount(raw) {
    if (!raw) return null
    // Convierte 1.234,56 o 1,234.56 -> número JS
    const cleaned = raw.replace(/[^0-9.,-]/g, '')
    // Asumimos coma como decimal si existen ambos
    let num = cleaned
    if (cleaned.includes('.') && cleaned.includes(',')) {
        num = cleaned.replace(/\./g, '').replace(',', '.')
    } else if (cleaned.includes(',')) {
        // Probable decimal latino
        const parts = cleaned.split(',')
        if (parts[parts.length - 1].length === 2) {
            num = cleaned.replace(/\./g, '').replace(',', '.')
        } else {
        num = cleaned.replace(/,/g, '')
        }
    }
    const val = Number(num)
    return isNaN(val) ? null : val
}

function findTotal(text, profile) {
    const L = linesOf(text)
    const ctx = findByHints(L, profile.totalHints, 2)
    if (ctx) {
        const m = ctx.joined.match(profile.amountRegex)
        if (m) return {
        raw: m[0],
        value: normalizeAmount(m[1]),
        source: 'hint+amount',
        confidence: 0.92
        }
    }
    // fallback: mayor cantidad global
    const amounts = [...text.matchAll(new RegExp(profile.amountRegex, 'g'))]
    .map(m => ({ raw: m[0], val: normalizeAmount(m[1]) }))
    .filter(a => a.val != null)
    if (amounts.length) {
        const top = amounts.sort((a, b) => b.val - a.val)[0]
        return { raw: top.raw, value: top.val, source: 'maxAmount', confidence: 0.6 }
    }
    return null
}

function findStore(text, profile) {
    const L = linesOf(text)
    const ctx = findByHints(L, profile.storeHints, 2)
    if (ctx) {
        // Toma la misma línea o la siguiente como nombre/dirección
        const cand = ctx.window.join(' ')
        // recorta etiqueta
        const cleaned = cand.replace(/^(sucursal|tienda|lugar|domicilio|direccion)\s*[:\-]?\s*/i, '')
        return { value: cleaned.slice(0, 80), source: 'hint', confidence: 0.7 }
    }
    // fallback: primera línea significativa
    return { value: linesOf(text)[0]?.slice(0, 80) ?? null, source: 'topline', confidence: 0.4 }
}

function findReference(text, profile) {
    const L = linesOf(text)
    const ctx = findByHints(L, profile.refHints, 2)
    if (ctx) {
        const m = ctx.joined.match(/([A-Z0-9\-]{6,})/)
        if (m) return { value: m[1], source: 'hint+alnum', confidence: 0.75 }
        // o dígitos largos
        const d = ctx.joined.match(/\b(\d{6,})\b/)
        if (d) return { value: d[1], source: 'hint+digits', confidence: 0.7 }
    }
    return null
}

export function parseTicket(ocrText, profileKey = 'mi_tienda') {
    const profile = profiles[profileKey] ?? profiles.mi_tienda
    let text = norm(ocrText)
    text = fixOcrMonthGlitches(text)
    const fecha = findDate(text, profile)
    const total = findTotal(text, profile)
    const sucursal = findStore(text, profile)
    const referencia = findReference(text, profile)

  // score simple
    const conf = {
        fecha: fecha?.confidence ?? 0,
        total: total?.confidence ?? 0,
        sucursal: sucursal?.confidence ?? 0,
        referencia: referencia?.confidence ?? 0,
    }
    const overall = Object.values(conf).reduce((a,b)=>a+b,0) / 4

    return {
        ok: overall >= 0.6,
        fields: {
            fecha: fecha?.value ?? null,
            total: total?.value ?? null,
            totalRaw: total?.raw ?? null,
            sucursal: sucursal?.value ?? null,
            referencia: referencia?.value ?? null,
        },
    confidence: { ...conf, overall },
    debug: { profile: profileKey }
    }
}
