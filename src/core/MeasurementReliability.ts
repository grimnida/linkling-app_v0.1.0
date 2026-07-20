/**
 * Measurement Reliability Gate (부속 명세 §2.2)
 * 특정 음성 API에 종속되지 않는 순수 정책 계층.
 * PronunciationEvaluator adapter의 confidence는 입력의 하나일 뿐이다.
 */
import type { AssessmentChannel, MeasurementReliability } from './types';
import { CONFIG } from './config';

export interface ReliabilityContext {
  channel: AssessmentChannel;
  confidence: number | null; // 판정기 confidence (없으면 null)
  micPermissionDenied: boolean;
  noInputCaptured: boolean;
  audioPlaybackFailed: boolean;
  pageWasHidden: boolean; // 백그라운드 중 입력
  withinEchoWindow: boolean; // TTS/모델 오디오 재생 직후
}

export function assessReliability(ctx: ReliabilityContext): MeasurementReliability {
  // 통로 문제 → invalid: 지식 평가에서 제외, 학습 실패로 기록하지 않는다
  if (ctx.pageWasHidden) return 'invalid';
  if (ctx.micPermissionDenied || ctx.noInputCaptured || ctx.audioPlaybackFailed) return 'invalid';
  // 에코 창 안의 음성 입력은 재확인 대상
  if (ctx.withinEchoWindow && ctx.channel === 'speech') return 'uncertain';
  // confidence 낮음 → 실패 확정 금지, 한 번 재확인
  if (ctx.channel === 'speech' && ctx.confidence !== null && ctx.confidence < CONFIG.CONFIDENCE_UNCERTAIN_THRESHOLD) {
    return 'uncertain';
  }
  return 'reliable';
}
