import { createContext, useContext } from 'react';
import type { ThemeName } from '../../lib/types';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
