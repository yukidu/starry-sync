type FacebookEnv = {
  DB: D1Database;
  ADMIN_EMAIL: string;
  TOKEN_ENCRYPTION_KEY: string;
  META_GRAPH_VERSION?: string;
};

const SESSION = 'svs_session';
const headers = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' };
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function fromBase64url(value:string){const p=value.replace(/-/g,'+').replace(/_/g,'/');const pad='='.repeat((4-p.length%4)%4);return Uint8Array.from(atob(p+pad),c=>c.charCodeAt(0));}
function cookies(request:Request){return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));}
async function isAdmin(request:Request,env:FacebookEnv){const sid=cookies(request)[SESSION];if(!sid)return false;const row:any=await env.DB.prepare('SELECT email,expires_at FROM admin_sessions WHERE id=?').bind(sid).first();return Boolean(row&&Number(row.expires_at||0)>Date.now()&&String(row.email||'').toLowerCase()===String(env.ADMIN_EMAIL||'').toLowerCase());}
async function key(env:FacebookEnv){const raw=fromBase64url(env.TOKEN_ENCRYPTION_KEY||'');if(raw.length!==32)throw new Error('TOKEN_ENCRYPTION_KEY 格式錯誤');return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);}
async function decrypt(env:FacebookEnv,value:string){const [ivRaw,dataRaw]=value.split('.');const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64url(ivRaw)},await key(env),fromBase64url(dataRaw));return new TextDecoder().decode(clear);}

export async function facebookReelFinishRoute(request:Request,env:FacebookEnv):Promise<Response|null>{
  const url=new URL(request.url);
  if(url.pathname!=='/api/facebook/reels/finish'||request.method.toUpperCase()!=='POST')return null;
  if(!(await isAdmin(request,env)))return json({error:'請先用指定管理員帳號登入'},401);
  const body:any=await request.json().catch(()=>({}));
  const videoId=String(body.videoId||'');
  if(!videoId)return json({error:'缺少 Facebook videoId'},400);
  const row:any=await env.DB.prepare('SELECT channel_id,access_token_enc,access_expires_at FROM platform_tokens WHERE provider=?').bind('facebook').first();
  if(!row?.access_token_enc)return json({error:'Facebook 尚未連接'},400);
  if(Number(row.access_expires_at||0)<Date.now()+30000)return json({error:'Facebook 授權已到期，請重新連接'},401);
  const accessToken=await decrypt(env,String(row.access_token_enc));
  const requested=String(body.videoState||'PUBLISHED').toUpperCase();
  const videoState=['PUBLISHED','DRAFT','SCHEDULED'].includes(requested)?requested:'PUBLISHED';
  const q=new URLSearchParams({
    access_token:accessToken,
    video_id:videoId,
    upload_phase:'finish',
    video_state:videoState,
    description:String(body.description||'').slice(0,5000),
    title:String(body.title||'').slice(0,255),
  });
  const version=env.META_GRAPH_VERSION?.trim()||'v26.0';
  const response=await fetch(`https://graph.facebook.com/${version}/me/video_reels?${q}`,{method:'POST'});
  const data:any=await response.json().catch(()=>({}));
  if(!response.ok||data.success===false)return json({error:data?.error?.message||'Facebook Reels 發布失敗'},response.status||502);
  return json({ok:true,videoId,videoState,url:row.channel_id?`https://www.facebook.com/${row.channel_id}/reels/`:undefined});
}
