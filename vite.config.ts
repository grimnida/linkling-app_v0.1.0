import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 단어팩 도메인은 소스에 하드코딩하지 않는다.
// VITE_WORDPACK_CATALOG_URL 은 Netlify 환경 변수로 주입한다 (본문서 §8.2, §9).
export default defineConfig({
  plugins: [react()],
  build: { sourcemap: true },
});
