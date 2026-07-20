# NETLIFY_DEPLOYMENT

두 저장소를 **서로 다른 Netlify 사이트**로 배포한다. 배포 이력·rollback이 서로 독립이다.

## 사이트 A — 앱 (`linkling-app`)

1. Netlify에서 새 사이트 → 이 저장소 연결. `netlify.toml`이 빌드를 정의한다 (`npm run build`, publish `dist`, Node 22).
2. SPA rewrite는 `public/_redirects`(`/* /index.html 200`)와 netlify.toml 양쪽에 있다.
3. 캐시: `index.html` 재검증, `/assets/*` immutable — `public/_headers`.
4. **환경 변수 (사이트 설정 → Environment variables)**

   | 컨텍스트 | 변수 | 값 |
   |---|---|---|
   | Production | `VITE_WORDPACK_CATALOG_URL` | `https://<wordpacks-prod>.netlify.app/catalog.json` |
   | Deploy Preview | `VITE_WORDPACK_CATALOG_URL` | `https://<wordpacks-preview>.netlify.app/catalog.json` |
   | (선택) | `VITE_RESEARCH_EXPORT` | 연구 빌드에서만 `true` |

   비밀 키는 클라이언트 변수에 넣지 않는다. catalog URL은 공개 설정값이다.

## 사이트 B — 단어팩 (`linkling-wordpacks`)

1. 새 사이트 → 저장소 연결. 빌드 `npm run build:content`, publish `dist`, Node 22.
2. CORS·캐시 헤더는 빌드가 `dist/_headers`로 생성한다:
   - `/catalog.json` — `max-age=60, must-revalidate` + CORS
   - `/packs/*`, `/shared/*` — `max-age=31536000, immutable` + CORS
3. **이미 배포한 버전 경로의 파일을 절대 덮어쓰지 않는다.** 빌드 스크립트의 `versions.lock.json` 불변성 검사가 이를 차단한다. 내용을 바꾸려면 `wordpack_version`을 올리고 catalog를 갱신한다.
4. 콘텐츠 rollback = 이전 catalog를 가리키는 커밋으로 rollback (versioned pack 경로는 그대로 유효).

## 검증 절차 (배포 후)

1. 앱 preview 접속 → 단어 목록 로드 (Network 탭에서 wordpacks origin 요청에 CORS 오류 없음 확인)
2. `APP_URL`·`CATALOG_URL`로 `npm run test:e2e`
3. 오프라인 토글 후 재접속 → 캐시 팩으로 진행되는지
4. wordpacks에 새 catalog 배포 → 앱 새로고침으로 신규 버전 반영 확인
5. CDN 이전 리허설: catalog URL 환경 변수만 바꿔 재배포 → 동일 동작 (앱 코드 수정 0)

## 첫 부팅 UX

catalog 로딩·팩 다운로드 동안 로딩 인디케이터와 진행 카운트를 표시한다(빈 화면 금지 — App.tsx `CATALOG_LOADING`/`PACK_PREFETCH`).
