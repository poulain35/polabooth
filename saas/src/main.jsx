import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { reloadOnceForNewVersion } from './lib/chunkReload'

// Fichier de l'ancienne version introuvable après une mise en ligne (préchargement de Vite) :
// rechargement, une fois par minute. Sinon l'erreur suit son cours (écran RouteError).
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForNewVersion()) event.preventDefault()
})

createRoot(document.getElementById('root')).render(<App />)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
