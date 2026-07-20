/**
 * PronunciationEvaluator — provider adapter (본문서 §7.6).
 * 실제 프로덕션 provider는 [확인 필요]. 앱을 특정 음성 인식 API에 결합하지 않는다.
 *
 * 구현체:
 *  - ManualTypingEvaluator: 타이핑 대체 채널 (부속 명세 §3.1의 계약을 강제)
 *  - MockPronunciationEvaluator: 개발·E2E용
 *  - (미래) 실제 provider adapter — PRONUNCIATION_PROVIDER_TODO.md 참조
 */
import type { PronunciationEvaluator, PronunciationInput, PronunciationResult } from './types';

/** 영어 산출 텍스트 정제: 소문자화, 영문자 외 제거 */
export function cleanEnglishTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z']/g, ''))
    .filter((t) => t.length > 0);
}

/** 제출 전 검사: 영어 철자 포함 여부 (부속 명세 §3.1 — 미제출 안내용) */
export function hasEnglishLetters(text: string): boolean {
  return /[a-z]/i.test(text);
}

/** 느슨한 비교: 소문자·비영문 제거 후 비교, 짧은 chunk는 앞부분 일치 허용 */
function looseMatch(input: string, expected: string): { matched: boolean; near: boolean } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const a = norm(input);
  const b = norm(expected);
  if (a.length === 0 || b.length === 0) return { matched: false, near: false };
  if (a === b) return { matched: true, near: false };
  // 한 글자 이내 차이 → near-pass 후보
  const dist = editDistance(a, b);
  if (dist <= 1) return { matched: false, near: true };
  return { matched: false, near: false };
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * 타이핑 대체 입력 채널 (부속 명세 §3.1).
 * 계약: 정제 후 토큰이 비면 무조건 fail — 자동 통과 처리 절대 금지.
 */
export class ManualTypingEvaluator implements PronunciationEvaluator {
  readonly channel = 'text' as const;

  async evaluate(input: PronunciationInput): Promise<PronunciationResult> {
    const text = input.text ?? '';
    const tokens = cleanEnglishTokens(text);
    if (tokens.length === 0) {
      // 한글만·숫자만·공백만 입력 → 전부 fail (PILOT30 결함의 회귀 방지)
      return {
        passed: false, confidence: 1, clarityScore: 0,
        matchedWord: null, missingSegments: [input.expectedSpelling], providerRawResult: { reason: 'empty-after-clean' },
      };
    }
    const joined = tokens.join('');
    const { matched, near } = looseMatch(joined, input.expectedSpelling);
    return {
      passed: matched,
      confidence: 1, // 타이핑은 인식 불확실성이 없다
      clarityScore: matched ? 1 : near ? 0.7 : 0,
      matchedWord: matched ? input.expectedSpelling : joined,
      missingSegments: matched ? [] : [input.expectedSpelling],
      providerRawResult: { tokens, near },
    };
  }
}

/** 개발·E2E용 Mock — 다음 결과를 큐로 주입하거나 항상 pass */
export class MockPronunciationEvaluator implements PronunciationEvaluator {
  readonly channel = 'speech' as const;
  private queue: Partial<PronunciationResult>[] = [];
  constructor(private readonly defaultPassed = true) {}

  enqueue(...results: Partial<PronunciationResult>[]): void {
    this.queue.push(...results);
  }

  async evaluate(input: PronunciationInput): Promise<PronunciationResult> {
    const next = this.queue.shift();
    const base: PronunciationResult = {
      passed: this.defaultPassed,
      confidence: 0.9,
      clarityScore: this.defaultPassed ? 0.9 : 0.2,
      matchedWord: input.expectedSpelling,
      missingSegments: [],
      providerRawResult: { mock: true },
    };
    return { ...base, ...next };
  }
}
