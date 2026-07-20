# linkling-app (저장소 A)

Linkling 학생용 웹/PWA. 단어팩은 번들에 포함하지 않고, 원격 catalog(`VITE_WORDPACK_CATALOG_URL`)에서 불러온다.

## 빠른 시작

```bash
npm install
VITE_WORDPACK_CATALOG_URL=https://<wordpack-site>/catalog.json npm run dev
```

개발 중 catalog를 바꿔 보려면 URL 파라미터도 사용할 수 있다: `?catalog=<catalog.json 주소>`

## 스크립트

| 명령 | 역할 |
|---|---|
| `npm run dev` | Vite 개발 서버 |
| `npm run build` | 타입체크 + 프로덕션 빌드 (`dist/`) |
| `npm test` | 단위 테스트 (node:test, 57개) |
| `npm run test:e2e` | Playwright 원격 배포 E2E (`APP_URL`, `CATALOG_URL` 환경 변수) |
| `npm run build:local` | 오프라인 환경용 esbuild 번들 (`dist-local/`) |
| `node tests/e2e/run-e2e.mjs` | 로컬 두 서버(cross-origin)로 Wave 1 전체 완주 E2E |

## 환경 변수

- `VITE_WORDPACK_CATALOG_URL` — 단어팩 catalog 주소 (필수, Netlify 환경 변수로 주입. 소스에 도메인 하드코딩 금지)
- `VITE_RESEARCH_EXPORT` — `true`일 때만 세션 요약에 연구용 JSON 내보내기 노출

## 구조

`docs/ARCHITECTURE.md` 참조. 학습 규칙·Flow는 `docs/LEARNING_FLOW.md`, 배포는 `docs/NETLIFY_DEPLOYMENT.md`.

## 현재 상태 (preview)

- 실제 `.riv` 미도착 → 모든 팩이 SVG fallback으로 동작 (`scene.availability=pending_rive_export`)
- 검수 오디오 미도착 → preview 팩에 한해 브라우저 TTS로 대체 재생
- 발음 판정 provider 미확정([확인 필요]) → Mock/타이핑 채널로 E2E 가능, adapter 분리 완료
