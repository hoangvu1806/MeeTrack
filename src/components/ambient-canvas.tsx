"use client";

import { useEffect, useRef } from "react";

// Adapted from OriginKit's Reactive Grid for a desktop glass backdrop:
// https://www.originkit.dev/components/reactivegrid
const FRAME_INTERVAL = 1000 / 24;
const MAX_PIXEL_RATIO = 1.25;
const CELL = 64;
const INFLUENCE = 270;
const MIN_SIZE = 1.4;
const MAX_SIZE = 18;

type Point = { x: number; y: number };

export function AmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer: Point = { x: 0, y: 0 };
    const focus: Point = { x: 0, y: 0 };
    let pointerSeenAt = -Infinity;
    let width = 0;
    let height = 0;
    let columns = 0;
    let rows = 0;
    let sizes = new Float32Array(0);
    let frame = 0;
    let lastFrame = performance.now();
    let isDark = document.documentElement.dataset.theme === "dark";

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      columns = Math.ceil(width / CELL) + 1;
      rows = Math.ceil(height / CELL) + 1;
      sizes = new Float32Array(columns * rows).fill(MIN_SIZE);
      focus.x = pointer.x = width * 0.56;
      focus.y = pointer.y = height * 0.44;
    };

    const drawRoundedSquare = (x: number, y: number, size: number) => {
      const half = size / 2;
      context.beginPath();
      context.roundRect(x - half, y - half, size, size, Math.min(3.5, half));
      context.fill();
    };

    const paint = (now: number, settle = true) => {
      context.clearRect(0, 0, width, height);

      const followingPointer = now - pointerSeenAt < 2400;
      const ambientTargetX = width * (0.5 + Math.cos(now * 0.000055) * 0.24);
      const ambientTargetY = height * (0.48 + Math.sin(now * 0.000043) * 0.24);
      const targetX = followingPointer ? pointer.x : ambientTargetX;
      const targetY = followingPointer ? pointer.y : ambientTargetY;
      const follow = settle ? (followingPointer ? 0.16 : 0.035) : 1;
      focus.x += (targetX - focus.x) * follow;
      focus.y += (targetY - focus.y) * follow;

      const offsetX = (width - (columns - 1) * CELL) / 2;
      const offsetY = (height - (rows - 1) * CELL) / 2;
      const baseColor = isDark ? "#dce1de" : "#202521";
      const accentColor = isDark ? "#51d7a2" : "#137d59";

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          const x = offsetX + column * CELL;
          const y = offsetY + row * CELL;
          const distance = Math.hypot(x - focus.x, y - focus.y);
          const proximity = Math.max(0, 1 - distance / INFLUENCE);
          const eased = proximity * proximity * (3 - 2 * proximity);
          const targetSize = MIN_SIZE + (MAX_SIZE - MIN_SIZE) * eased;
          sizes[index] += (targetSize - sizes[index]) * (settle ? 0.18 : 1);

          const accent = eased > 0.4;
          context.fillStyle = accent ? accentColor : baseColor;
          context.globalAlpha = accent
            ? 0.12 + eased * 0.18
            : (isDark ? 0.08 : 0.065) + eased * 0.055;
          drawRoundedSquare(x, y, sizes[index]);
        }
      }

      context.globalAlpha = 1;
    };

    const animate = (now: number) => {
      frame = window.requestAnimationFrame(animate);
      if (now - lastFrame < FRAME_INTERVAL) return;
      lastFrame = now;
      paint(now);
    };

    const syncAnimation = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = performance.now();

      if (document.hidden || reducedMotion.matches) {
        paint(lastFrame, false);
        return;
      }
      frame = window.requestAnimationFrame(animate);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointerSeenAt = performance.now();
      if (reducedMotion.matches) paint(pointerSeenAt, false);
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      paint(performance.now(), false);
    });
    const themeObserver = new MutationObserver(() => {
      isDark = document.documentElement.dataset.theme === "dark";
      paint(performance.now(), false);
    });

    resize();
    paint(performance.now(), false);
    resizeObserver.observe(canvas);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", syncAnimation);
    reducedMotion.addEventListener("change", syncAnimation);
    syncAnimation();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", syncAnimation);
      reducedMotion.removeEventListener("change", syncAnimation);
    };
  }, []);

  return <canvas ref={canvasRef} className="ambient-canvas" aria-hidden="true" />;
}
