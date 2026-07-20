/** 샌드박스 전용 — 실제 환경에서는 @types/node 사용 */
declare module 'node:test' {
  const test: (name: string, fn: (...a: any[]) => any) => void;
  export default test;
}
declare module 'node:assert/strict' {
  const assert: any;
  export default assert;
}
declare module 'node:fs' {
  export const readdirSync: any, readFileSync: any, statSync: any, writeFileSync: any, existsSync: any, mkdirSync: any;
}
declare module 'node:path' {
  const path: any;
  export default path;
}
declare module 'node:crypto' {
  export const createHash: any;
}
