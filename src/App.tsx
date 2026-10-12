import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, CloudUpload, ExternalLink, LogIn, RefreshCw, Sparkles, Video } from 'lucide-react';
import { api } from './api';
import { extractThumbnailCandidates, renderThumbnailFile, type ThumbnailCandidate } from './thumbnail';
import { uploadYoutubeFile, uploadYoutubeThumbnail } from './upload/youtube';
import { uploadGjwPoster, uploadGjwVideo } from './upload/gjw';
import { uploadYoutubeCaption, youtubePostProcess, type YoutubeOptions } from './youtubeStudio';

type Status = {
  authenticated: boolean;
  email?: string;
  youtube: { connected: boolean; channelTitle?: string };
  gjw: { connected: boolean; channelName?: string };
};

type PlatformProgress = { state: 'idle'|'waiting'|'uploading'|'processing'|'done'|'error'; pct: number; message?: string; url?: string };
type ThumbnailState = 'idle'|'extracting'|'ai'|'ready'|'fallback'|'error';
type VisibilityMode = 'private'|'unlisted'|'public'|'schedule';

type AiPreferences = {
  introOutro: boolean;
  faces: boolean;
  sharpness: boolean;
  lighting: boolean;
  lowText: boolean;
  custom: string;
};

const emptyProgress: PlatformProgress = { state: 'idle', pct: 0 };
const fallbackCategories = [
  { id:'22', title:'People & Blogs' }, { id:'27', title:'Education' }, { id:'26', title:'Howto & Style' },
  { id:'24', title:'Entertainment' }, { id:'28', title:'Science & Technology' }, { id:'10', title:'Music' },
];

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

  const [aiPreferences, setAiPreferences] = useState<AiPreferences>({ introOutro:true, faces:true, sharpness:true, lighting:true, lowText:true, custom:'' });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [language, setLanguage] = useState('zh-TW');
  const [youtubeCategory, setYoutubeCategory] = useState('22');
  const [gjwCategory, setGjwCategory] = useState('cat13');
  const [playlistId, setPlaylistId] = useState('');
  const [madeForKids, setMadeForKids] = useState(false);
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(false);
  const [license, setLicense] = useState<'youtube'|'creativeCommon'>('youtube');
  const [embeddable, setEmbeddable] = useState(true);
  const [publicStatsViewable, setPublicStatsViewable] = useState(true);
  const [notifySubscribers, setNotifySubscribers] = useState(true);
  const [recordingDate, setRecordingDate] = useState('');
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
      setYoutubeOptions({ playlists:options.playlists||[], categories:options.categories?.length ? options.categories : fallbackCategories });
    }).catch(() => undefined);
  }, [status?.youtube.connected]);
  useEffect(() => () => { if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview); }, [thumbnailPreview]);

  const canPublish = useMemo(() => !!video && !!thumbnail && !!title.trim() && status?.youtube.connected && status?.gjw.connected && !busy && !(visibilityMode==='schedule'&&!scheduleAt), [video, thumbnail, title, status, busy, visibilityMode, scheduleAt]);
  const thumbnailBusy = thumbnailState === 'extracting' || thumbnailState === 'ai';
  const displayIndexes = useMemo(() => {
    const all = thumbnailCandidates.map((_, index) => index);
    return [...recommendedIndexes, ...all.filter(index => !recommendedIndexes.includes(index))];
  }, [thumbnailCandidates, recommendedIndexes]);

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

  async function analyzeThumbnail(file: File) {
    const job = ++thumbnailJob.current;
    thumbnailSelectionJob.current++;
    setThumbnail(null); setThumbnailPreview(''); setThumbnailCandidates([]); setRecommendedIndexes([]); setSelectedIndex(null);
    setThumbnailState('extracting');
    setThumbnailMessage('正在從影片擷取 12 張候選畫面（包含片頭與片尾）…');
    try {
      const candidates = await extractThumbnailCandidates(file, 12);
      if (job !== thumbnailJob.current) return;
      if (!candidates.length) throw new Error('影片中找不到可用畫面');
      setThumbnailCandidates(candidates);
      const localRanked = candidates.map((candidate,index)=>({index,score:candidate.localScore})).sort((a,b)=>b.score-a.score).map(item=>item.index);
      let recommendations = localRanked.slice(0, 4);
      let usedAi = false;
      setThumbnailState('ai');
      setThumbnailMessage('12 張候選已顯示；Cloudflare AI 正在依你的偏好選出最佳 4 張…');
      try {
        const selected = await api<{ index:number; recommendedIndexes?:number[] }>('/api/thumbnail/select', {
          method:'POST',
          body:JSON.stringify({
            preferences:aiPreferences,
            frames:candidates.map(frame=>({ image:frame.preview, at:frame.at, localScore:frame.localScore, role:frame.role })),
          }),
        });
        const aiRecommended = Array.isArray(selected.recommendedIndexes) ? selected.recommendedIndexes.filter(index=>Number.isInteger(index)&&index>=0&&index<candidates.length) : [];
        const bestIndex = Number.isInteger(selected.index)&&selected.index>=0&&selected.index<candidates.length ? selected.index : null;
        const merged = [...(bestIndex===null?[]:[bestIndex]),...aiRecommended,...localRanked].filter((index,pos,values)=>values.indexOf(index)===pos).slice(0,4);
        if (merged.length) { recommendations=merged; usedAi=bestIndex!==null||aiRecommended.length>0; }
      } catch (error) { console.warn('Cloudflare AI thumbnail selection failed; using local fallback.', error); }
      if (job !== thumbnailJob.current) return;
      setRecommendedIndexes(recommendations);
      const initialIndex = recommendations[0] ?? 0;
      setSelectedIndex(initialIndex);
      const fileOut = await renderThumbnailFile(file, candidates[initialIndex].at);
      if (job !== thumbnailJob.current) return;
      setFinalThumbnail(fileOut);
      setThumbnailState(usedAi?'ready':'fallback');
      setThumbnailMessage(usedAi ? 'AI 推薦 4 張已排到最前面；12 張全部都可以自由點選' : 'AI 暫時不可用；已用本機評分排序，12 張仍可自由點選');
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

  async function handleVideoSelection(file: File | null) {
    thumbnailJob.current++; thumbnailSelectionJob.current++;
    setVideo(file); setThumbnail(null); setThumbnailPreview(''); setThumbnailCandidates([]); setRecommendedIndexes([]); setSelectedIndex(null);
    if (!file) { setThumbnailState('idle'); setThumbnailMessage('選擇影片後會自動分析'); return; }
    if (file.type && !file.type.startsWith('video/')) { setThumbnailState('error'); setThumbnailMessage('請放入影片檔案'); return; }
    await analyzeThumbnail(file);
  }

  function dropVideo(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault(); setDragActive(false);
    const file=event.dataTransfer.files?.[0]||null;
    void handleVideoSelection(file);
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
      privacy, publishAt, youtubeCategory, gjwCategory, madeForKids, containsSyntheticMedia, license, embeddable,
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
      <div className="preference-box wide"><div className="subhead"><strong>AI 挑選偏好</strong><span>只影響 AI 排序，不會限制你手動選圖</span></div><div className="preference-grid">
        <Toggle checked={aiPreferences.introOutro} onChange={value=>setAiPreferences(v=>({...v,introOutro:value}))} label="特別留意片頭／片尾"/>
        <Toggle checked={aiPreferences.faces} onChange={value=>setAiPreferences(v=>({...v,faces:value}))} label="人物臉部與自然表情"/>
        <Toggle checked={aiPreferences.sharpness} onChange={value=>setAiPreferences(v=>({...v,sharpness:value}))} label="清晰、避免動態模糊"/>
        <Toggle checked={aiPreferences.lighting} onChange={value=>setAiPreferences(v=>({...v,lighting:value}))} label="光線與對比良好"/>
        <Toggle checked={aiPreferences.lowText} onChange={value=>setAiPreferences(v=>({...v,lowText:value}))} label="避免密集小字投影片"/>
      </div><label className="wide">自訂偏好<input value={aiPreferences.custom} onChange={e=>setAiPreferences(v=>({...v,custom:e.target.value}))} placeholder="例如：優先選有講者正面、舞台全景、品牌 Logo 清楚的畫面" maxLength={500}/></label></div>

      <div className={`thumbnail-auto ${thumbnailState}`}>
        <div className="thumbnail-title"><span>封面縮圖</span><b><Sparkles size={15}/> AI 推薦 4 張排最前 · 12 張全部可選</b></div>
        {thumbnailPreview?<img className="thumbnail-preview" src={thumbnailPreview} alt="目前選定封面"/>:<div className="thumbnail-empty"><Sparkles size={24}/><span>{thumbnailBusy?'分析中…':'選影片後自動產生'}</span></div>}
        {thumbnailCandidates.length>0&&<><div className="thumbnail-gallery-title"><strong>12 張候選（含片頭／片尾）</strong><span>紫框＝AI 推薦；綠框＝目前正式封面</span></div><div className="thumbnail-gallery">
          {displayIndexes.map(index=>{const candidate=thumbnailCandidates[index];const rank=recommendedIndexes.indexOf(index)+1;const selected=selectedIndex===index;return <button type="button" key={`${candidate.at}-${index}`} className={`thumbnail-candidate ${rank>0?'recommended':''} ${selected?'selected':''}`} disabled={thumbnailBusy||busy} onClick={()=>void chooseThumbnailCandidate(index)}>
            <img src={candidate.preview} alt={`候選封面 ${index+1}`}/><span className="candidate-number">#{index+1}</span>{rank>0&&<span className="candidate-rank"><Sparkles size={12}/> AI {rank}</span>}{selected&&<span className="candidate-selected"><CheckCircle2 size={13}/>目前使用</span>}<small>{candidate.role==='intro'?'片頭':candidate.role==='outro'?'片尾':'內容'} · {Math.round(candidate.at)} 秒</small>
          </button>;})}
        </div></>}
        <div className="thumbnail-meta"><span>{thumbnailMessage}</span>{video&&<button type="button" className="small-button" disabled={thumbnailBusy||busy} onClick={()=>void analyzeThumbnail(video)}>依目前偏好重新分析</button>}</div>
      </div>
    </div></section>

    <section className="panel studio-panel"><div className="studio-heading"><div><div className="eyebrow">YOUTUBE STUDIO MODE</div><h2>③ YouTube Studio 詳細資料</h2></div><span className="api-badge">API 可直接寫入</span></div><div className="form-grid">
      <label className="wide">標題<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={100}/><small>{title.length}/100</small></label>
      <label className="wide">說明<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={7}/></label>
      <label>播放清單<select value={playlistId} onChange={e=>setPlaylistId(e.target.value)}><option value="">不加入播放清單</option>{youtubeOptions.playlists.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>YouTube 分類<select value={youtubeCategory} onChange={e=>setYoutubeCategory(e.target.value)}>{youtubeOptions.categories.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="wide">標籤（逗號分隔）<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="繁星回聲, 學習, 分享"/></label>
      <label>影片語言<input value={language} onChange={e=>setLanguage(e.target.value)} placeholder="zh-TW"/></label>
      <label>錄製日期<input type="date" value={recordingDate} onChange={e=>setRecordingDate(e.target.value)}/></label>
      <div className="setting-card wide"><strong>觀眾</strong><Toggle checked={madeForKids} onChange={setMadeForKids} label="這是兒童內容（Made for Kids）"/></div>
      <div className="setting-card wide"><strong>變造／合成內容揭露</strong><Toggle checked={containsSyntheticMedia} onChange={setContainsSyntheticMedia} label="包含逼真的 AI 生成或變造內容"/></div>
      <label>授權<select value={license} onChange={e=>setLicense(e.target.value as 'youtube'|'creativeCommon')}><option value="youtube">標準 YouTube 授權</option><option value="creativeCommon">Creative Commons</option></select></label>
      <div className="setting-card"><Toggle checked={embeddable} onChange={setEmbeddable} label="允許嵌入其他網站"/></div>
      <div className="setting-card"><Toggle checked={publicStatsViewable} onChange={setPublicStatsViewable} label="公開影片統計資訊"/></div>
      <div className="setting-card"><Toggle checked={notifySubscribers} onChange={setNotifySubscribers} label="通知訂閱者"/></div>
      <label className="wide">字幕檔（可選）<input type="file" accept=".srt,.vtt,.sbv,.ttml,.xml,text/*" onChange={e=>setCaptionFile(e.target.files?.[0]||null)}/><small>{captionFile?captionFile.name:'可上傳 SRT / VTT 等字幕；此功能需要新版 YouTube 授權'}</small></label>
      {captionFile&&<><label>字幕語言<input value={captionLanguage} onChange={e=>setCaptionLanguage(e.target.value)}/></label><label>字幕名稱<input value={captionName} onChange={e=>setCaptionName(e.target.value)}/></label></>}
      <label>Gan Jing World 分類 ID<input value={gjwCategory} onChange={e=>setGjwCategory(e.target.value)}/></label>
    </div></section>

    <section className="panel"><h2>④ YouTube Studio 發布設定</h2><div className="visibility-grid">
      {(['private','unlisted','public','schedule'] as VisibilityMode[]).map(mode=><button type="button" key={mode} className={`visibility-option ${visibilityMode===mode?'active':''}`} onClick={()=>setVisibilityMode(mode)}><b>{mode==='private'?'私人':mode==='unlisted'?'不公開列出':mode==='public'?'公開':'預約發布'}</b><span>{mode==='schedule'?'YouTube 會先保持私人，到指定時間再公開':''}</span></button>)}
    </div>{visibilityMode==='schedule'&&<label className="schedule-field">預約日期與時間<input type="datetime-local" value={scheduleAt} onChange={e=>setScheduleAt(e.target.value)}/></label>}</section>

    <section className="panel studio-only"><div className="studio-heading"><div><div className="eyebrow">YOUTUBE STUDIO ONLY</div><h2>⑤ YouTube 有，但官方 API 未開放寫入</h2></div><span className="manual-badge">上傳後到 Studio 完成</span></div><p>這些選項保留在同一頁提醒你，但 StarsVideoSync 不會假裝設定成功。</p><div className="locked-grid">
      {['付費宣傳／品牌置入','自動章節與重要時刻','精選地點','年齡限制的完整控制','留言與留言排序','顯示喜歡人數／部分互動設定','Shorts remix 取樣控制','片尾畫面','資訊卡','版權 Checks','廣告適合度／營利與廣告插入點','Premiere 首播'].map(item=><div className="locked-item" key={item}><span>🔒</span><b>{item}</b><small>YouTube Studio 專屬</small></div>)}
    </div></section>

    <section className="panel"><div className="publish-head"><h2>⑥ 一鍵發佈</h2><button className="primary" disabled={!canPublish} onClick={publish}>{busy?'正在發佈…':thumbnailBusy?'正在挑選封面…':'發布到所有平台'}</button></div>
      {!status?.authenticated&&<div className="notice"><LogIn size={18}/>第一次使用請先連接 YouTube；只有指定管理員帳號可以操作。</div>}
      <div className="notice info">新版增加播放清單與字幕寫入權限；第一次使用 v0.9 請按一次 YouTube「重新授權」。</div>
      <Progress name="YouTube" data={yt}/><Progress name="Gan Jing World" data={gjw}/><Progress name="Odysee" data={odysee}/>
    </section>

    <footer>影片檔本體不經過 StarsVideoSync Worker；12 張候選縮圖在瀏覽器產生，AI 只分析低解析候選圖。YouTube 官方 API 未開放的 Studio 功能會明確標示，不會偽裝成已設定。</footer>
  </main>;
}

function Toggle({checked,onChange,label}:{checked:boolean;onChange:(value:boolean)=>void;label:string}){return <label className="toggle-row"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span>{label}</span></label>;}
function Connection({name,connected,detail,href,icon}:{name:string;connected:boolean;detail?:string;href:string;icon:React.ReactNode}) {return <div className="connection"><div className="connection-title">{icon}<strong>{name}</strong></div><span className={`badge ${connected?'ok':'neutral'}`}>{connected?'已連接':'尚未連接'}</span><p>{detail||(connected?'授權正常':'需要授權後才能發佈')}</p><a className="small-button" href={href}>{connected?'重新授權':'連接帳號'} <ExternalLink size={14}/></a></div>;}
function Progress({name,data}:{name:string;data:PlatformProgress}) {const icon=data.state==='done'?<CheckCircle2 size={20}/>:<Circle size={20}/>;return <div className={`progress-row ${data.state}`}><div className="progress-title">{icon}<b>{name}</b><span>{data.message||'尚未開始'}</span>{data.url&&<a href={data.url} target="_blank" rel="noreferrer">開啟 <ExternalLink size={13}/></a>}</div><div className="bar"><i style={{width:`${Math.max(0,Math.min(100,data.pct))}%`}}/></div></div>;}
