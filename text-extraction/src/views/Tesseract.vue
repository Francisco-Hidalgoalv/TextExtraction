<script setup>
import TesseractOcr from '../components/tesseract.vue'  // ajusta la ruta si cambió
</script>

<template>
  <section style="padding:1rem">
    <h2>Tesseract</h2>
    <p>Sube una imagen y extrae texto.</p>
    <TesseractOcr />
    <button @click="$router.push('/')">Volver al menú</button>
  </section>
</template>