import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { registerServiceWorker } from './lib/pwa.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// PWA: register the service worker for offline support + installability.
// It only activates in production builds (npm run build && npm run preview)
// so Vite dev/HMR never fights the cache.
registerServiceWorker();
