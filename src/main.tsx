import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);

// PWA 서비스 워커 (앱 셸)
if ('serviceWorker' in navigator && !location.search.includes('nosw')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 개발 환경 등 */ });
  });
}
