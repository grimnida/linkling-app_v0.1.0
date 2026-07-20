import test from 'node:test';
import assert from 'node:assert/strict';
import { InterleavingScheduler } from '../../src/core/InterleavingScheduler';
import { ReviewScheduler } from '../../src/core/ReviewScheduler';
import { WordpackCache } from '../../src/core/WordpackCache';
import { CONFIG } from '../../src/core/config';
import { buildMeaningChoices } from '../../src/core/ReviewSessionEngine';
import { newWordProgress } from '../../src/core/ProgressStore';
import { makePack } from './helpers';

// ---- 재검사 규칙 (부속 명세 §5) ----

test('재검사는 즉시 반복이 아니라 2~5개 뒤에 배치된다', () => {
  const s = new InterleavingScheduler(['a', 'b', 'c', 'd', 'e', 'f'], () => 0.99);
  s.next(); // a 소비
  s.insertRetest('a');
  const q = s.peekAll().map((i) => i.wordId);
  const pos = q.indexOf('a');
  assert.ok(pos >= CONFIG.RETEST_MIN_GAP && pos <= CONFIG.RETEST_MAX_GAP, `pos=${pos}`);
});

test('near-pass는 조기 재검사(gap 1)', () => {
  const s = new InterleavingScheduler(['a', 'b', 'c', 'd'], () => 0.5);
  s.next();
  s.insertRetest('a', { nearPass: true });
  const q = s.peekAll().map((i) => i.wordId);
  assert.equal(q.indexOf('a'), CONFIG.NEAR_PASS_RETEST_GAP);
});

test('세션당 재검사 상한(3회) 초과분은 다음 세션으로 이월', () => {
  const s = new InterleavingScheduler(['a', 'b', 'c', 'd', 'e', 'f'], () => 0);
  assert.equal(s.insertRetest('a'), true);
  assert.equal(s.insertRetest('a'), true);
  assert.equal(s.insertRetest('a'), true);
  assert.equal(s.insertRetest('a'), false); // 상한 초과
  assert.deepEqual([...s.getCarryover()], ['a']);
});

test('직전 단어와 같으면 한 칸 미룬다 (즉시 연속 금지)', () => {
  const s = new InterleavingScheduler(['a', 'b'], () => 0);
  assert.equal(s.next()!.wordId, 'a');
  s.requeueAfterGap('a', 'learn', 0); // 맨 앞에 a
  // 직전이 a였으므로 b가 먼저 나와야 한다... 큐: [a, b]
  assert.equal(s.next()!.wordId, 'b');
});

// ---- ReviewScheduler ----

test('복습 도래 단어만 도래 순으로 반환', () => {
  const rs = new ReviewScheduler(() => 1000);
  const p1 = { ...newWordProgress('a', '1'), initial_learning_completed: true, next_review_at: 900 };
  const p2 = { ...newWordProgress('b', '1'), initial_learning_completed: true, next_review_at: 500 };
  const p3 = { ...newWordProgress('c', '1'), initial_learning_completed: true, next_review_at: 2000 };
  const p4 = { ...newWordProgress('d', '1'), initial_learning_completed: false, next_review_at: 100 };
  const due = rs.dueWords([p1, p2, p3, p4]);
  assert.deepEqual(due.map((p) => p.word_id), ['b', 'a']);
});

// ---- pack cache version 교체 (§12.1) ----

test('버전이 바뀌면 캐시 미스 → 새 버전으로 교체', async () => {
  const cache = new WordpackCache(() => 1);
  const pack = makePack('w1', 'word', 2);
  await cache.storePack(pack);
  assert.ok(await cache.get('w1', '0.1.0'));
  assert.equal(await cache.get('w1', '0.9.0'), null); // 새 버전 요청 → 미스
  const newPack = { ...pack, entry: { ...pack.entry, wordpack_version: '0.9.0' } };
  await cache.storePack(newPack);
  const rec = await cache.get('w1', '0.9.0');
  assert.equal(rec?.version, '0.9.0');
});

test('LRU: 상한 초과 시 가장 오래 안 쓴 팩 제거', async () => {
  let t = 0;
  const cache = new WordpackCache(() => ++t);
  for (let i = 0; i <= CONFIG.CACHE_MAX_PACKS; i++) {
    await cache.storePack(makePack(`w${i}`, 'word', 2));
  }
  const stored = await cache.listStored();
  assert.equal(stored.length, CONFIG.CACHE_MAX_PACKS);
  assert.equal(stored.some((s) => s.wordId === 'w0'), false); // 첫 팩 제거됨
});

// ---- 객관식 선택지 품질 (부속 명세 §6.3) ----

test('오답은 정답 뜻과 겹치지 않고, 풀 고갈 시 있는 만큼만', () => {
  const target = makePack('t', 'target', 2);
  const same = makePack('s', 'same', 2);
  same.wordpack.lexical.core_meaning_ko = target.wordpack.lexical.core_meaning_ko; // 겹침 → 제외 대상
  const other = makePack('o', 'other', 2);
  const choices = buildMeaningChoices(target, [target, same, other], 4, () => 0.5);
  assert.equal(choices.filter((c) => c.isCorrect).length, 1);
  const wrongs = choices.filter((c) => !c.isCorrect).map((c) => c.meaningKo);
  assert.ok(!wrongs.includes(target.wordpack.lexical.core_meaning_ko));
  assert.equal(wrongs.length, 1); // 고갈 — other 하나뿐
});
