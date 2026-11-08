import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemeName } from '../../lib/types';
import { ThemeContext } from './theme-context';
const STORAGE_KEY = 'xuzhen.theme.v2';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#151c1a' : '#f1eee5');
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
