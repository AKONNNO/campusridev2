import { useState, useEffect } from 'react';

/** Dark-mode toggle: persists to localStorage, syncs the `dark` class. */
export function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('knust_dark');
      if (saved !== null) return saved === '1';
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('knust_dark', dark ? '1' : '0');
    } catch {
      /* private mode */
    }
    // Keep the browser chrome / Android status bar colour in sync with the
    // chosen theme (PWA polish) — matches the manifest's theme_color for dark.
    const meta = document.querySelector('meta#theme-color-meta');
    if (meta) meta.setAttribute('content', dark ? '#0f172a' : '#f1f5f9');
  }, [dark]);

  return [dark, setDark];
}
