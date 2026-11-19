/* global process */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defineConfig, loadEnv, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import { KIOSK_CONFIG_FILE, resolveKioskConfig } from './scripts/kiosk-config.mjs'
import { versionLabel } from './scripts/update-instance-lib.mjs'

// Construction sans modules privés (open core L2b) : VITE_PRIVATE_MODULES=none remplace le
// registre src/modules/index.js par une liste vide. Aucun fichier de src/modules/<id>/ n'entre
// alors dans le build ; la CI vérifie que cette version se construit.
const MODULES_REGISTRY = normalizePath(fileURLToPath(new URL('./src/modules/index.js', import.meta.url)))
// Catalogues des modules (LAB-403, données lues par src/features/catalog.js et serviceKeys.js) : liste vide.
const MODULES_CATALOG = normalizePath(fileURLToPath(new URL('./src/modules/catalog.js', import.meta.url)))
// Marque de l'instance (open core L7) : fichier privé, remplacé par `null` dans la construction ouverte.
const BRAND_FILE = normalizePath(fileURLToPath(new URL('./src/modules/brand.js', import.meta.url)))
const disabledModules = () => process.env.VITE_PRIVATE_MODULES === 'none'

function privateModules() {
  const disabled = disabledModules()
  return {
    name: 'private-modules',
    enforce: 'pre',
    load(id) {
      if (!disabled) return null
      const file = normalizePath(id.split('?')[0])
      if (file === MODULES_REGISTRY) return 'export default [];'
      if (file === MODULES_CATALOG) return 'export default [];'
      if (file === BRAND_FILE) return 'export default null;'
      return null
    },
  }
}

// Manifeste PWA des galeries (open core L7) : généré avec le nom de la marque installée
// (src/manifest.template.json), au lieu d'un fichier statique de public/ qui portait la marque.
async function webManifest() {
  const brand = !disabledModules() && existsSync(BRAND_FILE)
    ? (await import(pathToFileURL(BRAND_FILE).href)).default
    : null
  const template = readFileSync(new URL('./src/manifest.template.json', import.meta.url), 'utf8')
  const name = typeof brand?.name === 'string' && brand.name.trim() ? brand.name.trim() : 'Photobooth'
  // Couleur de la barre du navigateur : celle de la marque (#RRGGBB), sinon celle du modèle.
  const themeColor = /^#[0-9a-f]{6}$/i.test(brand?.themeColor ?? '') ? brand.themeColor : null
  const manifest = JSON.parse(template.replace('%%BRAND_NAME%%', JSON.stringify(name).slice(1, -1)))
  if (themeColor) manifest.theme_color = themeColor
  const source = `${JSON.stringify(manifest, null, 2)}\n`
  return {
    name: 'web-manifest',
    transformIndexHtml(html) {
      return themeColor
        ? html.replace(/(<meta name="theme-color" content=")#[0-9a-f]{6}(")/i, `$1${themeColor}$2`)
        : html
    },
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json')
        res.end(source)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source })
    },
  }
}

// kiosk-config.json lu par la borne (open core K2) : généré depuis KIOSK_SUPABASE_* / VITE_SUPABASE_*
// au lieu d'être versionné dans public/ (chaque instance a le sien).
function kioskConfig() {
  let result
  let logger
  const shout = () => {
    if (!result?.warning) return
    const lines = result.warning.split('\n')
    const bar = '!'.repeat(Math.max(...lines.map((l) => l.length)) + 4)
    logger.warn(`\n${bar}\n${lines.map((l) => `! ${l}`).join('\n')}\n${bar}\n`, { timestamp: false })
  }
  return {
    name: 'kiosk-config',
    configResolved(config) {
      logger = config.logger
      result = resolveKioskConfig(loadEnv(config.mode, config.envDir || config.root, ''))
      if (config.publicDir && existsSync(join(config.publicDir, KIOSK_CONFIG_FILE))) {
        logger.warn(`public/${KIOSK_CONFIG_FILE} est obsolète (le fichier est généré) : supprimez-le.`)
      }
    },
    configureServer(server) {
      shout()
      server.middlewares.use(`/${KIOSK_CONFIG_FILE}`, (_req, res) => {
        if (!result.content) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(result.content)
      })
    },
    generateBundle() {
      if (result.content) this.emitFile({ type: 'asset', fileName: KIOSK_CONFIG_FILE, source: result.content })
    },
    closeBundle() {
      shout()
    },
  }
}

// Version du SaaS (menu du compte de l'admin, demande à l'éditeur) : « 1.2.0 (abc1234) », version de
// package.json (numérotée à chaque publication publique, LAB-431) et commit construit (Vercel ou git).
function appVersion() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
    || spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).stdout?.trim()
  return versionLabel(version, sha)
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [privateModules(), await webManifest(), kioskConfig(), react()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()) },
}))
