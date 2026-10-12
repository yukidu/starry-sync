export type ThumbnailCandidate = {
  at: number;
  preview: string;
  localScore: number;
  role: 'intro' | 'content' | 'outro';
};

const PREVIEW_WIDTH = 512;
const PREVIEW_HEIGHT = 288;
const FINAL_WIDTH = 1280;
const FINAL_HEIGHT = 720;

function waitForMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1 && Number.isFinite(video.duration)) return resolve();
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('無法讀取影片資訊')); };
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function seek(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => {
      cleanup();
      requestAnimationFrame(() => resolve());
    };
    const onError = () => { cleanup(); reject(new Error('讀取影片畫格失敗')); };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.05)));
  });
}

function drawCover(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('瀏覽器無法建立縮圖畫布');
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const scale = Math.max(canvas.width / vw, canvas.height / vh);
  const sw = canvas.width / scale;
  const sh = canvas.height / scale;
  const sx = Math.max(0, (vw - sw) / 2);
  const sy = Math.max(0, (vh - sh) / 2);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return ctx;
}

function localQuality(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const step = 4;
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  let previousRow = new Float32Array(Math.ceil(width / step));

  for (let y = 0; y < height; y += step) {
    let previous = -1;
    let xSlot = 0;
    const currentRow = new Float32Array(Math.ceil(width / step));
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      currentRow[xSlot] = gray;
      sum += gray;
      sumSq += gray * gray;
      count++;
      if (previous >= 0) { edgeSum += Math.abs(gray - previous); edgeCount++; }
      if (y > 0) { edgeSum += Math.abs(gray - previousRow[xSlot]); edgeCount++; }
      previous = gray;
      xSlot++;
    }
    previousRow = currentRow;
  }

  const mean = count ? sum / count : 0;
  const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
  const contrast = Math.sqrt(variance);
  const sharpness = edgeCount ? edgeSum / edgeCount : 0;
  const exposure = 1 - Math.min(1, Math.abs(mean - 142) / 118);
  const contrastScore = Math.min(1, contrast / 68);
  const sharpnessScore = Math.min(1, sharpness / 28);
  const extremePenalty = mean < 28 || mean > 235 ? 0.25 : 1;
  return (exposure * 0.25 + contrastScore * 0.25 + sharpnessScore * 0.5) * extremePenalty;
}

async function withVideo<T>(file: File, run: (video: HTMLVideoElement) => Promise<T>) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitForMetadata(video);
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('影片長度無法辨識');
    return await run(video);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function candidatePlan(count: number) {
  if (count <= 1) return [{ ratio: 0.5, role: 'content' as const }];
  if (count < 12) {
    return Array.from({ length: count }, (_, i) => ({ ratio: i / (count - 1), role: 'content' as const }));
  }

  const introRatios = [0.01, 0.025, 0.05];
  const outroRatios = [0.95, 0.975, 0.99];
  const introCount = Math.min(3, Math.max(2, Math.floor(count / 12)));
  const outroCount = introCount;
  const contentCount = Math.max(0, count - introCount - outroCount);
  const plan: Array<{ ratio: number; role: 'intro' | 'content' | 'outro' }> = [];

  for (let i = 0; i < introCount; i++) plan.push({ ratio: introRatios[Math.min(i, introRatios.length - 1)], role: 'intro' });
  for (let i = 0; i < contentCount; i++) {
    const ratio = contentCount === 1 ? 0.5 : 0.08 + (0.84 * i) / (contentCount - 1);
    plan.push({ ratio, role: 'content' });
  }
  for (let i = 0; i < outroCount; i++) plan.push({ ratio: outroRatios[Math.max(0, outroRatios.length - outroCount + i)], role: 'outro' });
  return plan;
}

export async function getVideoDuration(file: File) {
  return withVideo(file, async video => video.duration);
}

export async function renderThumbnailPreview(file: File, at: number) {
  return withVideo(file, async video => {
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    await seek(video, at);
    drawCover(video, canvas);
    return canvas.toDataURL('image/jpeg', 0.78);
  });
}

export async function extractThumbnailCandidates(file: File, count = 12): Promise<ThumbnailCandidate[]> {
  return withVideo(file, async video => {
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const frames: ThumbnailCandidate[] = [];

    for (const item of candidatePlan(count)) {
      const at = Math.max(0, Math.min(video.duration - 0.05, video.duration * item.ratio));
      await seek(video, at);
      const ctx = drawCover(video, canvas);
      frames.push({
        at,
        role: item.role,
        preview: canvas.toDataURL('image/jpeg', 0.72),
        localScore: localQuality(ctx, canvas.width, canvas.height),
      });
    }
    return frames;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('無法產生縮圖檔案')), 'image/jpeg', quality);
  });
}

export async function renderThumbnailFile(file: File, at: number) {
  return withVideo(file, async video => {
    const canvas = document.createElement('canvas');
    canvas.width = FINAL_WIDTH;
    canvas.height = FINAL_HEIGHT;
    await seek(video, at);
    drawCover(video, canvas);

    let blob = await canvasBlob(canvas, 0.9);
    if (blob.size > 1.9 * 1024 * 1024) blob = await canvasBlob(canvas, 0.8);
    if (blob.size > 1.9 * 1024 * 1024) blob = await canvasBlob(canvas, 0.68);

    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\-.]+/g, '-').slice(0, 80) || 'video';
    return new File([blob], `${base}-auto-thumbnail.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  });
}
