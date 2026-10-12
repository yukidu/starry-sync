import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, LoaderCircle, Share2, UploadCloud } from 'lucide-react';
import { api } from './api';
import FancySelect from './FancySelect';
import { uploadYoutubeFile } from './upload/youtube';

type Status = {
  authenticated: boolean;
  email?: string;
  youtube: { connected: boolean; channelTitle?: string };
};

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
  { id:'instagram', name:'Instagram', product:'Reels', badge:'IG', note:'等待 Meta Developer App 串接' },
  { id:'facebook', name:'Facebook', product:'Reels', badge:'FB', note:'等待 Meta Developer App 串接' },
  { id:'tiktok', name:'TikTok', product:'短影音', badge:'TT', note:'等待 TikTok Developer App／審核' },
  { id:'threads', name:'Threads', product:'影片貼文', badge:'TH', note:'等待 Threads API Developer App 串接' },
  { id:'pinterest', name:'Pinterest', product:'Video Pins', badge:'PI', note:'等待 Pinterest Developer App 串接' },
  { id:'x', name:'X', product:'影片貼文', badge:'X', note:'等待 X Developer App／API 計費設定' },
  { id:'linkedin', name:'LinkedIn', product:'影片貼文', badge:'IN', note:'等待 LinkedIn Developer App 串接' },
];

const privacyOptions = [
  { value:'private', label:'私人' },
  { value:'unlisted', label:'不公開列出' },
  { value:'public', label:'公開' },
];

export default function ShortVideoPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('#Shorts');
  const [privacy, setPrivacy] = useState('private');
  const [selected, setSelected] = useState<PlatformId[]>(['youtube']);
  const [progress, setProgress] = useState<Record<PlatformId, Progress>>(() => Object.fromEntries(platforms.map(item => [item.id,{state:'idle',pct:0}])) as Record<PlatformId,Progress>);
  const [busy, setBusy] = useState(false);
  const [videoMeta, setVideoMeta] = useState({ width:0, height:0, duration:0 });

  useEffect(() => {
    api<Status>('/api/status').then(setStatus).catch(() => setStatus({authenticated:false,youtube:{connected:false}}));
  }, []);

  useEffect(() => {
    if (!video) { setVideoUrl(''); return; }
    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);

  const available = useMemo(() => new Set<PlatformId>(status?.youtube.connected ? ['youtube'] : []), [status?.youtube.connected]);
  const selectedAvailable = selected.filter(id => available.has(id));
  const canPublish = !!video && !!title.trim() && selectedAvailable.length > 0 && !busy;

  function chooseVideo(file: File | null) {
    if (!file) { setVideo(null); setTitle(''); setCaption(''); setVideoMeta({width:0,height:0,duration:0}); return; }
    if (file.type && !file.type.startsWith('video/')) return;
    setVideo(file);
    setTitle(file.name.slice(0,100));
    setCaption(file.name);
    setVideoMeta({width:0,height:0,duration:0});
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
        title:title.trim().slice(0,100),
        description,
        tags:tagList,
        language:'zh-TW',
        privacy,
        youtubeCategory:'22',
        fileSize:video.size,
        mimeType:video.type||'video/mp4',
        madeForKids:false,
        containsSyntheticMedia:false,
        license:'youtube',
        embeddable:true,
        publicStatsViewable:true,
        notifySubscribers:true,
      }),
    });
    const result = await uploadYoutubeFile(video,start,pct=>setProgress(current=>({...current,youtube:{state:'uploading',pct,message:'直接從瀏覽器上傳到 YouTube'}})),getYoutubeAccessToken);
    const url = result.id ? `https://youtu.be/${result.id}` : undefined;
    setProgress(current=>({...current,youtube:{state:'done',pct:100,message:'YouTube 已完成；符合 Shorts 條件時由 YouTube 自動歸類',url}}));
  }

  async function publish() {
    if (!canPublish) return;
    setBusy(true);
    try {
      const tasks: Promise<void>[] = [];
      if (selectedAvailable.includes('youtube')) tasks.push(publishYoutube());
      await Promise.all(tasks);
    } catch (error) {
      const message = error instanceof Error ? error.message : '短影音發布失敗';
      if (selectedAvailable.includes('youtube')) setProgress(current=>({...current,youtube:{state:'error',pct:0,message}}));
    } finally {
      setBusy(false);
    }
  }

  return <main className="short-page shell">
    <section className="short-hero">
      <div><div className="eyebrow">SHORT VIDEO SYNC</div><h1>短影音</h1><p>一支直式短影音，集中準備文案與平台，再從同一頁同步發布。YouTube Shorts 已可沿用目前授權；其餘平台的正式 Developer App 串接會依序接上。</p></div>
      <div className="short-hero-mark"><img src="/stars-sync.svg" alt=""/><span>繁星同步</span></div>
    </section>

    <section className="panel short-platform-panel">
      <div className="short-section-heading"><div><div className="eyebrow">PLATFORMS</div><h2>① 選擇短影音平台</h2></div><span className="api-badge">一鍵發布架構</span></div>
      <div className="short-platform-grid">
        {platforms.map(platform => {
          const ready = available.has(platform.id);
          const checked = selected.includes(platform.id) && ready;
          return <button type="button" key={platform.id} className={`short-platform-card ${ready?'ready':'planned'} ${checked?'selected':''}`} onClick={()=>togglePlatform(platform.id)} disabled={!ready}>
            <span className="platform-badge">{platform.badge}</span>
            <span className="platform-copy"><b>{platform.name} <em>{platform.product}</em></b><small>{platform.note}</small></span>
            <span className="platform-state">{ready ? (checked ? <CheckCircle2 size={20}/> : <Circle size={20}/>) : '待串接'}</span>
          </button>;
        })}
      </div>
      {!status?.youtube.connected && <div className="notice info"><span>YouTube 尚未連接，先完成授權即可直接使用 Shorts 發布。</span><a className="small-button" href="/api/auth/youtube/start">連接 YouTube <ExternalLink size={14}/></a></div>}
    </section>

    <section className="panel short-compose-panel">
      <div className="short-section-heading"><div><div className="eyebrow">CONTENT</div><h2>② 短影音與文案</h2></div></div>
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
          <div className="field-block"><span className="field-label">YouTube 公開狀態</span><FancySelect value={privacy} options={privacyOptions} onChange={setPrivacy}/></div>
        </div>
      </div>
    </section>

    <section className="panel short-publish-panel">
      <div className="publish-head"><div><div className="eyebrow">PUBLISH</div><h2>③ 一鍵同步發布</h2></div><button type="button" className="primary" disabled={!canPublish} onClick={()=>void publish()}><Share2 size={18}/>{busy?'正在同步…':'發布到已勾選平台'}</button></div>
      <p className="short-publish-note">目前正式可執行的是 YouTube Shorts。Instagram Reels、Facebook Reels、TikTok、Threads、Pinterest、X、LinkedIn 的欄位與發布控制器已預留，等各平台 Developer App 憑證／審核完成後直接啟用，不會用未公開 API。</p>
      {platforms.map(platform => {
        const item = progress[platform.id];
        if (item.state === 'idle') return null;
        return <div key={platform.id} className={`short-progress ${item.state}`}><div><span className="platform-badge mini">{platform.badge}</span><b>{platform.name}</b><span>{item.message}</span>{item.state==='uploading'&&<LoaderCircle className="spin" size={17}/>} {item.url&&<a href={item.url} target="_blank" rel="noreferrer">開啟 <ExternalLink size={13}/></a>}</div><div className="bar"><i style={{width:`${item.pct}%`}}/></div></div>;
      })}
    </section>
  </main>;
}
