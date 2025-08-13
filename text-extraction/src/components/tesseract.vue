<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { extractTicketFromFile } from '../ocr/pipeline'   // ⬅️ nuevo
import { parseTicket } from '../utils/parseTicket'

const file = ref(null)
const imageURL = ref('')
const text = ref('')
const progress = ref(0)
const loading = ref(false)
const error = ref('')
const parsed = ref(null) // lo dejamos pero no lo usamos por ahora

const revoke = () => {
  if (imageURL.value) URL.revokeObjectURL(imageURL.value)
}

const onFileChange = (e) => {
  const f = e.target.files?.[0]
  if (!f) return
  file.value = f
  revoke()
  imageURL.value = URL.createObjectURL(f)
  text.value = ''
  error.value = ''
  progress.value = 0
  parsed.value = null
  e.target.value = ''
}

const runOCR = async () => {
  if (!file.value) return
  loading.value = true
  error.value = ''
  text.value = ''
  progress.value = 0
  parsed.value = null

  try {
    const res = await extractTicketFromFile(file.value, {
      languages: 'eng+spa',
      onProgress: (p) => { if (p != null) progress.value = Math.round(p * 100) },
      verbose: true
    })
    text.value = res.text || ''
    parsed.value = parseTicket(text.value)
    console.log('parsed:', parsed.value)
  } catch (err) {
    error.value = String(err?.message || err)
    console.error(err)
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(revoke)
</script>

<template>
  <div class="max-w-3xl mx-auto p-4 space-y-4">
    <h1>Extractor de texto (Tesseract.js)</h1>

    <div class="controls">
      <input type="file" accept="image/*" @change="onFileChange" />
      <button :disabled="!file || loading" @click="runOCR">
        {{ loading ? 'Procesando...' : 'Extraer texto' }}
      </button>
    </div>

    <div v-if="imageURL" class="preview">
      <img :src="imageURL" alt="preview" />
    </div>

    <div v-if="loading" class="progress">
      <div class="bar" :style="{ width: progress + '%' }"></div>
      <span>{{ progress }}%</span>
    </div>

    <p v-if="error" class="error">⚠️ {{ error }}</p>

    <textarea v-model="text" rows="10" placeholder="Aquí aparecerá el texto..." readonly />
  </div>

  <div v-if="parsed" class="card">
    <h3>Campos detectados</h3>
    <ul>
      <li><b>Fecha:</b> {{ parsed.fields.fecha || '—' }}</li>
      <li><b>Referencia:</b> {{ parsed.fields.referencia || '—' }}</li>
      <li><b>Monto (Amount):</b> {{ parsed.fields.amount ?? '—' }}</li>
      <li><b>Fees:</b> {{ parsed.fields.fees ?? '—' }}</li>
      <li><b>Otros:</b> {{ parsed.fields.other ?? '—' }}</li>
      <li><b>Impuestos (Taxes):</b> {{ parsed.fields.taxes ?? '—' }}</li>
      <li><b>Descuento:</b> {{ parsed.fields.discount ?? '—' }}</li>
      <li><b>Total a pagar (Total due):</b> {{ parsed.fields.totalDue ?? '—' }}</li>
      <li><b>Total al beneficiario:</b> {{ parsed.fields.recipient ?? '—' }}</li>
      <li><b>Tipo de cambio:</b> {{ parsed.fields.exchangeRate ?? '—' }}</li>
    </ul>

    <div v-if="parsed.issues?.length" style="margin-top:.5rem">
      <b>Ajustes/avisos:</b>
      <ul>
          <li v-for="(it, idx) in parsed.issues" :key="idx">{{ it }}</li>
      </ul>
    </div>

    <small>Confianza global: {{ Math.round((parsed.confidence.overall || 0) * 100) }}%</small>
  </div>

</template>

<style scoped>
h1 { font-size: 1.25rem; font-weight: 700; }
.controls { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.preview img { max-width: 100%; border: 1px solid #ddd; border-radius: 8px; }
.progress { position: relative; background: #f1f1f1; border-radius: 6px; height: 12px; }
.bar { height: 100%; border-radius: 6px; transition: width .2s; background: #4caf50; }
.progress span { margin-left: .5rem; font-size: .9rem; display: inline-block; }
textarea { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: .75rem; }
.error { color: #c0392b; font-weight: 600; }
.card { margin-top: 1rem; border: 1px solid #e5e5e5; border-radius: 10px; padding: 1rem; }
</style>
