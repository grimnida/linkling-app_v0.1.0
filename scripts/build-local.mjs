/**
 * 오프라인 검증용 로컬 번들 (esbuild).
 * 표준 배포 빌드는 `npm run build`(vite)를 사용한다 — 이 스크립트는 npm 레지스트리
 * 접근이 없는 환경에서 동일 소스를 번들해 E2E를 돌리기 위한 보조 도구다.
 * @rive-app/canvas 는 미설치 시 스텁으로 대체된다 (.riv availability=ready 팩이
 * 없는 preview 단계에서는 실행 경로에 없음).
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'dist-local');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'assets'), { recursive: true });

// rive 스텁 (미설치 시)
const stubDir = path.join(ROOT, 'scripts', '.stubs');
mkdirSync(stubDir, { recursive: true });
const riveStub = path.join(stubDir, 'rive-stub.js');
writeFileSync(riveStub, `export const EventType = { RiveEvent: 'riveevent' };
export class Rive { constructor(){ throw new Error('@rive-app/canvas 미설치 — preview에서는 SVG fallback만 사용'); } }
`);

let riveResolved = false;
try {
  await import.meta.resolve?.('@rive-app/canvas');
  riveResolved = existsSync(path.join(ROOT, 'node_modules', '@rive-app', 'canvas'));
} catch { riveResolved = false; }

await build({
  entryPoints: [path.join(ROOT, 'src', 'main.tsx')],
  bundle: true,
  format: 'esm',
  outfile: path.join(OUT, 'assets', 'main.js'),
  jsx: 'automatic',
  sourcemap: true,
  define: {
    'import.meta.env.VITE_WORDPACK_CATALOG_URL': JSON.stringify(process.env.VITE_WORDPACK_CATALOG_URL ?? ''),
    'import.meta.env.VITE_RESEARCH_EXPORT': JSON.stringify(process.env.VITE_RESEARCH_EXPORT ?? ''),
    'import.meta.env': '{}',
  },
  alias: riveResolved ? {} : { '@rive-app/canvas': riveStub },
  loader: { '.css': 'css' },
  logLevel: 'info',
});

// index.html 재작성
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('<script type="module" src="/src/main.tsx"></script>',
    '<link rel="stylesheet" href="/assets/main.css" />\n    <script type="module" src="/assets/main.js"></script>');
writeFileSync(path.join(OUT, 'index.html'), html);
cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
console.log('dist-local 빌드 완료');
