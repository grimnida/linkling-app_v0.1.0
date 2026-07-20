/**
 * 앱↔장면 고정 런타임 계약 (본문서 §6).
 * Rive(.riv)와 SVG fallback이 동일한 인터페이스를 구현한다.
 * 단어별 분기는 없다 — 차이는 데이터·자산에만 존재한다.
 */

export type SceneEventName =
  | 'request_full_audio'
  | 'final_animation_complete'
  | 'bubble_visible'
  | 'meaning_visible'
  | 'spelling_visible'
  | 'layer_revealed';

export interface SceneEvent {
  name: SceneEventName;
  payload?: string | number;
}

export interface SceneAdapter {
  /** 누적 이미지층 표시 (0..max_layer_stage) — 이전 층은 항상 유지된다 */
  setLayerStage(stage: number): void;
  /** 0 숨김, 1 말풍선, 2 한글 뜻, 3 철자·문형 */
  setLabelStage(stage: number): void;
  /** 전체 단어 발음 Pass 뒤 통합 시퀀스 시작 */
  triggerFinalPass(): void;
  /** 전체 발음 오디오 종료 뒤 최종 모션 시작 */
  triggerFullAudioComplete(): void;
  /** 한글 뜻 흡수 효과 */
  triggerMeaningAbsorb(): void;
  /** 최종 애니메이션 다시 보기 */
  triggerReplayFinal(): void;
  /** 초기화 */
  triggerReset(): void;
  setReducedMotion(value: boolean): void;
  onEvent(cb: (e: SceneEvent) => void): () => void;
  getLayerStage(): number;
  dispose(): void;
}
