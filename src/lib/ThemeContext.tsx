import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { THEMES, DEFAULT_THEME, isThemeKey, type ThemeKey, type ThemeDef } from '@/lib/themes';

const STORAGE_KEY = 'cardroom_theme';

interface ThemeContextValue {
  themeKey: ThemeKey;
  theme: ThemeDef;
  setTheme: (key: ThemeKey) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** "#10b981" -> "16 185 129", for Tailwind's `rgb(var(--x) / <alpha-value>)` color pattern. */
function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyThemeVars(theme: ThemeDef) {
  const root = document.documentElement;
  root.style.setProperty('--color-bg-rgb', hexToRgbTriplet(theme.colors.bg));
  root.style.setProperty('--color-panel-rgb', hexToRgbTriplet(theme.colors.panel));
  root.style.setProperty('--color-primary-rgb', hexToRgbTriplet(theme.colors.primary));
  root.style.setProperty('--color-primary-light-rgb', hexToRgbTriplet(theme.colors.primaryLight));
  root.style.setProperty('--color-primary-lighter-rgb', hexToRgbTriplet(theme.colors.primaryLighter));
  root.style.setProperty('--color-accent-rgb', hexToRgbTriplet(theme.colors.accent));
  root.style.setProperty('--color-label-rgb', hexToRgbTriplet(theme.colors.label));
  root.style.setProperty('--font-display', theme.fontDisplay);
  root.style.setProperty('--font-sans', theme.fontSans);
  root.setAttribute('data-theme', theme.key);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeKey, setThemeKey] = useState<ThemeKey>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeKey(stored) ? stored : DEFAULT_THEME;
  });

  useEffect(() => {
    applyThemeVars(THEMES[themeKey]);
  }, [themeKey]);

  function setTheme(key: ThemeKey) {
    localStorage.setItem(STORAGE_KEY, key);
    setThemeKey(key);
  }

  return (
    <ThemeContext.Provider value={{ themeKey, theme: THEMES[themeKey], setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
