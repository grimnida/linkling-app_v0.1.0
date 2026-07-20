/**
 * ReviewSessionEngine — 복습 방향 3종 (본문서 §5.7·§10.4)
 * - 이미지+말풍선→발음 / 철자→의미 / 음성→의미
 * - 핵심 이미지·말풍선은 항상 유지, 한글 뜻만 성공 기반 희미화 수준으로 표시
 * - 재인보다 인출 먼저: 객관식은 반복 실패 뒤 마지막 힌트로만 (§4.7)
 * - 여기서의 성공은 지연 차원(isDelayedRecall=true)으로 기록된다 (부속 명세 §2.3)
 */
import type {
  AssessmentChannel, HintLevel, LearningDirection, LoadedPack, PronunciationEvaluator,
  RawLearningEvent, ResultType,
} from './types';
import { CONFIG } from './config';
import { assessReliability } from './MeasurementReliability';
import { TelemetryLogger } from './TelemetryLogger';
import { ProgressStore } from './ProgressStore';
import { ReviewScheduler } from './ReviewScheduler';

export interface ReviewItem {
  pack: LoadedPack;
  direction: LearningDirection;
  attemptIndex: number;
  hintLevel: HintLevel;
  failCount: number;
  done: boolean;
}

export interface MeaningChoice {
  meaningKo: string;
  isCorrect: boolean;
}

/**
 * 객관식 선택지 생성 (부속 명세 §6.3 품질 규칙):
 * - 오답은 다른 단어의 핵심 뜻에서 가져오되, 정답 뜻과 겹치는 의미는 제외
 * - 오답 풀 고갈 시 있는 만큼만 (전체 범위 고갈 사례 회귀 방지)
 */
export function buildMeaningChoices(target: LoadedPack, pool: LoadedPack[], count = 4, rng: () => number = Math.random): MeaningChoice[] {
  const targetMeanings = new Set([
    target.wordpack.lexical.core_meaning_ko,
    ...target.wordpack.lexical.accepted_meanings_ko,
  ]);
  const distractors = pool
    .filter((p) => p.entry.word_id !== target.entry.word_id)
    .map((p) => p.wordpack.lexical.core_meaning_ko)
    .filter((m) => !targetMeanings.has(m));
  const unique = [...new Set(distractors)];
  // 셔플
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  const chosen = unique.slice(0, Math.max(0, count - 1));
  const choices: MeaningChoice[] = [
    { meaningKo: target.wordpack.lexical.core_meaning_ko, isCorrect: true },
    ...chosen.map((m) => ({ meaningKo: m, isCorrect: false })),
  ];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

export class ReviewSessionEngine {
  private items: ReviewItem[] = [];
  private index = 0;

  constructor(
    private readonly telemetry: TelemetryLogger,
    private readonly progress: ProgressStore,
    private readonly evaluators: Partial<Record<AssessmentChannel, PronunciationEvaluator>>,
    private readonly now: () => number = Date.now,
  ) {}

  start(packs: LoadedPack[], sessionIndex = 0): void {
    const rs = new ReviewScheduler(this.now);
    this.items = packs.map((pack) => {
      const p = this.progress.get(pack.entry.word_id, pack.entry.wordpack_version);
      return {
        pack,
        direction: rs.directionFor(p, sessionIndex),
        attemptIndex: 0,
        hintLevel: 0 as HintLevel,
        failCount: 0,
        done: false,
      };
    });
    this.index = 0;
  }

  current(): ReviewItem | null {
    while (this.index < this.items.length && this.items[this.index].done) this.index++;
    return this.index < this.items.length ? this.items[this.index] : null;
  }

  /** 뜻 표시 수준 (0~100, 0이면 기본 숨김·확인 시 표시) — 이미지·말풍선은 항상 표시 */
  meaningFadeLevel(item: ReviewItem): number {
    return this.progress.get(item.pack.entry.word_id, item.pack.entry.wordpack_version).meaning_fade_level;
  }

  /** 객관식은 반복 실패 뒤에만 허용 (§4.7) */
  choicesAllowed(item: ReviewItem): boolean {
    return item.failCount >= 2 && item.hintLevel >= 3;
  }

  /** 발음 방향(scene-to-sound) 산출 시도 */
  async submitProduction(ctx: {
    channel: AssessmentChannel; text?: string; audio?: Blob | null;
    pageWasHidden?: boolean; withinEchoWindow?: boolean;
    micPermissionDenied?: boolean; noInputCaptured?: boolean;
    promptEndedAt?: number | null;
  }): Promise<{ resultType: ResultType; advanced: boolean }> {
    const item = this.current();
    if (!item) throw new Error('복습 항목 없음');
    const evaluator = this.evaluators[ctx.channel];
    if (!evaluator) throw new Error(`평가 채널 없음: ${ctx.channel}`);
    item.attemptIndex++;

    const wp = item.pack.wordpack;
    const result = await evaluator.evaluate({
      wordId: item.pack.entry.word_id,
      audio: ctx.audio ?? null,
      text: ctx.text,
      expectedIpa: wp.pronunciation.ipa,
      expectedSpelling: wp.spelling_and_grammar.full_spelling,
      passProfileId: wp.pronunciation.final_pass_profile_id,
    });
    const reliability = assessReliability({
      channel: ctx.channel,
      confidence: result.confidence,
      micPermissionDenied: ctx.micPermissionDenied ?? false,
      noInputCaptured: ctx.noInputCaptured ?? false,
      audioPlaybackFailed: false,
      pageWasHidden: ctx.pageWasHidden ?? false,
      withinEchoWindow: ctx.withinEchoWindow ?? false,
    });

    let resultType: ResultType;
    if (reliability === 'invalid') resultType = 'invalid';
    else if (result.passed) resultType = item.hintLevel > 0 ? 'assisted-pass' : 'pass';
    else resultType = result.clarityScore >= 0.6 ? 'near-pass' : 'fail';

    this.log(item, ctx.channel, item.hintLevel, resultType, reliability, ctx.promptEndedAt ?? null);

    let advanced = false;
    if (reliability !== 'invalid' && result.passed) {
      advanced = true;
      this.completeItem(item);
    } else if (reliability !== 'invalid') {
      item.failCount++;
      if (item.hintLevel < 3) item.hintLevel = (item.hintLevel + 1) as HintLevel;
      else if (item.attemptIndex >= CONFIG.MAX_PRODUCTION_ATTEMPTS) {
        // assisted 탈출구: 정답 확인 후 재발화 — UI가 completeAssisted 호출
      }
    }
    return { resultType, advanced };
  }

  /** 의미 방향 자기 확인: 바로 떠올림 / 애매함 / 못 떠올림 (§10.4) — 단독 증거 아님 */
  submitSelfReport(rating: 'instant' | 'unsure' | 'failed'): void {
    const item = this.current();
    if (!item) return;
    item.attemptIndex++;
    const resultType: ResultType = rating === 'failed' ? 'fail' : 'pass';
    // 자기보고는 승격 증거가 아니다 — self-report 채널로만 기록 (부속 명세 §2.3)
    this.log(item, 'self-report', item.hintLevel, resultType, 'reliable', null);
    if (rating === 'instant') {
      this.completeItem(item);
    } else if (rating === 'unsure') {
      item.failCount++;
      if (item.hintLevel < 2) item.hintLevel = (item.hintLevel + 1) as HintLevel;
    } else {
      item.failCount++;
      if (item.hintLevel < 3) item.hintLevel = (item.hintLevel + 1) as HintLevel;
    }
  }

  /** 의미 방향 검증 산출(타이핑/음성): 뜻이 아니라 영어 산출로 증거를 남기고 싶을 때 */
  async submitMeaningTyping(text: string): Promise<{ resultType: ResultType; advanced: boolean }> {
    return this.submitProduction({ channel: 'text', text });
  }

  /** 객관식(마지막 힌트) — 성공해도 재인으로만 기록, 희미화·승격에 관여하지 않는다 */
  submitChoice(choice: MeaningChoice): { correct: boolean } {
    const item = this.current();
    if (!item) throw new Error('복습 항목 없음');
    if (!this.choicesAllowed(item)) throw new Error('객관식은 반복 실패 뒤 마지막 힌트로만 허용됩니다');
    item.attemptIndex++;
    this.log(item, 'touch-choice', 3, choice.isCorrect ? 'pass' : 'fail', 'reliable', null);
    if (choice.isCorrect) this.completeItem(item, /* viaRecognition */ true);
    return { correct: choice.isCorrect };
  }

  /** assisted 탈출구: 정답 확인 뒤 재발화 완료 */
  completeAssisted(): void {
    const item = this.current();
    if (!item) return;
    this.log(item, 'speech', 3, 'assisted-pass', 'reliable', null);
    this.completeItem(item);
  }

  private completeItem(item: ReviewItem, viaRecognition = false): void {
    item.done = true;
    if (!viaRecognition) {
      this.progress.scheduleNextReview(item.pack.entry.word_id, item.pack.entry.wordpack_version);
    }
    // 재인만으로 끝났으면 복습 간격을 늘리지 않는다 (조기 재도래)
  }

  remaining(): number { return this.items.filter((i) => !i.done).length; }

  private log(
    item: ReviewItem, channel: AssessmentChannel, hintLevel: HintLevel,
    resultType: ResultType, reliability: 'reliable' | 'uncertain' | 'invalid',
    promptEndedAt: number | null,
  ): void {
    const e: RawLearningEvent = {
      wordId: item.pack.entry.word_id,
      wordpackVersion: item.pack.entry.wordpack_version,
      stepType: 'REVIEW',
      layerStageAtEvent: item.pack.wordpack.scene.layers.length,
      assessmentChannel: channel,
      learningDirection: item.direction,
      hintLevel,
      resultType,
      measurementReliability: reliability,
      promptEndedAt,
      responseStartedAt: null,
      responseCompletedAt: this.now(),
      attemptIndex: item.attemptIndex,
      isDelayedRecall: true, // 복습 = 지연 차원
    };
    this.telemetry.log(e);
    this.progress.applyEvent(e);
  }
}
