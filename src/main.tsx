import React from 'react';
import ReactDOM from 'react-dom/client';
import RootApp from './RootApp';
import { initStarryResonanceEcosystem } from './ecosystemSso';
import './styles.css';
import './v13.css';
import './v15.css';
import './v16.css';

initStarryResonanceEcosystem();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RootApp /></React.StrictMode>
);