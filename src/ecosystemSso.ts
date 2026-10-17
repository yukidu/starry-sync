const CENTRAL = 'https://id.starry.phd';
const TICKET = `${CENTRAL}/api/apps/starry-sync/ticket`;
const LOCAL_STATUS = '/api/status';
const LOCAL_LOGOUT = '/api/starry/logout';
let syncing = false;
let lastSync = 0;

async function fetchJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { cache:'no-store', credentials:'include', ...init });
  const data:any = await response.clone().json().catch(() => ({}));
  return { response, data };
}

function cleanEmail(value: unknown) { return String(value || '').trim().toLowerCase(); }

async function localLogout() {
  await fetch(LOCAL_LOGOUT, { method:'POST', credentials:'include', cache:'no-store' }).catch(() => undefined);
}

async function centralLogout() {
  await fetch(`${CENTRAL}/api/logout`, { method:'POST', mode:'cors', credentials:'include', cache:'no-store', headers:{ 'Content-Type':'application/json' }, body:'{}' }).catch(() => undefined);
}

async function issueTicket() {
  const { response, data } = await fetchJson(TICKET, { method:'POST', mode:'cors', headers:{ 'Content-Type':'application/json' }, body:'{}' });
  if (!response.ok || !data?.redirect) return false;
  location.replace(String(data.redirect));
  return true;
}

export async function syncStarryResonanceSession(force = false) {
  if (syncing) return;
  const now = Date.now();
  if (!force && now - lastSync < 1500) return;
  syncing = true;
  lastSync = now;
  try {
    const [centralResult, localResult] = await Promise.all([
      fetchJson(`${CENTRAL}/api/ecosystem/session`, { mode:'cors' }),
      fetchJson(LOCAL_STATUS)
    ]);
    const central:any = centralResult.response.ok ? centralResult.data : { authenticated:false };
    const local:any = localResult.response.ok ? localResult.data : { authenticated:false };
    const centralUser:any = central?.authenticated ? central?.user : null;

    if (!centralUser) {
      if (local?.authenticated) {
        await localLogout();
        location.reload();
      }
      return;
    }

    const centralEmail = cleanEmail(centralUser?.email || centralUser?.primaryEmail);
    const localEmail = cleanEmail(local?.email);
    if (!local?.authenticated || (centralEmail && localEmail && centralEmail !== localEmail)) {
      if (local?.authenticated) await localLogout();
      await issueTicket();
    }
  } catch (error) {
    console.warn('Starry Resonance SSO sync skipped:', error);
  } finally {
    syncing = false;
  }
}

export async function logoutStarryResonanceEverywhere() {
  await Promise.allSettled([localLogout(), centralLogout()]);
  location.replace('/');
}

export async function switchStarryResonanceAccount() {
  await Promise.allSettled([localLogout(), centralLogout()]);
  location.href = `${CENTRAL}/auth/starry-sync?choose=1`;
}

function replaceBrand(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  for (const text of nodes) {
    const old = text.nodeValue || '';
    const next = old.replaceAll('繁星同步','繁星共振').replaceAll('Stars Video Sync','Starry Sync').replaceAll('StarsVideoSync','Starry Sync');
    if (next !== old) text.nodeValue = next;
  }
}

function addAccountActions() {
  const panel = document.querySelector('.main-menu-panel');
  if (!panel || panel.querySelector('[data-starry-resonance-account]')) return;
  const divider = document.createElement('div');
  divider.className = 'main-menu-divider';
  divider.dataset.starryResonanceAccount = '1';
  const switchBtn = document.createElement('button');
  switchBtn.type = 'button';
  switchBtn.className = 'main-menu-row';
  switchBtn.innerHTML = '<span style="font-size:20px">◎</span><span><b>切換帳號</b><small>切換後所有繁星 App 一起更新</small></span>';
  switchBtn.addEventListener('click', () => void switchStarryResonanceAccount());
  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.className = 'main-menu-row';
  logoutBtn.innerHTML = '<span style="font-size:20px">↪</span><span><b>登出</b><small>所有繁星 App 一起登出</small></span>';
  logoutBtn.addEventListener('click', () => void logoutStarryResonanceEverywhere());
  panel.appendChild(divider);
  panel.appendChild(switchBtn);
  panel.appendChild(logoutBtn);
}

export function initStarryResonanceEcosystem() {
  const start = () => {
    document.title = document.title.replaceAll('繁星同步','繁星共振').replaceAll('StarsVideoSync','Starry Sync');
    replaceBrand(document.body);
    addAccountActions();
    new MutationObserver(records => {
      for (const record of records) for (const node of Array.from(record.addedNodes)) if (node.nodeType === Node.ELEMENT_NODE) replaceBrand(node);
      replaceBrand(document.body);
      addAccountActions();
    }).observe(document.body, { childList:true, subtree:true });
    void syncStarryResonanceSession(true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
  addEventListener('focus', () => void syncStarryResonanceSession());
  addEventListener('online', () => void syncStarryResonanceSession());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void syncStarryResonanceSession(); });
}
