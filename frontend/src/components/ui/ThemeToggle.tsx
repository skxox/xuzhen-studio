import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../app/providers/theme-context';
import { IconButton } from './Button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <IconButton
      className="theme-toggle"
      label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
      onClick={toggleTheme}
    >
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </IconButton>
  );
}
