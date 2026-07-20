/**
 * ProgressStore — local-first 진도 저장 (본문서 §7.7 + 부속 명세 §2.3·§2.4).
 *
 * 핵심 규칙:
 * - 지식 상태 승격은 전용(자동 강등 없음): not-assessed → in-progress → supported → independent → stable
 * - independent/stable 승격과 "무힌트 성공" 카운트는 reliable + hintLevel 0 사건만 인정
 * - 선택지(touch-choice) 성공은 재인으로만 기록 — 절대 무힌트 성공으로 세지 않는다
 * - 뜻 희미화는 성공 기반(100→70→35→10→기본 숨김), 날짜만으로 진행하지 않는다
 */
import type { HintLevel, KnowledgeState, RawLearningEvent, WordProgress } from './types';
import { CONFIG } from './config';

const STORAGE_KEY = 'linkling.progress.v1';

export interface ProgressRepository {
  loadAll(): Record<string, WordProgress>;
  saveAll(data: Record<string, WordProgress>): void;
}

class LocalStorageProgressRepository implements ProgressRepository {
  loadAll(): Record<string, WordProgress> {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  saveAll(data: Record<string, WordProgress>): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* 저장 불가여도 세션 내 진도는 유지 */ }
  }
}

export function newWordProgress(wordId: string, version: string): WordProgress {
  return {
    word_id: wordId,
    wordpack_version: version,
    current_layer: 0,
    initial_learning_completed: false,
    independent_success_count: 0,
    assisted_success_count: 0,
    last_hint_level: 0,
    last_response_latency_ms: null,
    pronunciation_attempts: 0,
    meaning_recall_self_rating: null,
    meaning_fade_level: CONFIG.FADE_LEVELS.initial,
    next_review_at: null,
    last_reviewed_at: null,
    knowledge_state: 'not-assessed',
    reliable_success_count: 0,
    reliable_delayed_success_count: 0,
    uncertain_event_count: 0,
    invalid_event_count: 0,
    recognition_success_count: 0,
    channel_disagreement_flag: false,
  };
}

const STATE_ORDER: KnowledgeState[] = ['not-assessed', 'in-progress', 'supported', 'independent', 'stable'];

function promoteOnly(current: KnowledgeState, target: KnowledgeState): KnowledgeState {
  return STATE_ORDER.indexOf(target) > STATE_ORDER.indexOf(current) ? target : current;
}

export class ProgressStore {
  private data: Record<string, WordProgress>;
  /** 무힌트 reliable 성공 시각 기록 (희미화 두 번째 성공의 "떨어진 시점" 판정용) */
  private lastNoHintSuccessAt = new Map<string, number>();

  constructor(
    private readonly repo: ProgressRepository = new LocalStorageProgressRepository(),
    private readonly now: () => number = Date.now,
  ) {
    this.data = this.repo.loadAll();
  }

  get(wordId: string, version: string): WordProgress {
    const existing = this.data[wordId];
    if (existing && existing.wordpack_version === version) return existing;
    const fresh = newWordProgress(wordId, version);
    if (existing) {
      // 팩 버전이 바뀌어도 지식 상태·희미화는 이어간다 (콘텐츠 갱신 ≠ 기억 초기화)
      fresh.knowledge_state = existing.knowledge_state;
      fresh.meaning_fade_level = existing.meaning_fade_level;
      fresh.reliable_success_count = existing.reliable_success_count;
      fresh.reliable_delayed_success_count = existing.reliable_delayed_success_count;
      fresh.next_review_at = existing.next_review_at;
      fresh.last_reviewed_at = existing.last_reviewed_at;
    }
    this.data[wordId] = fresh;
    return fresh;
  }

  save(): void { this.repo.saveAll(this.data); }

  all(): WordProgress[] { return Object.values(this.data); }

  /**
   * Raw Event 반영 — 승격·희미화·카운트 산출의 유일한 진입점.
   * 여기서 파생되는 어떤 값도 진단이 아니라 관찰이다.
   */
  applyEvent(e: RawLearningEvent): WordProgress {
    const p = this.get(e.wordId, e.wordpackVersion);
    const t = this.now();

    if (e.measurementReliability === 'invalid') {
      p.invalid_event_count++; // 통로 문제 빈도 관찰용 — 지식 평가 제외
      this.save();
      return p;
    }
    if (e.measurementReliability === 'uncertain') {
      p.uncertain_event_count++;
    }

    if (p.knowledge_state === 'not-assessed') p.knowledge_state = 'in-progress';

    // 시스템 관찰(첫 노출·시퀀스 완료 등)은 지식 증거가 아니다 — 상태 표시만
    if (e.assessmentChannel === 'system-observation') {
      this.save();
      return p;
    }

    const isProduction = e.assessmentChannel === 'speech' || e.assessmentChannel === 'text';
    if (isProduction) p.pronunciation_attempts++;
    p.last_hint_level = e.hintLevel;
    if (e.promptEndedAt !== null && e.responseCompletedAt !== null) {
      p.last_response_latency_ms = e.responseCompletedAt - e.promptEndedAt;
    }

    // 재인(touch-choice) 성공: recognition으로만 기록 — 숙달 증거 아님
    if (e.assessmentChannel === 'touch-choice' && (e.resultType === 'pass' || e.resultType === 'assisted-pass')) {
      p.recognition_success_count++;
      this.save();
      return p;
    }

    if (e.resultType === 'pass' && e.hintLevel === 0 && e.measurementReliability === 'reliable' && isProduction) {
      // §2.3: independent 승격·뜻 희미화의 유일한 트리거
      p.independent_success_count++;
      p.reliable_success_count++;
      this.applyFadeOnNoHintSuccess(p, e, t);
      if (p.reliable_success_count >= CONFIG.INDEPENDENT_RELIABLE_SUCCESSES) {
        p.knowledge_state = promoteOnly(p.knowledge_state, 'independent');
      }
      if (e.isDelayedRecall) {
        p.reliable_delayed_success_count++;
        p.knowledge_state = promoteOnly(p.knowledge_state, 'stable');
      }
      this.lastNoHintSuccessAt.set(e.wordId, t);
    } else if (e.resultType === 'pass' || e.resultType === 'assisted-pass' || e.resultType === 'near-pass') {
      p.assisted_success_count++;
      p.knowledge_state = promoteOnly(p.knowledge_state, 'supported');
    }
    // fail: 카운트만 (시도 수는 위에서), 강등 없음

    this.save();
    return p;
  }

  /** 뜻 희미화 (본문서 §5.7): 100 → 70 → 35 → 10 → 기본 숨김(0) */
  private applyFadeOnNoHintSuccess(p: WordProgress, e: RawLearningEvent, t: number): void {
    const F = CONFIG.FADE_LEVELS;
    if (p.meaning_fade_level === F.initial) {
      p.meaning_fade_level = F.firstNoHint;
      return;
    }
    if (p.meaning_fade_level === F.firstNoHint) {
      const last = this.lastNoHintSuccessAt.get(p.word_id);
      // "떨어진 시점"의 두 번째 무힌트 성공만 35%로 진행
      if (last === undefined || t - last >= CONFIG.FADE_SECOND_SUCCESS_MIN_GAP_MS || e.isDelayedRecall) {
        p.meaning_fade_level = F.secondNoHintLater;
      }
      return;
    }
    if (p.meaning_fade_level === F.secondNoHintLater && e.isDelayedRecall) {
      p.meaning_fade_level = F.delayedReview;
      return;
    }
    if (p.meaning_fade_level === F.delayedReview && e.isDelayedRecall && p.knowledge_state === 'stable') {
      p.meaning_fade_level = F.stable; // 기본 숨김, 확인 시 표시
    }
  }

  /** 채널 불일치(음성 실패·텍스트 성공 병존) — 해석 금지, 표시만 */
  flagChannelDisagreement(wordId: string, version: string): void {
    const p = this.get(wordId, version);
    p.channel_disagreement_flag = true;
    this.save();
  }

  markLayer(wordId: string, version: string, layer: number): void {
    const p = this.get(wordId, version);
    p.current_layer = Math.max(p.current_layer, layer);
    this.save();
  }

  markInitialLearningCompleted(wordId: string, version: string): void {
    const p = this.get(wordId, version);
    p.initial_learning_completed = true;
    this.save();
  }

  scheduleNextReview(wordId: string, version: string): void {
    const p = this.get(wordId, version);
    const stage = Math.min(p.reliable_delayed_success_count, CONFIG.REVIEW_INTERVALS_MS.length - 1);
    p.next_review_at = this.now() + CONFIG.REVIEW_INTERVALS_MS[stage];
    p.last_reviewed_at = this.now();
    this.save();
  }
}
