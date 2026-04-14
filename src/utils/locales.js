/* ═══ Locale Presets ═══
 * Canonical codes use BCP-47 style (language-REGION) for Google Play compatibility.
 * Server-side mapping converts to App Store locale codes when needed.
 */

export const DEFAULT_LOCALE = 'ko-KR';

export const LOCALE_PRESETS = [
  { code: 'en-US', label: 'English (US)', language: 'English', flag: '🇺🇸' },
  { code: 'en-GB', label: 'English (UK)', language: 'English', flag: '🇬🇧' },
  { code: 'ja-JP', label: '日本語', language: 'Japanese', flag: '🇯🇵' },
  { code: 'zh-CN', label: '简体中文', language: 'Simplified Chinese', flag: '🇨🇳' },
  { code: 'zh-TW', label: '繁體中文', language: 'Traditional Chinese', flag: '🇹🇼' },
  { code: 'es-ES', label: 'Español (ES)', language: 'Spanish', flag: '🇪🇸' },
  { code: 'es-419', label: 'Español (LatAm)', language: 'Spanish (Latin America)', flag: '🌎' },
  { code: 'de-DE', label: 'Deutsch', language: 'German', flag: '🇩🇪' },
  { code: 'fr-FR', label: 'Français', language: 'French', flag: '🇫🇷' },
  { code: 'it-IT', label: 'Italiano', language: 'Italian', flag: '🇮🇹' },
  { code: 'pt-BR', label: 'Português (BR)', language: 'Portuguese (Brazil)', flag: '🇧🇷' },
  { code: 'ru-RU', label: 'Русский', language: 'Russian', flag: '🇷🇺' },
  { code: 'id-ID', label: 'Bahasa Indonesia', language: 'Indonesian', flag: '🇮🇩' },
  { code: 'vi-VN', label: 'Tiếng Việt', language: 'Vietnamese', flag: '🇻🇳' },
  { code: 'th-TH', label: 'ไทย', language: 'Thai', flag: '🇹🇭' },
  { code: 'ar-SA', label: 'العربية', language: 'Arabic', flag: '🇸🇦' },
  { code: 'hi-IN', label: 'हिन्दी', language: 'Hindi', flag: '🇮🇳' },
  { code: 'tr-TR', label: 'Türkçe', language: 'Turkish', flag: '🇹🇷' },
];

export function getLocaleLabel(code) {
  const preset = LOCALE_PRESETS.find(p => p.code === code);
  if (preset) return `${preset.flag} ${preset.label}`;
  if (code === DEFAULT_LOCALE) return '🇰🇷 한국어 (기본)';
  return code;
}

export function getLanguageName(code) {
  const preset = LOCALE_PRESETS.find(p => p.code === code);
  return preset?.language || code;
}
