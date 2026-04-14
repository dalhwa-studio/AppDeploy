# 🚀 AppDeploy

**모바일 앱 스토어 배포 자동화 플랫폼**

하나의 웹 UI에서 Google Play Store와 Apple App Store에 앱을 동시에 등록/업데이트하는 통합 배포 관리 서비스입니다.

## ✨ 주요 기능

- **통합 메타데이터 관리** — 공통 데이터는 한 번만 입력, 스토어별 차이는 분리 관리
- **바이너리 업로드** — AAB / IPA 파일 드래그 & 드롭 업로드
- **동시 배포** — Google Play / App Store / 둘 다 한 번에 배포
- **API 키 암호화 저장** — AES-256-GCM 암호화로 안전하게 저장
- **다중 앱 관리** — 무제한 앱 등록 및 관리
- **상태 추적** — Draft → Ready → Uploaded → In Review → Published

## 🛠 기술 스택

| 레이어 | 기술 |
|---|---|
| 프론트엔드 | React 19 + Vite 8 |
| 스타일링 | Vanilla CSS (Dark Mode + Glassmorphism) |
| 애니메이션 | framer-motion |
| 아이콘 | lucide-react |
| 백엔드 | Node.js + Express 5 |
| 실시간 | Socket.IO |
| 암호화 | AES-256-GCM (crypto) |

## 🚀 시작하기

```bash
# 의존성 설치
npm install

# 프론트엔드 개발 서버 (포트 5173)
npm run dev

# 백엔드 서버 (포트 3721)
npm run server

# 프론트엔드 + 백엔드 동시 실행
npm start
```

## 📁 프로젝트 구조

```
AppDeploy/
├── src/                      # 프론트엔드 (React)
│   ├── components/
│   │   ├── apps/             # 앱 목록, 카드
│   │   ├── common/           # 공통 컴포넌트 (Modal, Toast, Badge)
│   │   ├── detail/           # 상세 탭 (공통/Google/Apple/Build)
│   │   └── layout/           # 사이드바, 레이아웃
│   ├── hooks/                # Context, 커스텀 훅
│   └── utils/                # 상수, 유틸리티
├── server/                   # 백엔드 (Express)
│   └── index.js              # API 서버
├── index.html
├── vite.config.js
└── package.json
```

## 📋 앱 상세 탭 구성

1. **공통 정보** — 앱 이름, 설명, 아이콘, 스크린샷, 버전, URL
2. **Google Play** — Service Account 인증, Short Description, Feature Graphic, 트랙 선택
3. **App Store** — API Key 인증, Subtitle, Keywords, Promotional Text, 심사 정보
4. **Build & Release** — 바이너리 업로드, 스토어 연결 상태, 배포 버튼, 히스토리

## 🔒 보안

- API 키는 AES-256-GCM으로 암호화되어 저장됩니다
- `.appdeploy_keys/` 디렉토리는 `.gitignore`에 포함되어 있습니다
- 프로덕션에서는 `ENCRYPTION_MASTER_KEY` 환경변수를 반드시 설정하세요
