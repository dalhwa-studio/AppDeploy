/* ═══ Locale code mapping between canonical (BCP-47) and store-specific codes ═══
 * Canonical format: 'ko-KR', 'en-US', 'zh-CN' (matches Google Play closely).
 * App Store uses shorter or different codes for some locales.
 */

const APP_STORE_MAP = {
  'ko-KR': 'ko',
  'ja-JP': 'ja',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'id-ID': 'id',
  'vi-VN': 'vi',
  'th-TH': 'th',
  'tr-TR': 'tr',
  'ru-RU': 'ru',
  'hi-IN': 'hi',
  'ar-SA': 'ar-SA',
  'it-IT': 'it',
  'de-DE': 'de-DE',
  'fr-FR': 'fr-FR',
  'es-ES': 'es-ES',
  'es-419': 'es-MX',
  'pt-BR': 'pt-BR',
  'en-US': 'en-US',
  'en-GB': 'en-GB',
};

const GOOGLE_PLAY_MAP = {
  'ar-SA': 'ar',
  'en-US': 'en-US',
};

export function toAppStoreLocale(canonical) {
  return APP_STORE_MAP[canonical] || canonical;
}

export function toGooglePlayLocale(canonical) {
  return GOOGLE_PLAY_MAP[canonical] || canonical;
}

export const DEFAULT_LOCALE = 'ko-KR';
