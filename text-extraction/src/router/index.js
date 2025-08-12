import { createRouter, createWebHashHistory } from 'vue-router'
// Usa HashHistory para evitar 404 en XAMPP; si ya tienes .htaccess, luego puedes cambiar a createWebHistory
import Home from '../views/Home.vue'
import TesseractView from '../views/Tesseract.vue'
import OcrSpaceView from '../views/OcrSpace.vue'
import OtraView from '../views/API.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/tesseract', name: 'tesseract', component: TesseractView },
    { path: '/ocrspace', name: 'ocrspace', component: OcrSpaceView },
    { path: '/otra', name: 'otra', component: OtraView },
  ],
})
