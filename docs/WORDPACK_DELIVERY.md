# WORDPACK_DELIVERY

앱이 원격 단어팩을 가져오는 전체 경로.

## URL 규칙 (본문서 §8.2)

1. 앱은 `VITE_WORDPACK_CATALOG_URL` 하나만 안다. 도메인 하드코딩 없음.
2. `catalog.json`의 `manifest_path`는 catalog URL 기준 상대 경로.
3. 팩 내부 자산 경로는 pack manifest URL 기준 상대 경로. 절대 URL·`..`·`\` 는 로드 거부.
4. 따라서 단어팩 사이트를 Netlify → CDN으로 옮길 때 catalog URL 환경 변수 하나만 바꾸면 된다 (단위 테스트로 두 origin에서 동일 해석 검증).

## 로드 순서

```text
catalog.json (no-cache, 60s 정책)
→ schema_version·minimum_app_version 게이트 (불통과: 화면 오류, 조용한 fallback 없음)
→ 각 pack: pack.json manifest
   → schema 범위·word_id/version 일치·state_machine 확인
→ wordpack.runtime.json
   → files[] 의 bytes·sha256 검증 (crypto.subtle 가용 시)
   → authoring_research/qa 잔존 시 거부
   → chunk/layer 구조 검증
→ WordpackCache 저장 (IndexedDB) + 자산 프리페치 (Cache Storage)
```

실패한 팩은 그 팩만 격리되고 오류가 화면에 표시된다. 나머지 팩 학습은 계속된다.

## 캐시·버전 (본문서 §7.3·§8.3)

- versioned 경로(`packs/<id>/<ver>/…`)는 불변으로 취급 — Cache Storage cache-first.
- catalog가 새 버전을 가리키면 캐시 미스가 나서 새 버전 경로로 교체된다. catalog를 이전 버전으로 되돌리면 그대로 rollback.
- 팩 수가 `CONFIG.CACHE_MAX_PACKS`를 넘으면 LRU 제거.
- 오프라인: 마지막 정상 catalog(localStorage) + 캐시된 팩으로 동작하고, 화면에 오프라인임을 표시.

## 오디오·장면 자산의 현재 상태

- `.riv` 미도착: manifest `scene.availability=pending_rive_export` → 항상 `fallback_svg_path` 사용. `availability=ready`가 되면 같은 코드가 `.riv`를 로드한다 (RIVE_INTEGRATION.md).
- 검수 오디오 미도착: 오디오 fetch 실패 시 **preview 상태 팩에 한해** 브라우저 TTS로 대체 재생한다. published 팩에서는 TTS 대체가 발동하지 않는다 (빌드 파이프라인이 오디오 없는 팩의 published 판정을 차단하므로 published 팩은 항상 실제 AAC를 가진다).
