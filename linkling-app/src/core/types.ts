/** 원격 catalog / pack manifest / runtime wordpack 타입 (contracts/*.schema.json과 1:1) */

export type PackStatus = 'preview' | 'published' | 'retired';

export interface CatalogPackEntry {
  word_id: string;
  word: string;
  wordpack_version: string;
  status: PackStatus;
  manifest_path: string;
  minimum_app_version?: string;
  estimated_download_bytes?: number;
  sha256?: string;
}

export interface Catalog {
  schema_version: string;
  catalog_version: string;
  generated_at: string;
  minimum_app_version?: string;
  packs: CatalogPackEntry[];
}

export interface PackManifest {
  schema_version: string;
  word_id: string;
  word: string;
  wordpack_version: string;
  status: PackStatus;
  wordpack_path: string;
  scene: {
    format: 'rive';
    availability: 'ready' | 'pending_rive_export';
    riv_path?: string;
    fallback_svg_path?: string;
    artboard: string;
    state_machine: 'LinklingWordpackSM';
    max_layer_stage: number;
  };
  audio: {
    full_path: string;
    chunks: { order: number; path: string }[];
  };
  files?: { path: string; bytes: number; sha256: string }[];
}

export interface WordpackChunk {
  order: number;
  cumulative_ipa: string;
  cumulative_spelling: string;
  audio_asset_id: string;
  pass_profile_id: string;
  is_full_word: boolean;
}

export interface WordpackLayer {
  order: number;
  unlock_trigger: { type: 'chunk_pass'; chunk_order: number };
  semantic_roles: string[];
  group_ids: string[];
  description_ko: string;
  persists_after_reveal: boolean;
  same_camera_frame: boolean;
  uses_chunk_color_link: boolean;
  reveal_preset_id: string;
}

export interface RuntimeWordpack {
  schema_version: string;
  wordpack_version: string;
  word_id: string;
  word: string;
  template_id: string;
  status: string;
  lexical: {
    part_of_speech: string;
    core_meaning_ko: string;
    accepted_meanings_ko: string[];
    excluded_meanings_ko: string[];
    profile: Record<string, unknown> & {
      transitivity?: string;
      base_voice?: string;
      basic_argument_order?: string[];
    };
  };
  learning_scope: Record<string, unknown>;
  pronunciation: {
    dialect: string;
    ipa: string;
    full_audio_asset_id: string;
    chunks: WordpackChunk[];
    final_pass_profile_id: string;
  };
  scene: {
    master_scene_asset_id: string;
    render_format: string;
    summary_ko: string;
    layers: WordpackLayer[];
  };
  final_sequence: Record<string, unknown> & {
    order: string[];
    animation: { duration_ms: number; final_keyframe_id: string };
  };
  speech_bubble: { type: string; text_ko: string; anchor_group_id: string };
  meaning_reveal: Record<string, unknown>;
  spelling_and_grammar: {
    full_spelling: string;
    spelling_chunks: string[];
    grammar_skeleton?: {
      enabled: boolean;
      pattern_ko?: string;
      argument_order?: string[];
      base_voice?: string;
    };
  };
  review_policy: Record<string, unknown> & {
    pronunciation_hint_ladder?: string[];
    meaning_hint_ladder?: string[];
  };
  assets: Record<string, unknown>;
}

/** 로드 완료된 팩 (원격 자산 URL 해석 포함) */
export interface LoadedPack {
  entry: CatalogPackEntry;
  manifest: PackManifest;
  manifestUrl: string;
  wordpack: RuntimeWordpack;
  /** manifest 기준으로 해석된 절대 URL */
  assetUrl: (relPath: string) => string;
}

/* ============ 측정·기록 (부속 명세 §2) ============ */

export type AssessmentChannel = 'speech' | 'text' | 'touch-choice' | 'self-report' | 'system-observation';
export type LearningDirection = 'sound-to-scene' | 'scene-to-sound' | 'spelling-to-meaning' | 'audio-to-meaning';
export type ResultType = 'pass' | 'near-pass' | 'assisted-pass' | 'fail' | 'invalid';
export type MeasurementReliability = 'reliable' | 'uncertain' | 'invalid';
/** 힌트 사다리: 0=무힌트, 1=생각 시간, 2=첫소리, 3=전체 음원 (본문서 §5.4와 1:1) */
export type HintLevel = 0 | 1 | 2 | 3;

export interface RawLearningEvent {
  wordId: string;
  wordpackVersion: string;
  stepType: string; // 본문서 §7.4 상태 이름
  layerStageAtEvent: number; // 0..4
  assessmentChannel: AssessmentChannel;
  learningDirection: LearningDirection;
  hintLevel: HintLevel;
  resultType: ResultType;
  measurementReliability: MeasurementReliability;
  promptEndedAt: number | null;
  responseStartedAt: number | null;
  responseCompletedAt: number | null; // 모르면 null — 추정 금지
  attemptIndex: number;
  /** 즉시/지연 차원 구분 (부속 명세 §2.3) */
  isDelayedRecall: boolean;
}

/** 지식 상태 5단계 (부속 명세 §2.3) — 승격 전용, 자동 강등 없음 */
export type KnowledgeState = 'not-assessed' | 'in-progress' | 'supported' | 'independent' | 'stable';

export interface WordProgress {
  word_id: string;
  wordpack_version: string;
  current_layer: number;
  initial_learning_completed: boolean;
  independent_success_count: number;
  assisted_success_count: number;
  last_hint_level: HintLevel;
  last_response_latency_ms: number | null;
  pronunciation_attempts: number;
  meaning_recall_self_rating: string | null;
  meaning_fade_level: number; // 100 | 70 | 35 | 10 | 0(기본 숨김)
  next_review_at: number | null;
  last_reviewed_at: number | null;
  // ---- 부속 명세 §2.4 확장 ----
  knowledge_state: KnowledgeState;
  reliable_success_count: number; // 승격·희미화 산출 전용 (reliable + hintLevel 0)
  reliable_delayed_success_count: number;
  uncertain_event_count: number;
  invalid_event_count: number;
  recognition_success_count: number; // 재인 — 숙달 증거 아님
  channel_disagreement_flag: boolean; // 해석 금지, 표시만
}

export interface PronunciationResult {
  passed: boolean;
  confidence: number; // 0..1
  clarityScore: number;
  matchedWord: string | null;
  missingSegments: string[];
  providerRawResult: unknown;
}

export interface PronunciationInput {
  wordId: string;
  audio: Blob | null;
  /** 타이핑 채널일 때 텍스트 */
  text?: string;
  expectedIpa: string;
  expectedSpelling: string;
  passProfileId: string;
}

export interface PronunciationEvaluator {
  readonly channel: AssessmentChannel;
  evaluate(input: PronunciationInput): Promise<PronunciationResult>;
}
