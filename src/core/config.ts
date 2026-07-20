/**
 * 설정 상수 — 단어별 하드코딩 금지, 전부 여기서만 조정한다.
 * (본문서 §5, 부속 명세 §2·§3·§5)
 */
export const CONFIG = {
  /** 앱 버전 (catalog minimum_app_version 비교) */
  APP_VERSION: '0.1.0',
  /** 앱이 지원하는 콘텐츠 schema (범위 밖 팩은 로드 거부 — 조용한 fallback 금지) */
  SUPPORTED_CATALOG_SCHEMA: ['1.0.0'],
  SUPPORTED_PACK_SCHEMA: ['1.0.0'],
  SUPPORTED_WORDPACK_SCHEMA: ['1.0.0'],

  /** 무응답 시 도움 제안까지의 시간(ms) — 실패 시간이 아니다 (부속 명세 §5) */
  HELP_OFFER_MS: 3000,
  /** 산출 단계 시도 상한 — 도달 시 assisted 경로로 진행 (부속 명세 §3.2) */
  MAX_PRODUCTION_ATTEMPTS: 3,
  /** 음성 인식 연속 무결과 시 타이핑 전환 제안 횟수 */
  SPEECH_NO_RESULT_LIMIT: 3,
  /** Reliability Gate confidence 임계 (부속 명세 §2.2) */
  CONFIDENCE_UNCERTAIN_THRESHOLD: 0.45,
  /** TTS/모델 오디오 재생 직후 에코 창(ms) — 이 안의 음성 입력은 uncertain */
  ECHO_WINDOW_MS: 700,

  /** 사이 끼움: 같은 단어 앞뒤 최소 간격 (본문서 §7.5) */
  INTERLEAVE_MIN_GAP: 2,
  INTERLEAVE_MAX_GAP: 3,
  /** 재검사 배치 간격 (부속 명세 §5): 다른 과제 2~5개 뒤 */
  RETEST_MIN_GAP: 2,
  RETEST_MAX_GAP: 5,
  /** near-pass 조기 재검사 gap */
  NEAR_PASS_RETEST_GAP: 1,
  /** 세션당 같은 항목 재검사 상한 (초과분 다음 세션 이월) */
  SESSION_RETEST_CAP: 3,

  /** 뜻 희미화 단계 (본문서 §5.7) */
  FADE_LEVELS: { initial: 100, firstNoHint: 70, secondNoHintLater: 35, delayedReview: 10, stable: 0 },
  /** 두 번째 무힌트 성공이 "떨어진 시점"으로 인정되는 최소 간격(ms) */
  FADE_SECOND_SUCCESS_MIN_GAP_MS: 10 * 60 * 1000,
  /** independent 승격에 필요한 reliable+무힌트 성공 수 */
  INDEPENDENT_RELIABLE_SUCCESSES: 2,

  /** 복습 간격 (설정 상수, 날짜만으로 희미화하지 않음 — 성공 기반) */
  REVIEW_INTERVALS_MS: [10 * 60 * 1000, 24 * 3600 * 1000, 3 * 24 * 3600 * 1000, 7 * 24 * 3600 * 1000],

  /** 오디오 ended 미발화 대비 타임아웃 여유(ms) */
  AUDIO_ENDED_TIMEOUT_EXTRA_MS: 2500,
  /** 최종 애니메이션 뒤 말풍선 지연(ms) — 계약상 150~300 */
  BUBBLE_DELAY_MS: 220,

  /** 팩 선행 로드 개수 */
  PREFETCH_AHEAD: 3,
  /** 캐시 LRU 상한 (팩 수) */
  CACHE_MAX_PACKS: 40,
} as const;

// 낙인·진단 문구 자동 스캔(부속 명세 §2.5)은 tests/unit/banned-phrases.test.ts가 수행한다.
// 금지 문구 목록은 스캔 대상(src)에 문자열이 남지 않도록 테스트 파일 안에서 조합 생성한다.
