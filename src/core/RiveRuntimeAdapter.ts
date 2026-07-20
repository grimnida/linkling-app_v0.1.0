/**
 * RiveRuntimeAdapter — 실제 .riv drop-in 구조 (본문서 §6·§8.6).
 *
 * manifest.scene.availability === 'ready' 이고 .riv 로드가 성공했을 때만 사용된다.
 * 그 외에는 항상 SvgSceneController(fallback)가 사용된다.
 * @rive-app/canvas 는 지연 로드한다 — .riv가 없는 배포에서는 번들 실행 경로에 없다.
 *
 * 계약 검증: LinklingWordpackSM 존재, 필수 input 존재. 위반 시 로드 실패로 처리해
 * 조용히 다른 동작으로 빠지지 않고 호출자에게 오류를 돌려준다.
 */
import type { PackManifest, RuntimeWordpack } from './types';
import type { SceneAdapter, SceneEvent, SceneEventName } from './SceneAdapter';

const REQUIRED_INPUTS = [
  'layer_stage', 'final_pass', 'full_audio_complete', 'label_stage',
  'meaning_absorb', 'replay_final', 'reset', 'reduced_motion',
] as const;

const CONTRACT_EVENTS: SceneEventName[] = [
  'request_full_audio', 'final_animation_complete', 'bubble_visible',
  'meaning_visible', 'spelling_visible', 'layer_revealed',
];

type RiveModule = typeof import('@rive-app/canvas');

export async function createRiveAdapter(
  canvas: HTMLCanvasElement,
  rivUrl: string,
  manifest: PackManifest,
  wordpack: RuntimeWordpack,
): Promise<SceneAdapter> {
  const mod: RiveModule = await import('@rive-app/canvas');
  return new Promise((resolve, reject) => {
    const rive = new mod.Rive({
      src: rivUrl,
      canvas,
      artboard: manifest.scene.artboard,
      stateMachines: 'LinklingWordpackSM',
      autoplay: true,
      onLoad: () => {
        try {
          const inputs = rive.stateMachineInputs('LinklingWordpackSM');
          if (!inputs || inputs.length === 0) {
            throw new Error('LinklingWordpackSM 상태 머신이 없습니다');
          }
          const byName = new Map(inputs.map((i) => [i.name, i]));
          for (const name of REQUIRED_INPUTS) {
            if (!byName.has(name)) throw new Error(`필수 input "${name}" 없음`);
          }
          resolve(new RiveAdapterImpl(rive, byName, mod));
        } catch (e) {
          rive.cleanup();
          reject(e);
        }
      },
      onLoadError: () => reject(new Error(`.riv 로드 실패: ${rivUrl}`)),
    });
  });
}

class RiveAdapterImpl implements SceneAdapter {
  private listeners = new Set<(e: SceneEvent) => void>();
  private layerStage = 0;

  constructor(
    private readonly rive: InstanceType<RiveModule['Rive']>,
    private readonly inputs: Map<string, { name: string; value?: unknown; fire?: () => void }>,
    mod: RiveModule,
  ) {
    this.rive.on(mod.EventType.RiveEvent, (event: unknown) => {
      const data = (event as { data?: { name?: string; properties?: Record<string, unknown> } }).data;
      const name = data?.name as SceneEventName | undefined;
      if (name && CONTRACT_EVENTS.includes(name)) {
        this.emit({ name, payload: data?.properties?.word_id as string ?? data?.properties?.layer_order as number });
      }
    });
  }

  private setNumber(name: string, v: number): void {
    const input = this.inputs.get(name);
    if (input) (input as { value: number }).value = v;
  }

  private fire(name: string): void {
    const input = this.inputs.get(name);
    if (input?.fire) input.fire();
  }

  setLayerStage(stage: number): void {
    if (stage < this.layerStage) return;
    this.layerStage = stage;
    this.setNumber('layer_stage', stage);
  }
  getLayerStage(): number { return this.layerStage; }
  setLabelStage(stage: number): void { this.setNumber('label_stage', stage); }
  triggerFinalPass(): void { this.fire('final_pass'); }
  triggerFullAudioComplete(): void { this.fire('full_audio_complete'); }
  triggerMeaningAbsorb(): void { this.fire('meaning_absorb'); }
  triggerReplayFinal(): void { this.fire('replay_final'); }
  triggerReset(): void { this.layerStage = 0; this.fire('reset'); }
  setReducedMotion(value: boolean): void {
    const input = this.inputs.get('reduced_motion');
    if (input) (input as { value: boolean }).value = value;
  }
  onEvent(cb: (e: SceneEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(e: SceneEvent): void { for (const cb of this.listeners) cb(e); }
  dispose(): void {
    this.listeners.clear();
    this.rive.cleanup(); // 메모리 누수·Rive dispose (본문서 §12.4)
  }
}
