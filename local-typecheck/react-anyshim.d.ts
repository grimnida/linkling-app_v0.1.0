/**
 * 샌드박스(오프라인) 타입체크 전용 느슨한 shim.
 * 실제 개발 환경에서는 @types/react가 설치되어 이 파일은 사용되지 않는다
 * (tsconfig.json의 include에 없음 — tsconfig.local.json 전용).
 */
declare module 'react' {
  export function useState<T = any>(init?: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
  export function useEffect(cb: (...a: any[]) => any, deps?: any[]): void;
  export function useMemo<T = any>(cb: () => T, deps?: any[]): T;
  export function useCallback<T = any>(cb: T, deps?: any[]): T;
  export function useRef<T = any>(init?: T | null): { current: T };
  export const StrictMode: any;
  export type ReactElement = any;
  const React: any;
  export default React;
}
declare namespace React {
  type ReactElement = any;
}
declare module 'react/jsx-runtime' {
  export const jsx: any, jsxs: any, Fragment: any;
}
declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: unknown): void };
}
declare namespace JSX {
  interface IntrinsicElements { [elem: string]: any }
  type Element = any;
}
