export type YoutubeOption = { id: string; title: string };
export type YoutubeOptions = { playlists: YoutubeOption[]; categories: YoutubeOption[] };

export async function createYoutubePlaylist(
  title: string,
  privacyStatus: 'private' | 'unlisted' | 'public' = 'private',
  description = '',
) {
  const response = await fetch('/api/youtube/playlists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, privacyStatus, description }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `YouTube 建立播放清單失敗 (${response.status})`);
  }
  return { id: String(data.id || ''), title: String(data.title || title) };
}

export async function youtubePostProcess(videoId: string, playlistId?: string) {
  if (!playlistId) return;
  const response = await fetch('/api/youtube/postprocess', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ videoId, playlistId }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`YouTube 播放清單設定失敗 (${response.status}) ${text.slice(0, 200)}`);
  }
}

export async function uploadYoutubeCaption(
  videoId: string,
  file: File,
  language: string,
  name: string,
) {
  const form = new FormData();
  form.set('videoId', videoId);
  form.set('language', language || 'zh-TW');
  form.set('name', name || file.name.replace(/\.[^.]+$/, ''));
  form.set('file', file);
  const response = await fetch('/api/youtube/caption', { method: 'POST', body: form });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`YouTube 字幕上傳失敗 (${response.status}) ${text.slice(0, 220)}`);
  }
}
