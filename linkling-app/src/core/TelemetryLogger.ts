/**
 * TelemetryLogger — Raw Event 관찰 스키마 (부속 명세 §2.1).
 * 신호는 관찰이지 원인이 아니다. 어떤 파생 신호에도 진단·낙인 표현을 만들지 않는다.
 * 연구용 JSON 내보내기는 VITE_RESEARCH_EXPORT=true 뒤에만 존재한다 (§6.3).
 */
import type { RawLearningEvent } from './types';

const STORAGE_KEY = 'linkling.telemetry.v1';
const MAX_EVENTS = 5000;

export class TelemetryLogger {
  private events: RawLearningEvent[] = [];

  constructor(private readonly persist: boolean = true) {
    if (this.persist) {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (raw) this.events = JSON.parse(raw);
      } catch { /* 손상 시 새로 시작 */ }
    }
  }

  log(event: RawLearningEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    if (this.persist) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events));
      } catch { /* 저장 불가여도 학습은 계속 */ }
    }
  }

  all(): readonly RawLearningEvent[] { return this.events; }

  /** 세션 요약용 집계 — §2.3 정의(reliable + hintLevel 0)만 독립 성공으로 센다 */
  sessionCounts(sinceIndex = 0): { independent: number; assisted: number; invalidChannel: number } {
    let independent = 0; let assisted = 0; let invalidChannel = 0;
    for (const e of this.events.slice(sinceIndex)) {
      if (e.measurementReliability === 'invalid') { invalidChannel++; continue; }
      // 산출 채널(speech/text)만 센다 — 재인·자기보고·시스템 관찰은 숙달 증거가 아니다
      const isProduction = e.assessmentChannel === 'speech' || e.assessmentChannel === 'text';
      if (!isProduction) continue;
      if (e.resultType === 'pass' && e.hintLevel === 0 && e.measurementReliability === 'reliable') {
        independent++;
      } else if (e.resultType === 'assisted-pass' || (e.resultType === 'pass' && e.hintLevel > 0)) {
        assisted++;
      }
    }
    return { independent, assisted, invalidChannel };
  }

  eventCount(): number { return this.events.length; }

  /** 연구용 내보내기 — 개발/연구 플래그 뒤에서만 호출된다. 파일명 날짜는 Asia/Seoul 기준. */
  exportForResearch(): { filename: string; json: string } {
    const seoulDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    return {
      filename: `linkling_session_${seoulDate}.json`,
      json: JSON.stringify({ exported_at_seoul: seoulDate, events: this.events }, null, 2),
    };
  }
}
