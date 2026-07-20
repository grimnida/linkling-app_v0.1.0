/**
 * 사용자에게 보이는 오류 — 조용한 fallback 금지 (부속 명세 §4).
 * 지원 불가 팩·설치 실패는 반드시 화면에 표시된다.
 */
export class VisibleContentError extends Error {
  readonly userMessageKo: string;
  readonly scope: 'catalog' | 'pack' | 'asset' | 'audio';
  constructor(scope: VisibleContentError['scope'], userMessageKo: string, detail?: string) {
    super(`${scope}: ${userMessageKo}${detail ? ` (${detail})` : ''}`);
    this.name = 'VisibleContentError';
    this.scope = scope;
    this.userMessageKo = userMessageKo;
  }
}

/** 플랫폼 실패 ≠ 학습 실패 (부속 명세 공통 정책) — 통로 문제 표시용 */
export class ChannelProblem extends Error {
  readonly userMessageKo: string;
  constructor(userMessageKo: string) {
    super(userMessageKo);
    this.name = 'ChannelProblem';
    this.userMessageKo = userMessageKo;
  }
}
