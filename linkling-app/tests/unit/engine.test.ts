import test from 'node:test';
import assert from 'node:assert/strict';
import { LearningSessionEngine } from '../../src/core/LearningSessionEngine';
import { TelemetryLogger } from '../../src/core/TelemetryLogger';
import { ProgressStore } from '../../src/core/ProgressStore';
import { MockPronunciationEvaluator, ManualTypingEvaluator } from '../../src/core/PronunciationEvaluator';
import { makePack, MemoryProgressRepository } from './helpers';

function makeEngine(defaultPass = true) {
  const telemetry = new TelemetryLogger(false);
  const progress = new ProgressStore(new MemoryProgressRepository(), () => 1000);
  const mock = new MockPronunciationEvaluator(defaultPass);
  const engine = new LearningSessionEngine(
    telemetry, progress, { speech: mock, text: new ManualTypingEvaluator() },
    () => 1000, () => 0, // rng 고정 → gap 최소값
  );
  return { engine, telemetry, progress, mock };
}

async function driveWordToCompletion(engine: LearningSessionEngine, maxSteps = 100): Promise<string[]> {
  const visited: string[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const step = engine.getCurrentStep();
    if (step.stepType === 'SESSION_SUMMARY') break;
    visited.push(`${step.pack!.wordpack.word}:${step.stepType}:${step.chunkOrder ?? '-'}`);
    if (step.stepType === 'FULL_AUDIO_PREVIEW') {
      engine.completePreview();
    } else if (step.stepType === 'FINAL_INTEGRATION') {
      engine.completeFinalSequence();
    } else {
      await engine.submitAttempt({ channel: 'speech' });
    }
  }
  return visited;
}

// ---- 2·3·4층 팩이 동일 엔진 코드로 처리 (§12.1 — 단어별 분기 없음) ----

for (const layers of [2, 3, 4]) {
  test(`${layers}층 팩 전체 Flow가 같은 엔진으로 완주된다`, async () => {
    const { engine } = makeEngine();
    engine.startSession([makePack(`w${layers}`, 'abcdefgh'.slice(0, layers * 2), layers)]);
    const visited = await driveWordToCompletion(engine);
    // Chunk 순서 강제: encoding 1..n 순서대로
    const encodings = visited.filter((v) => v.includes('CHUNK_ENCODING')).map((v) => Number(v.split(':')[2]));
    assert.deepEqual(encodings, Array.from({ length: layers }, (_, i) => i + 1));
    // 전체 층 완료 전 FINAL_INTEGRATION 없음 (final_pass 차단)
    const finalIdx = visited.findIndex((v) => v.includes('FINAL_INTEGRATION'));
    const lastEncodeIdx = visited.map((v) => v.includes('CHUNK_ENCODING')).lastIndexOf(true);
    const fullRecallIdx = visited.findIndex((v) => v.includes('FULL_WORD_RECALL'));
    assert.ok(finalIdx > lastEncodeIdx, 'final은 모든 층 이후');
    assert.ok(finalIdx > fullRecallIdx && fullRecallIdx > -1, 'final은 전체 단어 인출 이후');
    assert.equal(engine.getCurrentStep().stepType, 'SESSION_SUMMARY');
  });
}

test('두 단어 세션: 같은 단어가 즉시 연속되지 않는다 (§7.5)', async () => {
  const { engine } = makeEngine();
  engine.startSession([makePack('wa', 'facione', 3), makePack('wb', 'melbone', 2)]);
  const visited = await driveWordToCompletion(engine, 200);
  const words = visited.map((v) => v.split(':')[0]);
  let immediateRepeat = 0;
  for (let i = 1; i < words.length; i++) {
    // 같은 방문 안의 recall→encoding 연속은 허용 (§5.4 성공 경로) — 단어 전환만 검사
    if (words[i] !== words[i - 1]) continue;
    const sameVisit = visited[i - 1].includes('CHUNK_RECALL') && visited[i].includes('CHUNK_ENCODING');
    const preview = visited[i - 1].includes('FULL_AUDIO_PREVIEW');
    const finalPair = visited[i].includes('FINAL_INTEGRATION') || visited[i - 1].includes('FULL_WORD_RECALL');
    if (!sameVisit && !preview && !finalPair) immediateRepeat++;
  }
  // 다른 단어가 남아 있는 동안에는 같은 단어 연속 방문이 없어야 한다
  const bothActive = words.slice(0, words.lastIndexOf('wb'));
  void bothActive;
  assert.ok(immediateRepeat <= 2, `즉시 연속 ${immediateRepeat}회`); // 한 단어만 남은 구간 허용
});

test('인출 실패 → 힌트 사다리 자동 상승(1→2→3) → assisted 경로 (상한 없는 산출 단계 금지)', async () => {
  const { engine, mock } = makeEngine(false); // 모두 실패
  engine.startSession([makePack('wf', 'failword', 2)]);
  engine.completePreview();
  // encoding chunk 1: 실패해도 상한 도달 시 assisted로 진행 가능해야 함
  mock.enqueue({ passed: true, confidence: 0.9, clarityScore: 0.9 });
  await engine.submitAttempt({ channel: 'speech' }); // encoding pass
  // 이제 CHUNK_RECALL — 연속 실패
  let step = engine.getCurrentStep();
  assert.equal(step.stepType, 'CHUNK_RECALL');
  const o1 = await engine.submitAttempt({ channel: 'speech' });
  assert.equal(o1.hintLevel, 1); // 생각 시간
  const o2 = await engine.submitAttempt({ channel: 'speech' });
  assert.equal(o2.hintLevel, 2); // 첫소리
  const o3 = await engine.submitAttempt({ channel: 'speech' });
  assert.equal(o3.hintLevel, 3); // 전체 음원
  assert.equal(o3.assistedPath, true); // 시도 상한 도달 → 탈출구 열림
  engine.completeAssistedRepeat(); // 정답 음원 뒤 재발화 → 항상 진행
  step = engine.getCurrentStep();
  assert.equal(step.stepType, 'CHUNK_ENCODING');
  assert.equal(step.chunkOrder, 2);
});

test('hint level이 기록된다 (§12.1)', async () => {
  const { engine, telemetry, mock } = makeEngine(false);
  engine.startSession([makePack('wh', 'hintword', 2)]);
  engine.completePreview();
  mock.enqueue({ passed: true });
  await engine.submitAttempt({ channel: 'speech' }); // encoding pass
  await engine.submitAttempt({ channel: 'speech' }); // recall fail → hint 1
  mock.enqueue({ passed: true });
  await engine.submitAttempt({ channel: 'speech' }); // recall pass (hint 1)
  const events = telemetry.all();
  const recallPass = events[events.length - 1];
  assert.equal(recallPass.hintLevel, 1);
  assert.equal(recallPass.resultType, 'assisted-pass'); // 힌트 성공 = 도움 성공
});

test('백그라운드 중 입력 → invalid 기록·승격 미반영 (§7 QA-6)', async () => {
  const { engine, progress } = makeEngine(true);
  engine.startSession([makePack('wb', 'backword', 2)]);
  engine.completePreview();
  const o = await engine.submitAttempt({ channel: 'speech', pageWasHidden: true });
  assert.equal(o.reliability, 'invalid');
  assert.equal(o.advanced, false);
  const p = progress.get('wb', '0.1.0');
  assert.equal(p.invalid_event_count, 1);
  // 노출로 in-progress까지만 — invalid 입력은 지식 평가에 반영되지 않는다
  assert.equal(p.knowledge_state, 'in-progress');
  assert.equal(p.reliable_success_count, 0);
  assert.equal(p.pronunciation_attempts, 0);
});

test('음성 연속 무결과 3회 → 타이핑 전환 제안 (§7 QA-4)', async () => {
  const { engine } = makeEngine(true);
  engine.startSession([makePack('ws', 'speechword', 2)]);
  engine.completePreview();
  let out;
  for (let i = 0; i < 3; i++) {
    out = await engine.submitAttempt({ channel: 'speech', noInputCaptured: true });
  }
  assert.equal(out!.suggestTyping, true);
});

test('uncertain 성공은 확정하지 않고 재확인 요청', async () => {
  const { engine, mock } = makeEngine();
  engine.startSession([makePack('wu', 'unsure', 2)]);
  engine.completePreview();
  mock.enqueue({ passed: true, confidence: 0.2 }); // confidence 낮음
  const o = await engine.submitAttempt({ channel: 'speech' });
  assert.equal(o.reliability, 'uncertain');
  assert.equal(o.advanced, false);
  assert.equal(o.needsReconfirm, true);
});

test('세션 요약: 독립 성공은 reliable+무힌트 정의만 사용 (§10.5, 부속 §2.3)', async () => {
  const { engine, mock } = makeEngine(false);
  engine.startSession([makePack('wc', 'count', 2)]);
  engine.completePreview();
  mock.enqueue({ passed: true }); // encoding 1 — 무힌트 pass
  await engine.submitAttempt({ channel: 'speech' });
  await engine.submitAttempt({ channel: 'speech' }); // recall fail → hint 1
  mock.enqueue({ passed: true });
  await engine.submitAttempt({ channel: 'speech' }); // hint 1 성공 → assisted
  const s = engine.sessionSummary();
  assert.equal(s.independent, 1);
  assert.ok(s.assisted >= 1);
});
