import { useTheme } from '../state/theme';
import { SunIcon, MoonIcon } from './icons';

/** Appearance toggle. The glyph shows the theme you will switch to, and the
    tooltip names it; sun for light, moon for dark. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const toLight = theme === 'dark';
  return (
    <button
      className="seat-tool tip tip--start"
      data-tip={toLight ? 'Light theme' : 'Dark theme'}
      aria-label={toLight ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={toggle}
    >
      {toLight ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
