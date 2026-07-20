/**
 * 원격 배포 구조 E2E (본문서 §12.3 축소판 — 로컬 두 서버로 cross-origin 재현)
 *  - 앱 서버(:8800)와 단어팩 서버(:8801)를 분리 기동 (별도 origin → CORS 경로 검증)
 *  - facilitate·melt를 포함한 Wave 1 10개 전부를 같은 엔진으로 완주
 *  - 단어별 새 코드 없음: 어떤 팩이든 동일한 화면 요소·동일한 조작으로 진행된다
 *
 * 실행: node tests/e2e/run-e2e.mjs [--words=all|2]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const APP_DIST = path.resolve(new URL('../../dist-local', import.meta.url).pathname);
const PACKS_DIST = process.env.WORDPACKS_DIST
  ?? path.resolve(new URL('../../../linkling-wordpacks/dist', import.meta.url).pathname);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.map': 'application/json', '.aac': 'audio/aac' };

function serve(root, port, { cors = false, spa = false } = {}) {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (spa) file = path.join(root, 'index.html');
      else { res.writeHead(404); res.end('nf'); return; }
    }
    const headers = { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' };
    if (cors) headers['access-control-allow-origin'] = '*';
    res.writeHead(200, headers);
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const appServer = await serve(APP_DIST, 8800, { spa: true });
const packServer = await serve(PACKS_DIST, 8801, { cors: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

await page.goto('http://localhost:8800/?nosw=1&catalog=http://localhost:8801/catalog.json');
await page.getByRole('button', { name: '학습 시작' }).waitFor({ timeout: 15000 });
log('카탈로그 로드 OK (cross-origin)');

// TTS 지연 제거: speechSynthesis를 즉시 완료로 대체 (오디오 파일은 검수 전이라 없음)
await page.evaluate(() => {
  window.speechSynthesis.speak = (u) => { setTimeout(() => u.onend && u.onend(new Event('end')), 30); };
});

await page.getByRole('button', { name: '학습 시작' }).click();

const seenWords = new Set();
const seenSteps = new Set();
let actions = 0;
const MAX_ACTIONS = 600;

while (actions++ < MAX_ACTIONS) {
  // 요약 도달?
  if (await page.locator('.summary-screen').count() > 0) break;

  const header = page.locator('.learn-header span').first();
  if (await header.count() > 0) {
    const word = (await header.textContent() ?? '').split('·')[0].trim();
    if (word) seenWords.add(word);
  }
  const stepLabel = await page.locator('.step-label').textContent().catch(() => null);
  if (stepLabel) seenSteps.add(stepLabel.trim());

  if (await clickIf('다음 단어')) { log(`단어 완료 (${[...seenWords].length}개째 진행 중)`); continue; }
  if (await page.locator('.meaning').count() > 0 && await page.locator('.spelling-block').count() === 0) {
    await page.locator('.meaning').click(); continue;
  }
  if (await page.locator('.bubble').count() > 0) { await page.locator('.bubble').click(); continue; }
  if (await clickIf('다음')) continue;
  if (await clickIf('🎤 정확히 말했어요')) continue;
  await page.waitForTimeout(250);
}

if (await page.locator('.summary-screen').count() === 0) {
  throw new Error(`요약 화면 미도달 (actions=${actions}) — 마지막 화면: ${await page.content().then((c) => c.slice(0, 500))}`);
}

async function clickIf(name) {
  const btn = page.getByRole('button', { name, exact: false }).first();
  if (await btn.count() > 0 && await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) {
    await btn.click();
    return true;
  }
  return false;
}

const summaryText = await page.locator('.summary-screen').textContent();
log(`요약 도달 — 학습 단어 ${seenWords.size}개: ${[...seenWords].join(', ')}`);
log(`거친 단계: ${[...seenSteps].join(' / ')}`);

// 검증
const EXPECTED = ['facilitate', 'melt', 'contaminate', 'flourish', 'telescope', 'compass', 'opportunity', 'hesitant', 'carefully', 'frequently'];
const missing = EXPECTED.filter((w) => !seenWords.has(w));
if (missing.length) throw new Error(`미완주 단어: ${missing.join(', ')}`);
for (const label of ['소리 먼저 듣기', '소리 따라 하기', '떠올려 말하기', '전체 단어 말하기', '의미 만나기']) {
  if (!seenSteps.has(label)) throw new Error(`단계 미경유: ${label}`);
}
if (!/혼자 힘으로 떠올린 횟수/.test(summaryText)) throw new Error('요약 항목 누락');
const corsErrors = consoleErrors.filter((e) => /CORS|cross-origin/i.test(e));
if (corsErrors.length) throw new Error(`CORS 오류: ${corsErrors[0]}`);

console.log('\nE2E PASS — Wave 1 10개 전부 동일 엔진으로 완주, CORS 오류 0건');
console.log(`콘솔 오류(참고): ${consoleErrors.length ? consoleErrors.slice(0, 5).join(' | ') : '없음'}`);

await browser.close();
appServer.close();
packServer.close();
