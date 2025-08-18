<script setup>
import { ref } from 'vue'
import { useN8nOcr } from '../components/useN8nOcr'

const { run } = useN8nOcr()

const file = ref(null)
const preview = ref('')
const loading = ref(false)
const error = ref('')
const text = ref('')

function onFileChange(e) {
  const f = e.target.files?.[0]
  if (!f) return
  file.value = f
  preview.value = URL.createObjectURL(f)
  text.value = ''
  error.value = ''
  e.target.value = '' // permitir re-seleccionar el mismo archivo
}

async function send() {
  if (!file.value) return
  loading.value = true
  error.value = ''
  text.value = ''
  try {
    const { text: t } = await run(file.value)
    text.value = t
    // (opcional) const parsed = parseTicket(t)
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="hero">
      <h2>OCR en la nube (n8n + Vision)</h2>
      <p>Prueba el extractor vía webhook.</p>
    </header>

    <section class="card">
      <div class="controls">
        <input type="file" accept="image/*" @change="onFileChange" />
        <button class="btn" :disabled="!file || loading" @click="send">
          {{ loading ? 'Procesando…' : 'Enviar a n8n' }}
        </button>
      </div>

      <div v-if="preview" class="preview">
        <img :src="preview" alt="preview" />
      </div>

      <p v-if="error" class="error">⚠️ {{ error }}</p>

      <label class="label">Texto extraído</label>
      <textarea class="output" v-model="text" rows="12" readonly
                placeholder="Aquí aparecerá el texto…" />
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1rem 3rem;
}
.hero h2 {
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.hero p {
  color: #6b7280;
  margin-top: .25rem;
}

.card {
  margin-top: 1rem;
  padding: 1.25rem;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  background: #fff;
  box-shadow:
    0 10px 15px -3px rgba(0,0,0,.05),
    0 4px 6px -4px rgba(0,0,0,.05);
}

.controls {
  display: flex;
  gap: .75rem;
  flex-wrap: wrap;
  align-items: center;
}

.btn {
  appearance: none;
  border: 0;
  padding: .7rem 1rem;
  border-radius: 10px;
  background: linear-gradient(180deg, #4f46e5, #4338ca);
  color: #fff;
  font-weight: 700;
  box-shadow: 0 6px 22px rgba(79,70,229,.28);
  cursor: pointer;
  transition: transform .06s ease, filter .2s ease;
}
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn:not(:disabled):active { transform: translateY(1px) scale(.99); }

.preview {
  margin-top: 1rem;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}
.preview img { width: 100%; display: block; }

.label {
  display: block;
  margin-top: 1rem;
  font-weight: 700;
  color: #111827;
}
.output {
  width: 100%;
  margin-top: .5rem;
  padding: .9rem 1rem;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  line-height: 1.4;
  resize: vertical;
}

.error {
  margin-top: .75rem;
  color: #b91c1c;
  font-weight: 600;
}
</style>
