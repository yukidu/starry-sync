import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard, Menu, MonitorPlay, RefreshCw, UserRound, X } from 'lucide-react';
import { openStarrySyncAccount } from './starrySso';

export type MainMode = 'long' | 'short';

type Props = {
  active: MainMode;
  onNavigate: (mode: MainMode) => void;
  onRefresh: () => void;
};

export default function MainNav({ active, onNavigate, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!open) return;
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  const go = (mode: MainMode) => {
    onNavigate(mode);
    setOpen(false);
  };

  return <header ref={rootRef} className="main-nav" data-main-navigation="true">
    <div className="main-nav-row">
      <button type="button" className="brand-button" onClick={() => go('long')} aria-label="繁星同步首頁">
        <span className="brand-mark-wrap" aria-hidden="true">
          <span className="brand-glow" />
          <img src="/stars-sync.svg" alt="" className="brand-mark" />
        </span>
        <span className="brand-copy"><b>繁星同步</b><small>Stars Video Sync</small></span>
      </button>

      <nav className="main-nav-tabs" aria-label="主選單">
        <button type="button" className={`main-nav-tab ${active === 'long' ? 'active' : ''}`} onClick={() => go('long')}>
          <MonitorPlay size={18}/><span>長影音</span>
        </button>
        <button type="button" className={`main-nav-tab ${active === 'short' ? 'active' : ''}`} onClick={() => go('short')}>
          <Clapperboard size={18}/><span>短影音</span>
        </button>
      </nav>

      <button type="button" className={`hamburger-button ${open ? 'open' : ''}`} aria-expanded={open} aria-label="主選單" onClick={() => setOpen(v => !v)}>
        {open ? <X size={24}/> : <Menu size={24}/>} 
      </button>
    </div>

    {open && <div className="main-menu-shell">
      <div className="main-menu-panel" data-react-menu="true">
        <div className="main-menu-brand-row">
          <img src="/stars-sync.svg" alt="" />
          <div><b>繁星同步</b><span>影片一站式同步發布</span></div>
        </div>
        <button type="button" className={`main-menu-row ${active === 'long' ? 'active' : ''}`} onClick={() => go('long')}><MonitorPlay size={20}/><span><b>長影音</b><small>YouTube · Gan Jing World · Odysee</small></span></button>
        <button type="button" className={`main-menu-row ${active === 'short' ? 'active' : ''}`} onClick={() => go('short')}><Clapperboard size={20}/><span><b>短影音</b><small>Reels · Shorts · TikTok · 更多平台</small></span></button>
        <div className="main-menu-divider" />
        <button type="button" className="main-menu-row" onClick={() => { setOpen(false); openStarrySyncAccount(); }}><UserRound size={20}/><span><b>繁星帳號</b><small>登入、切換帳號或登出全部繁星 App</small></span></button>
        <button type="button" className="main-menu-row" onClick={() => { setOpen(false); onRefresh(); }}><RefreshCw size={20}/><span><b>重新整理</b><small>重新讀取平台與授權狀態</small></span></button>
      </div>
    </div>}
  </header>;
}
