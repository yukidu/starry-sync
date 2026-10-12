export type GjwPlaylistVisibility = 'public' | 'unlisted' | 'private';

export type GjwPlaylist = {
  id: string;
  title: string;
  description?: string;
  visibility?: GjwPlaylistVisibility;
};

export type GjwPlaylistCapability = {
  available: boolean;
  source: 'official-api' | 'not-authorized';
  message?: string;
};

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `GJW Playlist API request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

/**
 * Official Gan Jing World Playlist API adapter.
 *
 * These routes intentionally target StarsVideoSync's own backend rather than
 * calling any undocumented Gan Jing World web endpoint from the browser.
 * The backend routes will be wired only after Gan Jing World provides an
 * official playlist API contract / beta endpoint / scope for this app.
 */
export async function getGjwPlaylistCapability() {
  return parse<GjwPlaylistCapability>(await fetch('/api/gjw/playlists/capability', { cache: 'no-store' }));
}

export async function listGjwPlaylists() {
  return parse<{ playlists: GjwPlaylist[] }>(await fetch('/api/gjw/playlists', { cache: 'no-store' }));
}

export async function createGjwPlaylist(input: { title: string; description?: string; visibility: GjwPlaylistVisibility }) {
  return parse<{ playlist: GjwPlaylist }>(await fetch('/api/gjw/playlists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function addVideoToGjwPlaylist(playlistId: string, contentId: string) {
  return parse<{ ok: true }>(await fetch(`/api/gjw/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentId }),
  }));
}
