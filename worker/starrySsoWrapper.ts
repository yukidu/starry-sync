import app from './aiRouter';

type Env = {
  DB: D1Database;
  STARRY_ID_DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_EMAIL: string;
  [key: string]: any;
};

const APP_ID = 'starry-sync';
const SESSION = 'svs_session';
const DAY = 86400000;
const CODE_RE = /^[A-Za-z0-9_-]{30,}$/;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cookies(request: Request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [v.slice(0, i), v.slice(i + 1)];
  }));
}

function redirect(url: string, cookie?: string) {
  const headers = new Headers({ location:url, 'Cache-Control':'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status:302, headers });
}

function json(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

async function finishStarryLogin(request: Request, env: Env) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim();
  if (!CODE_RE.test(code)) return redirect('/?login=error');
  const codeHash = await sha256Hex(code);
  const row:any = await env.STARRY_ID_DB.prepare(`DELETE FROM starry_app_auth_codes WHERE codeHash=? AND appId=? AND expiresAt>? RETURNING userId`)
    .bind(codeHash, APP_ID, Date.now()).first().catch(() => null);
  if (!row?.userId) return redirect('/?login=expired');
  const member:any = await env.STARRY_ID_DB.prepare(`SELECT u.primaryEmail,u.status FROM users u WHERE u.id=? LIMIT 1`).bind(String(row.userId)).first().catch(() => null);
  const email = String(member?.primaryEmail || '').trim().toLowerCase();
  if (!member || member.status !== 'active' || !email || email !== String(env.ADMIN_EMAIL || '').trim().toLowerCase()) {
    return redirect('/?login=denied');
  }
  const sid = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO admin_sessions(id,email,expires_at,created_at) VALUES(?,?,?,?)')
    .bind(sid, email, now + 30 * DAY, now).run();
  return redirect('/?login=ok', `${SESSION}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
}

async function localLogout(request: Request, env: Env) {
  const sid = cookies(request)[SESSION] || '';
  if (sid) await env.DB.prepare('DELETE FROM admin_sessions WHERE id=?').bind(sid).run().catch(() => undefined);
  return json({ ok:true }, 200, `${SESSION}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export default {
  async fetch(request: Request, env: Env, ctx?: any) {
    const url = new URL(request.url);
    if (url.pathname === '/auth/callback' && request.method === 'GET') {
      try { return await finishStarryLogin(request, env); }
      catch (error) { console.error('Starry Sync callback failed:', error); return redirect('/?login=error'); }
    }
    if (url.pathname === '/api/starry/logout' && request.method === 'POST') return localLogout(request, env);
    if (url.pathname === '/auth/starry' && request.method === 'GET') return redirect('https://id.starry.phd/auth/starry-sync');
    return app.fetch(request, env as any, ctx);
  }
};
