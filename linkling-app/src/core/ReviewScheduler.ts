/**
 * ReviewScheduler (본문서 §7.5·§5.7)
 * - next_review_at 계산은 설정 상수 간격 사용 (단어별 하드코딩 없음)
 * - 복습 방향 3종 순환: 이미지+말풍선→발음 / 철자→의미 / 음성→의미
 * - 날짜는 희미화에 관여하지 않는다 — 희미화는 ProgressStore가 성공 기반으로만 계산
 */
import type { WordProgress, LearningDirection } from './types';

export const REVIEW_DIRECTIONS: LearningDirection[] = [
  'scene-to-sound', // 이미지 + 말풍선 → 영어 발음
  'spelling-to-meaning', // 영어 철자 → 의미
  'audio-to-meaning', // 영어 음성 → 의미
];

export class ReviewScheduler {
  constructor(private readonly now: () => number = Date.now) {}

  /** 복습이 도래한 단어 목록 (도래 순) */
  dueWords(progress: WordProgress[]): WordProgress[] {
    const t = this.now();
    return progress
      .filter((p) => p.initial_learning_completed && p.next_review_at !== null && p.next_review_at <= t)
      .sort((a, b) => (a.next_review_at ?? 0) - (b.next_review_at ?? 0));
  }

  /** 이번 복습에서 사용할 방향 — 최근 방향과 겹치지 않게 순환 */
  directionFor(p: WordProgress, sessionIndex: number): LearningDirection {
    const base = (p.reliable_delayed_success_count + sessionIndex) % REVIEW_DIRECTIONS.length;
    return REVIEW_DIRECTIONS[base];
  }
}
