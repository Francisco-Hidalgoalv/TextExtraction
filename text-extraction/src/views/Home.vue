<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
const router = useRouter()
const option = ref('tesseract')
const go = () => {
  const map = { tesseract: '/tesseract', ocrspace: '/ocrspace', otra: '/otra' }
  router.push(map[option.value])
}
</script>

<template>
  <section>
    <h1>Bienvenido al extractor de texto</h1>
    <p>Elige un método y continúa.</p>

    <label><input type="radio" value="tesseract" v-model="option" /> Tesseract (local)</label>
    <label><input type="radio" value="ocrspace"  v-model="option" /> OCR.space (API)</label>
    <label><input type="radio" value="otra"      v-model="option" /> Otra opción</label>

    <button @click="go">Ir</button>
  </section>
</template>
