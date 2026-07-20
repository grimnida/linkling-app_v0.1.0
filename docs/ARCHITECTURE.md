# ARCHITECTURE

## 모듈 구성 (본문서 §7)

```text
AppShell (src/App.tsx)
├── CatalogRepository      src/core/CatalogRepository.ts   catalog 로드·schema 게이트·last-good 보존
├── WordpackRepository     src/core/WordpackRepository.ts  manifest/runtime 로드·schema 범위·해시 검증·팩 격리
├── AssetResolver          src/core/AssetResolver.ts       manifest 기준 상대 경로 해석 (절대 URL·탈출 거부)
├── WordpackCache          src/core/WordpackCache.ts       IndexedDB(pack) + Cache Storage(자산), 버전 교체, LRU
├── LearningSessionEngine  src/core/LearningSessionEngine.ts  학습 Flow 상태 머신 (§5)
├── InterleavingScheduler  src/core/InterleavingScheduler.ts  사이 끼움·재검사 배치·세션 상한·이월
├── PronunciationEvaluator src/core/PronunciationEvaluator.ts provider adapter + Mock/타이핑 구현
├── MeasurementReliability src/core/MeasurementReliability.ts reliable/uncertain/invalid 게이트 (부속 §2.2)
├── AudioController        src/core/AudioController.ts     언락·타임아웃 fallback·가시성·에코 창
├── RiveRuntimeAdapter     src/core/RiveRuntimeAdapter.ts  .riv drop-in (계약 검증 포함)
├── SvgSceneController     src/core/SvgSceneController.ts  SVG fallback (동일 SceneAdapter 계약)
├── ReviewScheduler        src/core/ReviewScheduler.ts     복습 도래·방향 순환
├── ReviewSessionEngine    src/core/ReviewSessionEngine.ts 복습 3방향 + 객관식 마지막 힌트
├── ProgressStore          src/core/ProgressStore.ts       local-first 진도 + 지식 상태 5단계 + 뜻 희미화
├── TelemetryLogger        src/core/TelemetryLogger.ts     Raw Event (부속 §2.1) + 연구 내보내기(플래그)
└── UI Screens             src/ui/*                        로딩/학습/복습/요약/오류
```

## 핵심 원칙

1. **단어별 분기 없음.** 엔진·어댑터 어디에도 word_id 분기가 없다 (자동 테스트로 강제 — `tests/unit/banned-phrases.test.ts`). 단어 차이는 데이터(runtime JSON)·SVG/Rive hierarchy·오디오·문자열에만 있다.

2. **장면 계약 단일화.** Rive와 SVG fallback이 같은 `SceneAdapter` 인터페이스를 구현한다. 앱 상태 머신(LearningSessionEngine)과 Rive 내부 상태 머신은 분리되어 있고, UI가 계약 이벤트로 다리를 놓는다.

3. **조용한 fallback 금지.** 지원 범위 밖 schema·무결성 실패·설치 실패는 `VisibleContentError`로 화면에 표시되고 해당 팩만 격리된다. 실행기는 하나뿐이다.

4. **측정 신뢰도 게이트.** 모든 판정은 `assessReliability`를 지나며, invalid(통로 문제)는 지식 평가에서 제외된다. 승격·뜻 희미화는 reliable + 무힌트 + 산출 채널(speech/text) 사건만 사용한다.

5. **local-first.** 진도는 `ProgressRepository` 인터페이스 뒤에 있다(현재 localStorage). 서버 동기화는 이 인터페이스 구현 추가로 붙인다.

## 상태 머신 (§7.4)

BOOT → CATALOG_LOADING → (HOME) → PACK_PREFETCH → 학습 세션:
FULL_AUDIO_PREVIEW → CHUNK_ENCODING → (다른 단어) → CHUNK_RECALL(+힌트 사다리) → … → FULL_WORD_RECALL → FINAL_INTEGRATION → … → SESSION_SUMMARY. 오류는 ERROR_RECOVERY 화면.

FINAL_INTEGRATION은 모든 층 잠금 + 전체 단어 명료성 Pass 전에는 도달 불가(= final_pass 차단, 단위 테스트로 검증).
