type SocialEnv = {
  DB: D1Database;
  ADMIN_EMAIL: string;
  TOKEN_ENCRYPTION_KEY: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  THREADS_APP_ID?: string;
  THREADS_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
};

type StoredToken = {
  provider: string;
  account_email?: string | null;
  account_name?: string | null;
  channel_id?: string | null;
  channel_name?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  access_expires_at?: number | null;
};

const SESSION = 'svs_session';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
function redirect(url: string) { return new Response(null, { status: 302, headers: { location: url } }); }
function base64url(bytes: Uint8Array) { let s=''; bytes.forEach(b=>s+=String.fromCharCode(b)); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function randomToken(size=32) { const bytes=new Uint8Array(size); crypto.getRandomValues(bytes); return base64url(bytes); }
function fromBase64url(value:string) { const p=value.replace(/-/g,'+').replace(/_/g,'/'); const pad='='.repeat((4-p.length%4)%4); return Uint8Array.from(atob(p+pad),c=>c.charCodeAt(0)); }
function graphVersion(env: SocialEnv) { return env.META_GRAPH_VERSION?.trim() || 'v26.0'; }
function graphBase(env: SocialEnv) { return `https://graph.facebook.com/${graphVersion(env)}`; }

function cookies(request:Request) {
  return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
}
async function admin(request:Request, env:SocialEnv) {
  const sid=cookies(request)[SESSION]; if(!sid) return null;
  const row:any=await env.DB.prepare('SELECT email, expires_at FROM admin_sessions WHERE id=?').bind(sid).first();
  if(!row || Number(row.expires_at||0)<Date.now()) return null;
  return String(row.email||'').toLowerCase()===String(env.ADMIN_EMAIL||'').toLowerCase() ? row : null;
}
async function requireAdmin(request:Request, env:SocialEnv) {
  const row=await admin(request,env);
  if(!row) throw new Response(JSON.stringify({error:'請先用指定管理員帳號登入'}),{status:401,headers:jsonHeaders});
  return row;
}

async function encryptionKey(env: SocialEnv) {
  const raw=fromBase64url(env.TOKEN_ENCRYPTION_KEY||'');
  if(raw.length!==32) throw new Error('TOKEN_ENCRYPTION_KEY 格式錯誤');
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
async function encrypt(env: SocialEnv, value:string) {
  const iv=new Uint8Array(12); crypto.getRandomValues(iv); const key=await encryptionKey(env);
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value)));
  return `${base64url(iv)}.${base64url(encrypted)}`;
}
async function decrypt(env: SocialEnv, value?:string|null) {
  if(!value) return '';
  const [ivRaw,dataRaw]=value.split('.'); const key=await encryptionKey(env);
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64url(ivRaw)},key,fromBase64url(dataRaw));
  return new TextDecoder().decode(clear);
}
async function tokenRow(env: SocialEnv, provider:string) {
  return env.DB.prepare('SELECT * FROM platform_tokens WHERE provider=?').bind(provider).first<StoredToken>();
}
async function upsertToken(env:SocialEnv, provider:string, token:any, meta:any={}) {
  const old:any=await tokenRow(env,provider);
  const access=await encrypt(env,String(token.access_token||''));
  const refresh=token.refresh_token ? await encrypt(env,String(token.refresh_token)) : old?.refresh_token_enc || null;
  const expiresIn=Number(token.expires_in||token.expires||5184000);
  await env.DB.prepare(`INSERT INTO platform_tokens(provider,account_email,account_name,channel_id,channel_name,access_token_enc,refresh_token_enc,access_expires_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET account_email=excluded.account_email,account_name=excluded.account_name,channel_id=excluded.channel_id,channel_name=excluded.channel_name,access_token_enc=excluded.access_token_enc,refresh_token_enc=excluded.refresh_token_enc,access_expires_at=excluded.access_expires_at,updated_at=excluded.updated_at`)
    .bind(provider,meta.email||null,meta.name||null,meta.channelId||null,meta.channelName||null,access,refresh,Date.now()+Math.max(3600,expiresIn)*1000,Date.now()).run();
}
async function accessToken(env:SocialEnv, provider:string) {
  const row=await tokenRow(env,provider);
  if(!row) throw new Error(`${provider} 尚未連接`);
  if(Number(row.access_expires_at||0) < Date.now()+30000) throw new Error(`${provider} 授權已到期，請重新連接`);
  return decrypt(env,row.access_token_enc);
}

async function socialStatus(request:Request,env:SocialEnv) {
  const authorized=Boolean(await admin(request,env));
  const [metaUser,facebook,instagram,threads]=await Promise.all([
    tokenRow(env,'meta_user'),tokenRow(env,'facebook'),tokenRow(env,'instagram'),tokenRow(env,'threads'),
  ]);
  return json({
    authenticated:authorized,
    metaConfigured:Boolean(env.META_APP_ID&&env.META_APP_SECRET),
    threadsConfigured:Boolean(env.THREADS_APP_ID&&env.THREADS_APP_SECRET),
    metaAuthorized:Boolean(metaUser),
    facebook:{connected:Boolean(facebook),pageId:facebook?.channel_id||undefined,pageName:facebook?.channel_name||undefined},
    instagram:{connected:Boolean(instagram),userId:instagram?.channel_id||undefined,username:instagram?.channel_name||undefined},
    threads:{connected:Boolean(threads),userId:threads?.channel_id||undefined,username:threads?.channel_name||undefined},
    graphVersion:graphVersion(env),
  });
}

async function metaStart(request:Request,env:SocialEnv) {
  if(!await admin(request,env)) return redirect('/?page=short&login_required=1');
  if(!env.META_APP_ID||!env.META_APP_SECRET) return redirect('/?page=short&setup=meta');
  const url=new URL(request.url),state=randomToken();
  await env.DB.prepare('INSERT INTO oauth_states(state,provider,expires_at) VALUES(?,?,?)').bind(state,'meta',Date.now()+10*60*1000).run();
  const redirectUri=`${url.origin}/api/auth/meta/callback`;
  const scope=['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish'].join(',');
  const q=new URLSearchParams({client_id:env.META_APP_ID,redirect_uri:redirectUri,response_type:'code',scope,state});
  return redirect(`https://www.facebook.com/${graphVersion(env)}/dialog/oauth?${q}`);
}

async function metaCallback(request:Request,env:SocialEnv) {
  const url=new URL(request.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
  const st:any=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND provider=? AND expires_at>? RETURNING state').bind(state,'meta',Date.now()).first();
  if(!st) return redirect('/?page=short&social_error=meta_state');
  if(!env.META_APP_ID||!env.META_APP_SECRET) return redirect('/?page=short&setup=meta');
  const redirectUri=`${url.origin}/api/auth/meta/callback`;
  const q=new URLSearchParams({client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,redirect_uri:redirectUri,code});
  const tokenR=await fetch(`${graphBase(env)}/oauth/access_token?${q}`); const short:any=await tokenR.json().catch(()=>({}));
  if(!tokenR.ok||!short.access_token) return redirect('/?page=short&social_error=meta_token');
  let token=short;
  const longQ=new URLSearchParams({grant_type:'fb_exchange_token',client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,fb_exchange_token:String(short.access_token)});
  const longR=await fetch(`${graphBase(env)}/oauth/access_token?${longQ}`); const long:any=await longR.json().catch(()=>({}));
  if(longR.ok&&long.access_token) token=long;
  const meR=await fetch(`${graphBase(env)}/me?fields=id,name&access_token=${encodeURIComponent(token.access_token)}`); const me:any=await meR.json().catch(()=>({}));
  await upsertToken(env,'meta_user',token,{name:me.name||'Meta'});
  return redirect('/?page=short&social=meta');
}

async function metaPages(request:Request,env:SocialEnv) {
  await requireAdmin(request,env);
  const token=await accessToken(env,'meta_user');
  const q=new URLSearchParams({fields:'id,name,access_token,tasks,instagram_business_account',limit:'100',access_token:token});
  const r=await fetch(`${graphBase(env)}/me/accounts?${q}`); const data:any=await r.json().catch(()=>({}));
  if(!r.ok) return json({error:data?.error?.message||'讀取 Facebook 粉絲專頁失敗'},r.status);
  const pages=(data.data||[]).map((item:any)=>({id:String(item.id),name:String(item.name||item.id),hasInstagram:Boolean(item.instagram_business_account?.id),instagramUserId:item.instagram_business_account?.id?String(item.instagram_business_account.id):undefined}));
  return json({pages});
}

async function selectMetaPage(request:Request,env:SocialEnv) {
  await requireAdmin(request,env);
  const body:any=await request.json().catch(()=>({})); const pageId=String(body.pageId||'');
  if(!pageId) return json({error:'缺少 Facebook Page ID'},400);
  const token=await accessToken(env,'meta_user');
  const q=new URLSearchParams({fields:'id,name,access_token,tasks,instagram_business_account',limit:'100',access_token:token});
  const r=await fetch(`${graphBase(env)}/me/accounts?${q}`); const data:any=await r.json().catch(()=>({}));
  if(!r.ok) return json({error:data?.error?.message||'讀取 Facebook 粉絲專頁失敗'},r.status);
  const page=(data.data||[]).find((item:any)=>String(item.id)===pageId);
  if(!page?.access_token) return json({error:'找不到可管理的 Facebook 粉絲專頁或 Page Access Token'},404);
  await upsertToken(env,'facebook',{access_token:page.access_token,expires_in:60*60*24*60},{channelId:String(page.id),channelName:String(page.name||page.id),name:String(page.name||'Facebook')});
  const igId=page.instagram_business_account?.id ? String(page.instagram_business_account.id) : '';
  if(igId) {
    const igR=await fetch(`${graphBase(env)}/${encodeURIComponent(igId)}?fields=id,username,name&access_token=${encodeURIComponent(page.access_token)}`); const ig:any=await igR.json().catch(()=>({}));
    await upsertToken(env,'instagram',{access_token:page.access_token,expires_in:60*60*24*60},{channelId:igId,channelName:String(ig.username||ig.name||page.name||igId),name:String(ig.name||ig.username||'Instagram')});
  }
  return json({ok:true,facebook:{pageId:String(page.id),pageName:String(page.name||page.id)},instagram:igId?{userId:igId}:null});
}

async function facebookReelStart(request:Request,env:SocialEnv) {
  await requireAdmin(request,env);
  const token=await accessToken(env,'facebook');
  const r=await fetch(`${graphBase(env)}/me/video_reels?upload_phase=start&access_token=${encodeURIComponent(token)}`,{method:'POST'}); const data:any=await r.json().catch(()=>({}));
  if(!r.ok) return json({error:data?.error?.message||'Facebook Reels 建立上傳工作階段失敗'},r.status);
  if(!data.video_id||!data.upload_url) return json({error:'Facebook 沒有回傳 video_id 或 upload_url'},502);
  return json({videoId:String(data.video_id),uploadUrl:String(data.upload_url),pageAccessToken:token});
}

async function facebookReelFinish(request:Request,env:SocialEnv) {
  await requireAdmin(request,env);
  const body:any=await request.json().catch(()=>({})); const videoId=String(body.videoId||'');
  if(!videoId) return json({error:'缺少 Facebook videoId'},400);
  const token=await accessToken(env,'facebook');
  const q=new URLSearchParams({access_token:token,video_id:videoId,upload_phase:'finish',video_state:'PUBLISHED',description:String(body.description||'').slice(0,5000),title:String(body.title||'').slice(0,255)});
  const r=await fetch(`${graphBase(env)}/me/video_reels?${q}`,{method:'POST'}); const data:any=await r.json().catch(()=>({}));
  if(!r.ok||data.success===false) return json({error:data?.error?.message||'Facebook Reels 發布失敗'},r.status||502);
  const row=await tokenRow(env,'facebook');
  return json({ok:true,videoId,url:row?.channel_id?`https://www.facebook.com/${row.channel_id}/reels/`:undefined});
}

async function instagramCreate(request:Request,env:SocialEnv) {
  await requireAdmin(request,env);
  const body:any=await request.json().catch(()=>({})); const videoUrl=String(body.videoUrl||'').trim();
  const row=await tokenRow(env,'instagram'); if(!row?.channel_id) return json({error:'Instagram 尚未連接'},400);
  if(!/^https:\/\//i.test(videoUrl)) return json({error:'Instagram Reels 需要可公開抓取的 HTTPS 影片網址'},400);
  const token=await accessToken(env,'instagram');
  const q=new URLSearchParams({media_type:'REELS',video_url:videoUrl,caption:String(body.caption||'').slice(0,2200),share_to_feed:body.shareToFeed===false?'false':'true',access_token:token});
  const r=await fetch(`${graphBase(env)}/${encodeURIComponent(String(row.channel_id))}/media?${q}`,{method:'POST'}); const data:any=await r.json().catch(()=>({}));
  if(!r.ok||!data.id) return json({error:data?.error?.message||'Instagram Reels 建立容器失敗'},r.status||502);
  return json({containerId:String(data.id)});
}

async function instagramStatus(request:Request,env:SocialEnv) {
  await requireAdmin(request,env); const url=new URL(request.url),containerId=url.searchParams.get('containerId')||'';
  if(!containerId) return json({error:'缺少 Instagram containerId'},400);
  const token=await accessToken(env,'instagram');
  const r=await fetch(`${graphBase(env)}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(token)}`); const data:any=await r.json().catch(()=>({}));
  if(!r.ok) return json({error:data?.error?.message||'Instagram Reels 狀態查詢失敗'},r.status);
  return json({statusCode:String(data.status_code||''),status:String(data.status||'')});
}

async function instagramPublish(request:Request,env:SocialEnv) {
  await requireAdmin(request,env); const body:any=await request.json().catch(()=>({})); const creationId=String(body.creationId||'');
  const row=await tokenRow(env,'instagram'); if(!row?.channel_id||!creationId) return json({error:'缺少 Instagram 帳號或 creationId'},400);
  const token=await accessToken(env,'instagram'); const q=new URLSearchParams({creation_id:creationId,access_token:token});
  const r=await fetch(`${graphBase(env)}/${encodeURIComponent(String(row.channel_id))}/media_publish?${q}`,{method:'POST'}); const data:any=await r.json().catch(()=>({}));
  if(!r.ok||!data.id) return json({error:data?.error?.message||'Instagram Reels 發布失敗'},r.status||502);
  return json({mediaId:String(data.id),url:row.channel_name?`https://www.instagram.com/${row.channel_name}/reels/`:undefined});
}

async function threadsStart(request:Request,env:SocialEnv) {
  if(!await admin(request,env)) return redirect('/?page=short&login_required=1');
  if(!env.THREADS_APP_ID||!env.THREADS_APP_SECRET) return redirect('/?page=short&setup=threads');
  const url=new URL(request.url),state=randomToken();
  await env.DB.prepare('INSERT INTO oauth_states(state,provider,expires_at) VALUES(?,?,?)').bind(state,'threads',Date.now()+10*60*1000).run();
  const redirectUri=`${url.origin}/api/auth/threads/callback`;
  const q=new URLSearchParams({client_id:env.THREADS_APP_ID,redirect_uri:redirectUri,scope:'threads_basic,threads_content_publish',response_type:'code',state});
  return redirect(`https://threads.net/oauth/authorize?${q}`);
}

async function threadsCallback(request:Request,env:SocialEnv) {
  const url=new URL(request.url),state=url.searchParams.get('state')||'',code=(url.searchParams.get('code')||'').replace(/#_$/,'');
  const st:any=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND provider=? AND expires_at>? RETURNING state').bind(state,'threads',Date.now()).first();
  if(!st) return redirect('/?page=short&social_error=threads_state');
  if(!env.THREADS_APP_ID||!env.THREADS_APP_SECRET) return redirect('/?page=short&setup=threads');
  const redirectUri=`${url.origin}/api/auth/threads/callback`;
  const q=new URLSearchParams({client_id:env.THREADS_APP_ID,client_secret:env.THREADS_APP_SECRET,code,grant_type:'authorization_code',redirect_uri:redirectUri});
  const tokenR=await fetch(`https://graph.threads.net/oauth/access_token?${q}`,{method:'POST'}); const short:any=await tokenR.json().catch(()=>({}));
  if(!tokenR.ok||!short.access_token) return redirect('/?page=short&social_error=threads_token');
  let token=short;
  const longQ=new URLSearchParams({grant_type:'th_exchange_token',client_secret:env.THREADS_APP_SECRET,access_token:String(short.access_token)});
  const longR=await fetch(`https://graph.threads.net/access_token?${longQ}`); const long:any=await longR.json().catch(()=>({}));
  if(longR.ok&&long.access_token) token=long;
  const meR=await fetch(`https://graph.threads.net/me?fields=id,username,threads_profile_picture_url&access_token=${encodeURIComponent(token.access_token)}`); const me:any=await meR.json().catch(()=>({}));
  await upsertToken(env,'threads',token,{channelId:String(me.id||short.user_id||''),channelName:String(me.username||me.id||'Threads'),name:String(me.username||'Threads')});
  return redirect('/?page=short&social=threads');
}

async function threadsCreate(request:Request,env:SocialEnv) {
  await requireAdmin(request,env); const body:any=await request.json().catch(()=>({})); const videoUrl=String(body.videoUrl||'').trim();
  if(!/^https:\/\//i.test(videoUrl)) return json({error:'Threads 影片貼文需要可公開抓取的 HTTPS 影片網址'},400);
  const token=await accessToken(env,'threads');
  const q=new URLSearchParams({media_type:'VIDEO',video_url:videoUrl,text:String(body.text||'').slice(0,500),access_token:token});
  if(body.altText) q.set('alt_text',String(body.altText).slice(0,1000));
  const r=await fetch(`https://graph.threads.net/me/threads?${q}`,{method:'POST'}); const data:any=await r.json().catch(()=>({}));
  if(!r.ok||!data.id) return json({error:data?.error?.message||'Threads 建立影片容器失敗'},r.status||502);
  return json({containerId:String(data.id)});
}

async function threadsPublish(request:Request,env:SocialEnv) {
  await requireAdmin(request,env); const body:any=await request.json().catch(()=>({})); const creationId=String(body.creationId||'');
  if(!creationId) return json({error:'缺少 Threads creationId'},400);
  const token=await accessToken(env,'threads'); const q=new URLSearchParams({creation_id:creationId,access_token:token});
  const r=await fetch(`https://graph.threads.net/me/threads_publish?${q}`,{method:'POST'}); const data:any=await r.json().catch(()=>({}));
  if(!r.ok||!data.id) return json({error:data?.error?.message||'Threads 發布失敗'},r.status||502);
  return json({postId:String(data.id),url:'https://www.threads.net/'});
}

export async function socialRoute(request:Request,env:SocialEnv):Promise<Response|null> {
  const url=new URL(request.url),p=url.pathname,m=request.method.toUpperCase();
  if(p==='/api/social/status'&&m==='GET') return socialStatus(request,env);
  if(p==='/api/auth/meta/start'&&m==='GET') return metaStart(request,env);
  if(p==='/api/auth/meta/callback'&&m==='GET') return metaCallback(request,env);
  if(p==='/api/meta/pages'&&m==='GET') return metaPages(request,env);
  if(p==='/api/meta/select-page'&&m==='POST') return selectMetaPage(request,env);
  if(p==='/api/facebook/reels/start'&&m==='POST') return facebookReelStart(request,env);
  if(p==='/api/facebook/reels/finish'&&m==='POST') return facebookReelFinish(request,env);
  if(p==='/api/instagram/reels/create'&&m==='POST') return instagramCreate(request,env);
  if(p==='/api/instagram/reels/status'&&m==='GET') return instagramStatus(request,env);
  if(p==='/api/instagram/reels/publish'&&m==='POST') return instagramPublish(request,env);
  if(p==='/api/auth/threads/start'&&m==='GET') return threadsStart(request,env);
  if(p==='/api/auth/threads/callback'&&m==='GET') return threadsCallback(request,env);
  if(p==='/api/threads/posts/create'&&m==='POST') return threadsCreate(request,env);
  if(p==='/api/threads/posts/publish'&&m==='POST') return threadsPublish(request,env);
  return null;
}
