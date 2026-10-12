import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, CloudUpload, ExternalLink, LogIn, Plus, RefreshCw, Sparkles, Video } from 'lucide-react';
import { api } from './api';
import FancySelect from './FancySelect';
import { extractThumbnailCandidates, renderThumbnailFile, type ThumbnailCandidate } from './thumbnail';
import { uploadYoutubeFile, uploadYoutubeThumbnail } from './upload/youtube';
import { uploadGjwPoster, uploadGjwVideo } from './upload/gjw';
import { createYoutubePlaylist, uploadYoutubeCaption, youtubePostProcess, type YoutubeOptions } from './youtubeStudio';

type Status = {
  authenticated: boolean;
  email?: string;
  youtube: { connected: boolean; channelTitle?: string };
  gjw: { connected: boolean; channelName?: string };
};

type PlatformProgress = { state: 'idle'|'waiting'|'uploading'|'processing'|'done'|'error'; pct: number; message?: string; url?: string };
type ThumbnailState = 'idle'|'extracting'|'ai'|'ready'|'fallback'|'error';
type VisibilityMode = 'private'|'unlisted'|'public'|'schedule';
type PlaylistPrivacy = 'private'|'unlisted'|'public';

type AiPreferences = {
  introOutro: boolean;
  faces: boolean;
  sharpness: boolean;
  lighting: boolean;
  lowText: boolean;
  custom: string;
};

type CompatibleCategory = {
  id: string;
  title: string;
  gjwId: string;
  gjwTitle: string;
};

const emptyProgress: PlatformProgress = { state: 'idle', pct: 0 };
const compatibleCategories: CompatibleCategory[] = [
  { id:'22', title:'人物與網誌', gjwId:'cat13', gjwTitle:'文化／一般' },
  { id:'27', title:'教育', gjwId:'cat7', gjwTitle:'教育' },
  { id:'26', title:'教學與生活風格', gjwId:'cat15', gjwTitle:'生活風格' },
  { id:'10', title:'音樂', gjwId:'cat17', gjwTitle:'音樂' },
  { id:'15', title:'寵物與動物', gjwId:'cat21', gjwTitle:'寵物' },
  { id:'17', title:'運動', gjwId:'cat25', gjwTitle:'運動' },
  { id:'19', title:'旅遊與活動', gjwId:'cat27', gjwTitle:'旅遊' },
  { id:'1', title:'電影與動畫', gjwId:'cat2', gjwTitle:'藝術與設計' },
];
const fallbackCategories = compatibleCategories.map(({ id, title }) => ({ id, title }));
const neutralPreferences: AiPreferences = { introOutro:false, faces:false, sharpness:false, lighting:false, lowText:false, custom:'' };

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
    : `${minutes}:${String(secs).padStart(2,'0')}`;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [youtubeOptions, setYoutubeOptions] = useState<YoutubeOptions>({ playlists:[], categories:fallbackCategories });
  const [video, setVideo] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState('');
  const [thumbnailCandidates, setThumbnailCandidates] = useState<ThumbnailCandidate[]>([]);
  const [recommendedIndexes, setRecommendedIndexes] = useState<number[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [thumbnailState, setThumbnailState] = useState<ThumbnailState>('idle');
  const [thumbnailMessage, setThumbnailMessage] = useState('選擇影片後會自動分析');
  const thumbnailJob = useRef(0);
  const thumbnailSelectionJob = useRef(0);
  const manualVideoRef = useRef<HTMLVideoElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [manualTime, setManualTime] = useState(0);
  const [manualCaptureBusy, setManualCaptureBusy] = useState(false);

  const [aiPreferences, setAiPreferences] = useState<AiPreferences>({ introOutro:true, faces:true, sharpness:true, lighting:true, lowText:true, custom:'' });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [language, setLanguage] = useState('zh-TW');
  const [youtubeCategory, setYoutubeCategory] = useState('22');
  const [playlistId, setPlaylistId] = useState('');
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('');
  const [newPlaylistPrivacy, setNewPlaylistPrivacy] = useState<PlaylistPrivacy>('private');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState('');
  const [madeForKids, setMadeForKids] = useState(false);
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(false);
  const [license, setLicense] = useState<'youtube'|'creativeCommon'>('youtube');
  const [embeddable, setEmbeddable] = useState(true);
  const [publicStatsViewable, setPublicStatsViewable] = useState(true);
  const [notifySubscribers, setNotifySubscribers] = useState(true);
  const [recordingDate, setRecordingDate] = useState(todayLocal);
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>('private');
  const [scheduleAt, setScheduleAt] = useState('');
  const [captionFile, setCaptionFile] = useState<File | null>(null);
  const [captionLanguage, setCaptionLanguage] = useState('zh-TW');
  const [captionName, setCaptionName] = useState('繁體中文字幕');

  const [yt, setYt] = useState<PlatformProgress>(emptyProgress);
  const [gjw, setGjw] = useState<PlatformProgress>(emptyProgress);
  const [odysee, setOdysee] = useState<PlatformProgress>({ state: 'waiting', pct: 0, message: '由 YouTube Sync 自動同步' });
  const [busy, setBusy] = useState(false);

  const refreshStatus = () => api<Status>('/api/status').then(setStatus).catch(() => setStatus({ authenticated:false, youtube:{connected:false}, gjw:{connected:false} }));
  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => {
    if (!status?.youtube.connected) return;
    api<YoutubeOptions>('/api/youtube/options').then(options => {
      const available = new Set((options.categories || []).map(item => item.id));
      const filtered = compatibleCategories.filter(item => available.size === 0 || available.has(item.id)).map(({id,title}) => ({id,title}));
      setYoutubeOptions({ playlists:options.playlists||[], categories:filtered.length ? filtered : fallbackCategories });
      if (filtered.length && !filtered.some(item => item.id === youtubeCategory)) setYoutubeCategory(filtered[0].id);
    }).catch(() => undefined);
  }, [status?.youtube.connected]);
  useEffect(() => () => { if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview); }, [thumbnailPreview]);

  const manualVideoUrl = useMemo(() => video ? URL.createObjectURL(video) : '', [video]);
  useEffect(() => () => { if (manualVideoUrl) URL.revokeObjectURL(manualVideoUrl); }, [manualVideoUrl]);

  const canPublish = useMemo(() => !!video && !!thumbnail && !!title.trim() && status?.youtube.connected && status?.gjw.connected && !busy && !(visibilityMode==='schedule'&&!scheduleAt), [video, thumbnail, title, status, busy, visibilityMode, scheduleAt]);
  const thumbnailBusy = thumbnailState === 'extracting' || thumbnailState === 'ai';
  const displayIndexes = useMemo(() => {
    const all = thumbnailCandidates.map((_, index) => index);
    return [...recommendedIndexes, ...all.filter(index => !recommendedIndexes.includes(index))];
  }, [thumbnailCandidates, recommendedIndexes]);
  const activeCategory = compatibleCategories.find(item => item.id === youtubeCategory) || compatibleCategories[0];

  async function getYoutubeAccessToken() {
    return (await api<{ accessToken: string }>('/api/youtube/access-token')).accessToken;
  }
  async function getGjwUploadToken() {
    return (await api<{ uploadToken: string }>('/api/gjw/upload-token')).uploadToken;
  }
  function setFinalThumbnail(fileOut: File) {
    setThumbnail(fileOut);
    setThumbnailPreview(URL.createObjectURL(fileOut));
  }

  function localRanking(frames: ThumbnailCandidate[]) {
    return frames.map((candidate,index)=>({index,score:candidate.localScore})).sort((a,b)=>b.score-a.score).map(item=>item.index);
  }

  async function rankFrames(frames: ThumbnailCandidate[], preferences: AiPreferences) {
    const localRanked = localRanking(frames);
    try {
      const selected = await api<{ index:number; recommendedIndexes?:number[] }>('/api/thumbnail/select', {
        method:'POST',
        body:JSON.stringify({
          preferences,
          frames:frames.map(frame=>({ image:frame.preview, at:frame.at, localScore:frame.localScore, role:frame.role })),
        }),
      });
      const aiRecommended = Array.isArray(selected.recommendedIndexes) ? selected.recommendedIndexes.filter(index=>Number.isInteger(index)&&index>=0&&index<frames.length) : [];
      const bestIndex = Number.isInteger(selected.index)&&selected.index>=0&&selected.index<frames.length ? selected.index : null;
      const merged = [...(bestIndex===null?[]:[bestIndex]),...aiRecommended,...localRanked].filter((index,pos,values)=>values.indexOf(index)===pos);
      return { indexes:merged, usedAi:bestIndex!==null||aiRecommended.length>0 };
    } catch (error) {
      console.warn('Cloudflare AI thumbnail selection failed; using local fallback.', error);
      return { indexes:localRanked, usedAi:false };
    }
  }

  async function analyzeThumbnail(file: File) {
    const job = ++thumbnailJob.current;
    thumbnailSelectionJob.current++;
    setThumbnail(null); setThumbnailPreview(''); setThumbnailCandidates([]); setRecommendedIndexes([]); setSelectedIndex(null);
    setThumbnailState('extracting');
    setThumbnailMessage('正在廣泛掃描影片畫面，先依你的偏好建立 12 張候選…');
    try {
      const pool = await extractThumbnailCandidates(file, 36);
      if (job !== thumbnailJob.current) return;
      if (!pool.length) throw new Error('影片中找不到可用畫面');

      setThumbnailState('ai');
      setThumbnailMessage('正在依勾選與自訂偏好搜尋畫面，讓符合條件的內容先進入 12 張候選…');
      const preferredCandidates: ThumbnailCandidate[] = [];
      let preferenceScanUsedAi = false;
      for (let start = 0; start < pool.length; start += 12) {
        const batch = pool.slice(start, start + 12);
        const ranked = await rankFrames(batch, aiPreferences);
        preferenceScanUsedAi = preferenceScanUsedAi || ranked.usedAi;
        for (const index of ranked.indexes.slice(0, 4)) {
          if (batch[index]) preferredCandidates.push(batch[index]);
        }
      }
      if (job !== thumbnailJob.current) return;

      const uniquePreferred = preferredCandidates.filter((candidate,index,list)=>list.findIndex(item=>Math.abs(item.at-candidate.at)<0.01)===index);
      if (uniquePreferred.length < 12) {
        for (const index of localRanking(pool)) {
          const candidate = pool[index];
          if (!uniquePreferred.some(item=>Math.abs(item.at-candidate.at)<0.01)) uniquePreferred.push(candidate);
          if (uniquePreferred.length >= 12) break;
        }
      }
      const candidates = uniquePreferred.slice(0, 12);
      if (!candidates.length) throw new Error('偏好篩選後找不到可用畫面');
      setThumbnailCandidates(candidates);

      setThumbnailMessage('偏好候選 12 張已完成；現在只從這 12 張裡選出 AI 推薦前 4 名…');
      const finalRanked = await rankFrames(candidates, neutralPreferences);
      if (job !== thumbnailJob.current) return;
      const recommendations = finalRanked.indexes.slice(0, Math.min(4, candidates.length));
      setRecommendedIndexes(recommendations);
      const initialIndex = recommendations[0] ?? 0;
      setSelectedIndex(initialIndex);
      const fileOut = await renderThumbnailFile(file, candidates[initialIndex].at);
      if (job !== thumbnailJob.current) return;
      setFinalThumbnail(fileOut);
      const fullyAi = preferenceScanUsedAi && finalRanked.usedAi;
      setThumbnailState(fullyAi?'ready':'fallback');
      setThumbnailMessage(fullyAi ? '偏好已先套用到 12 張候選；AI 前 4 名已排最前，12 張都可自由選' : '部分 AI 分析暫時不可用；已用本機品質評分補足候選，12 張仍可自由選');
    } catch (error) {
      if (job !== thumbnailJob.current) return;
      setThumbnail(null); setThumbnailCandidates([]); setRecommendedIndexes([]); setSelectedIndex(null); setThumbnailState('error');
      setThumbnailMessage(error instanceof Error ? error.message : '自動產生封面失敗');
    }
  }

  async function chooseThumbnailCandidate(index: number) {
    if (!video || busy || thumbnailBusy || !thumbnailCandidates[index]) return;
    const selectionJob = ++thumbnailSelectionJob.current;
    setSelectedIndex(index); setThumbnail(null);
    const rank = recommendedIndexes.indexOf(index)+1;
    setThumbnailMessage(rank>0 ? `正在使用 AI 推薦第 ${rank} 名產生正式封面…` : `正在使用候選 #${index+1} 產生正式封面…`);
    try {
      const fileOut = await renderThumbnailFile(video, thumbnailCandidates[index].at);
      if (selectionJob !== thumbnailSelectionJob.current) return;
      setFinalThumbnail(fileOut);
      setThumbnailMessage(rank>0 ? `已選擇 AI 推薦第 ${rank} 名作為正式封面` : `已選擇候選 #${index+1} 作為正式封面`);
    } catch (error) {
      if (selectionJob !== thumbnailSelectionJob.current) return;
      setThumbnail(null); setThumbnailMessage(error instanceof Error ? error.message : '產生正式封面失敗');
    }
  }

  function scrubManualThumbnail(value: number) {
    const time = Math.max(0, Math.min(value, videoDuration || value));
    setManualTime(time);
    if (manualVideoRef.current && Number.isFinite(time)) manualVideoRef.current.currentTime = time;
  }

  async function captureManualThumbnail() {
    if (!video || thumbnailBusy || manualCaptureBusy) return;
    setManualCaptureBusy(true);
    thumbnailSelectionJob.current++;
    try {
      const fileOut = await renderThumbnailFile(video, manualTime);
      setSelectedIndex(null);
      setFinalThumbnail(fileOut);
      setThumbnailState('ready');
      setThumbnailMessage(`已使用時間軸 ${formatTime(manualTime)} 的畫面作為正式封面`);
    } catch (error) {
      setThumbnailMessage(error instanceof Error ? error.message : '手動擷取縮圖失敗');
    } finally {
      setManualCaptureBusy(false);
    }
  }

  async function handleVideoSelection(file: File | null) {
    thumbnailJob.current++; thumbnailSelectionJob.current++;
    setVideo(file); setThumbnail(null); setThumbnailPreview(''); setThumbnailCandidates([]); setRecommendedIndexes([]); setSelectedIndex(null);
    setVideoDuration(0); setManualTime(0);
    if (!file) {
      setTitle(''); setDescription(''); setThumbnailState('idle'); setThumbnailMessage('選擇影片後會自動分析'); return;
    }
    if (file.type && !file.type.startsWith('video/')) { setThumbnailState('error'); setThumbnailMessage('請放入影片檔案'); return; }
    setTitle(file.name);
    setDescription(file.name);
    await analyzeThumbnail(file);
  }

  function dropVideo(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault(); setDragActive(false);
    const file=event.dataTransfer.files?.[0]||null;
    void handleVideoSelection(file);
  }

  async function addPlaylist() {
    const name = newPlaylistTitle.trim();
    if (!name || creatingPlaylist) return;
    setCreatingPlaylist(true);
    setPlaylistError('');
    try {
      const created = await createYoutubePlaylist(name, newPlaylistPrivacy);
      if (!created.id) throw new Error('YouTube 沒有回傳播放清單 ID');
      setYoutubeOptions(current => ({
        ...current,
        playlists: [created, ...current.playlists.filter(item => item.id !== created.id)],
      }));
      setPlaylistId(created.id);
      setNewPlaylistTitle('');
      setNewPlaylistPrivacy('private');
      setNewPlaylistOpen(false);
    } catch (error) {
      setPlaylistError(error instanceof Error ? error.message : '建立播放清單失敗');
    } finally {
      setCreatingPlaylist(false);
    }
  }

  async function publish() {
    if (!video || !thumbnail || !canPublish) return;
    setBusy(true);
    setYt({ state:'waiting', pct:0, message:'建立 YouTube 上傳工作階段' });
    setGjw({ state:'waiting', pct:0, message:'準備 Gan Jing World' });
    setOdysee({ state:'waiting', pct:0, message:'等待 YouTube 公開影片同步' });

    const publishAt = visibilityMode==='schedule' && scheduleAt ? new Date(scheduleAt).toISOString() : '';
    const privacy = visibilityMode==='schedule' ? 'private' : visibilityMode;
    const metadata = {
      title:title.trim(), description, tags:tags.split(',').map(v=>v.trim()).filter(Boolean), language,
      privacy, publishAt, youtubeCategory, gjwCategory:activeCategory.gjwId, madeForKids, containsSyntheticMedia, license, embeddable,
      publicStatsViewable, notifySubscribers, recordingDate,
    };

    const youtubeTask = (async () => {
      try {
        const start = await api<{uploadUrl:string;accessToken:string}>('/api/youtube/upload-session',{method:'POST',body:JSON.stringify({...metadata,fileSize:video.size,mimeType:video.type||'video/mp4'})});
        setYt({state:'uploading',pct:0,message:'直接從你的瀏覽器傳到 YouTube'});
        const result = await uploadYoutubeFile(video,start,pct=>setYt({state:'uploading',pct,message:'直接從你的瀏覽器傳到 YouTube'}),getYoutubeAccessToken);
        const warnings:string[]=[];
        if(result.id){
          try{await uploadYoutubeThumbnail(result.id,thumbnail,await getYoutubeAccessToken());}catch(error){warnings.push('縮圖');console.warn(error);}
          if(playlistId){try{await youtubePostProcess(result.id,playlistId);}catch(error){warnings.push('播放清單');console.warn(error);}}
          if(captionFile){try{await uploadYoutubeCaption(result.id,captionFile,captionLanguage,captionName);}catch(error){warnings.push('字幕');console.warn(error);}}
        }
        const url=result.id?`https://youtu.be/${result.id}`:undefined;
        const suffix=warnings.length?`；${warnings.join('、')}設定未完成，若為 403 請按「重新授權」取得新版 YouTube 權限`:'';
        setYt({state:'done',pct:100,message:`YouTube 已完成${suffix}`,url});
        setOdysee({state:'processing',pct:0,message:'YouTube 已完成；Odysee 將依 YouTube Sync 自動同步'});
        return url;
      }catch(error){setYt({state:'error',pct:0,message:error instanceof Error?error.message:'YouTube 上傳失敗'});throw error;}
    })();

    const gjwTask = (async () => {
      try {
        const uploadToken=await getGjwUploadToken();setGjw({state:'uploading',pct:1,message:'上傳已選封面'});
        const poster=await uploadGjwPoster(thumbnail,uploadToken);
        const created=await api<{contentId:string;channelId:string}>('/api/gjw/create-video',{method:'POST',body:JSON.stringify({...metadata,...poster})});
        setGjw({state:'uploading',pct:2,message:'直接從你的瀏覽器傳到 Gan Jing World'});
        const tusUrl=await uploadGjwVideo({file:video,contentId:created.contentId,channelId:created.channelId,language,getUploadToken:getGjwUploadToken,onProgress:pct=>setGjw({state:'uploading',pct,message:'直接從你的瀏覽器傳到 Gan Jing World'})});
        setGjw({state:'processing',pct:100,message:'影片已上傳，等待平台轉碼'});
        const prepared=await api<{videoId:string}>('/api/gjw/finish-video',{method:'POST',body:JSON.stringify({tusUrl})});
        for(let attempt=0;attempt<60;attempt++){
          const polled=await api<{ready:boolean;url?:string}>(`/api/gjw/video-status?videoId=${encodeURIComponent(prepared.videoId)}&contentId=${encodeURIComponent(created.contentId)}`);
          if(polled.ready&&polled.url){setGjw({state:'done',pct:100,message:'Gan Jing World 已完成',url:polled.url});return polled.url;}
          setGjw({state:'processing',pct:100,message:`平台轉碼中… ${attempt+1}/60`});await new Promise(resolve=>setTimeout(resolve,10000));
        }
        throw new Error('Gan Jing World 轉碼時間較久，請稍後重新整理狀態');
      }catch(error){setGjw({state:'error',pct:0,message:error instanceof Error?error.message:'Gan Jing World 上傳失敗'});throw error;}
    })();

    await Promise.allSettled([youtubeTask,gjwTask]);setBusy(false);
  }

  const playlistOptions = [{value:'',label:'不加入播放清單'}, ...youtubeOptions.playlists.map(item=>({value:item.id,label:item.title}))];
  const categoryOptions = youtubeOptions.categories.map(item => {
    const match = compatibleCategories.find(category => category.id === item.id);
    return { value:item.id, label:item.title, hint:match ? `乾淨世界：${match.gjwTitle}` : undefined };
  });

  return <main className="shell">
    <header>
      <div><div className="eyebrow">MULTI-PLATFORM PUBLISHER</div><h1>StarsVideoSync</h1><p>以 YouTube Studio 上傳流程為主，影片同時發佈到 YouTube 與 Gan Jing World；Odysee 交給官方 YouTube Sync。</p></div>
      <button className="ghost" onClick={refreshStatus}><RefreshCw size={17}/>更新狀態</button>
    </header>

    <section className="panel connections"><h2>① 連接平台</h2><div className="connection-grid">
      <Connection name="YouTube" connected={!!status?.youtube.connected} detail={status?.youtube.channelTitle} href="/api/auth/youtube/start" icon={<Video size={22}/>} />
      <Connection name="Gan Jing World" connected={!!status?.gjw.connected} detail={status?.gjw.channelName} href="/api/auth/gjw/start" icon={<CloudUpload size={22}/>} />
      <div className="connection"><div className="connection-title"><CheckCircle2 size={22}/><strong>Odysee</strong></div><span className="badge neutral">YouTube Sync</span><p>讓 Odysee 官方同步 YouTube，不搬運第三份影片。</p></div>
    </div></section>

    <section className="panel"><h2>② 影片與縮圖</h2><div className="form-grid">
      <label className={`filebox wide dropzone ${dragActive?'drag-active':''}`} onDragEnter={e=>{e.preventDefault();setDragActive(true);}} onDragOver={e=>e.preventDefault()} onDragLeave={()=>setDragActive(false)} onDrop={dropVideo}>
        <span>影片母片</span><input type="file" accept="video/*" onChange={e=>void handleVideoSelection(e.target.files?.[0]||null)}/><b>{video?`${video.name} · ${(video.size/1024/1024).toFixed(1)} MB`:'點選選擇影片，或直接把影片拖曳到這裡'}</b><small>支援桌面拖曳；手機維持點選檔案。</small>
      </label>
      <div className="preference-box wide"><div className="subhead"><strong>12 張候選偏好</strong><span>先用偏好從影片找出候選，再讓 AI 只在這 12 張中選前 4 名</span></div><div className="preference-grid">
        <Toggle checked={aiPreferences.introOutro} onChange={value=>setAiPreferences(v=>({...v,introOutro:value}))} label="特別留意片頭／片尾"/>
        <Toggle checked={aiPreferences.faces} onChange={value=>setAiPreferences(v=>({...v,faces:value}))} label="人物臉部與自然表情"/>
        <Toggle checked={aiPreferences.sharpness} onChange={value=>setAiPreferences(v=>({...v,sharpness:value}))} label="清晰、避免動態模糊"/>
        <Toggle checked={aiPreferences.lighting} onChange={value=>setAiPreferences(v=>({...v,lighting:value}))} label="光線與對比良好"/>
        <Toggle checked={aiPreferences.lowText} onChange={value=>setAiPreferences(v=>({...v,lowText:value}))} label="避免密集小字投影片"/>
      </div><label className="wide">自訂偏好<input value={aiPreferences.custom} onChange={e=>setAiPreferences(v=>({...v,custom:e.target.value}))} placeholder="例如：優先找品牌 Logo 清楚、講者正面、舞台全景的畫面" maxLength={500}/></label></div>

      <div className={`thumbnail-auto ${thumbnailState}`}>
        <div className="thumbnail-title"><span>封面縮圖</span><b><Sparkles size={15}/> AI 推薦＋手動時間軸皆可使用</b></div>
        {thumbnailPreview?<img className="thumbnail-preview" src={thumbnailPreview} alt="目前選定封面"/>:<div className="thumbnail-empty"><Sparkles size={24}/><span>{thumbnailBusy?'分析中…':'選影片後自動產生'}</span></div>}

        {video && manualVideoUrl && <div className="manual-thumbnail-box">
          <div className="manual-thumbnail-head"><strong>手動時間軸抓縮圖</strong><span>{formatTime(manualTime)} / {formatTime(videoDuration)}</span></div>
          <div className="manual-thumbnail-body">
            <video
              ref={manualVideoRef}
              className="manual-thumbnail-video"
              src={manualVideoUrl}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={event => {
                const duration = Number(event.currentTarget.duration || 0);
                setVideoDuration(duration);
                const initial = Math.min(manualTime, Math.max(0, duration - 0.05));
                event.currentTarget.currentTime = initial;
              }}
            />
            <div className="manual-thumbnail-controls">
              <input
                className="timeline-range"
                type="range"
                min="0"
                max={Math.max(videoDuration, 0.1)}
                step="0.1"
                value={Math.min(manualTime, Math.max(videoDuration, 0.1))}
                onChange={e=>scrubManualThumbnail(Number(e.target.value))}
              />
              <div className="timeline-labels"><span>0:00</span><span>拖曳到你要的畫面</span><span>{formatTime(videoDuration)}</span></div>
              <button type="button" className="small-button timeline-capture" disabled={thumbnailBusy||manualCaptureBusy||busy||videoDuration<=0} onClick={()=>void captureManualThumbnail()}>{manualCaptureBusy?'擷取中…':'使用目前時間點當封面'}</button>
            </div>
          </div>
        </div>}

        {thumbnailCandidates.length>0&&<><div className="thumbnail-gallery-title"><strong>12 張偏好候選（含片頭／片尾）</strong><span>紫框＝AI 推薦；綠框＝目前正式封面</span></div><div className="thumbnail-gallery">
          {displayIndexes.map(index=>{const candidate=thumbnailCandidates[index];const rank=recommendedIndexes.indexOf(index)+1;const selected=selectedIndex===index;return <button type="button" key={`${candidate.at}-${index}`} className={`thumbnail-candidate ${rank>0?'recommended':''} ${selected?'selected':''}`} disabled={thumbnailBusy||busy} onClick={()=>void chooseThumbnailCandidate(index)}>
            <img src={candidate.preview} alt={`候選封面 ${index+1}`}/><span className="candidate-number">#{index+1}</span>{rank>0&&<span className="candidate-rank"><Sparkles size={12}/> AI {rank}</span>}{selected&&<span className="candidate-selected"><CheckCircle2 size={13}/>目前使用</span>}<small>{candidate.role==='intro'?'片頭':candidate.role==='outro'?'片尾':'內容'} · {Math.round(candidate.at)} 秒</small>
          </button>;})}
        </div></>}
        <div className="thumbnail-meta"><span>{thumbnailMessage}</span>{video&&<button type="button" className="small-button" disabled={thumbnailBusy||busy} onClick={()=>void analyzeThumbnail(video)}>依目前偏好重新搜尋 12 張</button>}</div>
      </div>
    </div></section>

    <section className="panel studio-panel"><div className="studio-heading"><div><div className="eyebrow">YOUTUBE STUDIO MODE</div><h2>③ YouTube Studio 詳細資料</h2></div><span className="api-badge">API 可直接寫入</span></div><div className="form-grid">
      <label className="wide">標題<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={100}/><small>{video?'已自動完整複製上傳檔名，可手動修改 · ':''}{title.length}/100</small></label>
      <label className="wide">說明<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={7}/><small>{video?'已自動完整複製上傳檔名，可手動修改':''}</small></label>

      <div className="field-block playlist-field"><span className="field-label">播放清單</span><div className="playlist-row"><FancySelect value={playlistId} options={playlistOptions} onChange={setPlaylistId}/><button type="button" className="small-button add-playlist-button" onClick={()=>{setNewPlaylistOpen(v=>!v);setPlaylistError('');}}><Plus size={15}/>新增播放清單</button></div>
        {newPlaylistOpen&&<div className="new-playlist-box"><input value={newPlaylistTitle} onChange={e=>setNewPlaylistTitle(e.target.value)} placeholder="新的播放清單名稱" maxLength={150}/><FancySelect value={newPlaylistPrivacy} onChange={value=>setNewPlaylistPrivacy(value as PlaylistPrivacy)} options={[{value:'private',label:'私人'},{value:'unlisted',label:'不公開列出'},{value:'public',label:'公開'}]}/><div className="new-playlist-actions"><button type="button" className="small-button" disabled={!newPlaylistTitle.trim()||creatingPlaylist} onClick={()=>void addPlaylist()}>{creatingPlaylist?'建立中…':'建立並選用'}</button><button type="button" className="text-button" onClick={()=>setNewPlaylistOpen(false)}>取消</button></div>{playlistError&&<small className="field-error">{playlistError}</small>}</div>}
      </div>

      <div className="field-block"><span className="field-label">YouTube 分類</span><FancySelect value={youtubeCategory} options={categoryOptions} onChange={setYoutubeCategory}/><small>只顯示目前可對應乾淨世界的分類；乾淨世界會自動使用「{activeCategory.gjwTitle}」，不需要再輸入內部分類 ID。</small></div>
      <label className="wide">標籤（逗號分隔）<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="繁星回聲, 學習, 分享"/></label>
      <label>影片語言<input value={language} onChange={e=>setLanguage(e.target.value)} placeholder="zh-TW"/></label>
      <label>錄製日期<input type="date" value={recordingDate} onChange={e=>setRecordingDate(e.target.value)}/><small>預設為今天，可自行修改。</small></label>
      <div className="setting-card wide"><strong>觀眾</strong><Toggle checked={madeForKids} onChange={setMadeForKids} label="這是兒童內容（Made for Kids）"/></div>
      <div className="setting-card wide"><strong>變造／合成內容揭露</strong><Toggle checked={containsSyntheticMedia} onChange={setContainsSyntheticMedia} label="包含逼真的 AI 生成或變造內容"/></div>
      <div className="field-block"><span className="field-label">授權</span><FancySelect value={license} onChange={value=>setLicense(value as 'youtube'|'creativeCommon')} options={[{value:'youtube',label:'標準 YouTube 授權'},{value:'creativeCommon',label:'Creative Commons'}]}/></div>
      <div className="setting-card"><Toggle checked={embeddable} onChange={setEmbeddable} label="允許嵌入其他網站"/></div>
      <div className="setting-card"><Toggle checked={publicStatsViewable} onChange={setPublicStatsViewable} label="公開影片統計資訊"/></div>
      <div className="setting-card"><Toggle checked={notifySubscribers} onChange={setNotifySubscribers} label="通知訂閱者"/></div>
      <label className="wide">字幕檔（可選）<input type="file" accept=".srt,.vtt,.sbv,.ttml,.xml,text/*" onChange={e=>setCaptionFile(e.target.files?.[0]||null)}/><small>{captionFile?captionFile.name:'可上傳 SRT / VTT 等字幕；此功能需要新版 YouTube 授權'}</small></label>
      {captionFile&&<><label>字幕語言<input value={captionLanguage} onChange={e=>setCaptionLanguage(e.target.value)}/></label><label>字幕名稱<input value={captionName} onChange={e=>setCaptionName(e.target.value)}/></label></>}
    </div></section>

    <section className="panel"><h2>④ YouTube Studio 發布設定</h2><div className="visibility-grid">
      {(['private','unlisted','public','schedule'] as VisibilityMode[]).map(mode=><button type="button" key={mode} className={`visibility-option ${visibilityMode===mode?'active':''}`} onClick={()=>setVisibilityMode(mode)}><b>{mode==='private'?'私人':mode==='unlisted'?'不公開列出':mode==='public'?'公開':'預約發布'}</b><span>{mode==='schedule'?'YouTube 會先保持私人，到指定時間再公開':''}</span></button>)}
    </div>{visibilityMode==='schedule'&&<label className="schedule-field">預約日期與時間<input type="datetime-local" value={scheduleAt} onChange={e=>setScheduleAt(e.target.value)}/></label>}</section>

    <section className="panel studio-only"><div className="studio-heading"><div><div className="eyebrow">YOUTUBE STUDIO ONLY</div><h2>⑤ YouTube 有，但官方 API 未開放寫入</h2></div><span className="manual-badge">上傳後到 Studio 完成</span></div><p>這些選項保留在同一頁提醒你，但 StarsVideoSync 不會假裝設定成功。</p><div className="locked-grid">
      {['付費宣傳／品牌置入','自動章節與重要時刻','精選地點','年齡限制的完整控制','留言與留言排序','顯示喜歡人數／部分互動設定','Shorts remix 取樣控制','片尾畫面','資訊卡','版權 Checks','廣告適合度／營利與廣告插入點','Premiere 首播'].map(item=><div className="locked-item" key={item}><span>🔒</span><b>{item}</b><small>YouTube Studio 專屬</small></div>)}
    </div></section>

    <section className="panel"><div className="publish-head"><h2>⑥ 一鍵發佈</h2><button className="primary" disabled={!canPublish} onClick={publish}>{busy?'正在發佈…':thumbnailBusy?'正在挑選封面…':'發布到所有平台'}</button></div>
      {!status?.authenticated&&<div className="notice"><LogIn size={18}/>第一次使用請先連接 YouTube；只有指定管理員帳號可以操作。</div>}
      <Progress name="YouTube" data={yt}/><Progress name="Gan Jing World" data={gjw}/><Progress name="Odysee" data={odysee}/>
    </section>

    <footer>影片檔本體不經過 StarsVideoSync Worker；自動縮圖與手動時間軸都在你的瀏覽器處理。乾淨世界的內部 category_id 已改成由 YouTube 中文分類自動對應，不再要求你輸入代碼。</footer>
  </main>;
}

function Toggle({checked,onChange,label}:{checked:boolean;onChange:(value:boolean)=>void;label:string}){return <label className="toggle-row"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span>{label}</span></label>;}
function Connection({name,connected,detail,href,icon}:{name:string;connected:boolean;detail?:string;href:string;icon:React.ReactNode}) {return <div className="connection"><div className="connection-title">{icon}<strong>{name}</strong></div><span className={`badge ${connected?'ok':'neutral'}`}>{connected?'已連接':'尚未連接'}</span><p>{detail||(connected?'授權正常':'需要授權後才能發佈')}</p><a className="small-button" href={href}>{connected?'重新授權':'連接帳號'} <ExternalLink size={14}/></a></div>;}
function Progress({name,data}:{name:string;data:PlatformProgress}) {const icon=data.state==='done'?<CheckCircle2 size={20}/>:<Circle size={20}/>;return <div className={`progress-row ${data.state}`}><div className="progress-title">{icon}<b>{name}</b><span>{data.message||'尚未開始'}</span>{data.url&&<a href={data.url} target="_blank" rel="noreferrer">開啟 <ExternalLink size={13}/></a>}</div><div className="bar"><i style={{width:`${Math.max(0,Math.min(100,data.pct))}%`}}/></div></div>;}
