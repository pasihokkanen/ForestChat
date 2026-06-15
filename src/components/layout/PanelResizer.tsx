"use client";

import { useRef, useCallback } from "react";

interface PanelResizerProps {
  /** Called during drag with the delta in pixels. */
  onResize: (delta: number) => void;
}

export default function PanelResizer({ onResize }: PanelResizerProps) {
  const isDragging = useRef(false);
  const lastClientX = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      lastClientX.current = e.clientX;

      const handlePointerMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientX - lastClientX.current;
        lastClientX.current = ev.clientX;
        onResize(delta);
      };

      const handlePointerUp = () => {
        isDragging.current = false;
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
    },
    [onResize]
  );

  return (
    <div
      className="group w-4 shrink-0 cursor-col-resize relative flex items-center justify-center"
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation="vertical"
    >
      <div className="w-px h-full bg-gray-300 dark:bg-gray-600 group-hover:w-[3px] group-hover:bg-blue-400 dark:group-hover:bg-blue-500 transition-all duration-200" />
    </div>
  );
}