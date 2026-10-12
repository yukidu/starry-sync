export type YoutubeOption = { id: string; title: string };
export type YoutubeOptions = { playlists: YoutubeOption[]; categories: YoutubeOption[] };

async function youtubeAccessToken() {
  const response = await fetch('/api/youtube/access-token', { headers: { accept: 'application/json' } });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || !data?.accessToken) throw new Error(data?.error || '無法取得 YouTube 授權');
  return String(data.accessToken);
}

export async function createYoutubePlaylist(
  title: string,
  privacyStatus: 'private' | 'unlisted' | 'public' = 'private',
  description = '',
) {
  const accessToken = await youtubeAccessToken();
  const response = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      snippet: { title, description, defaultLanguage: 'zh-TW' },
      status: { privacyStatus },
    }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `YouTube 建立播放清單失敗 (${response.status})`);
  }
  return { id: String(data.id || ''), title: String(data.snippet?.title || title) };
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
