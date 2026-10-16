type StarrySyncSsoEnv = {
  DB: D1Database;
  ADMIN_EMAIL: string;
  STARRY_ECOSYSTEM: Fetcher;
};

const SESSION_COOKIE = 'svs_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CENTRAL_EXCHANGE = 'https://id.starry.phd/api/apps/starry-sync/exchange';
const TOKEN_RE = /^[A-Za-z0-9_-]{30,}$/;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return '';
}

function rejectCrossSite(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return null;
  const origin = request.headers.get('Origin');
  const ownOrigin = new URL(request.url).origin;
  if ((origin && origin !== ownOrigin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return json({ error: '不接受來自其他網站的操作' }, 403);
  }
  return null;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function localAdmin(request: Request, env: StarrySyncSsoEnv) {
  const sid = cookieValue(request, SESSION_COOKIE);
  if (!TOKEN_RE.test(sid)) return null;
  const row: any = await env.DB.prepare(
    'SELECT email, expires_at FROM admin_sessions WHERE id=? LIMIT 1'
  ).bind(sid).first().catch(() => null);
  if (!row || Number(row.expires_at || 0) <= Date.now()) return null;
  if (String(row.email || '').trim().toLowerCase() !== String(env.ADMIN_EMAIL || '').trim().toLowerCase()) return null;
  return { email: String(row.email || '').trim().toLowerCase(), sid };
}

function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Priority=High`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Priority=High`;
}

async function session(request: Request, env: StarrySyncSsoEnv) {
  const admin = await localAdmin(request, env);
  return json(admin ? { authenticated: true, email: admin.email } : { authenticated: false }, admin ? 200 : 401);
}

async function exchange(request: Request, env: StarrySyncSsoEnv) {
  const rejected = rejectCrossSite(request);
  if (rejected) return rejected;
  const body: any = await request.json().catch(() => ({}));
  const code = String(body?.code || '').trim();
  if (!TOKEN_RE.test(code)) return json({ authenticated: false, error: '登入票證格式不正確' }, 400);
  if (!env.STARRY_ECOSYSTEM?.fetch) return json({ authenticated: false, error: '繁星通行證服務尚未連線' }, 503);

  const centralResponse = await env.STARRY_ECOSYSTEM.fetch(new Request(CENTRAL_EXCHANGE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code }),
  }));
  const central: any = await centralResponse.json().catch(() => ({}));
  const email = String(central?.user?.email || '').trim().toLowerCase();
  if (!centralResponse.ok || central?.authenticated !== true || !email) {
    return json({ authenticated: false, error: central?.error || '繁星通行證登入票證無效' }, centralResponse.status || 401);
  }
  if (email !== String(env.ADMIN_EMAIL || '').trim().toLowerCase()) {
    return json({ authenticated: false, error: '此帳號沒有繁星同步管理權限' }, 403);
  }

  const sid = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('INSERT INTO admin_sessions(id,email,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(sid, email, now + SESSION_TTL_MS, now),
  ]);

  return json({ authenticated: true, email, user: central.user }, 200, { 'Set-Cookie': sessionCookie(sid) });
}

async function logout(request: Request, env: StarrySyncSsoEnv) {
  const rejected = rejectCrossSite(request);
  if (rejected) return rejected;
  const sid = cookieValue(request, SESSION_COOKIE);
  if (TOKEN_RE.test(sid)) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE id=?').bind(sid).run().catch(() => undefined);
  }
  return json({ success: true }, 200, { 'Set-Cookie': clearCookie() });
}

export async function handleStarrySyncSso(request: Request, env: StarrySyncSsoEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (url.pathname === '/api/auth/starry/session' && method === 'GET') return session(request, env);
  if (url.pathname === '/api/auth/starry/exchange' && method === 'POST') return exchange(request, env);
  if (url.pathname === '/api/auth/starry/logout' && method === 'POST') return logout(request, env);

  if (url.pathname === '/api/auth/youtube/start' && method === 'GET') {
    const admin = await localAdmin(request, env);
    if (!admin) return Response.redirect(`${url.origin}/?starry=required`, 302);
  }

  return null;
}
