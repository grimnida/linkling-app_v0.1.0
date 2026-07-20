/**
 * LearningSessionEngine — 학습 Flow 상태 머신 (본문서 §5·§7.4).
 *
 * 원칙:
 * - Rive 내부 상태 머신과 앱 학습 상태를 구분한다 (이 엔진은 장면을 직접 만지지 않고
 *   UI가 SceneAdapter를 계약 순서대로 구동한다).
 * - 단어별 분기 없음 — 모든 단어가 같은 코드 경로를 지난다.
 * - 무응답 3초는 실패가 아니라 도움 제안 시점 (부속 명세 §5).
 * - 모든 산출 단계에 시도 상한과 assisted 통과 경로가 있다 (부속 명세 §3.2).
 * - 측정 신뢰도 게이트를 통과한 사건만 지식 평가에 반영 (부속 명세 §2).
 */
import type {
  AssessmentChannel, HintLevel, LearningDirection, LoadedPack, PronunciationEvaluator,
  RawLearningEvent, ResultType,
} from './types';
import { CONFIG } from './config';
import { assessReliability, type ReliabilityContext } from './MeasurementReliability';
import { InterleavingScheduler } from './InterleavingScheduler';
import { TelemetryLogger } from './TelemetryLogger';
import { ProgressStore } from './ProgressStore';

export type StepType =
  | 'FULL_AUDIO_PREVIEW' // §5.2 전체 발음 첫 노출
  | 'CHUNK_ENCODING'     // §5.3 새 Chunk 부호화 (누적 음원 + 층 공개 + 따라 말하기)
  | 'CHUNK_RECALL'       // §5.4 간격 뒤 Chunk 인출 (음원·철자·뜻 숨김)
  | 'FULL_WORD_RECALL'   // §5.5 음원 없이 전체 단어 (PRON_FULL_CLARITY_V1)
  | 'FINAL_INTEGRATION'  // §5.6 최종 결합 Sequence (UI가 SceneAdapter 구동)
  | 'SESSION_SUMMARY';

interface WordState {
  pack: LoadedPack;
  /** 잠긴(성공한) 누적 chunk 수 = 공개된 층 수 */
  lockedChunks: number;
  /** 부호화가 끝나 인출 차례인지 */
  awaitingRecall: boolean;
  fullWordRecallDone: boolean;
  finalDone: boolean;
  hintLevel: HintLevel;
  attemptIndex: number;
  /** 상한 도달로 assisted 경로(정답 음원 뒤 재발화)에 있는지 */
  assistedPath: boolean;
  previewDone: boolean;
  speechNoResultStreak: number;
}

export interface CurrentStep {
  stepType: StepType;
  pack: LoadedPack | null;
  /** 이번 단계의 대상 chunk (1-based order), 해당 없으면 null */
  chunkOrder: number | null;
  /** 현재 공개되어야 하는 층 수 (SceneAdapter.setLayerStage 값) */
  layerStage: number;
  hintLevel: HintLevel;
  attemptIndex: number;
  assistedPath: boolean;
  /** 타이핑 채널 전환 제안 여부 (음성 연속 무결과) */
  suggestTyping: boolean;
  isRetest: boolean;
}

export interface AttemptContext {
  channel: AssessmentChannel;
  text?: string;
  audio?: Blob | null;
  /** 통로 상태 플래그 (AudioController 등에서) */
  pageWasHidden?: boolean;
  withinEchoWindow?: boolean;
  micPermissionDenied?: boolean;
  noInputCaptured?: boolean;
  audioPlaybackFailed?: boolean;
  promptEndedAt?: number | null;
  responseStartedAt?: number | null;
}

export interface AttemptOutcome {
  resultType: ResultType;
  reliability: 'reliable' | 'uncertain' | 'invalid';
  /** 단계 통과 여부 (엔진이 다음으로 진행했는지) */
  advanced: boolean;
  /** uncertain으로 한 번 재확인이 필요한지 */
  needsReconfirm: boolean;
  hintLevel: HintLevel;
  assistedPath: boolean;
  suggestTyping: boolean;
}

export class LearningSessionEngine {
  private words = new Map<string, WordState>();
  private scheduler: InterleavingScheduler | null = null;
  private current: { wordId: string; isRetest: boolean } | null = null;
  private sessionStartEventIndex = 0;

  constructor(
    private readonly telemetry: TelemetryLogger,
    private readonly progress: ProgressStore,
    private readonly evaluators: Partial<Record<AssessmentChannel, PronunciationEvaluator>>,
    private readonly now: () => number = Date.now,
    private readonly rng: () => number = Math.random,
  ) {}

  /** §5.1 세션 시작 — 현재 단어와 뒤에 끼울 단어들을 큐로 준비 */
  startSession(packs: LoadedPack[]): void {
    if (packs.length === 0) throw new Error('세션에 단어가 없습니다');
    this.words.clear();
    for (const pack of packs) {
      this.words.set(pack.entry.word_id, {
        pack,
        lockedChunks: 0,
        awaitingRecall: false,
        fullWordRecallDone: false,
        finalDone: false,
        hintLevel: 0,
        attemptIndex: 0,
        assistedPath: false,
        previewDone: false,
        speechNoResultStreak: 0,
      });
    }
    this.scheduler = new InterleavingScheduler(packs.map((p) => p.entry.word_id), this.rng);
    this.sessionStartEventIndex = this.telemetry.eventCount();
    this.advanceQueue();
  }

  private advanceQueue(): void {
    if (!this.scheduler) return;
    const item = this.scheduler.next();
    if (!item) {
      // 미완료 단어가 남았으면 이어서 (짧은 세션에서 가능한 범위의 간격 확보 후)
      const unfinished = [...this.words.values()].find((w) => !w.finalDone);
      if (unfinished) {
        this.current = { wordId: unfinished.pack.entry.word_id, isRetest: false };
        return;
      }
      this.current = null;
      return;
    }
    const w = this.words.get(item.wordId);
    if (!w || w.finalDone) { this.advanceQueue(); return; }
    this.current = { wordId: item.wordId, isRetest: item.kind === 'retest' };
  }

  /** 현재 단계 설명 — UI 렌더링과 SceneAdapter 구동의 근거 */
  getCurrentStep(): CurrentStep {
    if (!this.current) {
      return {
        stepType: 'SESSION_SUMMARY', pack: null, chunkOrder: null, layerStage: 0,
        hintLevel: 0, attemptIndex: 0, assistedPath: false, suggestTyping: false, isRetest: false,
      };
    }
    const w = this.words.get(this.current.wordId)!;
    const chunks = w.pack.wordpack.pronunciation.chunks;
    let stepType: StepType;
    let chunkOrder: number | null = null;

    if (!w.previewDone) {
      stepType = 'FULL_AUDIO_PREVIEW';
    } else if (w.lockedChunks === chunks.length && w.fullWordRecallDone) {
      stepType = 'FINAL_INTEGRATION';
    } else if (w.lockedChunks === chunks.length && w.awaitingRecall) {
      stepType = 'FULL_WORD_RECALL';
    } else if (w.awaitingRecall) {
      stepType = 'CHUNK_RECALL';
      chunkOrder = w.lockedChunks; // 마지막으로 잠근 누적 chunk를 인출
    } else {
      stepType = 'CHUNK_ENCODING';
      chunkOrder = w.lockedChunks + 1; // 새 chunk 부호화
    }
    return {
      stepType,
      pack: w.pack,
      chunkOrder,
      layerStage: stepType === 'CHUNK_ENCODING' ? w.lockedChunks + 1 : w.lockedChunks,
      hintLevel: w.hintLevel,
      attemptIndex: w.attemptIndex,
      assistedPath: w.assistedPath,
      suggestTyping: w.speechNoResultStreak >= CONFIG.SPEECH_NO_RESULT_LIMIT,
      isRetest: this.current.isRetest,
    };
  }

  /** §5.2 전체 발음 첫 노출 완료 (따라 말하기 강제 없음) */
  completePreview(): void {
    const w = this.currentWord();
    w.previewDone = true;
    this.logEvent(w, 'FULL_AUDIO_PREVIEW', 'system-observation', 'sound-to-scene', 0, 'pass', 'reliable', null, null, null);
    // 바로 첫 chunk 부호화로 (같은 방문에서)
  }

  /** 힌트 사다리 수동 상승 (0→1 생각 시간→2 첫소리→3 전체 음원) — §5.4 */
  requestHint(): HintLevel {
    const w = this.currentWord();
    if (w.hintLevel < 3) w.hintLevel = (w.hintLevel + 1) as HintLevel;
    return w.hintLevel;
  }

  /**
   * 산출 시도 제출 (부호화 따라 말하기 / 인출 / 전체 단어).
   * 판정 → 신뢰도 게이트 → 기록 → 전이.
   */
  async submitAttempt(ctx: AttemptContext): Promise<AttemptOutcome> {
    const w = this.currentWord();
    const step = this.getCurrentStep();
    const evaluator = this.evaluators[ctx.channel];
    if (!evaluator) throw new Error(`평가 채널 없음: ${ctx.channel}`);

    const chunks = w.pack.wordpack.pronunciation.chunks;
    const targetChunk = step.stepType === 'FULL_WORD_RECALL' || step.stepType === 'FINAL_INTEGRATION'
      ? chunks[chunks.length - 1]
      : chunks[(step.chunkOrder ?? 1) - 1];
    const passProfile = step.stepType === 'FULL_WORD_RECALL'
      ? w.pack.wordpack.pronunciation.final_pass_profile_id
      : targetChunk.pass_profile_id;

    w.attemptIndex++;
    const result = await evaluator.evaluate({
      wordId: w.pack.entry.word_id,
      audio: ctx.audio ?? null,
      text: ctx.text,
      expectedIpa: targetChunk.cumulative_ipa,
      expectedSpelling: targetChunk.cumulative_spelling,
      passProfileId: passProfile,
    });

    const relCtx: ReliabilityContext = {
      channel: ctx.channel,
      confidence: result.confidence,
      micPermissionDenied: ctx.micPermissionDenied ?? false,
      noInputCaptured: ctx.noInputCaptured ?? false,
      audioPlaybackFailed: ctx.audioPlaybackFailed ?? false,
      pageWasHidden: ctx.pageWasHidden ?? false,
      withinEchoWindow: ctx.withinEchoWindow ?? false,
    };
    const reliability = assessReliability(relCtx);

    // 음성 무결과 추적 (연속 N회 → 타이핑 전환 제안, 무한 재시작 금지)
    if (ctx.channel === 'speech') {
      if (reliability === 'invalid' || ctx.noInputCaptured) w.speechNoResultStreak++;
      else w.speechNoResultStreak = 0;
    }

    let resultType: ResultType;
    if (reliability === 'invalid') {
      resultType = 'invalid'; // 통로 문제 — 학습 실패로 기록하지 않는다
    } else if (result.passed) {
      resultType = w.hintLevel > 0 || w.assistedPath ? 'assisted-pass' : 'pass';
    } else if (result.clarityScore >= 0.6) {
      resultType = 'near-pass';
    } else {
      resultType = 'fail';
    }

    const direction: LearningDirection = 'scene-to-sound';
    this.logEvent(
      w, step.stepType, ctx.channel, direction, w.hintLevel, resultType, reliability,
      ctx.promptEndedAt ?? null, ctx.responseStartedAt ?? null, this.now(),
    );

    let advanced = false;
    let needsReconfirm = false;

    if (reliability === 'invalid') {
      // 지식 평가 제외 — 단계 유지, 통로 안내는 UI가 표시
    } else if (reliability === 'uncertain' && result.passed) {
      // 실패 확정 금지·성공도 확정 금지 — 한 번 재확인
      needsReconfirm = true;
    } else if (result.passed || (resultType === 'near-pass' && step.stepType !== 'FULL_WORD_RECALL')) {
      advanced = true;
      this.onStepPassed(w, step, resultType);
    } else {
      this.onStepFailed(w, step);
    }

    return {
      resultType, reliability, advanced, needsReconfirm,
      hintLevel: w.hintLevel, assistedPath: w.assistedPath,
      suggestTyping: w.speechNoResultStreak >= CONFIG.SPEECH_NO_RESULT_LIMIT,
    };
  }

  private onStepPassed(w: WordState, step: CurrentStep, resultType: ResultType): void {
    const chunks = w.pack.wordpack.pronunciation.chunks;
    const wasRetestWorthy = w.hintLevel > 0 || resultType === 'near-pass' || resultType === 'assisted-pass';

    if (step.stepType === 'CHUNK_ENCODING') {
      // 층 고정 → 다른 단어로 이동 (§5.3)
      w.lockedChunks++;
      w.awaitingRecall = true;
      this.progress.markLayer(w.pack.entry.word_id, w.pack.entry.wordpack_version, w.lockedChunks);
      this.resetStepState(w);
      this.scheduler?.requeueAfterGap(w.pack.entry.word_id);
      this.advanceQueue();
    } else if (step.stepType === 'CHUNK_RECALL') {
      if (w.lockedChunks < chunks.length) {
        // 성공 → 같은 방문에서 다음 누적 Chunk 부호화 (§5.4 성공 경로)
        w.awaitingRecall = false;
        if (wasRetestWorthy) this.scheduler?.insertRetest(w.pack.entry.word_id, { nearPass: resultType === 'near-pass' });
        this.resetStepState(w);
        // current 유지 — 다음 getCurrentStep()이 CHUNK_ENCODING을 낸다
      } else {
        // 마지막 누적 chunk(=전체 단어) 인출 성공 — 전체 단어 명료성 단계로
        this.resetStepState(w);
      }
    } else if (step.stepType === 'FULL_WORD_RECALL') {
      w.fullWordRecallDone = true;
      if (wasRetestWorthy) this.scheduler?.insertRetest(w.pack.entry.word_id, { nearPass: resultType === 'near-pass' });
      this.resetStepState(w);
      // current 유지 — FINAL_INTEGRATION으로 진행 (UI가 SceneAdapter 구동)
    }
  }

  private onStepFailed(w: WordState, step: CurrentStep): void {
    if (step.stepType === 'CHUNK_ENCODING') {
      // 부호화는 느슨하게 — 상한 도달 시 그대로 잠그고 진행 (갇힘 방지)
      if (w.attemptIndex >= CONFIG.MAX_PRODUCTION_ATTEMPTS) {
        w.assistedPath = true;
      }
      return;
    }
    // 인출 단계: 힌트 사다리 자동 상승 (§5.4 실패 힌트)
    if (w.hintLevel < 3) {
      w.hintLevel = (w.hintLevel + 1) as HintLevel;
    } else {
      // 4단계: 정답 음원 뒤 반드시 다시 직접 말하게 함 — assisted 경로
      w.assistedPath = true;
    }
    if (w.attemptIndex >= CONFIG.MAX_PRODUCTION_ATTEMPTS && w.hintLevel >= 3) {
      w.assistedPath = true; // 상한 없는 산출 단계는 만들지 않는다
    }
  }

  /** assisted 경로에서 정답 음원 재생 뒤 재발화 성공 처리 (탈출구 — 항상 진행) */
  completeAssistedRepeat(): void {
    const w = this.currentWord();
    const step = this.getCurrentStep();
    this.logEvent(w, step.stepType, 'speech', 'scene-to-sound', 3, 'assisted-pass', 'reliable', null, null, this.now());
    this.onStepPassed(w, step, 'assisted-pass');
    if (step.stepType === 'FULL_WORD_RECALL' || step.stepType === 'CHUNK_RECALL') {
      this.scheduler?.insertRetest(w.pack.entry.word_id, {});
    }
  }

  /** §5.6 최종 결합 완료 (UI가 SceneAdapter 시퀀스를 끝냈을 때) */
  completeFinalSequence(): void {
    const w = this.currentWord();
    w.finalDone = true;
    this.progress.markInitialLearningCompleted(w.pack.entry.word_id, w.pack.entry.wordpack_version);
    this.progress.scheduleNextReview(w.pack.entry.word_id, w.pack.entry.wordpack_version);
    this.logEvent(w, 'FINAL_INTEGRATION', 'system-observation', 'sound-to-scene', 0, 'pass', 'reliable', null, null, this.now());
    this.advanceQueue();
  }

  /** 인출 성공 직후 같은 방문에서 부호화로 넘어가기 위한 큐 유지 확인용 */
  hasCurrentWord(): boolean { return this.current !== null; }

  sessionSummary(): { independent: number; assisted: number; invalidChannel: number; carryover: readonly string[]; reviewWords: string[] } {
    const counts = this.telemetry.sessionCounts(this.sessionStartEventIndex);
    const reviewWords = [...this.words.values()]
      .filter((w) => w.finalDone)
      .map((w) => w.pack.wordpack.word);
    return { ...counts, carryover: this.scheduler?.getCarryover() ?? [], reviewWords };
  }

  private currentWord(): WordState {
    if (!this.current) throw new Error('현재 단어가 없습니다');
    return this.words.get(this.current.wordId)!;
  }

  private resetStepState(w: WordState): void {
    w.hintLevel = 0;
    w.attemptIndex = 0;
    w.assistedPath = false;
  }

  private logEvent(
    w: WordState, stepType: string, channel: AssessmentChannel, direction: LearningDirection,
    hintLevel: HintLevel, resultType: ResultType, reliability: 'reliable' | 'uncertain' | 'invalid',
    promptEndedAt: number | null, responseStartedAt: number | null, responseCompletedAt: number | null,
  ): void {
    const e: RawLearningEvent = {
      wordId: w.pack.entry.word_id,
      wordpackVersion: w.pack.entry.wordpack_version,
      stepType,
      layerStageAtEvent: w.lockedChunks,
      assessmentChannel: channel,
      learningDirection: direction,
      hintLevel,
      resultType,
      measurementReliability: reliability,
      promptEndedAt,
      responseStartedAt,
      responseCompletedAt,
      attemptIndex: w.attemptIndex,
      isDelayedRecall: false, // 초기 학습 세션 — 지연 차원은 복습 세션에서만 true
    };
    this.telemetry.log(e);
    this.progress.applyEvent(e);
  }
}
