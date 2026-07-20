import React, { useEffect, useRef } from 'react';
import type { LoadedPack } from '../core/types';
import type { SceneAdapter } from '../core/SceneAdapter';
import { SvgSceneController } from '../core/SvgSceneController';
import { createRiveAdapter } from '../core/RiveRuntimeAdapter';

/**
 * 장면 호스트 — .riv가 준비된 팩은 Rive, 아니면 SVG fallback (본문서 §8.6).
 * 단어별 분기 없음: 어떤 팩이든 같은 계약(SceneAdapter)으로 다뤄진다.
 */
export function SceneView(props: {
  pack: LoadedPack;
  reducedMotion: boolean;
  hidden?: boolean; // §5.2 첫 노출 등 이미지 숨김 단계
  onReady: (adapter: SceneAdapter) => void;
  onError: (messageKo: string) => void;
}): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<SceneAdapter | null>(null);
  const { pack, onReady, onError } = props;

  useEffect(() => {
    let disposed = false;
    async function init(): Promise<void> {
      const host = hostRef.current;
      if (!host) return;
      try {
        let adapter: SceneAdapter;
        const scene = pack.manifest.scene;
        if (scene.availability === 'ready' && scene.riv_path && canvasRef.current) {
          adapter = await createRiveAdapter(
            canvasRef.current, pack.assetUrl(scene.riv_path), pack.manifest, pack.wordpack,
          );
        } else if (scene.fallback_svg_path) {
          const res = await fetch(pack.assetUrl(scene.fallback_svg_path));
          if (!res.ok) throw new Error(`SVG ${res.status}`);
          adapter = new SvgSceneController(host, await res.text(), pack.wordpack);
        } else {
          throw new Error('장면 자산 없음');
        }
        if (disposed) { adapter.dispose(); return; }
        adapter.setReducedMotion(props.reducedMotion);
        adapterRef.current = adapter;
        onReady(adapter);
      } catch {
        if (!disposed) onError(`"${pack.wordpack.word}" 장면을 불러오지 못했습니다.`);
      }
    }
    void init();
    return () => {
      disposed = true;
      adapterRef.current?.dispose(); // Rive dispose·메모리 누수 방지 (§12.4)
      adapterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.entry.word_id, pack.entry.wordpack_version]);

  useEffect(() => {
    adapterRef.current?.setReducedMotion(props.reducedMotion);
  }, [props.reducedMotion]);

  const useRive = pack.manifest.scene.availability === 'ready' && !!pack.manifest.scene.riv_path;
  return (
    <div className={`scene-view${props.hidden ? ' scene-hidden' : ''}`} aria-label={`${pack.wordpack.word} 학습 장면`}>
      {useRive
        ? <canvas ref={canvasRef} className="scene-canvas" width={960} height={540} />
        : <div ref={hostRef} className="scene-svg-host" />}
    </div>
  );
}
