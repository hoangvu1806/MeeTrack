"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Maximize2, Minus, X } from "lucide";
import type { TranslationKey } from "@/lib/i18n";
import { UiIcon } from "./ui-icon";

type WindowAction = "minimize" | "maximize" | "close";
type Translator = (key: TranslationKey) => string;

export function WindowTitlebar({ t }: { t: Translator }) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let cleanup: undefined | (() => void);

    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      if (!cancelled) setIsMaximized(await appWindow.isMaximized());
      const unlisten = await appWindow.onResized(async () => {
        if (!cancelled) setIsMaximized(await appWindow.isMaximized());
      });
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const runWindowAction = useCallback(async (action: WindowAction) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "maximize") await appWindow.toggleMaximize();
    if (action === "close") await appWindow.close();
  }, []);

  return (
    <header className="window-titlebar">
      <div className="window-drag-area" data-tauri-drag-region>
        <div className="window-brand" data-tauri-drag-region>
          <img className="brand-symbol" src="/logo.png" alt="" data-tauri-drag-region />
          <span data-tauri-drag-region>MeeTrack</span>
        </div>
        <span className="titlebar-divider" data-tauri-drag-region />
        <span className="titlebar-workspace" data-tauri-drag-region>{t("workspace")}</span>
        <span className="local-badge" data-tauri-drag-region><i data-tauri-drag-region />{t("local")}</span>
      </div>

      <div className="window-controls" aria-label="Window controls">
        <button className="window-control" type="button" aria-label={t("minimize")} title={t("minimize")} onClick={() => void runWindowAction("minimize")}>
          <UiIcon icon={Minus} size={15} strokeWidth={1.65} />
        </button>
        <button className="window-control" type="button" aria-label={t("maximize")} title={t("maximize")} onClick={() => void runWindowAction("maximize")}>
          <UiIcon icon={isMaximized ? Copy : Maximize2} size={14} strokeWidth={1.55} />
        </button>
        <button className="window-control window-control--close" type="button" aria-label={t("close")} title={t("close")} onClick={() => void runWindowAction("close")}>
          <UiIcon icon={X} size={15} strokeWidth={1.65} />
        </button>
      </div>
    </header>
  );
}
