/* ═══ Constants & Configuration ═══ */

export const APP_STATUSES = {
  DRAFT: 'draft',
  READY: 'ready',
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  IN_REVIEW: 'in_review',
  PUBLISHED: 'published',
  REJECTED: 'rejected',
  FAILED: 'failed',
};

export const STATUS_CONFIG = {
  [APP_STATUSES.DRAFT]: { label: '초안', badgeClass: 'badge-draft', color: '#64748b' },
  [APP_STATUSES.READY]: { label: '준비 완료', badgeClass: 'badge-ready', color: '#3b82f6' },
  [APP_STATUSES.UPLOADING]: { label: '업로드 중', badgeClass: 'badge-uploading', color: '#f59e0b' },
  [APP_STATUSES.UPLOADED]: { label: '업로드됨', badgeClass: 'badge-uploaded', color: '#3b82f6' },
  [APP_STATUSES.IN_REVIEW]: { label: '심사 중', badgeClass: 'badge-in-review', color: '#a855f7' },
  [APP_STATUSES.PUBLISHED]: { label: '게시됨', badgeClass: 'badge-published', color: '#10b981' },
  [APP_STATUSES.REJECTED]: { label: '거부됨', badgeClass: 'badge-rejected', color: '#ef4444' },
  [APP_STATUSES.FAILED]: { label: '실패', badgeClass: 'badge-failed', color: '#ef4444' },
};

export const STORES = {
  GOOGLE_PLAY: 'google_play',
  APP_STORE: 'app_store',
};

export const STORE_LABELS = {
  [STORES.GOOGLE_PLAY]: 'Google Play',
  [STORES.APP_STORE]: 'App Store',
};

export const TRACKS = {
  INTERNAL: 'internal',
  CLOSED: 'alpha',
  OPEN: 'beta',
  PRODUCTION: 'production',
};

export const TRACK_LABELS = {
  [TRACKS.INTERNAL]: 'Internal Testing',
  [TRACKS.CLOSED]: 'Closed Testing',
  [TRACKS.OPEN]: 'Open Testing',
  [TRACKS.PRODUCTION]: 'Production',
};

export const CATEGORIES = [
  { value: 'games', label: '게임' },
  { value: 'business', label: '비즈니스' },
  { value: 'education', label: '교육' },
  { value: 'entertainment', label: '엔터테인먼트' },
  { value: 'finance', label: '금융' },
  { value: 'food_drink', label: '음식 및 음료' },
  { value: 'health_fitness', label: '건강 및 피트니스' },
  { value: 'lifestyle', label: '라이프스타일' },
  { value: 'music', label: '음악' },
  { value: 'navigation', label: '내비게이션' },
  { value: 'news', label: '뉴스' },
  { value: 'photo_video', label: '사진 및 비디오' },
  { value: 'productivity', label: '생산성' },
  { value: 'shopping', label: '쇼핑' },
  { value: 'social', label: '소셜 네트워킹' },
  { value: 'sports', label: '스포츠' },
  { value: 'tools', label: '도구' },
  { value: 'travel', label: '여행' },
  { value: 'utilities', label: '유틸리티' },
  { value: 'weather', label: '날씨' },
];

export const FIELD_LIMITS = {
  appName: 30,
  subtitle: 30,
  shortDescription: 80,
  description: 4000,
  keywords: 100,
  promotionalText: 170,
  whatsNew: 4000,
  googleReleaseNotes: 500,
  copyright: 255,
};

export const API_BASE = 'http://localhost:3721/api';

export const DEPLOY_STEPS = {
  // Google Play steps
  DECRYPT_CREDENTIAL: '자격증명 복호화',
  AUTH: 'Google Play API 인증',
  CREATE_EDIT: '편집 세션 생성',
  UPLOAD_BUNDLE: 'AAB 파일 업로드',
  UPDATE_TRACK: '트랙 설정',
  UPDATE_LISTING: '메타데이터 업데이트',
  COMMIT: '변경사항 적용',
  // App Store steps
  APPLE_DECRYPT: '자격증명 복호화',
  APPLE_AUTH: 'App Store Connect 인증',
  APPLE_FIND_APP: '앱 조회',
  APPLE_UPLOAD_IPA: 'IPA 파일 업로드',
  APPLE_PROCESS_BUILD: '빌드 처리 대기',
  APPLE_CREATE_VERSION: '버전 생성',
  APPLE_UPDATE_META: '메타데이터 업데이트',
  APPLE_REVIEW_INFO: '심사 정보 설정',
  APPLE_SELECT_BUILD: '빌드 연결',
  APPLE_SUBMIT: '심사 제출',
  // Shared
  DONE: '완료',
};

export const DEFAULT_APP = {
  id: null,
  name: '',
  iosBundleId: '',
  androidPackageName: '',
  category: '',
  icon: null,
  status: APP_STATUSES.DRAFT,
  shared: {
    appName: '',
    description: '',
    privacyUrl: '',
    supportUrl: '',
    versionName: '1.0.0',
    versionCode: 1,
    screenshots: [],
  },
  googlePlay: {
    shortDescription: '',
    releaseNotes: '',
    featureGraphic: null,
    videoUrl: '',
    track: TRACKS.INTERNAL,
  },
  appStore: {
    subtitle: '',
    keywords: '',
    promotionalText: '',
    whatsNew: '',
    marketingUrl: '',
    copyright: '',
    reviewContact: {
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
    },
    reviewNotes: '',
    demoAccount: {
      username: '',
      password: '',
    },
  },
  builds: {
    android: null,
    ios: null,
  },
  storeAccounts: {
    googlePlay: null,
    appStore: null,
  },
  deployments: [],
  // ─── Localization ───
  defaultLocale: 'ko-KR',
  targetLocales: [],           // e.g. ['en-US','ja-JP']
  locales: {},                 // { 'en-US': { title, subtitle, description, keywords, promotionalText, whatsNew, shortDescription, screenshots, generatedAt, generatedBy, edited } } — screenshots 비어있으면 shared.screenshots 로 폴백
  createdAt: null,
  updatedAt: null,
};
