import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressStore } from '../../src/core/ProgressStore';
import { CONFIG } from '../../src/core/config';
import type { RawLearningEvent } from '../../src/core/types';
import { MemoryProgressRepository } from './helpers';

function makeEvent(over: Partial<RawLearningEvent> = {}): RawLearningEvent {
  return {
    wordId: 'w1', wordpackVersion: '0.1.0', stepType: 'CHUNK_RECALL', layerStageAtEvent: 1,
    assessmentChannel: 'text', learningDirection: 'scene-to-sound',
    hintLevel: 0, resultType: 'pass', measurementReliability: 'reliable',
    promptEndedAt: 1000, responseStartedAt: null, responseCompletedAt: 2000,
    attemptIndex: 1, isDelayedRecall: false, ...over,
  };
}

function makeStore(startTime = 0) {
  let t = startTime;
  const store = new ProgressStore(new MemoryProgressRepository(), () => t);
  return { store, setTime: (v: number) => { t = v; } };
}

// ---- meaning fade 단계 계산 (본문서 §12.1·§5.7) ----

test('뜻 희미화: 100 → 첫 무힌트 성공 70', () => {
  const { store } = makeStore();
  const p = store.applyEvent(makeEvent());
  assert.equal(p.meaning_fade_level, 70);
});

test('붙은 시점의 두 번째 성공은 35로 내려가지 않는다 (떨어진 시점만 인정)', () => {
  const { store, setTime } = makeStore();
  store.applyEvent(makeEvent());
  setTime(60 * 1000); // 1분 뒤 — 간격 부족
  const p = store.applyEvent(makeEvent());
  assert.equal(p.meaning_fade_level, 70);
});

test('떨어진 시점의 두 번째 무힌트 성공 → 35, 지연 복습 성공 → 10', () => {
  const { store, setTime } = makeStore();
  store.applyEvent(makeEvent());
  setTime(CONFIG.FADE_SECOND_SUCCESS_MIN_GAP_MS + 1000);
  let p = store.applyEvent(makeEvent());
  assert.equal(p.meaning_fade_level, 35);
  setTime(CONFIG.FADE_SECOND_SUCCESS_MIN_GAP_MS * 2 + 2000);
  p = store.applyEvent(makeEvent({ isDelayedRecall: true }));
  assert.equal(p.meaning_fade_level, 10);
});

test('힌트 성공은 희미화를 진행시키지 않는다', () => {
  const { store } = makeStore();
  const p = store.applyEvent(makeEvent({ hintLevel: 2, resultType: 'assisted-pass' }));
  assert.equal(p.meaning_fade_level, 100);
});

test('uncertain 성공은 희미화·독립 카운트에 반영되지 않는다 (§2.3 reliable만)', () => {
  const { store } = makeStore();
  const p = store.applyEvent(makeEvent({ measurementReliability: 'uncertain' }));
  assert.equal(p.meaning_fade_level, 100);
  assert.equal(p.reliable_success_count, 0);
  assert.equal(p.uncertain_event_count, 1);
});

test('선택지(touch-choice) 성공만으로 희미화가 진행되지 않는다 (§7 QA-8)', () => {
  const { store } = makeStore();
  const p = store.applyEvent(makeEvent({ assessmentChannel: 'touch-choice' }));
  assert.equal(p.meaning_fade_level, 100);
  assert.equal(p.recognition_success_count, 1);
  assert.equal(p.independent_success_count, 0);
  assert.equal(p.knowledge_state, 'in-progress');
});

test('자기보고(self-report)는 단독 증거가 아니다 — 독립 카운트 미반영', () => {
  const { store } = makeStore();
  const p = store.applyEvent(makeEvent({ assessmentChannel: 'self-report' }));
  assert.equal(p.independent_success_count, 0);
  assert.equal(p.meaning_fade_level, 100);
});

// ---- 지식 상태 5단계 + reliable-only 승격 (부속 명세 §2.3) ----

test('승격: in-progress → supported(도움 성공) → independent(reliable 무힌트 2회) → stable(지연 성공)', () => {
  const { store, setTime } = makeStore();
  let p = store.applyEvent(makeEvent({ resultType: 'assisted-pass', hintLevel: 2 }));
  assert.equal(p.knowledge_state, 'supported');
  p = store.applyEvent(makeEvent());
  assert.equal(p.knowledge_state, 'supported'); // reliable 1회 — 아직
  setTime(CONFIG.FADE_SECOND_SUCCESS_MIN_GAP_MS + 1000);
  p = store.applyEvent(makeEvent());
  assert.equal(p.knowledge_state, 'independent'); // reliable 2회
  setTime(CONFIG.FADE_SECOND_SUCCESS_MIN_GAP_MS * 2 + 2000);
  p = store.applyEvent(makeEvent({ isDelayedRecall: true }));
  assert.equal(p.knowledge_state, 'stable');
});

test('자동 강등 없음: 이후 실패해도 상태 유지', () => {
  const { store, setTime } = makeStore();
  store.applyEvent(makeEvent());
  setTime(CONFIG.FADE_SECOND_SUCCESS_MIN_GAP_MS + 1000);
  store.applyEvent(makeEvent());
  const p = store.applyEvent(makeEvent({ resultType: 'fail' }));
  assert.equal(p.knowledge_state, 'independent');
});

test('invalid 사건은 지식 평가에서 제외 — 카운트만 관찰', () => {
  const { store } = makeStore();
  const p = store.applyEvent(makeEvent({ measurementReliability: 'invalid', resultType: 'invalid' }));
  assert.equal(p.invalid_event_count, 1);
  assert.equal(p.knowledge_state, 'not-assessed');
  assert.equal(p.pronunciation_attempts, 0);
});

test('팩 버전 교체 시 지식 상태·희미화는 승계된다', () => {
  const { store, setTime } = makeStore();
  store.applyEvent(makeEvent());
  setTime(CONFIG.FADE_SECOND_SUCCESS_MIN_GAP_MS + 1000);
  store.applyEvent(makeEvent());
  const p2 = store.get('w1', '0.2.0'); // 새 버전
  assert.equal(p2.wordpack_version, '0.2.0');
  assert.equal(p2.knowledge_state, 'independent');
  assert.equal(p2.meaning_fade_level, 35);
  assert.equal(p2.current_layer, 0); // 층 진행은 초기화
});
