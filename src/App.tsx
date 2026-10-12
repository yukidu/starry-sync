import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, CloudUpload, ExternalLink, LogIn, RefreshCw, Sparkles, Video } from 'lucide-react';
import { api } from './api';
import { extractThumbnailCandidates, renderThumbnailFile, type ThumbnailCandidate } from './thumbnail';
import { uploadYoutubeFile, uploadYoutubeThumbnail } from './upload/youtube';
import { uploadGjwPoster, uploadGjwVideo } from './upload/gjw';

type Status = {
  authenticated: boolean;
  email?: string;
  youtube: { connected: boolean; channelTitle?: string };
  gjw: { connected: boolean; channelName?: string };
};

type PlatformProgress = { state: 'idle'|'waiting'|'uploading'|'processing'|'done'|'error'; pct: number; message?: string; url?: string };
type ThumbnailState = 'idle'|'extracting'|'ai'|'ready'|'fallback'|'error';

const emptyProgress: PlatformProgress = { state: 'idle', pct: 0 };

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState('');
  const [thumbnailCandidates, setThumbnailCandidates] = useState<ThumbnailCandidate[]>([]);
  const [recommendedIndexes, setRecommendedIndexes] = useState<number[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [thumbnailState, setThumbnailState] = useState<ThumbnailState>('idle');
  const [thumbnailMessage, setThumbnailMessage] = useState('選擇影片後會自動分析');
  const thumbnailJob = useRef(0);
  const thumbnailSelectionJob = useRef(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [language, setLanguage] = useState('zh-TW');
  const [privacy, setPrivacy] = useState<'private'|'unlisted'|'public'>('private');
  const [youtubeCategory, setYoutubeCategory] = useState('22');
  const [gjwCategory, setGjwCategory] = useState('cat13');
  const [madeForKids, setMadeForKids] = useState(false);
  const [yt, setYt] = useState<PlatformProgress>(emptyProgress);
  const [gjw, setGjw] = useState<PlatformProgress>(emptyProgress);
  const [odysee, setOdysee] = useState<PlatformProgress>({ state: 'waiting', pct: 0, message: '由 YouTube Sync 自動同步' });
  const [busy, setBusy] = useState(false);

  const refreshStatus = () => api<Status>('/api/status').then(setStatus).catch(() => setStatus({ authenticated:false, youtube:{connected:false}, gjw:{connected:false} }));
  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => () => { if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview); }, [thumbnailPreview]);

  const canPublish = useMemo(() => !!video && !!thumbnail && !!title.trim() && status?.youtube.connected && status?.gjw.connected && !busy, [video, thumbnail, title, status, busy]);
  const thumbnailBusy = thumbnailState === 'extracting' || thumbnailState === 'ai';

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
    setThumbnail(null);
    setThumbnailPreview('');
    setThumbnailCandidates([]);
    setRecommendedIndexes([]);
    setSelectedIndex(null);
    setThumbnailState('extracting');
    setThumbnailMessage('正在從影片擷取 12 張候選畫面…');
    try {
      const candidates = await extractThumbnailCandidates(file, 12);
      if (job !== thumbnailJob.current) return;
      if (!candidates.length) throw new Error('影片中找不到可用畫面');
      setThumbnailCandidates(candidates);

      const localRanked = candidates
        .map((candidate, index) => ({ index, score: candidate.localScore }))
        .sort((a, b) => b.score - a.score)
        .map(item => item.index);
      let recommendations = localRanked.slice(0, 4);
      let usedAi = false;

      setThumbnailState('ai');
      setThumbnailMessage('12 張候選已顯示；Cloudflare AI 正在選出最佳 4 張…');
      try {
        const selected = await api<{ index: number; recommendedIndexes?: number[]; scores: number[]; confidence?: number }>('/api/thumbnail/select', {
          method: 'POST',
          body: JSON.stringify({ frames: candidates.map(frame => ({ image: frame.preview, at: frame.at, localScore: frame.localScore })) }),
        });
        const aiRecommended = Array.isArray(selected.recommendedIndexes)
          ? selected.recommendedIndexes.filter(index => Number.isInteger(index) && index >= 0 && index < candidates.length)
          : [];
        const bestIndex = Number.isInteger(selected.index) && selected.index >= 0 && selected.index < candidates.length ? selected.index : null;
        const merged = [...(bestIndex === null ? [] : [bestIndex]), ...aiRecommended, ...localRanked]
          .filter((index, position, values) => values.indexOf(index) === position)
          .slice(0, Math.min(4, candidates.length));
        if (merged.length) {
          recommendations = merged;
          usedAi = bestIndex !== null || aiRecommended.length > 0;
        }
      } catch (aiError) {
        console.warn('Cloudflare AI thumbnail selection failed; using local fallback.', aiError);
      }

      if (job !== thumbnailJob.current) return;
      setRecommendedIndexes(recommendations);
      const initialIndex = recommendations[0] ?? 0;
      setSelectedIndex(initialIndex);
      const fileOut = await renderThumbnailFile(file, candidates[initialIndex].at);
      if (job !== thumbnailJob.current) return;
      setFinalThumbnail(fileOut);
      setThumbnailState(usedAi ? 'ready' : 'fallback');
      setThumbnailMessage(usedAi
        ? 'AI 已從 12 張中推薦 4 張；目前預選第 1 名，你可以點選任一推薦圖作為正式封面'
        : 'AI 暫時不可用；已用本機評分選出 4 張，你可以手動選擇');
    } catch (error) {
      if (job !== thumbnailJob.current) return;
      setThumbnail(null);
      setThumbnailCandidates([]);
      setRecommendedIndexes([]);
      setSelectedIndex(null);
      setThumbnailState('error');
      setThumbnailMessage(error instanceof Error ? error.message : '自動產生封面失敗');
    }
  }

  async function chooseThumbnailCandidate(index: number) {
    if (!video || busy || thumbnailBusy || !recommendedIndexes.includes(index) || !thumbnailCandidates[index]) return;
    const selectionJob = ++thumbnailSelectionJob.current;
    setSelectedIndex(index);
    setThumbnail(null);
    const rank = recommendedIndexes.indexOf(index) + 1;
    setThumbnailMessage(`正在使用 AI 推薦第 ${rank} 名產生正式封面…`);
    try {
      const fileOut = await renderThumbnailFile(video, thumbnailCandidates[index].at);
      if (selectionJob !== thumbnailSelectionJob.current) return;
      setFinalThumbnail(fileOut);
      setThumbnailMessage(`已選擇 AI 推薦第 ${rank} 名作為正式封面`);
    } catch (error) {
      if (selectionJob !== thumbnailSelectionJob.current) return;
      setThumbnail(null);
      setThumbnailMessage(error instanceof Error ? error.message : '產生正式封面失敗');
    }
  }

  async function handleVideoSelection(file: File | null) {
    thumbnailJob.current++;
    thumbnailSelectionJob.current++;
    setVideo(file);
    setThumbnail(null);
    setThumbnailPreview('');
    setThumbnailCandidates([]);
    setRecommendedIndexes([]);
    setSelectedIndex(null);
    if (!file) {
      setThumbnailState('idle');
      setThumbnailMessage('選擇影片後會自動分析');
      return;
    }
    await analyzeThumbnail(file);
  }

  async function publish() {
    if (!video || !thumbnail || !canPublish) return;
    setBusy(true);
    setYt({ state:'waiting', pct:0, message:'建立 YouTube 上傳工作階段' });
    setGjw({ state:'waiting', pct:0, message:'準備 Gan Jing World' });
    setOdysee({ state:'waiting', pct:0, message:'等待 YouTube 公開影片同步' });

    const metadata = {
      title: title.trim(), description, tags: tags.split(',').map(v=>v.trim()).filter(Boolean), language,
      privacy, youtubeCategory, gjwCategory, madeForKids,
    };

    const youtubeTask = (async () => {
      try {
        const start = await api<{uploadUrl:string;accessToken:string}>('/api/youtube/upload-session', {
          method:'POST', body: JSON.stringify({ ...metadata, fileSize: video.size, mimeType: video.type || 'video/mp4' })
        });
        setYt({ state:'uploading', pct:0, message:'直接從你的瀏覽器傳到 YouTube' });
        const result = await uploadYoutubeFile(video, start, pct => setYt({ state:'uploading', pct, message:'直接從你的瀏覽器傳到 YouTube' }), getYoutubeAccessToken);
        if (result.id) {
          try { await uploadYoutubeThumbnail(result.id, thumbnail, await getYoutubeAccessToken()); }
          catch (thumbError) { console.warn(thumbError); }
        }
        const url = result.id ? `https://youtu.be/${result.id}` : undefined;
        setYt({ state:'done', pct:100, message:'YouTube 已完成', url });
        setOdysee({ state:'processing', pct:0, message:'YouTube 已完成；Odysee 將依 YouTube Sync 自動同步' });
        return url;
      } catch (e) {
        setYt({ state:'error', pct:0, message: e instanceof Error ? e.message : 'YouTube 上傳失敗' });
        throw e;
      }
    })();

    const gjwTask = (async () => {
      try {
        const uploadToken = await getGjwUploadToken();
        setGjw({ state:'uploading', pct:1, message:'上傳已選封面' });
        const poster = await uploadGjwPoster(thumbnail, uploadToken);
        const created = await api<{ contentId:string; channelId:string }>('/api/gjw/create-video', {
          method:'POST', body: JSON.stringify({ ...metadata, ...poster })
        });
        setGjw({ state:'uploading', pct:2, message:'直接從你的瀏覽器傳到 Gan Jing World' });
        const tusUrl = await uploadGjwVideo({
          file: video, contentId: created.contentId, channelId: created.channelId, language,
          getUploadToken: getGjwUploadToken,
          onProgress: pct => setGjw({ state:'uploading', pct, message:'直接從你的瀏覽器傳到 Gan Jing World' })
        });
        setGjw({ state:'processing', pct:100, message:'影片已上傳，等待平台轉碼' });
        const prepared = await api<{ videoId:string }>('/api/gjw/finish-video', { method:'POST', body: JSON.stringify({ tusUrl }) });
        for (let attempt = 0; attempt < 60; attempt++) {
          const polled = await api<{ ready:boolean; url?:string; error?:string }>(`/api/gjw/video-status?videoId=${encodeURIComponent(prepared.videoId)}&contentId=${encodeURIComponent(created.contentId)}`);
          if (polled.ready && polled.url) {
            setGjw({ state:'done', pct:100, message:'Gan Jing World 已完成', url: polled.url });
            return polled.url;
          }
          setGjw({ state:'processing', pct:100, message:`平台轉碼中… ${attempt + 1}/60` });
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
        throw new Error('Gan Jing World 轉碼時間較久，請稍後重新整理狀態');
      } catch (e) {
        setGjw({ state:'error', pct:0, message: e instanceof Error ? e.message : 'Gan Jing World 上傳失敗' });
        throw e;
      }
    })();

    await Promise.allSettled([youtubeTask, gjwTask]);
    setBusy(false);
  }

  return <main className="shell">
    <header>
      <div><div className="eyebrow">MULTI-PLATFORM PUBLISHER</div><h1>StarsVideoSync</h1><p>選一次影片，直接發佈到 YouTube 與 Gan Jing World；Odysee 交給官方 YouTube Sync。</p></div>
      <button className="ghost" onClick={refreshStatus}><RefreshCw size={17}/>更新狀態</button>
    </header>

    <section className="panel connections">
      <h2>① 連接平台</h2>
      <div className="connection-grid">
        <Connection name="YouTube" connected={!!status?.youtube.connected} detail={status?.youtube.channelTitle} href="/api/auth/youtube/start" icon={<Video size={22}/>} />
        <Connection name="Gan Jing World" connected={!!status?.gjw.connected} detail={status?.gjw.channelName} href="/api/auth/gjw/start" icon={<CloudUpload size={22}/>} />
        <div className="connection"><div className="connection-title"><CheckCircle2 size={22}/><strong>Odysee</strong></div><span className="badge neutral">YouTube Sync</span><p>本系統不搬運第三份影片，讓 Odysee 官方同步 YouTube，節省流量。</p></div>
      </div>
    </section>

    <section className="panel">
      <h2>② 選擇影片與資料</h2>
      <div className="form-grid">
        <label className="filebox wide"><span>影片母片</span><input type="file" accept="video/*" onChange={e=>void handleVideoSelection(e.target.files?.[0]||null)}/><b>{video ? `${video.name} · ${(video.size/1024/1024).toFixed(1)} MB` : '選擇影片'}</b></label>
        <div className={`thumbnail-auto ${thumbnailState}`}>
          <div className="thumbnail-title"><span>封面縮圖</span><b><Sparkles size={15}/> 12 張候選 · AI 推薦 4 張 · 你決定最後 1 張</b></div>
          {thumbnailPreview ? <img className="thumbnail-preview" src={thumbnailPreview} alt="目前選定封面"/> : <div className="thumbnail-empty"><Sparkles size={24}/><span>{thumbnailBusy ? '分析中…' : '選影片後自動產生'}</span></div>}
          {thumbnailCandidates.length > 0 && <>
            <div className="thumbnail-gallery-title"><strong>影片擷取的 12 張候選</strong><span>有「AI 推薦」標記的 4 張可以直接點選</span></div>
            <div className="thumbnail-gallery">
              {thumbnailCandidates.map((candidate, index) => {
                const rank = recommendedIndexes.indexOf(index) + 1;
                const recommended = rank > 0;
                const selected = selectedIndex === index;
                return <button
                  type="button"
                  key={`${candidate.at}-${index}`}
                  className={`thumbnail-candidate ${recommended ? 'recommended' : ''} ${selected ? 'selected' : ''}`}
                  disabled={!recommended || thumbnailBusy || busy}
                  onClick={()=>void chooseThumbnailCandidate(index)}
                  aria-label={recommended ? `AI 推薦第 ${rank} 名，點選作為封面` : `候選畫面 ${index + 1}`}
                >
                  <img src={candidate.preview} alt={`候選封面 ${index + 1}`}/>
                  <span className="candidate-number">#{index + 1}</span>
                  {recommended && <span className="candidate-rank"><Sparkles size={12}/> AI 推薦 {rank}</span>}
                  {selected && <span className="candidate-selected"><CheckCircle2 size={13}/> 目前使用</span>}
                  <small>{Math.round(candidate.at)} 秒</small>
                </button>;
              })}
            </div>
          </>}
          <div className="thumbnail-meta"><span>{thumbnailMessage}</span>{video && <button type="button" className="small-button" disabled={thumbnailBusy || busy} onClick={()=>void analyzeThumbnail(video)}>重新分析</button>}</div>
        </div>
        <label className="wide">標題<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={100}/></label>
        <label className="wide">說明<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={5}/></label>
        <label className="wide">標籤（用逗號分隔）<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="繁星回聲, 學習, 分享"/></label>
        <label>語言<input value={language} onChange={e=>setLanguage(e.target.value)}/></label>
        <label>YouTube 分類 ID<input value={youtubeCategory} onChange={e=>setYoutubeCategory(e.target.value)}/></label>
        <label>Gan Jing World 分類 ID<input value={gjwCategory} onChange={e=>setGjwCategory(e.target.value)}/></label>
        <label>公開狀態<select value={privacy} onChange={e=>setPrivacy(e.target.value as any)}><option value="private">私人（建議先測試）</option><option value="unlisted">不公開列出</option><option value="public">公開</option></select></label>
        <label className="check"><input type="checkbox" checked={madeForKids} onChange={e=>setMadeForKids(e.target.checked)}/> 這是兒童內容</label>
      </div>
    </section>

    <section className="panel">
      <div className="publish-head"><h2>③ 一鍵發佈</h2><button className="primary" disabled={!canPublish} onClick={publish}>{busy ? '正在發佈…' : thumbnailBusy ? '正在挑選封面…' : '發布到所有平台'}</button></div>
      {!status?.authenticated && <div className="notice"><LogIn size={18}/>第一次使用請先連接 YouTube；只有指定管理員帳號可以操作。</div>}
      <Progress name="YouTube" data={yt}/><Progress name="Gan Jing World" data={gjw}/><Progress name="Odysee" data={odysee}/>
    </section>

    <footer>影片檔本體不經過 StarsVideoSync 的 Cloudflare Worker；前台會顯示 12 張低解析候選畫面，Workers AI 從中推薦 4 張，最後由你選定 1 張；正式縮圖仍在你的瀏覽器產生。</footer>
  </main>
}

function Connection({name,connected,detail,href,icon}:{name:string;connected:boolean;detail?:string;href:string;icon:React.ReactNode}) {
  return <div className="connection"><div className="connection-title">{icon}<strong>{name}</strong></div><span className={`badge ${connected?'ok':'neutral'}`}>{connected?'已連接':'尚未連接'}</span><p>{detail || (connected ? '授權正常' : '需要授權後才能發佈')}</p><a className="small-button" href={href}>{connected?'重新授權':'連接帳號'} <ExternalLink size={14}/></a></div>
}
function Progress({name,data}:{name:string;data:PlatformProgress}) {
  const icon = data.state==='done' ? <CheckCircle2 size={20}/> : <Circle size={20}/>;
  return <div className={`progress-row ${data.state}`}><div className="progress-title">{icon}<b>{name}</b><span>{data.message || '尚未開始'}</span>{data.url && <a href={data.url} target="_blank" rel="noreferrer">開啟 <ExternalLink size={13}/></a>}</div><div className="bar"><i style={{width:`${Math.max(0,Math.min(100,data.pct))}%`}}/></div></div>
}
