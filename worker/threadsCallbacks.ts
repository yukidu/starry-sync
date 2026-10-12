type ThreadsCallbackEnv = {
  DB: D1Database;
  THREADS_APP_SECRET?: string;
};

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function fromBase64url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(normalized + padding), c => c.charCodeAt(0));
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifySignedRequest(signedRequest: string, appSecret: string) {
  const [signaturePart, payloadPart] = signedRequest.split('.');
  if (!signaturePart || !payloadPart) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart)));
  const supplied = fromBase64url(signaturePart);
  if (!equalBytes(expected, supplied)) return null;

  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(payloadPart)));
  } catch {
    return null;
  }
}

async function readSignedRequest(request: Request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData();
    return String(form.get('signed_request') || '');
  }
  if (type.includes('application/json')) {
    const body: any = await request.json().catch(() => ({}));
    return String(body?.signed_request || '');
  }
  const text = await request.text().catch(() => '');
  const params = new URLSearchParams(text);
  return params.get('signed_request') || '';
}

async function validateCallback(request: Request, env: ThreadsCallbackEnv) {
  if (!env.THREADS_APP_SECRET) return { error: json({ error: 'Threads App Secret 尚未設定' }, 503) };
  const signedRequest = await readSignedRequest(request);
  if (!signedRequest) return { error: json({ error: '缺少 signed_request' }, 400) };
  const payload = await verifySignedRequest(signedRequest, env.THREADS_APP_SECRET);
  if (!payload) return { error: json({ error: 'signed_request 驗證失敗' }, 400) };
  return { payload };
}

async function deleteThreadsTokens(env: ThreadsCallbackEnv) {
  await env.DB.prepare("DELETE FROM platform_tokens WHERE provider='threads'").run();
  await env.DB.prepare("DELETE FROM oauth_states WHERE provider='threads'").run();
}

async function uninstallCallback(request: Request, env: ThreadsCallbackEnv) {
  if (request.method === 'GET') return json({ ok: true, callback: 'threads-uninstall' });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const checked = await validateCallback(request, env);
  if ('error' in checked) return checked.error;
  await deleteThreadsTokens(env);
  return json({ ok: true });
}

async function deletionCallback(request: Request, env: ThreadsCallbackEnv) {
  if (request.method === 'GET') return json({ ok: true, callback: 'threads-data-deletion' });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const checked = await validateCallback(request, env);
  if ('error' in checked) return checked.error;
  await deleteThreadsTokens(env);
  const confirmationCode = crypto.randomUUID();
  const origin = new URL(request.url).origin;
  return json({
    url: `${origin}/?page=short&threads_data_deleted=1&confirmation_code=${encodeURIComponent(confirmationCode)}`,
    confirmation_code: confirmationCode,
  });
}

export async function threadsCallbackRoute(request: Request, env: ThreadsCallbackEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/threads/uninstall-callback') return uninstallCallback(request, env);
  if (path === '/api/threads/delete-callback') return deletionCallback(request, env);
  return null;
}
