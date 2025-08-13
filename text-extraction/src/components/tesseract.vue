<script setup>
import { ref, onBeforeUnmount } from 'vue'
import Tesseract from 'tesseract.js'
import { parseTicket } from '../utils/parseTicket'

const file = ref(null)
const imageURL = ref('')
const text = ref('')
const progress = ref(0)
const lang = ref('spa')
const loading = ref(false)
const error = ref('')
const parsed = ref(null) // 👈 estado para los campos extraídos

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
  // permite volver a subir el mismo archivo
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
    const { data } = await Tesseract.recognize(file.value, lang.value, {
      logger: (m) => {
        if (m.status === 'recognizing text' && m.progress != null) {
          progress.value = Math.round(m.progress * 100)
        }
      }
    })
    text.value = data.text || ''
    // 👇 parsea inmediatamente después del OCR
    parsed.value = parseTicket(text.value, 'mi_tienda')
    console.log('ticket:', parsed.value)
  } catch (err) {
    error.value = String(err?.message || err)
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
      <select v-model="lang" title="Idioma OCR">
        <option value="eng">Inglés (eng)</option>
        <option value="spa">Español (spa)</option>
      </select>
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

  <!-- 👇 solo muestra cuando ya hay parsed -->
  <div v-if="parsed" class="card">
    <h3>Campos detectados</h3>
    <ul>
      <li><b>Fecha:</b> {{ parsed.fields.fecha || '—' }}</li>
      <li><b>Total:</b> {{ (parsed.fields.total ?? parsed.fields.totalRaw) || '—' }}</li>
      <li><b>Sucursal:</b> {{ parsed.fields.sucursal || '—' }}</li>
      <li><b>Referencia:</b> {{ parsed.fields.referencia || '—' }}</li>
    </ul>
    <small>Confianza: {{ Math.round((parsed.confidence.overall || 0) * 100) }}%</small>
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
