const CENTRAL = 'https://id.starry.phd';
const CENTRAL_SESSION = `${CENTRAL}/api/ecosystem/session`;
const CENTRAL_TICKET = `${CENTRAL}/api/apps/starry-sync/ticket`;
const CENTRAL_GOOGLE_SYNC = `${CENTRAL}/api/google-sync`;
const CENTRAL_LOGOUT = `${CENTRAL}/api/logout`;
const LOCAL_SESSION = '/api/auth/starry/session';
const LOCAL_EXCHANGE = '/api/auth/starry/exchange';
const LOCAL_LOGOUT = '/api/auth/starry/logout';
const GOOGLE_CLIENT_ID = '661055525630-ndcq5gtr16h7rqqprlqqkkvineea87lc.apps.googleusercontent.com';
const GOOGLE_GSI = 'https://accounts.google.com/gsi/client';
const MIN_SYNC_MS = 3000;

type Identity = {
  id?: string;
  email?: string;
  name?: string;
  avatar?: string;
  rank?: string;
};

type CentralState = { authenticated: boolean; user?: Identity };
type LocalState = { authenticated: boolean; email?: string };

let overlay: HTMLDivElement | null = null;
let syncing = false;
let lastSync = 0;
let reloadPending = false;
let googlePromise: Promise<any> | null = null;
let lastCentral: CentralState | null = null;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function reloadOnce() {
  if (reloadPending) return;
  reloadPending = true;
  window.location.reload();
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

async function localState(): Promise<LocalState | null> {
  try {
    const response = await fetch(LOCAL_SESSION, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    const data: any = await readJson(response);
    return response.ok && data?.authenticated ? { authenticated: true, email: text(data.email).toLowerCase() } : { authenticated: false };
  } catch {
    return null;
  }
}

async function centralState(): Promise<CentralState | null> {
  try {
    const response = await fetch(CENTRAL_SESSION, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    const data: any = await readJson(response);
    const state = response.ok && data?.authenticated ? { authenticated: true, user: data.user || {} } : { authenticated: false };
    lastCentral = state;
    return state;
  } catch {
    return null;
  }
}

async function localLogout() {
  try {
    await fetch(LOCAL_LOGOUT, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}',
    });
  } catch {}
}

async function centralLogout() {
  try {
    await fetch(CENTRAL_LOGOUT, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}',
    });
  } catch {}
}

async function issueTicket() {
  const response = await fetch(CENTRAL_TICKET, {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}',
  });
  const data: any = await readJson(response);
  if (!response.ok || !data?.code) throw new Error(data?.error || '無法建立繁星同步登入票證');
  return text(data.code);
}

async function exchangeLocal(code: string) {
  const response = await fetch(LOCAL_EXCHANGE, {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data: any = await readJson(response);
  if (!response.ok || data?.authenticated !== true) throw new Error(data?.error || '繁星同步登入同步失敗');
  return data;
}

async function syncNow(force = false) {
  const now = Date.now();
  if (syncing || (!force && now - lastSync < MIN_SYNC_MS)) return;
  syncing = true;
  lastSync = now;
  try {
    const [local, central] = await Promise.all([localState(), centralState()]);
    if (!central) return;
    if (!central.authenticated || !central.user?.email) {
      if (local?.authenticated) {
        await localLogout();
        reloadOnce();
      }
      return;
    }
    const centralEmail = text(central.user.email).toLowerCase();
    if (local?.authenticated && text(local.email).toLowerCase() === centralEmail) return;
    if (local?.authenticated) await localLogout();
    const code = await issueTicket();
    await exchangeLocal(code);
    reloadOnce();
  } catch (error) {
    console.warn('繁星同步：中央登入同步暫時略過', error);
  } finally {
    syncing = false;
  }
}

function installStyle() {
  if (document.getElementById('starry-sync-sso-style')) return;
  const style = document.createElement('style');
  style.id = 'starry-sync-sso-style';
  style.textContent = `
    .starry-sync-sso{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:rgba(3,8,22,.72);backdrop-filter:blur(7px)}
    .starry-sync-sso-card{width:min(400px,100%);border:1px solid rgba(129,230,255,.38);border-radius:22px;padding:22px 18px 18px;background:#081225;color:#fff;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.5)}
    .starry-sync-sso-close{float:right;border:0;background:transparent;color:#fff;font-size:26px;line-height:1;cursor:pointer}.starry-sync-sso-card h2{margin:5px 0 7px;font-size:21px}.starry-sync-sso-card p{margin:0;color:#b8d3e4;font-size:13px;line-height:1.65}
    .starry-sync-google{display:flex;justify-content:center;min-height:44px;margin-top:18px}.starry-sync-sso-status{min-height:19px;margin-top:11px;color:#bfeaff;font-size:12px;line-height:1.5}
    .starry-sync-account-actions{display:grid;gap:9px;margin-top:17px}.starry-sync-account-actions button,.starry-sync-account-actions a{min-height:44px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.24);border-radius:12px;background:#111d36;color:#fff;font-weight:800;text-decoration:none;cursor:pointer}.starry-sync-account-actions .danger{background:#3a1720;border-color:#75404a}
  `;
  document.head.appendChild(style);
}

function closeOverlay() {
  overlay?.remove();
  overlay = null;
}

function setStatus(message: string) {
  const node = overlay?.querySelector<HTMLElement>('[data-starry-sync-status]');
  if (node) node.textContent = message;
}

function loadGoogle() {
  const google = (window as any).google;
  if (google?.accounts?.id) return Promise.resolve(google);
  if (googlePromise) return googlePromise;
  googlePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-starry-sync-google]');
    if (existing) {
      const timer = window.setInterval(() => {
        const ready = (window as any).google;
        if (!ready?.accounts?.id) return;
        window.clearInterval(timer);
        resolve(ready);
      }, 80);
      window.setTimeout(() => { window.clearInterval(timer); reject(new Error('Google 登入載入逾時')); }, 10000);
      return;
    }
    const script = document.createElement('script');
    script.src = GOOGLE_GSI;
    script.async = true;
    script.defer = true;
    script.dataset.starrySyncGoogle = '1';
    script.onload = () => resolve((window as any).google);
    script.onerror = () => reject(new Error('Google 登入暫時無法載入'));
    document.head.appendChild(script);
  }).catch(error => { googlePromise = null; throw error; });
  return googlePromise;
}

async function completeGoogleLogin(credential: string) {
  if (!credential) return setStatus('沒有取得 Google 登入資料，請再試一次。');
  setStatus('正在登入繁星通行證…');
  try {
    const response = await fetch(CENTRAL_GOOGLE_SYNC, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ credential, appId: 'starry-sync' }),
    });
    const data: any = await readJson(response);
    if (!response.ok || data?.success !== true) throw new Error(data?.error || '登入失敗');
    const code = await issueTicket();
    await exchangeLocal(code);
    closeOverlay();
    reloadOnce();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '登入失敗，請再試一次。');
  }
}

async function showLogin() {
  closeOverlay();
  installStyle();
  overlay = document.createElement('div');
  overlay.className = 'starry-sync-sso';
  overlay.innerHTML = `
    <div class="starry-sync-sso-card" role="dialog" aria-modal="true" aria-label="登入繁星通行證">
      <button class="starry-sync-sso-close" type="button" data-starry-sync-close aria-label="關閉">×</button>
      <h2>登入繁星通行證</h2>
      <p>直接在繁星同步選擇 Google 帳號。YouTube、Facebook 等發布平台授權會保持獨立。</p>
      <div class="starry-sync-google" data-starry-sync-google-slot></div>
      <div class="starry-sync-sso-status" data-starry-sync-status>正在準備登入…</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-starry-sync-close]')?.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay(); });
  try {
    const google = await loadGoogle();
    if (!overlay || !google?.accounts?.id) throw new Error('Google 登入暫時無法使用');
    google.accounts.id.disableAutoSelect?.();
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (result: any) => void completeGoogleLogin(text(result?.credential)),
      ux_mode: 'popup', auto_select: false, itp_support: true,
    });
    const slot = overlay.querySelector<HTMLElement>('[data-starry-sync-google-slot]');
    if (slot) google.accounts.id.renderButton(slot, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', locale: 'zh_TW', width: 300 });
    setStatus('請選擇 Google 帳號');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Google 登入暫時無法使用');
  }
}

async function showAccount() {
  const central = await centralState();
  if (!central?.authenticated) return showLogin();
  closeOverlay();
  installStyle();
  const user = central.user || {};
  const safeName = (text(user.name) || text(user.email) || '繁星會員').replace(/[&<>"']/g, '');
  const safeRank = text(user.rank).replace(/[&<>"']/g, '');
  overlay = document.createElement('div');
  overlay.className = 'starry-sync-sso';
  overlay.innerHTML = `
    <div class="starry-sync-sso-card" role="dialog" aria-modal="true" aria-label="繁星帳號">
      <button class="starry-sync-sso-close" type="button" data-starry-sync-close aria-label="關閉">×</button>
      <h2>${safeName}${safeRank ? ` · ${safeRank}` : ''}</h2>
      <p>繁星帳號已與其他 Starry App 共用。影音平台授權不會因切換繁星帳號而自動刪除。</p>
      <div class="starry-sync-account-actions">
        <button type="button" data-starry-sync-switch>切換 Google 帳號</button>
        <a href="${CENTRAL}/member-center" target="_blank" rel="noopener noreferrer">繁星通行證會員中心</a>
        <button class="danger" type="button" data-starry-sync-logout>登出全部繁星 App</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-starry-sync-close]')?.addEventListener('click', closeOverlay);
  overlay.querySelector('[data-starry-sync-switch]')?.addEventListener('click', () => void showLogin());
  overlay.querySelector('[data-starry-sync-logout]')?.addEventListener('click', async () => {
    setStatus('正在登出…');
    await Promise.allSettled([localLogout(), centralLogout()]);
    try { (window as any).google?.accounts?.id?.disableAutoSelect?.(); } catch {}
    closeOverlay();
    reloadOnce();
  });
  overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay(); });
}

export function openStarrySyncAccount() {
  void showAccount();
}

export function initStarrySyncSso() {
  void syncNow(true);
  window.addEventListener('focus', () => void syncNow());
  window.addEventListener('online', () => void syncNow(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>('a[href^="/api/auth/youtube/start"]');
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void localState().then(local => {
      if (local?.authenticated) window.location.assign(link.href);
      else void showLogin();
    });
  }, true);

  const url = new URL(window.location.href);
  if (url.searchParams.get('starry') === 'required') {
    url.searchParams.delete('starry');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.setTimeout(() => {
      if (!lastCentral?.authenticated) void showLogin();
    }, 350);
  }
}
