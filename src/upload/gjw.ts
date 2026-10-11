import * as tus from 'tus-js-client';

function collectUrls(value: unknown, path = '', out: Array<{ path: string; url: string }> = []) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) out.push({ path, url: value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUrls(item, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      collectUrls(item, path ? `${path}.${key}` : key, out);
    });
  }
  return out;
}

function chooseImageUrl(
  images: unknown,
  preferredKeys: string[],
  preferWebp = true,
) {
  const urls = collectUrls(images);
  if (!urls.length) return undefined;

  for (const key of preferredKeys) {
    const keyPattern = new RegExp(`(^|[._\\[\\]-])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([._\\]\\-]|$)`, 'i');
    const matches = urls.filter(item => keyPattern.test(item.path) || keyPattern.test(item.url));
    if (!matches.length) continue;
    const webp = preferWebp ? matches.find(item => /\.webp(?:$|\?)/i.test(item.url)) : undefined;
    return (webp || matches[0]).url;
  }

  const webp = preferWebp ? urls.find(item => /\.webp(?:$|\?)/i.test(item.url)) : undefined;
  return (webp || urls[0]).url;
}

export async function uploadGjwPoster(file: File, uploadToken: string) {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('https://imgapi.cloudokyo.cloud/api/v2/image', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${uploadToken}`,
      'resizing-list': '140,240,360,380,480,580,672,960,1280,1920',
    },
    body,
  });

  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Gan Jing World 縮圖服務回傳非 JSON (${response.status})`);
  }

  if (!response.ok) throw new Error(data?.message || data?.body?.message || `Gan Jing World 縮圖上傳失敗 (${response.status})`);

  // GJW CDN 文件指定網址位於 body.image_url；實際回應可能是 object、array，
  // 且同一尺寸可能同時有 jpg/webp，因此不要假設固定 JSON 形狀。
  const images = data?.body?.image_url ?? data?.data?.body?.image_url ?? data?.data?.image_url ?? data?.image_url;
  const posterUrl = chooseImageUrl(images, ['672', '480', '580', '360', '240', '140']);
  const posterHdUrl = chooseImageUrl(images, ['origin', '1920', '1280', '960', '672']);

  if (!posterUrl || !posterHdUrl) {
    const keys = images && typeof images === 'object' ? Object.keys(images).slice(0, 12).join(', ') : typeof images;
    throw new Error(`Gan Jing World 沒有回傳可用縮圖網址（image_url: ${keys || 'empty'}）`);
  }
  return { posterUrl, posterHdUrl };
}

export function uploadGjwVideo(options: {
  file: File;
  contentId: string;
  channelId: string;
  language: string;
  getUploadToken: () => Promise<string>;
  onProgress: (pct: number) => void;
}) {
  return new Promise<string>((resolve, reject) => {
    const upload = new tus.Upload(options.file, {
      endpoint: 'https://vodapi.cloudokyo.cloud/api/v1/tus/upload',
      chunkSize: 10 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      removeFingerprintOnSuccess: true,
      metadata: {
        content_id: options.contentId,
        content_type: 'Video',
        channel_id: options.channelId,
        filetype: options.file.type || 'video/mp4',
        filename: options.file.name.replace(/[^\x20-\x7E]/g, '_'),
        language: options.language,
        profile_name: 'fullbitrate',
        analyze_flag: 'true',
        auto_caption_flag: 'true',
        caption_priority: 'low',
        preview_start: '00:00:00',
        preview_end: '00:00:20',
        priority: 'low',
      },
      onBeforeRequest: async req => {
        req.setHeader('Authorization', `Bearer ${await options.getUploadToken()}`);
      },
      onProgress: (done, total) => options.onProgress((done / total) * 100),
      onError: reject,
      onSuccess: () => {
        if (!upload.url) return reject(new Error('Gan Jing World 沒有回傳上傳網址'));
        resolve(upload.url);
      },
    });
    upload.findPreviousUploads().then(previous => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(() => upload.start());
  });
}
