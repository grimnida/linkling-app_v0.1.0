import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualTypingEvaluator, cleanEnglishTokens, hasEnglishLetters } from '../../src/core/PronunciationEvaluator';
import { assessReliability } from '../../src/core/MeasurementReliability';

const base = { wordId: 'w', audio: null, expectedIpa: '/t/', expectedSpelling: 'facil', passProfileId: 'PRON_CHUNK_LOOSE_V1' };

// ---- 타이핑 채널 필수 검증 (부속 명세 §3.1 — PILOT30 결함 회귀 방지) ----

test('한글만 입력 → fail (자동 통과 절대 금지)', async () => {
  const ev = new ManualTypingEvaluator();
  const r = await ev.evaluate({ ...base, text: '퍼실리테이트' });
  assert.equal(r.passed, false);
});

test('숫자만 입력 → fail', async () => {
  const ev = new ManualTypingEvaluator();
  const r = await ev.evaluate({ ...base, text: '12345' });
  assert.equal(r.passed, false);
});

test('공백만 입력 → fail', async () => {
  const ev = new ManualTypingEvaluator();
  const r = await ev.evaluate({ ...base, text: '   ' });
  assert.equal(r.passed, false);
});

test('기호만 입력 → fail', async () => {
  const ev = new ManualTypingEvaluator();
  const r = await ev.evaluate({ ...base, text: '!!!...' });
  assert.equal(r.passed, false);
});

test('정답 철자 입력 → pass, 한 글자 오타 → near(clarityScore 0.7)', async () => {
  const ev = new ManualTypingEvaluator();
  assert.equal((await ev.evaluate({ ...base, text: 'facil' })).passed, true);
  const near = await ev.evaluate({ ...base, text: 'facll' });
  assert.equal(near.passed, false);
  assert.equal(near.clarityScore, 0.7);
});

test('제출 전 검사: 영어 철자 미포함 감지', () => {
  assert.equal(hasEnglishLetters('한글'), false);
  assert.equal(hasEnglishLetters('123'), false);
  assert.equal(hasEnglishLetters('melt'), true);
  assert.deepEqual(cleanEnglishTokens('한글 123 !!'), []);
});

// ---- Measurement Reliability Gate (부속 명세 §2.2) ----

const ctx = {
  channel: 'speech' as const, confidence: 0.9,
  micPermissionDenied: false, noInputCaptured: false, audioPlaybackFailed: false,
  pageWasHidden: false, withinEchoWindow: false,
};

test('정상 입력 + confidence 충분 → reliable', () => {
  assert.equal(assessReliability(ctx), 'reliable');
});

test('confidence 낮음(<0.45) → uncertain (실패 확정 금지)', () => {
  assert.equal(assessReliability({ ...ctx, confidence: 0.3 }), 'uncertain');
});

test('마이크 권한 없음·입력 없음·오디오 재생 실패 → invalid (통로 문제)', () => {
  assert.equal(assessReliability({ ...ctx, micPermissionDenied: true }), 'invalid');
  assert.equal(assessReliability({ ...ctx, noInputCaptured: true }), 'invalid');
  assert.equal(assessReliability({ ...ctx, audioPlaybackFailed: true }), 'invalid');
});

test('페이지 백그라운드 중 입력 → invalid (자동 제외)', () => {
  assert.equal(assessReliability({ ...ctx, pageWasHidden: true }), 'invalid');
});

test('에코 창 안의 음성 입력 → uncertain (재확인)', () => {
  assert.equal(assessReliability({ ...ctx, withinEchoWindow: true }), 'uncertain');
});

test('타이핑 채널은 confidence 임계와 무관하게 reliable', () => {
  assert.equal(assessReliability({ ...ctx, channel: 'text', confidence: 1 }), 'reliable');
});
