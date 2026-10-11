import * as tus from 'tus-js-client';

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
  const data: any = await response.json();
  if (!response.ok) throw new Error(data?.message || 'Gan Jing World 縮圖上傳失敗');
  const images = data?.body?.image_url || {};
  const values = typeof images === 'object' ? images : {};
  const pick = (...keys: string[]) => keys.map(k => values[k]).find(Boolean);
  const posterUrl = pick('672', '480', '580', '360', '240', '140');
  const posterHdUrl = pick('origin', '1920', '1280', '960', '672');
  if (!posterUrl || !posterHdUrl) throw new Error('Gan Jing World 沒有回傳可用縮圖網址');
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
