import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { TelemetryLogger } from '../../src/core/TelemetryLogger';

/**
 * 낙인·진단·생물학 인과 문구 0건 스캔 (부속 명세 §2.5 — 절대 규칙, §7 QA-7).
 * 금지 문구는 스캔 대상에 문자열이 남지 않도록 조각으로 조합한다.
 */
const BANNED: string[] = [
  ['암기력', ' 부족'].join(''),
  ['집중력', ' 부족'].join(''),
  ['주의력', ' 결핍'].join(''),
  ['난', '독'].join(''),
  ['학습', ' 장애'].join(''),
  ['도파', '민'].join(''),
  ['불안', '장애'].join(''),
  ['머리가', ' 나쁘'].join(''),
  ['AD', 'HD'].join(''),
  ['dysle', 'xia'].join(''),
  ['dopa', 'mine'].join(''),
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(HERE, '../../src');
const PUBLIC = path.resolve(HERE, '../../public');

test('src·public 전체에 낙인·진단 문구 0건', () => {
  const files = [...walk(SRC), ...walk(PUBLIC)];
  assert.ok(files.length > 10);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const phrase of BANNED) {
      assert.ok(!text.includes(phrase), `${f} 에 금지 문구 "${phrase}" 존재`);
    }
  }
});

test('단어별 런타임 분기 금지: 엔진 코드에 Wave 1 단어 하드코딩 없음 (§6·§13)', () => {
  const wave1 = ['facilitate', 'contaminate', 'flourish', 'telescope', 'compass', 'opportunity', 'hesitant', 'carefully', 'frequently'];
  for (const f of walk(SRC)) {
    const text = readFileSync(f, 'utf8').toLowerCase();
    for (const w of wave1) {
      assert.ok(!text.includes(w), `${f} 에 단어 "${w}" 하드코딩`);
    }
    // 'melt'는 일반 영단어 조각과 겹치기 쉬우므로 word_id 형태로 검사
    assert.ok(!text.includes('melt_v_01'), `${f} 에 word_id 하드코딩`);
    assert.ok(!text.includes('facilitate_v_01'), `${f} 에 word_id 하드코딩`);
  }
});

test('연구 내보내기 파일명 날짜는 Asia/Seoul 기준 (§7 QA-9)', () => {
  const t = new TelemetryLogger(false);
  const { filename } = t.exportForResearch();
  const seoulToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  assert.equal(filename, `linkling_session_${seoulToday}.json`);
});

test('파생 요약은 관찰 값만 담는다 (진단·꼬리표 필드 없음)', () => {
  const t = new TelemetryLogger(false);
  const counts = t.sessionCounts();
  assert.deepEqual(Object.keys(counts).sort(), ['assisted', 'independent', 'invalidChannel']);
});
