import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/**
 * Translations live in src/i18n/locales/<lang>/<namespace>.json.
 *  - common.json is merged at the root:      t('save'), t('nav.dashboard'), t('status.paid')
 *  - every other file becomes a sub-tree:    collection.json → t('collection.title')
 * Marathi (mr) is the primary/default language; English and Hindi are fully supported.
 */
const files = import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>

const resources: Record<string, { translation: Record<string, unknown> }> = { mr: { translation: {} }, en: { translation: {} }, hi: { translation: {} } }
for (const [path, json] of Object.entries(files)) {
  const m = path.match(/\.\/locales\/(\w+)\/(\w+)\.json$/)
  if (!m) continue
  const [, lng, ns] = m
  if (!resources[lng]) continue
  if (ns === 'common') Object.assign(resources[lng].translation, json)
  else resources[lng].translation[ns] = json
}

export const LANGS = [
  { code: 'mr', label: 'मराठी' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
] as const

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('sf_lang') || 'mr',
  fallbackLng: ['mr', 'en'],
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on('languageChanged', (l) => {
  document.documentElement.lang = l
  localStorage.setItem('sf_lang', l)
})

export default i18n
