/**
 * InterleavingScheduler (본문서 §7.5) + 재검사 규칙 (부속 명세 §5)
 * - 같은 단어 즉시 반복 금지, 기본 2~3개 사이 끼움
 * - 실패·느린 회상·힌트 성공 재검사: 다른 과제 2~5개 뒤
 * - near-pass: gap 1 조기 재검사
 * - 세션당 같은 항목 재검사 상한(기본 3회), 초과분 다음 세션 이월
 */
import { CONFIG } from './config';

export interface QueueItem {
  wordId: string;
  kind: 'learn' | 'retest';
}

export class InterleavingScheduler {
  private queue: QueueItem[] = [];
  private history: string[] = []; // 소비된 순서
  private retestCounts = new Map<string, number>();
  private carryover: string[] = []; // 다음 세션 이월분

  constructor(wordIds: string[], private readonly rng: () => number = Math.random) {
    // 초기 큐: 단어 순서 유지 (세션 준비 시 현재 단어 + 뒤에 끼울 단어들)
    this.queue = wordIds.map((w) => ({ wordId: w, kind: 'learn' as const }));
  }

  /** 다음 항목 꺼내기 — 직전 단어와 같으면 뒤로 미룬다(즉시 연속 금지) */
  next(): QueueItem | null {
    if (this.queue.length === 0) return null;
    const last = this.history[this.history.length - 1];
    let idx = 0;
    if (this.queue[0].wordId === last && this.queue.length > 1) {
      idx = 1; // 한 칸 미루기 — 가능한 범위에서 최대 간격 확보
    }
    const [item] = this.queue.splice(idx, 1);
    this.history.push(item.wordId);
    return item;
  }

  peekAll(): readonly QueueItem[] { return this.queue; }
  get length(): number { return this.queue.length; }

  /** 같은 단어를 gap개 뒤에 다시 넣는다 (Chunk 인출 사이 끼움: 2~3개 뒤) */
  requeueAfterGap(wordId: string, kind: QueueItem['kind'] = 'learn', gapOverride?: number): void {
    const gap = gapOverride ?? this.pickGap(CONFIG.INTERLEAVE_MIN_GAP, CONFIG.INTERLEAVE_MAX_GAP);
    const pos = Math.min(gap, this.queue.length);
    this.queue.splice(pos, 0, { wordId, kind });
  }

  /**
   * 재검사 삽입 (부속 명세 §5).
   * @returns 삽입됐으면 true, 세션 상한 초과로 이월됐으면 false
   */
  insertRetest(wordId: string, opts: { nearPass?: boolean } = {}): boolean {
    const count = this.retestCounts.get(wordId) ?? 0;
    if (count >= CONFIG.SESSION_RETEST_CAP) {
      if (!this.carryover.includes(wordId)) this.carryover.push(wordId);
      return false; // 초과분은 다음 세션으로 이월
    }
    this.retestCounts.set(wordId, count + 1);
    const gap = opts.nearPass
      ? CONFIG.NEAR_PASS_RETEST_GAP
      : this.pickGap(CONFIG.RETEST_MIN_GAP, CONFIG.RETEST_MAX_GAP);
    const pos = Math.min(gap, this.queue.length);
    this.queue.splice(pos, 0, { wordId, kind: 'retest' });
    return true;
  }

  getCarryover(): readonly string[] { return this.carryover; }

  private pickGap(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }
}
