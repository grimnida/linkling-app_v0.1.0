import { defineConfig } from '@playwright/test';

/**
 * 원격 배포 E2E (본문서 §12.3)
 * 사용:
 *   APP_URL=https://<app-preview>.netlify.app \
 *   CATALOG_URL=https://<wordpacks-preview>.netlify.app/catalog.json \
 *   npm run test:e2e
 * 로컬 오프라인 검증은 `node tests/e2e/run-e2e.mjs` 사용.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  use: {
    viewport: { width: 420, height: 860 },
  },
});
