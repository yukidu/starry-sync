export type FacebookReelStart = {
  videoId: string;
  uploadUrl: string;
  pageAccessToken: string;
};

export async function uploadFacebookReelLocal(
  file: File,
  start: FacebookReelStart,
  onProgress: (pct: number) => void,
) {
  const response = await new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', start.uploadUrl);
    xhr.setRequestHeader('Authorization', `OAuth ${start.pageAccessToken}`);
    xhr.setRequestHeader('offset', '0');
    xhr.setRequestHeader('file_size', String(file.size));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      onProgress(Math.max(1, Math.min(99, (event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(new Error('Facebook Reels 上傳網路錯誤'));
    xhr.onload = () => {
      const headers = new Headers();
      const raw = xhr.getAllResponseHeaders();
      raw.trim().split(/[\r\n]+/).filter(Boolean).forEach(line => {
        const index = line.indexOf(':');
        if (index > 0) headers.append(line.slice(0,index).trim(), line.slice(index+1).trim());
      });
      resolve(new Response(xhr.responseText, { status:xhr.status, statusText:xhr.statusText, headers }));
    };
    xhr.send(file);
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Facebook Reels 影片上傳失敗 (${response.status}) ${text.slice(0,220)}`);
  }
  const data = await response.json().catch(() => ({})) as { success?: boolean };
  if (data.success === false) throw new Error('Facebook Reels 回報影片上傳失敗');
  onProgress(100);
}
