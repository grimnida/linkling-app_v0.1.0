import React, { useMemo } from 'react';
import type { LearningSessionEngine } from '../core/LearningSessionEngine';
import type { TelemetryLogger } from '../core/TelemetryLogger';
import type { ProgressStore } from '../core/ProgressStore';
import { isResearchExportEnabled } from '../env';

/**
 * 세션 요약 (본문서 §10.5) — 최소 표시만. 점수 경쟁·과도한 보상 UI 없음.
 * "독립 인출 성공 수"는 reliable + 무힌트 정의를 그대로 쓴다 (부속 명세 §2.3).
 */
export function SummaryScreen(props: {
  engine: LearningSessionEngine;
  telemetry: TelemetryLogger;
  progress: ProgressStore;
  onHome: () => void;
}): React.ReactElement {
  const summary = useMemo(() => props.engine.sessionSummary(), [props.engine]);
  const nextReview = useMemo(() => {
    const upcoming = props.progress.all()
      .filter((p) => p.next_review_at !== null)
      .sort((a, b) => (a.next_review_at ?? 0) - (b.next_review_at ?? 0))[0];
    if (!upcoming?.next_review_at) return null;
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).format(new Date(upcoming.next_review_at));
  }, [props.progress]);

  const exportResearch = () => {
    const { filename, json } = props.telemetry.exportForResearch();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="summary-screen">
      <h1>오늘 정리</h1>
      <dl className="summary-list">
        <dt>혼자 힘으로 떠올린 횟수</dt><dd>{summary.independent}</dd>
        <dt>도움을 받아 성공한 횟수</dt><dd>{summary.assisted}</dd>
        {summary.invalidChannel > 0 && (
          <><dt>입력이 잘 전달되지 않은 횟수</dt><dd>{summary.invalidChannel}</dd></>
        )}
        <dt>다시 볼 단어</dt>
        <dd>{summary.carryover.length > 0 ? summary.carryover.join(', ') : '없음'}</dd>
        <dt>다음 복습 예정</dt><dd>{nextReview ?? '학습을 마치면 안내해 드려요'}</dd>
      </dl>
      <button className="primary" onClick={props.onHome}>처음으로</button>
      {isResearchExportEnabled() && (
        <button className="secondary" onClick={exportResearch}>연구용 세션 내보내기</button>
      )}
    </div>
  );
}
