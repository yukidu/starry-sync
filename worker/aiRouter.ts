import app from './index';
import { socialRoute } from './social';

type AiEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME: string;
  ADMIN_EMAIL: string;
  AI: any;
  TOKEN_ENCRYPTION_KEY: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  THREADS_APP_ID?: string;
  THREADS_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
};

const SESSION = 'svs_session';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function cookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get('cookie') || '')
      .split(';')
      .map(v => v.trim())
      .filter(Boolean)
      .map(v => {
        const i = v.indexOf('=');
        return [v.slice(0, i), v.slice(i + 1)];
      }),
  );
}

async function isAdmin(request: Request, env: AiEnv) {
  const sid = cookies(request)[SESSION];
  if (!sid) return false;
  const row: any = await env.DB.prepare('SELECT email, expires_at FROM admin_sessions WHERE id=?').bind(sid).first();
  if (!row || Number(row.expires_at || 0) < Date.now()) return false;
  return String(row.email || '').toLowerCase() === String(env.ADMIN_EMAIL || '').toLowerCase();
}

function normalizeChoice(answer: any, optionCount: number) {
  const possible = [answer?.choice, answer?.value, answer?.answer, answer?.selected, answer?.label];
  for (const value of possible) {
    if (typeof value !== 'string') continue;
    const m = value.match(/(?:frame[_-]?)?(\d+)/i);
    if (m) {
      const n = Number(m[1]);
      if (n >= 0 && n < optionCount) return n;
      if (n >= 1 && n <= optionCount) return n - 1;
    }
  }
  return 0;
}

function uniqueIndexes(values: number[], optionCount: number) {
  const seen = new Set<number>();
  return values.filter(index => {
    if (!Number.isInteger(index) || index < 0 || index >= optionCount || seen.has(index)) return false;
    seen.add(index);
    return true;
  });
}

function preferenceText(preferences: any) {
  const lines: string[] = [];
  if (preferences?.introOutro) lines.push('Give extra consideration to strong opening-title or closing-title frames when they are visually useful and readable.');
  if (preferences?.faces) lines.push('Prefer clear human faces with natural, engaging expressions when people are present.');
  if (preferences?.sharpness) lines.push('Strongly prefer sharp, in-focus frames and avoid motion blur.');
  if (preferences?.lighting) lines.push('Prefer balanced lighting, clear contrast, and avoid frames that are too dark or blown out.');
  if (preferences?.lowText) lines.push('Avoid frames dominated by tiny text, dense slides, or unreadable text.');
  const custom = String(preferences?.custom || '').trim().slice(0, 500);
  if (custom) lines.push(`User preference: ${custom}`);
  return lines;
}

async function selectThumbnail(request: Request, env: AiEnv) {
  if (request.method.toUpperCase() !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await isAdmin(request, env))) return json({ error: '請先用指定管理員帳號登入' }, 401);

  const body: any = await request.json().catch(() => null);
  const frames = Array.isArray(body?.frames) ? body.frames.slice(0, 12) : [];
  if (!frames.length) return json({ error: '缺少候選縮圖' }, 400);

  const images: string[] = [];
  const criteria: Record<string, string> = {};
  const times: number[] = [];
  const localScores: number[] = [];
  const roles: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    const image = String(frames[i]?.image || '');
    if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(image)) {
      return json({ error: `第 ${i + 1} 張候選縮圖格式不支援` }, 400);
    }
    if (image.length > 4_500_000) return json({ error: `第 ${i + 1} 張候選縮圖太大` }, 413);
    const role = ['intro', 'content', 'outro'].includes(String(frames[i]?.role)) ? String(frames[i].role) : 'content';
    images.push(image);
    times.push(Number(frames[i]?.at || 0));
    localScores.push(Number(frames[i]?.localScore || 0));
    roles.push(role);
    criteria[`frame_${i}`] = `Image ${i + 1}, ${role} frame, at ${Math.round(times[i])} seconds.`;
  }

  const priorities = [
    'clear and sharp subject',
    'visually interesting composition that still reads at small thumbnail size',
    'avoid black frames, transitions, awkward gestures, closed eyes, duplicate-looking frames, or accidental frames',
    ...preferenceText(body?.preferences),
  ];

  const result: any = await env.AI.run('@cf/cloudflare/clef-flash', {
    model: 'clef-flash',
    state: {
      task: 'Rank all attached video frames as thumbnail candidates. Return the strongest overall choice and suitability scores for alternatives.',
      priorities,
      frame_times_seconds: times,
      frame_roles: roles,
    },
    images,
    questions: {
      best_thumbnail: {
        type: 'choice',
        instructions: 'Which attached image is the best thumbnail for this video? Pick exactly one option and score the alternatives by suitability.',
        criteria,
      },
    },
  });

  const answer = result?.answers?.best_thumbnail || {};
  const index = normalizeChoice(answer, frames.length);
  const rawProbabilities = answer?.probabilities || answer?.scores || answer?.options || {};
  const scores: number[] = frames.map((_: unknown, i: number) => {
    const raw = rawProbabilities?.[`frame_${i}`];
    if (typeof raw === 'number') return raw;
    const value = Number(raw?.probability ?? raw?.score ?? 0);
    return Number.isFinite(value) ? value : 0;
  });

  const aiRanked = scores
    .map((score: number, i: number) => ({ i, score }))
    .filter((item: { i: number; score: number }) => item.score > 0)
    .sort((a: { i: number; score: number }, b: { i: number; score: number }) => b.score - a.score)
    .map((item: { i: number; score: number }) => item.i);
  const localRanked = localScores
    .map((score: number, i: number) => ({ i, score }))
    .sort((a: { i: number; score: number }, b: { i: number; score: number }) => b.score - a.score)
    .map((item: { i: number; score: number }) => item.i);
  const recommendedIndexes = uniqueIndexes([index, ...aiRanked, ...localRanked], frames.length).slice(0, Math.min(4, frames.length));

  return json({
    index,
    recommendedIndexes,
    scores,
    confidence: Number(answer?.confidence || 0) || undefined,
    model: result?.model || '@cf/cloudflare/clef-flash',
    usage: result?.usage || undefined,
  });
}

export default {
  async fetch(request: Request, env: AiEnv) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/thumbnail/select') return await selectThumbnail(request, env);
      const social = await socialRoute(request, env);
      if (social) return social;
      return app.fetch(request, env as any);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error(error);
      return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
    }
  },
};
