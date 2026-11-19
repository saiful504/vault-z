"use client";

import { useRef, useState } from "react";
import NextImage from "next/image";

type Point = { x: number; y: number };

type DocumentScannerProps = {
  onChange: (image: string | null) => void;
};

const INITIAL_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 1800;
const MAX_OUTPUT_DIMENSION = 1400;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function extensionForType(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function downloadImage(dataUrl: string, filename: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row;
      }
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < 1e-8)
      throw new Error("Adjust the crop corners and try again.");
    for (let entry = column; entry <= size; entry += 1) {
      rows[column][entry] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        rows[row][entry] -= factor * rows[column][entry];
      }
    }
  }

  return rows.map((row) => row[size]);
}

function sharpen(image: ImageData, amount: number): void {
  if (amount <= 0) return;
  const { data, width, height } = image;
  const original = new Uint8ClampedArray(data);
  const strength = amount / 100;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const neighbors =
          original[center - 4 + channel] +
          original[center + 4 + channel] +
          original[center - width * 4 + channel] +
          original[center + width * 4 + channel];
        data[center + channel] =
          original[center + channel] * (1 + 4 * strength) -
          neighbors * strength;
      }
    }
  }
}

export function DocumentScanner({ onChange }: DocumentScannerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState("image/jpeg");
  const [sourceName, setSourceName] = useState("document");
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [corners, setCorners] = useState(INITIAL_CORNERS);
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
  const [clean, setClean] = useState(35);
  const [sharpness, setSharpness] = useState(25);
  const [processing, setProcessing] = useState(false);
  const [applied, setApplied] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file?: File) {
    if (!file) return;
    setError(null);
    setApplied(false);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file to scan.");
      return;
    }
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image to preserve its format.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError("Choose an image smaller than 15 MB.");
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(
        1,
        MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("This browser could not prepare the image.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const sourceData = canvas.toDataURL(
        file.type,
        file.type === "image/png" ? undefined : 0.92,
      );
      if (!sourceData.startsWith(`data:${file.type};`)) {
        throw new Error("This browser cannot preserve this image format.");
      }
      setSource(sourceData);
      setSourceType(file.type);
      setSourceName(file.name.replace(/\.[^.]+$/, "") || "document");
      setAspectRatio(canvas.width / canvas.height);
      setCorners(INITIAL_CORNERS);
      setScanResult(sourceData);
      setApplied(false);
      onChange(sourceData);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not open this image.",
      );
    }
  }

  function moveCorner(event: React.PointerEvent<SVGSVGElement>) {
    if (activeCorner === null) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(
        0,
        Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100),
      ),
      y: Math.max(
        0,
        Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100),
      ),
    };
    setCorners((current) =>
      current.map((corner, index) => (index === activeCorner ? point : corner)),
    );
    setApplied(false);
  }

  async function createScan() {
    if (!source) return;
    setProcessing(true);
    setError(null);
    try {
      const image = new Image();
      image.src = source;
      await image.decode();

      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const sourceContext = sourceCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!sourceContext)
        throw new Error("This browser could not process the image.");
      const contrast = 100 + clean * 0.42;
      const brightness = 100 + clean * 0.07;
      sourceContext.filter = `contrast(${contrast}%) brightness(${brightness}%) grayscale(${clean * 0.12}%)`;
      sourceContext.drawImage(image, 0, 0);
      sourceContext.filter = "none";
      const sourcePixels = sourceContext.getImageData(
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
      );

      const points = corners.map((point) => ({
        x: (point.x / 100) * sourceCanvas.width,
        y: (point.y / 100) * sourceCanvas.height,
      }));
      const topWidth = Math.hypot(
        points[1].x - points[0].x,
        points[1].y - points[0].y,
      );
      const bottomWidth = Math.hypot(
        points[2].x - points[3].x,
        points[2].y - points[3].y,
      );
      const leftHeight = Math.hypot(
        points[3].x - points[0].x,
        points[3].y - points[0].y,
      );
      const rightHeight = Math.hypot(
        points[2].x - points[1].x,
        points[2].y - points[1].y,
      );
      const scale = Math.min(
        1,
        MAX_OUTPUT_DIMENSION /
          Math.max(
            (topWidth + bottomWidth) / 2,
            (leftHeight + rightHeight) / 2,
          ),
      );
      const outputWidth = Math.max(
        1,
        Math.round(((topWidth + bottomWidth) / 2) * scale),
      );
      const outputHeight = Math.max(
        1,
        Math.round(((leftHeight + rightHeight) / 2) * scale),
      );
      const destination = [
        { x: 0, y: 0 },
        { x: outputWidth, y: 0 },
        { x: outputWidth, y: outputHeight },
        { x: 0, y: outputHeight },
      ];
      const equations: number[][] = [];
      const values: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const { x, y } = destination[index];
        const sourcePoint = points[index];
        equations.push([
          x,
          y,
          1,
          0,
          0,
          0,
          -x * sourcePoint.x,
          -y * sourcePoint.x,
        ]);
        values.push(sourcePoint.x);
        equations.push([
          0,
          0,
          0,
          x,
          y,
          1,
          -x * sourcePoint.y,
          -y * sourcePoint.y,
        ]);
        values.push(sourcePoint.y);
      }
      const [a, b, c, d, e, f, g, h] = solveLinearSystem(equations, values);
      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = outputWidth;
      outputCanvas.height = outputHeight;
      const outputContext = outputCanvas.getContext("2d");
      if (!outputContext)
        throw new Error("This browser could not finish the scan.");
      const outputPixels = outputContext.createImageData(
        outputWidth,
        outputHeight,
      );

      for (let y = 0; y < outputHeight; y += 1) {
        for (let x = 0; x < outputWidth; x += 1) {
          const denominator = g * x + h * y + 1;
          const sourceX = (a * x + b * y + c) / denominator;
          const sourceY = (d * x + e * y + f) / denominator;
          const x0 = Math.max(
            0,
            Math.min(sourceCanvas.width - 1, Math.floor(sourceX)),
          );
          const y0 = Math.max(
            0,
            Math.min(sourceCanvas.height - 1, Math.floor(sourceY)),
          );
          const x1 = Math.min(sourceCanvas.width - 1, x0 + 1);
          const y1 = Math.min(sourceCanvas.height - 1, y0 + 1);
          const xBlend = Math.max(0, Math.min(1, sourceX - x0));
          const yBlend = Math.max(0, Math.min(1, sourceY - y0));
          const target = (y * outputWidth + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            const upper =
              sourcePixels.data[(y0 * sourceCanvas.width + x0) * 4 + channel] *
                (1 - xBlend) +
              sourcePixels.data[(y0 * sourceCanvas.width + x1) * 4 + channel] *
                xBlend;
            const lower =
              sourcePixels.data[(y1 * sourceCanvas.width + x0) * 4 + channel] *
                (1 - xBlend) +
              sourcePixels.data[(y1 * sourceCanvas.width + x1) * 4 + channel] *
                xBlend;
            outputPixels.data[target + channel] =
              upper * (1 - yBlend) + lower * yBlend;
          }
          outputPixels.data[target + 3] = 255;
        }
      }
      sharpen(outputPixels, sharpness);
      outputContext.putImageData(outputPixels, 0, 0);
      const result = outputCanvas.toDataURL(
        sourceType,
        sourceType === "image/png" ? undefined : 0.9,
      );
      if (!result.startsWith(`data:${sourceType};`)) {
        throw new Error(
          "This browser cannot export the scan in its original format.",
        );
      }
      if (result.length > 2_000_000) {
        throw new Error(
          "This scan is too large to store. Reduce the crop area and try again.",
        );
      }
      onChange(result);
      setScanResult(result);
      setApplied(true);
      setEditorOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create the scan.",
      );
    } finally {
      setProcessing(false);
    }
  }

  function updateCorner(index: number, axis: keyof Point, value: number) {
    if (!Number.isFinite(value)) return;
    setCorners((current) =>
      current.map((corner, cornerIndex) =>
        cornerIndex === index
          ? { ...corner, [axis]: Math.max(0, Math.min(100, value)) }
          : corner,
      ),
    );
    setApplied(false);
  }

  return (
    <section className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void handleFile(file);
        }}
      />

      {source ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-emerald-900 text-xs font-semibold uppercase text-white">
              {extensionForType(sourceType)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{sourceName}</p>
              <p className="text-xs text-zinc-500">
                {applied ? "Edited scan ready" : "Original image loaded"} ·{" "}
                {extensionForType(sourceType).toUpperCase()}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="rounded-md bg-emerald-800 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {applied ? "Edit scan" : "Open editor"}
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Replace
            </button>
            {scanResult ? (
              <button
                type="button"
                onClick={() =>
                  void downloadImage(
                    scanResult,
                    `${sourceName}-scan.${extensionForType(sourceType)}`,
                  )
                }
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Download
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="m-4 flex min-h-56 w-[calc(100%-2rem)] flex-col items-center justify-center border border-dashed border-zinc-300 bg-[#f7f8f5] px-6 text-center hover:border-emerald-700 hover:bg-emerald-50/50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-emerald-950/20"
        >
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-emerald-800/20 text-xl text-emerald-800">
            +
          </span>
          <span className="text-sm font-semibold">Upload a document image</span>
          <span className="mt-1 text-xs text-zinc-500">
            JPEG, PNG, or WebP · up to 15 MB
          </span>
        </button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {editorOpen && source ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="document-editor-title"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !processing) setEditorOpen(false);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !processing)
              setEditorOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6"
        >
          <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950">
            <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div>
                <h3
                  id="document-editor-title"
                  className="text-base font-semibold"
                >
                  Edit document
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {sourceName} · output remains{" "}
                  {extensionForType(sourceType).toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close editor"
                disabled={processing}
                onClick={() => setEditorOpen(false)}
                className="flex h-9 w-9 items-center justify-center border border-zinc-300 text-lg hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                ×
              </button>
            </header>
            <div className="grid min-h-0 flex-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-h-80 items-center justify-center bg-[#e7e8e2] p-4 dark:bg-zinc-900 sm:p-6">
                <div
                  className="relative max-h-[58vh] max-w-full overflow-hidden bg-white shadow-xl"
                  style={{
                    aspectRatio,
                    width: `min(100%, ${aspectRatio * 58}vh)`,
                  }}
                >
                  <NextImage
                    src={source}
                    alt="Uploaded document to crop"
                    fill
                    unoptimized
                    sizes="(max-width: 1024px) 100vw, 900px"
                    className="object-fill"
                    style={{
                      filter: `contrast(${100 + clean * 0.42}%) brightness(${100 + clean * 0.07}%) grayscale(${clean * 0.12}%)`,
                    }}
                  />
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full touch-none"
                    onPointerMove={moveCorner}
                    onPointerUp={() => setActiveCorner(null)}
                    onPointerCancel={() => setActiveCorner(null)}
                    onLostPointerCapture={() => setActiveCorner(null)}
                  >
                    <polygon
                      points={corners.map(({ x, y }) => `${x},${y}`).join(" ")}
                      fill="rgba(35, 124, 93, 0.12)"
                      stroke="#18845e"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                    />
                    {corners.map((point, index) => (
                      <circle
                        key={index}
                        cx={point.x}
                        cy={point.y}
                        r="3.2"
                        fill="#ffffff"
                        stroke="#08734f"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                        className="cursor-move"
                        onLostPointerCapture={() => setActiveCorner(null)}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          setActiveCorner(index);
                        }}
                      />
                    ))}
                  </svg>
                  <div className="pointer-events-none absolute bottom-2 left-2 bg-black/65 px-2 py-1 text-[10px] font-medium text-white">
                    DRAG CORNERS TO FRAME
                  </div>
                </div>
              </div>
              <aside className="space-y-5 border-t border-zinc-200 p-5 lg:border-l lg:border-t-0 dark:border-zinc-800">
                <details className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
                  <summary className="cursor-pointer text-sm font-semibold marker:text-emerald-800">
                    Fine-tune corner positions
                  </summary>
                  <div className="mt-3 space-y-2">
                    {corners.map((point, index) => (
                      <fieldset
                        key={index}
                        className="grid grid-cols-[minmax(82px,1fr)_1fr_1fr] items-center gap-2"
                      >
                        <legend className="sr-only">
                          {
                            [
                              "Top left",
                              "Top right",
                              "Bottom right",
                              "Bottom left",
                            ][index]
                          }
                        </legend>
                        <span className="text-xs font-medium">
                          {
                            [
                              "Top left",
                              "Top right",
                              "Bottom right",
                              "Bottom left",
                            ][index]
                          }
                        </span>
                        {(["x", "y"] as const).map((axis) => (
                          <label key={axis} className="relative">
                            <span className="sr-only">
                              {axis.toUpperCase()} position in percent
                            </span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              value={Number(point[axis].toFixed(1))}
                              onChange={(event) =>
                                updateCorner(
                                  index,
                                  axis,
                                  Number(event.target.value),
                                )
                              }
                              className="w-full border border-zinc-300 bg-transparent py-1.5 pl-2 pr-6 text-xs tabular-nums outline-none focus:border-emerald-700 dark:border-zinc-700"
                            />
                            <span className="absolute right-2 top-1.5 text-[10px] text-zinc-400">
                              {axis.toUpperCase()}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                </details>
                <label className="block space-y-2">
                  <span className="flex justify-between text-xs font-medium">
                    <span>Clean image</span>
                    <span className="text-zinc-500">{clean}</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={clean}
                    onChange={(event) => {
                      setClean(Number(event.target.value));
                      setApplied(false);
                    }}
                    className="w-full accent-emerald-700"
                  />
                  <span className="block text-[11px] text-zinc-500">
                    Boost contrast and reduce color cast
                  </span>
                </label>
                <label className="block space-y-2">
                  <span className="flex justify-between text-xs font-medium">
                    <span>Sharpen</span>
                    <span className="text-zinc-500">{sharpness}</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sharpness}
                    onChange={(event) => {
                      setSharpness(Number(event.target.value));
                      setApplied(false);
                    }}
                    className="w-full accent-emerald-700"
                  />
                  <span className="block text-[11px] text-zinc-500">
                    Clarify small text and edges
                  </span>
                </label>
              </aside>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <p className="text-xs text-zinc-500">
                Your image is edited locally and encrypted before it is saved.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={processing}
                  onClick={() => setEditorOpen(false)}
                  className="border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void createScan()}
                  disabled={processing}
                  className="bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {processing ? "Preparing scan…" : "Apply scan"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
