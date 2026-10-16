import React from 'react';
import ReactDOM from 'react-dom/client';
import RootApp from './RootApp';
import { initStarrySyncSso } from './starrySso';
import './styles.css';
import './v13.css';
import './v15.css';
import './v16.css';

initStarrySyncSso();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RootApp /></React.StrictMode>
);
