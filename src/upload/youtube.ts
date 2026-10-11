export type YoutubeUploadStart = {
  uploadUrl: string;
  accessToken: string;
};

const CHUNK = 8 * 1024 * 1024;

export async function uploadYoutubeFile(
  file: File,
  start: YoutubeUploadStart,
  onProgress: (pct: number) => void,
  refreshToken: () => Promise<string>,
) {
  let offset = 0;
  let accessToken = start.accessToken;

  while (offset < file.size) {
    const endExclusive = Math.min(offset + CHUNK, file.size);
    const chunk = file.slice(offset, endExclusive);
    let response = await fetch(start.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Range': `bytes ${offset}-${endExclusive - 1}/${file.size}`,
      },
      body: chunk,
    });

    if (response.status === 401) {
      accessToken = await refreshToken();
      response = await fetch(start.uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Range': `bytes ${offset}-${endExclusive - 1}/${file.size}`,
        },
        body: chunk,
      });
    }

    if (response.status === 308) {
      const range = response.headers.get('Range');
      const match = range?.match(/bytes=0-(\d+)/);
      offset = match ? Number(match[1]) + 1 : endExclusive;
      onProgress(Math.min(99, (offset / file.size) * 100));
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`YouTube 上傳失敗 (${response.status}) ${text.slice(0, 250)}`);
    }

    const result = await response.json();
    onProgress(100);
    return result as { id?: string };
  }
  throw new Error('YouTube 上傳未完成');
}

export async function uploadYoutubeThumbnail(videoId: string, file: File, accessToken: string) {
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('YouTube 自訂縮圖上限為 2 MB，請先縮小圖片。');
  }
  const response = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': file.type || 'image/jpeg',
    },
    body: file,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`YouTube 縮圖設定失敗 (${response.status}) ${text.slice(0, 200)}`);
  }
}
