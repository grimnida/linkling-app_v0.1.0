import { test, expect, type Page } from '@playwright/test';

/**
 * 배포 프리뷰 간 원격 연동 E2E (본문서 §12.3)
 * - 앱 preview가 wordpacks preview catalog를 CORS 오류 없이 로드
 * - facilitate·melt 포함 Wave 1을 같은 엔진으로 완주 (단어별 새 코드 없음)
 */
const APP_URL = process.env.APP_URL ?? 'http://localhost:8800';
const CATALOG_URL = process.env.CATALOG_URL ?? 'http://localhost:8801/catalog.json';

async function clickIf(page: Page, name: string): Promise<boolean> {
  const btn = page.getByRole('button', { name, exact: false }).first();
  if (await btn.count() > 0 && await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) {
    await btn.click();
    return true;
  }
  return false;
}

test('Wave 1 전체가 원격 catalog에서 로드되어 완주된다', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`${APP_URL}/?nosw=1&catalog=${encodeURIComponent(CATALOG_URL)}`);
  await page.getByRole('button', { name: '학습 시작' }).waitFor({ timeout: 20_000 });

  // 검수 오디오 준비 전: TTS 지연 제거 (preview 한정)
  await page.evaluate(() => {
    // @ts-expect-error 테스트 전용
    window.speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(new Event('end')), 30);
  });
  await page.getByRole('button', { name: '학습 시작' }).click();

  const seenWords = new Set<string>();
  for (let i = 0; i < 600; i++) {
    if (await page.locator('.summary-screen').count() > 0) break;
    const header = page.locator('.learn-header span').first();
    if (await header.count() > 0) {
      const w = ((await header.textContent()) ?? '').split('·')[0].trim();
      if (w) seenWords.add(w);
    }
    if (await clickIf(page, '다음 단어')) continue;
    if (await page.locator('.meaning').count() > 0 && await page.locator('.spelling-block').count() === 0) {
      await page.locator('.meaning').click(); continue;
    }
    if (await page.locator('.bubble').count() > 0) { await page.locator('.bubble').click(); continue; }
    if (await clickIf(page, '다음')) continue;
    if (await clickIf(page, '🎤 정확히 말했어요')) continue;
    await page.waitForTimeout(250);
  }

  await expect(page.locator('.summary-screen')).toBeVisible();
  expect(seenWords.has('facilitate')).toBe(true);
  expect(seenWords.has('melt')).toBe(true);
  expect(consoleErrors.filter((e) => /CORS|cross-origin/i.test(e))).toHaveLength(0);
});
