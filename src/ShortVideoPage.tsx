import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, LoaderCircle, RefreshCw, Share2, UploadCloud } from 'lucide-react';
import { api } from './api';
import FancySelect from './FancySelect';
import { uploadFacebookReelLocal, type FacebookReelStart } from './upload/facebook';
import { uploadYoutubeFile } from './upload/youtube';

type Status = {
  authenticated: boolean;
  email?: string;
  youtube: { connected: boolean; channelTitle?: string };
};

type SocialStatus = {
  authenticated: boolean;
  metaConfigured: boolean;
  threadsConfigured: boolean;
  metaAuthorized: boolean;
  graphVersion: string;
  facebook: { connected:boolean; pageId?:string; pageName?:string };
  instagram: { connected:boolean; userId?:string; username?:string };
  threads: { connected:boolean; userId?:string; username?:string };
};

type MetaPage = { id:string; name:string; hasInstagram:boolean; instagramUserId?:string };
type PlatformId = 'youtube'|'instagram'|'facebook'|'tiktok'|'threads'|'pinterest'|'x'|'linkedin';
type ProgressState = 'idle'|'uploading'|'done'|'error';
type Progress = { state:ProgressState; pct:number; message?:string; url?:string };

type Platform = {
  id: PlatformId;
  name: string;
  product: string;
  badge: string;
  note: string;
};

const platforms: Platform[] = [
  { id:'youtube', name:'YouTube', product:'Shorts', badge:'YT', note:'沿用現有 YouTube 授權，可直接發布' },
  { id:'instagram', name:'Instagram', product:'Reels', badge:'IG', note:'Meta OAuth 已接入；下一步接公開暫存影片直送 Meta' },
  { id:'facebook', name:'Facebook', product:'Reels', badge:'FB', note:'Meta Page 授權完成後，可由瀏覽器直接上傳影片' },
  { id:'tiktok', name:'TikTok', product:'短影音', badge:'TT', note:'下一階段：TikTok Content Posting API' },
  { id:'threads', name:'Threads', product:'影片貼文', badge:'TH', note:'Threads OAuth 已接入；影片發布需公開暫存網址' },
  { id:'pinterest', name:'Pinterest', product:'Video Pins', badge:'PI', note:'後續接 Pinterest Developer App' },
  { id:'x', name:'X', product:'影片貼文', badge:'X', note:'後續接 X Developer App／API 計費設定' },
  { id:'linkedin', name:'LinkedIn', product:'影片貼文', badge:'IN', note:'後續接 LinkedIn Developer App' },
];

const privacyOptions = [
  { value:'private', label:'私人／草稿' },
  { value:'unlisted', label:'不公開列出／草稿' },
  { value:'public', label:'公開' },
];

function emptyProgress() {
  return Object.fromEntries(platforms.map(item => [item.id,{state:'idle',pct:0}])) as Record<PlatformId,Progress>;
}

export default function ShortVideoPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [metaPages, setMetaPages] = useState<MetaPage[]>([]);
  const [metaPageId, setMetaPageId] = useState('');
  const [socialBusy, setSocialBusy] = useState(false);
  const [socialMessage, setSocialMessage] = useState('');
  const loginError = new URLSearchParams(window.location.search).has('login_error');
  const loginUrl = '/api/auth/youtube/start?returnTo=%2F%3Fpage%3Dshort';
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('#Shorts');
  const [privacy, setPrivacy] = useState('private');
  const [selected, setSelected] = useState<PlatformId[]>(['youtube']);
  const [progress, setProgress] = useState<Record<PlatformId, Progress>>(emptyProgress);
  const [busy, setBusy] = useState(false);
  const [videoMeta, setVideoMeta] = useState({ width:0, height:0, duration:0 });

  async function refreshConnections() {
    const [base,socialState] = await Promise.all([
      api<Status>('/api/status').catch(() => ({authenticated:false,youtube:{connected:false}} as Status)),
      api<SocialStatus>('/api/social/status').catch(() => ({authenticated:false,metaConfigured:false,threadsConfigured:false,metaAuthorized:false,graphVersion:'v26.0',facebook:{connected:false},instagram:{connected:false},threads:{connected:false}} as SocialStatus)),
    ]);
    setStatus(base);
    setSocial(socialState);
    return socialState;
  }

  async function loadMetaPages() {
    try {
      const data = await api<{pages:MetaPage[]}>('/api/meta/pages');
      setMetaPages(data.pages || []);
      setMetaPageId(current => current || social?.facebook.pageId || data.pages?.[0]?.id || '');
    } catch (error) {
      setSocialMessage(error instanceof Error ? error.message : '讀取 Meta 粉絲專頁失敗');
    }
  }

  useEffect(() => {
    void refreshConnections().then(next => {
      if (next.metaAuthorized) void api<{pages:MetaPage[]}>('/api/meta/pages').then(data => {
        setMetaPages(data.pages || []);
        setMetaPageId(next.facebook.pageId || data.pages?.[0]?.id || '');
      }).catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    if (!video) { setVideoUrl(''); return; }
    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);

  const available = useMemo(() => {
    const set = new Set<PlatformId>();
    if (status?.authenticated && status.youtube.connected) set.add('youtube');
    if (social?.authenticated && social.facebook.connected) set.add('facebook');
    return set;
  }, [status?.authenticated, status?.youtube.connected, social?.authenticated, social?.facebook.connected]);
  const selectedAvailable = selected.filter(id => available.has(id));
  const facebookRatio = videoMeta.width && videoMeta.height ? videoMeta.width / videoMeta.height : 0;
  const facebookCompatible = !video || (
    videoMeta.duration >= 4 && videoMeta.duration <= 60 &&
    facebookRatio > 0 && Math.abs(facebookRatio - 9/16) <= 0.025
  );
  const selectedFacebookInvalid = selectedAvailable.includes('facebook') && !facebookCompatible;
  const canPublish = !!video && !!title.trim() && selectedAvailable.length > 0 && !busy && !selectedFacebookInvalid;

  function chooseVideo(file: File | null) {
    if (!file) { setVideo(null); setTitle(''); setCaption(''); setVideoMeta({width:0,height:0,duration:0}); return; }
    if (file.type && !file.type.startsWith('video/')) return;
    setVideo(file);
    setTitle(file.name.slice(0,100));
    setCaption(file.name);
    setVideoMeta({width:0,height:0,duration:0});
    setProgress(emptyProgress());
  }

  function dropVideo(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    chooseVideo(event.dataTransfer.files?.[0] || null);
  }

  function togglePlatform(id: PlatformId) {
    if (!available.has(id)) return;
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current,id]);
  }

  async function selectMetaPage() {
    if (!metaPageId || socialBusy) return;
    setSocialBusy(true); setSocialMessage('正在連結 Facebook 粉絲專頁與 Instagram 專業帳號…');
    try {
      await api('/api/meta/select-page',{method:'POST',body:JSON.stringify({pageId:metaPageId})});
      const next = await refreshConnections();
      setSocialMessage(next.instagram.connected ? 'Meta 已完成：Facebook Reels 與 Instagram 專業帳號皆已連結。' : 'Facebook 粉絲專頁已連結；此 Page 尚未偵測到 Instagram 專業帳號。');
    } catch (error) {
      setSocialMessage(error instanceof Error ? error.message : '套用 Meta 粉絲專頁失敗');
    } finally {
      setSocialBusy(false);
    }
  }

  async function getYoutubeAccessToken() {
    return (await api<{accessToken:string}>('/api/youtube/access-token')).accessToken;
  }

  async function publishYoutube() {
    if (!video) return;
    setProgress(current => ({...current,youtube:{state:'uploading',pct:0,message:'建立 YouTube Shorts 上傳工作階段'}}));
    const description = [caption.trim(), hashtags.trim()].filter(Boolean).join('\n\n');
    const tagList = hashtags.split(/\s+/).map(item => item.replace(/^#/,'').trim()).filter(Boolean);
    const start = await api<{uploadUrl:string;accessToken:string}>('/api/youtube/upload-session',{
      method:'POST',
      body:JSON.stringify({
        title:title.trim().slice(0,100), description, tags:tagList, language:'zh-TW', privacy,
        youtubeCategory:'22', fileSize:video.size, mimeType:video.type||'video/mp4', madeForKids:false,
        containsSyntheticMedia:false, license:'youtube', embeddable:true, publicStatsViewable:true, notifySubscribers:true,
      }),
    });
    const result = await uploadYoutubeFile(video,start,pct=>setProgress(current=>({...current,youtube:{state:'uploading',pct,message:'直接從瀏覽器上傳到 YouTube'}})),getYoutubeAccessToken);
    const url = result.id ? `https://youtu.be/${result.id}` : undefined;
    setProgress(current=>({...current,youtube:{state:'done',pct:100,message:'YouTube 已完成；符合 Shorts 條件時由 YouTube 自動歸類',url}}));
  }

  async function publishFacebook() {
    if (!video) return;
    setProgress(current=>({...current,facebook:{state:'uploading',pct:0,message:'建立 Facebook Reels 上傳工作階段'}}));
    const start = await api<FacebookReelStart>('/api/facebook/reels/start',{method:'POST',body:'{}'});
    await uploadFacebookReelLocal(video,start,pct=>setProgress(current=>({...current,facebook:{state:'uploading',pct,message:'影片直接從瀏覽器傳到 Facebook'}})));
    const description = [caption.trim(),hashtags.trim()].filter(Boolean).join('\n\n');
    const finish = await api<{ok:boolean;url?:string}>('/api/facebook/reels/finish',{
      method:'POST',
      body:JSON.stringify({videoId:start.videoId,title:title.trim(),description,videoState:privacy==='public'?'PUBLISHED':'DRAFT'}),
    });
    setProgress(current=>({...current,facebook:{state:'done',pct:100,message:privacy==='public'?'Facebook Reels 已發布':'Facebook Reels 已上傳為草稿',url:finish.url}}));
  }

  async function publish() {
    if (!canPublish) return;
    setBusy(true);
    const tasks: Promise<void>[] = [];
    if (selectedAvailable.includes('youtube')) tasks.push(publishYoutube().catch(error => {
      setProgress(current=>({...current,youtube:{state:'error',pct:0,message:error instanceof Error?error.message:'YouTube Shorts 發布失敗'}}));
    }));
    if (selectedAvailable.includes('facebook')) tasks.push(publishFacebook().catch(error => {
      setProgress(current=>({...current,facebook:{state:'error',pct:0,message:error instanceof Error?error.message:'Facebook Reels 發布失敗'}}));
    }));
    await Promise.allSettled(tasks);
    setBusy(false);
  }

  const pageOptions = metaPages.map(page => ({value:page.id,label:page.name,hint:page.hasInstagram?'已連結 Instagram 專業帳號':'未偵測到 Instagram 專業帳號'}));

  return <main className="short-page shell">
    <section className="short-hero">
      <div><div className="eyebrow">SHORT VIDEO SYNC</div><h1>短影音</h1><p>一支直式短影音，集中準備文案與平台，再從同一頁同步發布。YouTube Shorts 與 Facebook Reels 已進入正式串接；Instagram Reels、Threads 的官方 OAuth 與發布 API 也已接入，下一步補上公開暫存影片流程。</p></div>
      <div className="short-hero-mark"><img src="/stars-sync.svg" alt=""/><span>繁星同步</span></div>
    </section>

    <section className="panel social-connect-panel">
      <div className="short-section-heading"><div><div className="eyebrow">ACCOUNTS</div><h2>① 社群帳號連線</h2></div><button type="button" className="small-button" onClick={()=>void refreshConnections()}><RefreshCw size={14}/>更新狀態</button></div>
      {status && !status.authenticated && <div className="notice info" role="status"><span>請先使用管理員 Google 帳號登入／重新授權 YouTube。登入完成後會返回短影音頁，再連接 Meta 或 Threads。</span><a className="small-button" href={loginUrl}>管理員登入 <ExternalLink size={14}/></a></div>}
      {loginError && <div className="social-message" role="alert">Google 授權未完成，請重新登入。</div>}
      <div className="social-connect-grid">
        <div className={`social-connect-card ${social?.facebook.connected?'connected':''}`}>
          <div className="social-connect-title"><span className="platform-badge">META</span><div><b>Meta</b><small>Facebook Reels ＋ Instagram Reels</small></div></div>
          {!social?.metaConfigured ? <><p>程式端已完成，還差 Meta Developer App 的 App ID／Secret。</p><span className="setup-chip">等待 Developer App</span></> : !social.metaAuthorized ? <><p>先授權 Meta，繁星同步才能讀取你管理的粉絲專頁。</p><a className="small-button" href="/api/auth/meta/start">連接 Meta <ExternalLink size={14}/></a></> : <>
            <p>Meta 已授權。選擇要同步的 Facebook 粉絲專頁；如果它有綁 Instagram 專業帳號會一起帶入。</p>
            {pageOptions.length>0 ? <div className="social-page-picker"><FancySelect value={metaPageId} options={pageOptions} onChange={setMetaPageId}/><button type="button" className="small-button" disabled={!metaPageId||socialBusy} onClick={()=>void selectMetaPage()}>{socialBusy?'套用中…':'套用這個 Page'}</button></div> : <button type="button" className="small-button" onClick={()=>void loadMetaPages()}>讀取粉絲專頁</button>}
            <div className="social-account-status"><span className={social.facebook.connected?'ok':''}>Facebook：{social.facebook.connected?social.facebook.pageName:'尚未選擇'}</span><span className={social.instagram.connected?'ok':''}>Instagram：{social.instagram.connected?`@${social.instagram.username}`:'尚未連結'}</span></div>
          </>}
        </div>
        <div className={`social-connect-card ${social?.threads.connected?'connected':''}`}>
          <div className="social-connect-title"><span className="platform-badge">TH</span><div><b>Threads</b><small>官方 Threads API</small></div></div>
          {!social?.threadsConfigured ? <><p>Threads API 程式已完成，還差 Threads App ID／Secret。</p><span className="setup-chip">等待 Developer App</span></> : social.threads.connected ? <><p>已連結 @{social.threads.username}。下一步加入影片公開暫存後即可一鍵影片貼文。</p><a className="small-button" href="/api/auth/threads/start">重新授權 <ExternalLink size={14}/></a></> : <><p>授權範圍使用 threads_basic＋threads_content_publish。</p><a className="small-button" href="/api/auth/threads/start">連接 Threads <ExternalLink size={14}/></a></>}
        </div>
      </div>
      {socialMessage&&<div className="social-message">{socialMessage}</div>}
    </section>

    <section className="panel short-platform-panel">
      <div className="short-section-heading"><div><div className="eyebrow">PLATFORMS</div><h2>② 選擇短影音平台</h2></div><span className="api-badge">一鍵發布架構</span></div>
      <div className="short-platform-grid">
        {platforms.map(platform => {
          const ready = available.has(platform.id);
          const connectedWaiting = (platform.id==='instagram'&&social?.instagram.connected)||(platform.id==='threads'&&social?.threads.connected);
          const checked = selected.includes(platform.id) && ready;
          return <button type="button" key={platform.id} className={`short-platform-card ${ready?'ready':'planned'} ${checked?'selected':''} ${connectedWaiting?'connected-waiting':''}`} onClick={()=>togglePlatform(platform.id)} disabled={!ready}>
            <span className="platform-badge">{platform.badge}</span>
            <span className="platform-copy"><b>{platform.name} <em>{platform.product}</em></b><small>{platform.note}</small></span>
            <span className="platform-state">{ready ? (checked ? <CheckCircle2 size={20}/> : <Circle size={20}/>) : connectedWaiting ? '已連接・待暫存' : '待串接'}</span>
          </button>;
        })}
      </div>
      {!status?.youtube.connected && <div className="notice info"><span>YouTube 尚未連接，先完成授權即可直接使用 Shorts 發布。</span><a className="small-button" href={loginUrl}>連接 YouTube <ExternalLink size={14}/></a></div>}
    </section>

    <section className="panel short-compose-panel">
      <div className="short-section-heading"><div><div className="eyebrow">CONTENT</div><h2>③ 短影音與文案</h2></div></div>
      <div className="short-compose-grid">
        <label className={`short-dropzone ${dragActive?'drag-active':''}`} onDragEnter={e=>{e.preventDefault();setDragActive(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={()=>setDragActive(false)} onDrop={dropVideo}>
          <UploadCloud size={28}/><b>{video?video.name:'點選或拖曳短影音到這裡'}</b><small>{video?`${(video.size/1024/1024).toFixed(1)} MB`:'建議使用直式 9:16 MP4；影片本體直接由瀏覽器傳到平台'}</small><input type="file" accept="video/*" onChange={e=>chooseVideo(e.target.files?.[0]||null)}/>
        </label>
        <div className="short-preview-box">
          {videoUrl ? <video src={videoUrl} controls muted playsInline preload="metadata" onLoadedMetadata={e=>setVideoMeta({width:e.currentTarget.videoWidth,height:e.currentTarget.videoHeight,duration:e.currentTarget.duration||0})}/> : <div className="short-preview-empty">9:16<br/>PREVIEW</div>}
          {video && <div className="short-video-meta"><span>{videoMeta.width&&videoMeta.height?`${videoMeta.width}×${videoMeta.height}`:'讀取尺寸中'}</span><span>{videoMeta.duration?`${Math.round(videoMeta.duration)} 秒`:'讀取長度中'}</span></div>}
        </div>
        <div className="short-fields">
          <label>標題<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={100}/><small>{title.length}/100</small></label>
          <label>貼文說明<textarea value={caption} onChange={e=>setCaption(e.target.value)} rows={5}/></label>
          <label>Hashtag<input value={hashtags} onChange={e=>setHashtags(e.target.value)} placeholder="#Shorts #繁星同步"/></label>
          <div className="field-block"><span className="field-label">公開狀態</span><FancySelect value={privacy} options={privacyOptions} onChange={setPrivacy}/><small>Facebook 選「私人／不公開」時會先建立為草稿；YouTube 依原本隱私設定處理。</small></div>
        </div>
      </div>
      {video&&selectedAvailable.includes('facebook')&&!facebookCompatible&&<div className="compat-warning">Facebook Reels 官方本機上傳規格目前要求 9:16、4～60 秒。這支影片是 {videoMeta.width}×{videoMeta.height}、約 {Math.round(videoMeta.duration)} 秒，因此先阻止 Facebook 發布，避免 API 上傳失敗。</div>}
    </section>

    <section className="panel short-publish-panel">
      <div className="publish-head"><div><div className="eyebrow">PUBLISH</div><h2>④ 一鍵同步發布</h2></div><button type="button" className="primary" disabled={!canPublish} onClick={()=>void publish()}><Share2 size={18}/>{busy?'正在同步…':'發布到已勾選平台'}</button></div>
      <p className="short-publish-note">目前可實際執行：YouTube Shorts；Meta Developer App 完成設定與授權後，Facebook Reels 也可直接啟用。Instagram Reels 與 Threads 已完成 OAuth／發布 API，因官方需要可公開抓取的影片網址，下一步會加入「瀏覽器直傳暫存 → Meta/Threads 抓取 → 發布完成自動刪除」流程，影片仍不經 Cloudflare Worker。</p>
      {platforms.map(platform => {
        const item = progress[platform.id];
        if (item.state === 'idle') return null;
        return <div key={platform.id} className={`short-progress ${item.state}`}><div><span className="platform-badge mini">{platform.badge}</span><b>{platform.name}</b><span>{item.message}</span>{item.state==='uploading'&&<LoaderCircle className="spin" size={17}/>} {item.url&&<a href={item.url} target="_blank" rel="noreferrer">開啟 <ExternalLink size={13}/></a>}</div><div className="bar"><i style={{width:`${item.pct}%`}}/></div></div>;
      })}
    </section>
  </main>;
}
