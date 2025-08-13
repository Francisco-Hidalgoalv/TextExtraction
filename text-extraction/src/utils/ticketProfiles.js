export const profiles = {
  // Cambia "mi_tienda" por el nombre del ticket objetivo
    mi_tienda: {
        headerHints: [/comprobante/i, /ticket/i, /env[ií]o/i], // opcional
        dateHints: [/fecha/i, /fch/i, ],
        totalHints: [/total/i, /importe/i, /a\s*pagar/i, /monto/i],
        storeHints: [/sucursal/i, /tienda/i, /lugar/i, /domicilio/i, /direcci[oó]n/i],
        refHints: [/referencia/i, /\bfolio\b/i, /autorizaci[oó]n/i, /operaci[oó]n/i, /clave/i],

        // Formatos esperados (ajusta a tu ticket)
        dateRegexes: [
            /\b([0-3]?\d)[\/\-\.]([01]?\d)[\/\-\.](\d{2,4})\b/,            // dd/mm/aaaa
            /\b(\d{4})[\/\-\.]([01]\d)[\/\-\.]([0-3]\d)\b/,                // aaaa-mm-dd
            /\b([0-3]?\d)\s+(ene|feb|mar|abr|may|jun|Jul|ago|sep|oct|nov|dic)\w*\s+(\d{2,4})\b/i
        ],
        amountRegex: /(?:\$?\s*)((?:\d{1,3}(?:[.,]\d{3})*|\d+)(?:[.,]\d{2})?)/, // 1.234,56 | 1234.56
    }
}
