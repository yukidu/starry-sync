import React, { useEffect, useState } from 'react';
import LongVideoPage from './App';
import MainNav, { type MainMode } from './MainNav';
import ShortVideoPage from './ShortVideoPage';

function modeFromUrl(): MainMode {
  if (typeof window === 'undefined') return 'long';
  return new URLSearchParams(window.location.search).get('page') === 'short' ? 'short' : 'long';
}

export default function RootApp() {
  const [mode, setMode] = useState<MainMode>(modeFromUrl);

  useEffect(() => {
    const sync = () => setMode(modeFromUrl());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    document.title = mode === 'short' ? '繁星同步｜短影音' : '繁星同步｜長影音';
    document.body.dataset.videoMode = mode;
    return () => { delete document.body.dataset.videoMode; };
  }, [mode]);

  const navigate = (next: MainMode) => {
    if (next === mode) return;
    const url = new URL(window.location.href);
    if (next === 'short') url.searchParams.set('page','short');
    else url.searchParams.delete('page');
    window.history.pushState({page:next},'',`${url.pathname}${url.search}${url.hash}`);
    setMode(next);
    window.scrollTo({top:0,behavior:'smooth'});
  };

  return <div className="root-app-shell">
    <MainNav active={mode} onNavigate={navigate} onRefresh={() => window.location.reload()}/>
    <div className="page-under-main-nav">
      {mode === 'short'
        ? <ShortVideoPage/>
        : <div className="long-video-route"><LongVideoPage/></div>}
    </div>
  </div>;
}
