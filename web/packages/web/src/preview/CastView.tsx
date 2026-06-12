import { useEffect, useRef } from "react";

/**
 * Replays .cast (asciicast v1/v2/v3) recordings with asciinema-player,
 * lazy-imported so its WASM terminal core stays out of the main bundle.
 */
export function CastView({ src }: { src: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let player: { dispose: () => void } | null = null;
    let cancelled = false;
    void Promise.all([
      import("asciinema-player"),
      import("asciinema-player/dist/bundle/asciinema-player.css"),
    ]).then(([mod]) => {
      if (cancelled || !host) return;
      player = (mod as unknown as {
        create: (src: string, el: HTMLElement, opts?: object) => { dispose: () => void };
      }).create(src, host, {
        fit: "width",
        terminalFontFamily: '"JetBrains Mono Variable", monospace',
        theme: "dracula",
      });
    });
    return () => {
      cancelled = true;
      player?.dispose();
    };
  }, [src]);

  return <div ref={hostRef} className="h-full w-full [&_.ap-player]:rounded-none" />;
}
