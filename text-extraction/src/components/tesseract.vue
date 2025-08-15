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
      verbose: false
    })
    text.value = res.text || ''  // ⬅️ guarda A/B/C para mostrar
    parsed.value = parseTicket(text.value)
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
      <label>Remitente</label>
      <li><b>Nombre del remitente:</b> {{ parsed.fields.sender?.name || '—' }}</li>
      <li><b>Dirección:</b> {{ parsed.fields.sender?.address1 || '—' }}</li>
      <li><b>Teléfono:</b> {{ parsed.fields.sender?.phone || '—' }}</li>
      <label>Beneficiario</label>
      <li><b>Nombre del beneficiario:</b> {{ parsed.fields.beneficiary?.name || '—' }}</li>
      <li><b>Dirección:</b> {{ parsed.fields.beneficiary?.address1 || '—' }}</li>
      <li><b>Teléfono:</b> {{ parsed.fields.beneficiary?.phone || '—' }}</li>
      <li><b>País:</b> {{ parsed.fields.beneficiary?.country || '—' }}</li>
      <label>Detalles del envío</label>
      <li><b>Monto:</b> {{ parsed.fields.amount ?? '—' }}</li>
      <li><b>Total a pagar:</b> {{ parsed.fields.totalDue ?? '—' }}</li>
      <li><b>Total al beneficiario:</b> {{ parsed.fields.recipient ?? '—' }}</li>
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
/* ====== Look & feel general ====== */
.max-w-3xl.mx-auto {
  --bg: #0b0f17;
  --card-bg: rgba(255,255,255,0.06);
  --card-bg-strong: rgba(255,255,255,0.08);
  --border: rgba(255,255,255,0.12);
  --text: #e7e9ee;
  --muted: #aab1c3;
  --accent: #7c5cff;
  --accent-2: #00d4ff;
  --accent-contrast: #0b0f17;
  --ring: rgba(124, 92, 255, .35);

  color: var(--text);
  background:
    radial-gradient(1200px 600px at 10% -10%, rgba(124,92,255,.12), transparent 60%),
    radial-gradient(1200px 600px at 110% 0%, rgba(0,212,255,.10), transparent 60%);
  border-radius: 16px;
  padding: 1.25rem;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
}

/* Dark/Light auto */
@media (prefers-color-scheme: light) {
  .max-w-3xl.mx-auto {
    --bg: #fafafa;
    --card-bg: rgba(255,255,255,0.85);
    --card-bg-strong: rgba(255,255,255,0.95);
    --border: rgba(0,0,0,0.08);
    --text: #101323;
    --muted: #475069;
    --accent: #6a5cff;
    --accent-2: #06b6d4;
    --accent-contrast: #ffffff;
    --ring: rgba(106, 92, 255, .30);
    box-shadow: 0 6px 24px rgba(16,19,35,.06);
  }
}

* { box-sizing: border-box; }
h1 { display:none; }

/* ====== Controles ====== */
.controls {
  display: flex;
  gap: .75rem;
  align-items: center;
  flex-wrap: wrap;
  padding: .75rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: linear-gradient(180deg, var(--card-bg), transparent);
  backdrop-filter: blur(6px);
}

/* input file bonito */
.controls input[type="file"] {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: .5rem .75rem;
  background: var(--card-bg-strong);
  color: var(--muted);
  transition: border-color .2s, background .2s;
}
.controls input[type="file"]:hover {
  border-color: var(--accent);
  background: rgba(124,92,255,.08);
}

.controls input[type="file"]::file-selector-button {
  margin-right: .75rem;
  border: none;
  border-radius: 10px;
  padding: .45rem .8rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--accent-contrast);
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
}
.controls input[type="file"]::file-selector-button:hover {
  filter: brightness(1.05);
}

/* botón acción */
.controls button {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: .6rem 1rem;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  color: var(--accent-contrast);
  font-weight: 700;
  letter-spacing: .2px;
  box-shadow: 0 8px 18px rgba(124,92,255,.25);
  transition: transform .08s ease, box-shadow .2s ease, filter .2s;
}
.controls button:hover { filter: brightness(1.05); }
.controls button:active { transform: translateY(1px) scale(.995); }
.controls button:disabled {
  opacity: .6;
  cursor: not-allowed;
  box-shadow: none;
  background: linear-gradient(90deg, #7b7b7b, #999);
}

/* ====== Preview de imagen ====== */
.preview {
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: .75rem;
  background: var(--card-bg);
  backdrop-filter: blur(4px);
}
.preview img {
  display:block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,.25);
}

/* ====== Barra de progreso ====== */
.progress {
  position: relative;
  border-radius: 10px;
  height: 12px;
  overflow: hidden;
  background: rgba(255,255,255,.06);
  border: 1px solid var(--border);
}
.bar {
  height: 100%;
  border-radius: 10px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  position: relative;
}
.bar::after {
  content: "";
  position: absolute;
  inset: 0;
  background-size: 28px 28px;
  background-image:
    linear-gradient(45deg, rgba(255,255,255,.25) 25%, transparent 25%,
                           transparent 50%, rgba(255,255,255,.25) 50%,
                           rgba(255,255,255,.25) 75%, transparent 75%, transparent);
  animation: move 1s linear infinite;
  mix-blend-mode: overlay;
}
@keyframes move {
  to { background-position: 28px 0; }
}
.progress + span, .progress span {
  margin-left: .5rem;
  font-size: .9rem;
  color: var(--muted);
}

/* ====== Área de texto OCR ====== */
textarea {
  width: 100%;
  min-height: 220px;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: .9rem 1rem;
  background: var(--card-bg-strong);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  line-height: 1.45;
  outline: none;
  resize: vertical;
  box-shadow: inset 0 0 0 1px transparent, 0 10px 24px rgba(0,0,0,.12);
  transition: box-shadow .2s, border-color .2s, background .2s;
}
textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--ring), 0 10px 24px rgba(124,92,255,.18);
}

/* ====== Mensaje de error ====== */
.error {
  padding: .65rem .8rem;
  border-radius: 10px;
  border: 1px solid rgba(255,80,80,.25);
  background: linear-gradient(180deg, rgba(255,80,80,.12), transparent);
  color: #ff9a9a;
  font-weight: 600;
}

/* ====== Card de resultados ====== */
.card {
  margin-top: 1rem;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1rem 1.1rem;
  background:
    linear-gradient(180deg, var(--card-bg-strong), rgba(255,255,255,0.04));
  backdrop-filter: blur(6px);
  box-shadow: 0 8px 28px rgba(0,0,0,.18);
}
.card h3 {
  margin: 0 0 .6rem 0;
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: .2px;
}

/* lista en formato “etiqueta : valor” */
.card ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: .35rem;
}
.card li {
  display: grid;
  grid-template-columns: 200px 1fr;
  align-items: start;
  gap: .5rem;
  padding: .5rem .6rem;
  border-radius: 10px;
  border: 1px solid transparent;
  transition: background .2s, border-color .2s;
}
.card li:hover {
  background: rgba(255,255,255,.04);
  border-color: var(--border);
}
.card li > b {
  color: var(--muted);
  font-weight: 700;
}

/* “labels” inline que metiste dentro del ul */
.card label {
  grid-column: 1 / -1;
  margin-top: .4rem;
  margin-bottom: .2rem;
  font-size: .85rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .6px;
  color: var(--muted);
  opacity: .9;
}

/* confidencia y avisos */
.card small {
  display: inline-block;
  margin-top: .6rem;
  color: var(--muted);
}
.card ul ul { margin-top: .25rem; }
.card ul ul li {
  grid-template-columns: 1fr;
  padding: .35rem .5rem;
  border-radius: 8px;
  background: rgba(255,255,255,.03);
}

</style>
