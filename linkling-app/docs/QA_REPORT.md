# QA_REPORT

작성일: 2026-07-20 (Asia/Seoul) · 검증 환경: Node 22 / Chromium(headless, Playwright)

## 자동 테스트 결과

| 스위트 | 결과 |
|---|---|
| 앱 단위 테스트 (`npm test`, node:test) | **57 / 57 통과** |
| 단어팩 저장소 (`npm test`: 검증 10팩 + 무결성 테스트 6건) | **전부 통과** |
| 타입체크 (`tsc --noEmit`) | 통과 |
| 로컬 cross-origin E2E (`node tests/e2e/run-e2e.mjs`) | **통과** — Wave 1 10개 전부 동일 엔진으로 완주, CORS 오류 0건 |

E2E는 앱(:8800)과 단어팩(:8801)을 별도 origin으로 기동해 원격 분리 구조를 재현했다. 실제 Netlify preview 간 E2E는 배포 후 `npm run test:e2e`로 동일 스펙을 실행한다.

## 완료 기준 대조 (본문서 §15 + 부속 §9)

| # | 기준 | 상태 |
|---|---|---|
| 1 | 앱/단어팩 저장소·빌드·사이트 분리 | ✅ 두 저장소, 독립 netlify.toml |
| 2 | 앱 번들에 단어팩 미포함 | ✅ 번들에 팩 데이터 0건 (원격 로드만) |
| 3 | 환경 변수 catalog URL에서 원격 로드 | ✅ `VITE_WORDPACK_CATALOG_URL` |
| 4 | CORS 오류 없이 팩·자산 로드 | ✅ E2E 검증 (`_headers` CORS) |
| 5 | facilitate·melt 동일 Controller 완주 | ✅ E2E |
| 6 | 나머지 8개 새 코드 없이 로드 | ✅ E2E — 10개 전부, 단어 하드코딩 0건(자동 테스트) |
| 7 | 동일 장면 누적·Chunk 해금·최종 sequence | ✅ 팩 빌드 검증 + 엔진/장면 테스트 |
| 8 | 애니메이션→말풍선→뜻→철자 순서 | ✅ SceneAdapter 이벤트 강제 + E2E 경유 확인 |
| 9 | 이미지·말풍선 유지, 뜻만 성공 기반 약화 | ✅ ReviewScreen + fade 단위 테스트 |
| 10 | 문맥 문제 없음 | ✅ 화면·데이터에 부재 |
| 11 | local-first 진도·캐시 | ✅ ProgressStore + WordpackCache |
| 12 | mock으로 E2E + provider adapter 분리 | ✅ Mock/Manual + 인터페이스 |
| 13 | .riv 없는 팩: preview fallback만, published 차단 | ✅ 빌드 publish 게이트 |
| 14 | catalog URL만 바꿔 CDN 전환 | ✅ 상대 경로 해석 단위 테스트 (두 origin) |
| 15 | 자동 테스트·수동 QA 문서화 | ✅ 이 문서 |
| 16 | Raw Event + Reliability Gate, reliable+무힌트만 승격·희미화 | ✅ 단위 테스트 8건 |
| 17 | 부속 §7 QA 10항목 통과 | ✅ 아래 표 |
| 18 | 지원 불가 팩·설치 실패 화면 표시, 조용한 fallback 없음 | ✅ VisibleContentError 경로 테스트 |
| 19 | 낙인·진단 문구 0건 자동 스캔 | ✅ 양쪽 저장소 테스트 스위트 포함 |

## 부속 명세 §7 QA 체크리스트 10항목

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| 1 | 한글/숫자/공백만 입력 → fail | 단위 테스트 4건 | ✅ |
| 2 | 지원 밖 schema 팩 → 명시적 오류 | 단위 테스트 | ✅ |
| 3 | 같은 버전 경로 다른 내용 배포 차단 | versions.lock 검사 — 실제 변조 시나리오로 빌드 실패 확인 | ✅ |
| 4 | 음성 무결과 3회 → 타이핑 제안 | 단위 테스트 | ✅ |
| 5 | 시도 상한 → assisted 경로 (전 산출 단계) | 단위 테스트 (힌트 사다리→assisted) | ✅ |
| 6 | 백그라운드 입력 → invalid·미승격 | 단위 테스트 | ✅ |
| 7 | 낙인·진단 문구 0건 스캔 | src/public + 팩 소스 전체 | ✅ 0건 |
| 8 | 선택지 성공만으로 희미화 없음 | 단위 테스트 | ✅ |
| 9 | 날짜 Asia/Seoul 기준 | 단위 테스트 (내보내기 파일명·빌드 요약) | ✅ |
| 10 | 첫 부팅 로딩 인디케이터 | 구현(CATALOG_LOADING/PACK_PREFETCH) + E2E 화면 확인 | ✅ (저속 회선 스로틀 수동 QA는 실기기 단계에 재확인 권장) |

## 남은 항목 (차단 사항 — 본문서 §17)

- 실제 `.riv` export 10개 → drop-in 절차는 RIVE_INTEGRATION.md
- 검수 오디오 (현재 preview는 TTS 대체)
- 실제 발음 provider 연결 (PRONUNCIATION_PROVIDER_TODO.md)
- 실기기·브라우저 매트릭스 QA (§12.4: Android Chrome / iOS Safari / 데스크톱) — Netlify preview 배포 후 수행
- Netlify 실제 사이트 2개 생성·환경 변수 설정 (NETLIFY_DEPLOYMENT.md 절차)

## [충돌-확인 필요] / [OPEN] 기록

- 충돌 항목: 없음 (부속 명세와 본문서 간 충돌 미발견)
- `[OPEN-QUIZ-002]` Quiz Linking(사전 인출): 본문서 §5 Flow에 없어 구현하지 않음. 완료 기준 달성 후 별도 결정.
