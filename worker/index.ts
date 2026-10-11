interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME: string;
  ADMIN_EMAIL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GJW_CLIENT_ID: string;
  GJW_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY: string;
}

const SESSION = 'svs_session';
const DAY = 86400000;
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...headers } });
}
function redirect(url: string, headers: HeadersInit = {}) { return new Response(null, { status: 302, headers: { location: url, ...headers } }); }
function base64url(bytes: Uint8Array) { let s=''; bytes.forEach(b=>s+=String.fromCharCode(b)); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function randomToken(size=32) { const b=new Uint8Array(size); crypto.getRandomValues(b); return base64url(b); }
async function sha256(v:string) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))); }

async function encryptionKey(env: Env) {
  const raw = Uint8Array.from(atob(env.TOKEN_ENCRYPTION_KEY.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY 必須是 32 bytes 的 base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function encrypt(env: Env, value: string) {
  const iv=new Uint8Array(12); crypto.getRandomValues(iv); const key=await encryptionKey(env);
  const enc=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value)));
  return `${base64url(iv)}.${base64url(enc)}`;
}
function fromBase64url(v:string) { const p=v.replace(/-/g,'+').replace(/_/g,'/'); const pad='='.repeat((4-p.length%4)%4); return Uint8Array.from(atob(p+pad),c=>c.charCodeAt(0)); }
async function decrypt(env: Env, value?: string|null) {
  if (!value) return '';
  const [ivRaw, dataRaw]=value.split('.'); const key=await encryptionKey(env);
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64url(ivRaw)},key,fromBase64url(dataRaw));
  return new TextDecoder().decode(clear);
}

function cookies(request:Request) { return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];})); }
async function admin(request:Request, env:Env) {
  const sid=cookies(request)[SESSION]; if(!sid) return null;
  const row:any=await env.DB.prepare('SELECT email, expires_at FROM admin_sessions WHERE id=?').bind(sid).first();
  if(!row || row.expires_at<Date.now()) return null;
  return String(row.email).toLowerCase()===String(env.ADMIN_EMAIL).toLowerCase() ? row : null;
}
async function requireAdmin(request:Request, env:Env) { const a=await admin(request,env); if(!a) throw new Response(JSON.stringify({error:'請先用指定管理員 Google 帳號連接 YouTube'}),{status:401,headers:jsonHeaders}); return a; }

async function upsertToken(env:Env, provider:string, token:any, meta:any={}) {
  const old:any=await env.DB.prepare('SELECT refresh_token_enc FROM platform_tokens WHERE provider=?').bind(provider).first();
  const access=await encrypt(env,String(token.access_token||''));
  const refresh=token.refresh_token ? await encrypt(env,String(token.refresh_token)) : old?.refresh_token_enc || null;
  await env.DB.prepare(`INSERT INTO platform_tokens(provider,account_email,account_name,channel_id,channel_name,access_token_enc,refresh_token_enc,access_expires_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET account_email=excluded.account_email,account_name=excluded.account_name,channel_id=excluded.channel_id,channel_name=excluded.channel_name,access_token_enc=excluded.access_token_enc,refresh_token_enc=excluded.refresh_token_enc,access_expires_at=excluded.access_expires_at,updated_at=excluded.updated_at`)
    .bind(provider,meta.email||null,meta.name||null,meta.channelId||null,meta.channelName||null,access,refresh,Date.now()+Number(token.expires_in||3600)*1000,Date.now()).run();
}
async function tokenRow(env:Env, provider:string) { return env.DB.prepare('SELECT * FROM platform_tokens WHERE provider=?').bind(provider).first<any>(); }

async function youtubeAccess(env:Env) {
  const row:any=await tokenRow(env,'youtube'); if(!row) throw new Error('YouTube 尚未連接');
  if(Number(row.access_expires_at||0)>Date.now()+60000) return decrypt(env,row.access_token_enc);
  const refresh=await decrypt(env,row.refresh_token_enc); if(!refresh) throw new Error('YouTube refresh token 不存在，請重新授權');
  const form=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}); const t:any=await r.json();
  if(!r.ok) throw new Error(t.error_description||'YouTube token 更新失敗'); await upsertToken(env,'youtube',t,{email:row.account_email,name:row.account_name,channelId:row.channel_id,channelName:row.channel_name}); return String(t.access_token);
}
async function gjwAccess(env:Env) {
  const row:any=await tokenRow(env,'gjw'); if(!row) throw new Error('Gan Jing World 尚未連接');
  if(Number(row.access_expires_at||0)>Date.now()+60000) return decrypt(env,row.access_token_enc);
  const refresh=await decrypt(env,row.refresh_token_enc); if(!refresh) throw new Error('Gan Jing World refresh token 不存在，請重新授權');
  const r=await fetch('https://api.ganjingworld.com/v1/oauth2/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',refresh_token:refresh,client_id:env.GJW_CLIENT_ID})}); const t:any=await r.json();
  if(!r.ok) throw new Error(t.message||t.error_description||'Gan Jing World token 更新失敗'); await upsertToken(env,'gjw',t,{email:row.account_email,name:row.account_name,channelId:row.channel_id,channelName:row.channel_name}); return String(t.access_token);
}
async function gjwUploadToken(env:Env){const access=await gjwAccess(env);const r=await fetch('https://api.ganjingworld.com/v1/media/token',{headers:{Authorization:access}});const d:any=await r.json();if(!r.ok)throw new Error(d.message||'無法取得 Gan Jing World upload token');return String(d?.data?.upload_token||d?.upload_token||d?.data?.token||d?.token||'');}

async function youtubeStart(request:Request,env:Env){
  const url=new URL(request.url),state=randomToken(); await env.DB.prepare('INSERT INTO oauth_states(state,provider,expires_at) VALUES(?,?,?)').bind(state,'youtube',Date.now()+10*60*1000).run();
  const redirectUri=`${url.origin}/api/auth/youtube/callback`;
  const q=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',access_type:'offline',include_granted_scopes:'true',prompt:'consent',state});
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}
async function youtubeCallback(request:Request,env:Env){
  const url=new URL(request.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||''; const st:any=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND provider=? AND expires_at>? RETURNING state').bind(state,'youtube',Date.now()).first(); if(!st)return json({error:'YouTube OAuth state 無效或逾時'},400);
  const redirectUri=`${url.origin}/api/auth/youtube/callback`;const form=new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectUri,grant_type:'authorization_code'}); const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}); const t:any=await r.json();if(!r.ok)return json({error:t.error_description||'Google OAuth 失敗'},400);
  const meR=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:`Bearer ${t.access_token}`}});const me:any=await meR.json();if(String(me.email||'').toLowerCase()!==String(env.ADMIN_EMAIL).toLowerCase())return json({error:'這個 Google 帳號不是 StarsVideoSync 指定管理員'},403);
  const chR=await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:`Bearer ${t.access_token}`}});const ch:any=await chR.json();const channel=ch.items?.[0];await upsertToken(env,'youtube',t,{email:me.email,name:me.name,channelId:channel?.id,channelName:channel?.snippet?.title});
  const sid=randomToken();await env.DB.prepare('INSERT INTO admin_sessions(id,email,expires_at,created_at) VALUES(?,?,?,?)').bind(sid,me.email,Date.now()+30*DAY,Date.now()).run();
  return redirect('/',{'set-cookie':`${SESSION}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30*86400}`});
}
async function gjwStart(request:Request,env:Env){await requireAdmin(request,env);const url=new URL(request.url),state=randomToken(),verifier=randomToken(48),challenge=base64url(await sha256(verifier));await env.DB.prepare('INSERT INTO oauth_states(state,provider,verifier,expires_at) VALUES(?,?,?,?)').bind(state,'gjw',verifier,Date.now()+10*60*1000).run();const q=new URLSearchParams({client_id:env.GJW_CLIENT_ID,redirect_uri:`${url.origin}/api/auth/gjw/callback`,response_type:'code',state,code_challenge:challenge,code_challenge_method:'S256'});return redirect(`https://www.ganjingworld.com/v1/oauth2/authorize?${q}`);}
async function gjwCallback(request:Request,env:Env){const url=new URL(request.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';const st:any=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND provider=? AND expires_at>? RETURNING verifier').bind(state,'gjw',Date.now()).first();if(!st)return json({error:'Gan Jing World OAuth state 無效或逾時'},400);const form=new URLSearchParams({code,code_verifier:st.verifier,client_id:env.GJW_CLIENT_ID,redirect_uri:`${url.origin}/api/auth/gjw/callback`,grant_type:'authorization_code'});if(env.GJW_CLIENT_SECRET)form.set('client_secret',env.GJW_CLIENT_SECRET);const r=await fetch('https://www.ganjingworld.com/v1/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});const t:any=await r.json();if(!r.ok)return json({error:t.error_description||t.message||'Gan Jing World OAuth 失敗'},400);const meR=await fetch('https://api.ganjingworld.com/v1/oauth2/me',{headers:{Authorization:String(t.access_token)}});const me:any=await meR.json();const data=me.data||me;await upsertToken(env,'gjw',t,{email:data.email,name:data.name||data.nickname,channelId:data.pid,channelName:data.channel_name||data.name||data.nickname});return redirect('/');}

async function route(request:Request,env:Env){const url=new URL(request.url),p=url.pathname,m=request.method.toUpperCase();
  if(p==='/api/auth/youtube/start')return youtubeStart(request,env);if(p==='/api/auth/youtube/callback')return youtubeCallback(request,env);if(p==='/api/auth/gjw/start')return gjwStart(request,env);if(p==='/api/auth/gjw/callback')return gjwCallback(request,env);
  if(p==='/api/status'&&m==='GET'){const a=await admin(request,env);const yt:any=await tokenRow(env,'youtube');const gjw:any=await tokenRow(env,'gjw');return json({authenticated:!!a,email:a?.email,youtube:{connected:!!yt,channelTitle:yt?.channel_name},gjw:{connected:!!gjw,channelName:gjw?.channel_name}});}
  await requireAdmin(request,env);
  if(p==='/api/youtube/access-token'&&m==='GET')return json({accessToken:await youtubeAccess(env)});
  if(p==='/api/youtube/upload-session'&&m==='POST'){const b:any=await request.json();const access=await youtubeAccess(env);const body={snippet:{title:b.title,description:b.description,tags:b.tags||[],categoryId:String(b.youtubeCategory||'22'),defaultLanguage:b.language||'zh-TW'},status:{privacyStatus:b.privacy||'private',selfDeclaredMadeForKids:!!b.madeForKids}};const r=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{Authorization:`Bearer ${access}`,'content-type':'application/json; charset=UTF-8','X-Upload-Content-Length':String(b.fileSize),'X-Upload-Content-Type':String(b.mimeType||'video/mp4')},body:JSON.stringify(body)});if(!r.ok)return json({error:`YouTube 建立上傳工作階段失敗：${(await r.text()).slice(0,300)}`},r.status);const uploadUrl=r.headers.get('location');if(!uploadUrl)return json({error:'YouTube 沒有回傳 resumable upload URL'},502);return json({uploadUrl,accessToken:access});}
  if(p==='/api/gjw/upload-token'&&m==='GET')return json({uploadToken:await gjwUploadToken(env)});
  if(p==='/api/gjw/create-video'&&m==='POST'){const b:any=await request.json();const access=await gjwAccess(env);const body:any={type:'Video',title:b.title,description:b.description||'',category_id:b.gjwCategory,lang:b.language||'zh-TW',visibility:b.privacy==='private'?'private':'public',poster_url:b.posterUrl,poster_hd_url:b.posterHdUrl,made_for_kids:!!b.madeForKids,user_made_for_kids:!!b.madeForKids,auto_caption_flag:true};if(b.privacy==='private')body.mode='draft';const cr=await fetch('https://api.ganjingworld.com/v1/content/create',{method:'POST',headers:{Authorization:access,'content-type':'application/json'},body:JSON.stringify(body)});const cd:any=await cr.json();if(!cr.ok)return json({error:cd.message||'Gan Jing World 建立影片資料失敗'},cr.status);const contentId=String(cd?.data?.content_id||cd?.data?.id||cd?.content_id||'');if(!contentId)return json({error:'Gan Jing World 沒有回傳 content id'},502);const uploadId=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');const ir=await fetch('https://api.ganjingworld.com/v1/media/upload/id',{method:'POST',headers:{Authorization:access,'content-type':'application/json'},body:JSON.stringify({content_id:contentId,upload_id:uploadId,type:'TUS'})});if(!ir.ok)return json({error:'Gan Jing World 註冊 upload id 失敗'},ir.status);const row:any=await tokenRow(env,'gjw');return json({contentId,channelId:row?.channel_id,uploadId});}
  if(p==='/api/gjw/finish-video'&&m==='POST'){const b:any=await request.json();const token=await gjwUploadToken(env);const idR=await fetch(String(b.tusUrl),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});const idD:any=await idR.json();if(!idR.ok)return json({error:'無法取得 Gan Jing World video id'},idR.status);const videoId=String(idD?.body?.video_id||'');if(!videoId)return json({error:'Gan Jing World 沒有回傳 video id'},502);return json({videoId});}
  if(p==='/api/gjw/video-status'&&m==='GET'){const videoId=url.searchParams.get('videoId')||'';const contentId=url.searchParams.get('contentId')||'';if(!videoId||!contentId)return json({error:'缺少 Gan Jing World videoId/contentId'},400);const token=await gjwUploadToken(env);const sr=await fetch(`https://vodapi.cloudokyo.cloud/api/v1/status/${encodeURIComponent(videoId)}`,{headers:{Authorization:`Bearer ${token}`}});const sd:any=await sr.json();if(!sr.ok)return json({error:sd?.message||'Gan Jing World 狀態查詢失敗'},sr.status);if(sd?.body?.url)return json({ready:true,url:`https://www.ganjingworld.com/video/${contentId}`,playbackUrl:sd.body.url});if(['error','failed'].includes(String(sd?.body?.status||'').toLowerCase()))return json({error:'Gan Jing World 轉碼失敗'},502);return json({ready:false,progress:Number(sd?.body?.progress||0),status:sd?.body?.status||'processing'});}
  return json({error:'Not found'},404);
}

export default {async fetch(request:Request,env:Env){try{const u=new URL(request.url);if(u.pathname.startsWith('/api/'))return await route(request,env);return env.ASSETS.fetch(request);}catch(e){if(e instanceof Response)return e;console.error(e);return json({error:e instanceof Error?e.message:'Unexpected error'},500);}}};
