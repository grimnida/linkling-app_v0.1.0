/**
 * @rive-app/canvas 최소 타입 선언 (RiveRuntimeAdapter가 사용하는 표면만).
 * 실제 패키지 설치 시 패키지 타입이 우선하도록 최소로 유지한다.
 */
declare module '@rive-app/canvas' {
  export enum EventType { RiveEvent = 'riveevent' }
  export interface StateMachineInput { name: string; value?: unknown; fire?: () => void }
  export class Rive {
    constructor(opts: {
      src: string;
      canvas: HTMLCanvasElement;
      artboard?: string;
      stateMachines?: string | string[];
      autoplay?: boolean;
      onLoad?: () => void;
      onLoadError?: () => void;
    });
    stateMachineInputs(name: string): StateMachineInput[];
    on(type: EventType, cb: (event: unknown) => void): void;
    cleanup(): void;
  }
}
