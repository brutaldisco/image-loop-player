import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadSession, saveSession, type SessionImage } from "./storage";

type ImageItem = {
  id: string;
  name: string;
  url: string;
  dataUrl: string;
};

const MIN_INTERVAL = 16;
const MAX_INTERVAL = 10_000;
const MAX_IMAGES = 50;
const PRESETS = [50, 100, 250, 500];
const SAVE_DEBOUNCE_MS = 400;

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [intervalMs, setIntervalMs] = useState(100);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [isFullscreenSupported, setIsFullscreenSupported] = useState(true);
  const isiOS = useMemo(
    () => /iP(hone|od|ad)/.test(globalThis.navigator?.platform ?? "") || /Mac/.test(globalThis.navigator?.userAgent ?? "") && "ontouchend" in document,
    [],
  );

  const timeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const prevUrls = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  const currentImage = images[currentIndex];

  const clampedInterval = useMemo(
    () => Math.min(Math.max(intervalMs, MIN_INTERVAL), MAX_INTERVAL),
    [intervalMs],
  );

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const dataUrlToObjectUrl = async (dataUrl: string) => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await loadSession();
        if (!session || cancelled) return;
        const restored = await Promise.all(
          session.images.slice(0, MAX_IMAGES).map(async (img) => ({
            ...img,
            url: await dataUrlToObjectUrl(img.dataUrl),
          })),
        );
        setImages(restored);
        setIntervalMs(
          Math.min(Math.max(session.intervalMs ?? 100, MIN_INTERVAL), MAX_INTERVAL),
        );
      } catch (err) {
        console.error("Failed to load session", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const currentUrls = images.map((img) => img.url);
    prevUrls.current.forEach((url) => {
      if (!currentUrls.includes(url)) {
        URL.revokeObjectURL(url);
      }
    });
    prevUrls.current = currentUrls;
  }, [images]);

  useEffect(() => {
    return () => {
      prevUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    images.forEach((img) => {
      const preload = new Image();
      preload.src = img.url;
    });
  }, [images]);

  useEffect(() => {
    const elem = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };
    const supported =
      Boolean(document.fullscreenEnabled) ||
      Boolean(elem.requestFullscreen) ||
      Boolean(elem.webkitRequestFullscreen) ||
      Boolean(elem.msRequestFullscreen);
    setIsFullscreenSupported(supported);

    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (
        target &&
        (target.isContentEditable ||
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          tag === "option" ||
          tag === "button")
      ) {
        return;
      }
      event.preventDefault();
      if (images.length === 0) return;
      if (isPlaying) {
        handleStop();
      } else {
        handleStart();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isPlaying, images.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const payload: { intervalMs: number; images: SessionImage[] } = {
        intervalMs: clampedInterval,
        images: images.map(({ id, name, dataUrl }) => ({ id, name, dataUrl })),
      };
      saveSession(payload).catch((err) => console.error("Failed to save session", err));
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [images, clampedInterval]);

  useEffect(() => {
    if (!isPlaying || images.length === 0) {
      clearTimers();
      return;
    }

    const useRaf = clampedInterval <= 32;
    let start = performance.now();

    if (useRaf) {
      const step = (now: number) => {
        if (!isPlaying) return;
        if (now - start >= clampedInterval) {
          setCurrentIndex((idx) => (idx + 1) % images.length);
          start = now;
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    } else {
      const tick = () => {
        setCurrentIndex((idx) => (idx + 1) % images.length);
        timeoutRef.current = window.setTimeout(tick, clampedInterval);
      };
      timeoutRef.current = window.setTimeout(tick, clampedInterval);
    }

    return () => clearTimers();
    // clampedInterval already derived from intervalMs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, images.length, clampedInterval]);

  const clearTimers = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const currentCount = images.length;
    const available = Math.max(0, MAX_IMAGES - currentCount);
    const selected = Array.from(files).slice(0, available);

    const next = await Promise.all(
      selected.map(async (file): Promise<ImageItem> => {
        const dataUrl = await fileToDataUrl(file);
        return {
          id: crypto.randomUUID(),
          name: file.name,
          url: URL.createObjectURL(file),
          dataUrl,
        };
      }),
    );

    if (selected.length < files.length) {
      alert(`最大 ${MAX_IMAGES} 枚までです。先頭 ${selected.length} 枚を追加しました。`);
    }

    setImages((prev) => [...prev, ...next]);
    setCurrentIndex((idx) => (idx >= 0 ? idx : 0));
  };

  const handleRemove = (id: string) => {
    setImages((prev) => {
      const next = prev.filter((img) => img.id !== id);
      setCurrentIndex((idx) => {
        if (next.length === 0) return 0;
        return idx >= next.length ? 0 : idx;
      });
      return next;
    });
  };

  const handleStart = () => {
    if (images.length === 0) return;
    setIsPlaying(true);
  };

  const handleStop = () => {
    setIsPlaying(false);
    clearTimers();
  };

  const handleIntervalChange = (value: number) => {
    const clamped = Math.min(Math.max(value, MIN_INTERVAL), MAX_INTERVAL);
    setIntervalMs(clamped);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    void handleFiles(event.dataTransfer?.files);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const onDragStart = (index: number) => {
    dragItem.current = index;
  };

  const onDragEnter = (index: number) => {
    dragOverItem.current = index;
  };

  const onDragEnd = () => {
    const start = dragItem.current;
    const end = dragOverItem.current;
    dragItem.current = null;
    dragOverItem.current = null;

    if (start === null || end === null || start === end) return;

    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(start, 1);
      next.splice(end, 0, moved);
      return next;
    });
    setCurrentIndex(0);
  };

  useEffect(() => {
    if (isPseudoFullscreen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  }, [isPseudoFullscreen]);

  const toggleFullscreen = async () => {
    const target = playerContainerRef.current;
    if (!target) return;
    const active = isFullscreen || isPseudoFullscreen;

    // iOS SafariはFullscreen APIが基本的に非対応なので疑似フルスクリーンへフォールバック
    if (!isFullscreenSupported || isiOS) {
      setIsPseudoFullscreen(!active);
      return;
    }

    try {
      if (!document.fullscreenElement) {
        const el = target as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>;
          msRequestFullscreen?: () => Promise<void>;
        };
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        } else if (el.msRequestFullscreen) {
          await el.msRequestFullscreen();
        } else {
          setIsPseudoFullscreen(!active);
        }
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen toggle failed", err);
      setIsPseudoFullscreen(!active);
    }
  };

  const fullscreenActive = isFullscreen || isPseudoFullscreen;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-slate-100">
              IMAGE LOOP PLAYER
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span className="flex items-center gap-2 rounded-full border border-slate-800 px-3 py-1">
              <span
                className={`h-2 w-2 rounded-full ${
                  isPlaying ? "bg-emerald-400" : "bg-slate-500"
                }`}
              />
              {isPlaying ? "再生中" : "停止中"}
            </span>
            <span className="rounded-full border border-slate-800 px-3 py-1">
              最短 {MIN_INTERVAL}ms / 最大 {MAX_INTERVAL}ms
            </span>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div
            ref={playerContainerRef}
            className={`glass-panel relative flex aspect-video cursor-pointer items-center justify-center overflow-hidden border transition ${
              isDragOver ? "border-emerald-400/80" : "border-slate-800/80"
            } ${
              isPseudoFullscreen
                ? "fixed inset-0 z-50 m-0 aspect-auto h-[100dvh] w-screen rounded-none border-0 bg-slate-950 p-4 overflow-auto touch-pan-y"
                : ""
            }`}
            style={
              isPseudoFullscreen
                ? {
                    paddingTop: "env(safe-area-inset-top)",
                    paddingBottom: "env(safe-area-inset-bottom)",
                    paddingLeft: "env(safe-area-inset-left)",
                    paddingRight: "env(safe-area-inset-right)",
                  }
                : undefined
            }
            onClick={openFileDialog}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {currentImage ? (
              <img
                key={currentImage.id}
                src={currentImage.url}
                alt={currentImage.name}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <p>クリックまたはドラッグ＆ドロップで画像を追加</p>
                <p className="text-xs">jpg / png / webp ・ 最大 {MAX_IMAGES} 枚</p>
              </div>
            )}
            {currentImage && (
              <div className="absolute right-3 top-3 rounded-full bg-slate-900/70 px-3 py-1 text-xs text-slate-200">
                {currentIndex + 1} / {images.length}
              </div>
            )}
            {isPseudoFullscreen && (
              <button
                type="button"
                onClick={toggleFullscreen}
                className="fixed right-4 top-4 z-50 rounded-full bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-100 shadow-lg backdrop-blur hover:bg-slate-800"
              >
                Exit Full
              </button>
            )}
          </div>

          <div className="glass-panel flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={handleStart}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={images.length === 0}
              >
                Start
              </button>
              <button
                type="button"
                onClick={handleStop}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-500"
              >
                Stop
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                  fullscreenActive
                    ? "border-emerald-400 text-emerald-200"
                    : "border-slate-700 text-slate-100 hover:border-slate-500"
                } ${isFullscreenSupported ? "" : "opacity-80"}`}
              >
                {fullscreenActive ? "Exit Full" : isFullscreenSupported ? "Fullscreen" : "Fill Screen"}
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>表示間隔（ms）</span>
                <span className="text-slate-400">
                  実効精度は環境依存 / 最短 {MIN_INTERVAL}ms
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={MIN_INTERVAL}
                  max={MAX_INTERVAL}
                  value={intervalMs}
                  onChange={(e) => handleIntervalChange(Number(e.target.value) || MIN_INTERVAL)}
                  className="w-28 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleIntervalChange(preset)}
                      className={`rounded-md border px-3 py-1 text-xs ${
                        intervalMs === preset
                          ? "border-emerald-400 text-emerald-300"
                          : "border-slate-800 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      {preset}ms
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="range"
                min={MIN_INTERVAL}
                max={MAX_INTERVAL}
                step={1}
                value={intervalMs}
                onChange={(e) => handleIntervalChange(Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>
          </div>
        </section>

        <section className="glass-panel p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between text-sm text-slate-300">
            <span>画像リスト（ドラッグで並び替え / 個別削除）</span>
            <span className="text-slate-500">
              {images.length} / {MAX_IMAGES} 枚
            </span>
          </div>
          {images.length === 0 ? (
            <p className="text-sm text-slate-500">画像を追加するとここに表示されます。</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((img, index) => (
                <div
                  key={img.id}
                  draggable
                  onDragStart={() => onDragStart(index)}
                  onDragEnter={() => onDragEnter(index)}
                  onDragEnd={onDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                  className="group relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70 shadow hover:border-emerald-400"
                >
                  <img src={img.url} alt={img.name} className="h-36 w-full object-cover" />
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-200">
                    <span className="truncate" title={img.name}>
                      {img.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemove(img.id)}
                      className="rounded-md px-2 py-1 text-red-300 opacity-80 transition hover:bg-red-500/10 hover:opacity-100"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
