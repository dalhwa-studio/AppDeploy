import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
};

const FIELD_LIMITS = {
  title: 30,
  subtitle: 30,
  shortDescription: 80,
  description: 4000,
  keywords: 100,
  promotionalText: 170,
  whatsNew: 4000,
};

const STORE_FIELDS = {
  app_store: ['title', 'subtitle', 'description', 'keywords', 'promotionalText', 'whatsNew'],
  google_play: ['title', 'shortDescription', 'description', 'whatsNew'],
  both: ['title', 'subtitle', 'shortDescription', 'description', 'keywords', 'promotionalText', 'whatsNew'],
};

function buildSystemPrompt(store, locale, languageName) {
  return `You are a senior ASO (App Store Optimization) specialist and professional native translator for mobile app stores.

Rules:
- Output JSON ONLY, matching the given schema. Do not include markdown code fences.
- Translate the INTENT, not word-by-word. Use culturally native phrasing for ${languageName} (${locale}).
- Respect per-field length limits strictly (in characters, not words).
- For \`keywords\`: comma-separated, NO spaces after commas, max 100 chars total, use high-search-volume terms relevant to the target market.
- For \`title\` / \`subtitle\`: keyword-front-loaded, compelling, brand-safe.
- \`promotionalText\`: action-oriented, seasonal-friendly, <= 170 chars.
- \`shortDescription\`: punchy hook for Google Play, <= 80 chars.
- \`description\`: scannable paragraphs or bullet-style lines, <= 4000 chars.
- \`whatsNew\`: concise release notes in native tone, <= 4000 chars.
- Keep brand names, proper nouns, trademarks intact.
- Do NOT invent features the source doesn't describe.
- Target store: ${store}. Target locale: ${locale}.`;
}

function buildUserPrompt({ sourceLocale, sourceMetadata, targetLocale, fields }) {
  const limits = Object.fromEntries(fields.map(f => [f, FIELD_LIMITS[f]]));
  return `Source locale: ${sourceLocale}
Target locale: ${targetLocale}

Source metadata (JSON):
${JSON.stringify(sourceMetadata, null, 2)}

Field length limits (chars): ${JSON.stringify(limits)}
Required fields: ${fields.join(', ')}

Return a single JSON object with exactly these keys: ${fields.map(f => `"${f}"`).join(', ')}.`;
}

async function generateWithAnthropic({ apiKey, system, user, model }) {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: model || DEFAULT_MODELS.anthropic,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content?.find(b => b.type === 'text')?.text || '';
  return parseJson(text);
}

async function generateWithOpenAI({ apiKey, system, user, model }) {
  const client = new OpenAI({ apiKey });
  const res = await client.chat.completions.create({
    model: model || DEFAULT_MODELS.openai,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const text = res.choices?.[0]?.message?.content || '{}';
  return parseJson(text);
}

async function generateWithGemini({ apiKey, system, user, model }) {
  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({
    model: model || DEFAULT_MODELS.gemini,
    systemInstruction: system,
    generationConfig: { responseMimeType: 'application/json' },
  });
  const res = await genModel.generateContent(user);
  const text = res?.response?.text?.() || '{}';
  return parseJson(text);
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM 응답에서 JSON을 찾을 수 없습니다.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function clampToLimits(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const limit = FIELD_LIMITS[k];
    out[k] = limit && typeof v === 'string' ? v.slice(0, limit) : v;
  }
  return out;
}

/**
 * Generate translated + ASO-optimized metadata for multiple target locales in parallel.
 *
 * @param {object} opts
 * @param {string} opts.provider - 'anthropic' | 'openai' | 'gemini'
 * @param {string} opts.apiKey
 * @param {string} opts.store - 'app_store' | 'google_play' | 'both'
 * @param {string} opts.sourceLocale - e.g. 'ko-KR'
 * @param {object} opts.sourceMetadata - { title, subtitle, description, keywords, ... }
 * @param {string[]} opts.targetLocales - ['en-US', 'ja-JP', ...]
 * @returns {Promise<Record<string, object | { error: string }>>}
 */
export async function generateForLocales({
  provider,
  apiKey,
  model,
  store,
  sourceLocale,
  sourceMetadata,
  targetLocales,
}) {
  if (!apiKey) throw new Error('LLM API Key가 설정되지 않았습니다.');
  if (!targetLocales?.length) return {};

  const fields = STORE_FIELDS[store] || STORE_FIELDS.both;
  const providerFns = {
    anthropic: generateWithAnthropic,
    openai: generateWithOpenAI,
    gemini: generateWithGemini,
  };
  const fn = providerFns[provider] || generateWithAnthropic;
  const resolvedModel = model || DEFAULT_MODELS[provider];

  const entries = await Promise.all(
    targetLocales.map(async (locale) => {
      try {
        const system = buildSystemPrompt(store, locale, humanLang(locale));
        const user = buildUserPrompt({ sourceLocale, sourceMetadata, targetLocale: locale, fields });
        const result = await fn({ apiKey, system, user, model: resolvedModel });
        return [locale, {
          ...clampToLimits(result),
          generatedAt: new Date().toISOString(),
          generatedBy: `${provider}:${resolvedModel}`,
        }];
      } catch (err) {
        return [locale, { error: err.message }];
      }
    })
  );

  return Object.fromEntries(entries);
}

function humanLang(locale) {
  const map = {
    'en-US': 'American English',
    'en-GB': 'British English',
    'ja-JP': 'Japanese',
    'zh-CN': 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese',
    'es-ES': 'European Spanish',
    'es-419': 'Latin American Spanish',
    'de-DE': 'German',
    'fr-FR': 'French',
    'it-IT': 'Italian',
    'pt-BR': 'Brazilian Portuguese',
    'ru-RU': 'Russian',
    'id-ID': 'Indonesian',
    'vi-VN': 'Vietnamese',
    'th-TH': 'Thai',
    'ar-SA': 'Arabic',
    'hi-IN': 'Hindi',
    'tr-TR': 'Turkish',
    'ko-KR': 'Korean',
  };
  return map[locale] || locale;
}
