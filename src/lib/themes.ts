import type { BackColorKey } from '@/lib/cardArt';

export type ThemeKey = 'swank' | 'goof' | 'heist' | 'okitoki';

export interface ThemeDef {
  key: ThemeKey;
  label: string;
  /** CSS font-family value (including its own fallback chain). */
  fontDisplay: string;
  /** Extra classes for display headings that need italic/weight beyond the family itself. */
  fontDisplayClass: string;
  fontSans: string;
  /** Drives the shared app-* CSS-var tokens used across Landing/Lobby/Game. */
  colors: {
    bg: string;
    panel: string;
    primary: string;
    primaryLight: string;
    primaryLighter: string;
    accent: string;
    label: string;
  };
  /** Suggested card-back color seeded when a room is created under this theme. */
  backColor: BackColorKey;
  /** Landing-page-only presentation — literal Tailwind classes, read directly by Landing.tsx. */
  landing: {
    transparentPanel: boolean;
    panelClass: string;
    headingClass: string;
    /** Present only for themes with a per-word multicolor title (Goof, Oki Toki). */
    multicolorHeading?: { word: string; className: string }[];
    taglineClass: string;
    primaryBtnClass: string;
    secondaryBtnClass: string;
    pillActiveClass: string;
    testBtnClass: string;
    radius: { panel: string; button: string; input: string; pillOuter: string; pillInner: string; testButton: string };
    decoration: 'diagonal-tile' | 'goof-columns' | 'heist-blobs' | 'okitoki-scatter';
  };
}

export const THEMES: Record<ThemeKey, ThemeDef> = {
  // Matches the Figma frame "Swank" — the original vintage card-room look.
  swank: {
    key: 'swank',
    label: 'Swank',
    fontDisplay: '"ohno-blazeface", ui-serif, Georgia, serif',
    fontDisplayClass: '',
    fontSans: '"avenir-next-lt-pro", ui-sans-serif, system-ui, sans-serif',
    colors: {
      bg: '#022c22',
      panel: '#064e3b',
      primary: '#059669',
      primaryLight: '#10b981',
      primaryLighter: '#34d399',
      accent: '#10b981',
      label: '#6ee7b7',
    },
    backColor: 'blue',
    landing: {
      transparentPanel: false,
      panelClass: 'bg-app-panel border border-white/10',
      headingClass: 'text-white',
      taglineClass: 'text-white/80',
      primaryBtnClass: 'bg-app-primaryLight hover:bg-app-primaryLighter text-white',
      secondaryBtnClass: 'bg-white/10 hover:bg-white/20 text-white',
      pillActiveClass: 'bg-app-primary text-white',
      testBtnClass: 'border-white/20 hover:border-white/40 text-white/60 hover:text-white',
      radius: { panel: 'rounded', button: 'rounded', input: 'rounded', pillOuter: 'rounded', pillInner: 'rounded', testButton: 'rounded' },
      decoration: 'diagonal-tile',
    },
  },
  // Matches the Figma frame "Goof" — black background, neon Cheee display font.
  goof: {
    key: 'goof',
    label: 'Goof',
    fontDisplay: '"cheee-variable", ui-sans-serif, system-ui, sans-serif',
    fontDisplayClass: '',
    fontSans: '"avenir-next-lt-pro", ui-sans-serif, system-ui, sans-serif',
    colors: {
      bg: '#000000',
      panel: '#18181b',
      primary: '#9d00d9',
      primaryLight: '#b700ff',
      primaryLighter: '#d24bff',
      accent: '#00ff48',
      label: '#00ff48',
    },
    backColor: 'black',
    landing: {
      transparentPanel: true,
      // Fully transparent (as in the mockup) reads fine against a plain black page, but
      // this responsive layout puts the decorative column right behind the card at some
      // widths — a faint scrim keeps the form legible without adding a visible border.
      panelClass: 'bg-black/40',
      headingClass: 'text-white',
      multicolorHeading: [
        { word: 'The ', className: 'text-[#00ff48]' },
        { word: 'Card ', className: 'text-[#ff5100]' },
        { word: 'Room', className: 'text-[#b700ff]' },
      ],
      taglineClass: 'text-white/80',
      primaryBtnClass: 'bg-[#b700ff] hover:bg-[#d24bff] text-white',
      secondaryBtnClass: 'bg-white/10 hover:bg-white/20 text-white',
      pillActiveClass: 'bg-[#ff5100] text-white',
      testBtnClass: 'border-white/20 hover:border-white/40 text-white/60 hover:text-white',
      radius: { panel: 'rounded', button: 'rounded-[20px]', input: 'rounded-[16px]', pillOuter: 'rounded-[16px]', pillInner: 'rounded-[12px]', testButton: 'rounded-full' },
      decoration: 'goof-columns',
    },
  },
  // Matches the Figma frame "Heist" — deep navy, italic condensed Obviously display font.
  heist: {
    key: 'heist',
    label: 'Heist',
    fontDisplay: '"obviously-narrow", ui-sans-serif, system-ui, sans-serif',
    fontDisplayClass: 'italic font-bold',
    fontSans: '"avenir-next-lt-pro", ui-sans-serif, system-ui, sans-serif',
    colors: {
      bg: '#001056',
      panel: '#0a1a6b',
      primary: '#e4d4ff',
      primaryLight: '#ffffff',
      primaryLighter: '#ffffff',
      accent: '#ffffff',
      label: '#6ee7b7',
    },
    backColor: 'purple',
    landing: {
      transparentPanel: true,
      panelClass: 'bg-transparent',
      headingClass: 'text-[#d1aaff]/80',
      taglineClass: 'text-white/80',
      primaryBtnClass: 'bg-white hover:bg-white/90 text-[#070085]',
      secondaryBtnClass: 'bg-white/10 hover:bg-white/20 text-white',
      pillActiveClass: 'bg-white text-[#070085]',
      testBtnClass: 'border-white/20 hover:border-white/40 text-white/60 hover:text-white',
      radius: { panel: 'rounded', button: 'rounded', input: 'rounded', pillOuter: 'rounded', pillInner: 'rounded', testButton: 'rounded' },
      decoration: 'heist-blobs',
    },
  },
  // Matches the Figma frame "oki toki" — pastel teal, bubbly Ohno Softie display font.
  okitoki: {
    key: 'okitoki',
    label: 'Oki Toki',
    fontDisplay: '"ohno-softie-variable", ui-sans-serif, system-ui, sans-serif',
    fontDisplayClass: 'font-black',
    fontSans: '"ohno-softie-variable", ui-sans-serif, system-ui, sans-serif',
    colors: {
      bg: '#65a7b3',
      panel: '#a1c9d1',
      primary: '#ff9bc0',
      primaryLight: '#ffb8d0',
      primaryLighter: '#ffd0e0',
      accent: '#ffffff',
      label: '#ffffff',
    },
    backColor: 'gold',
    landing: {
      transparentPanel: false,
      panelClass: 'bg-app-panel border border-white/20',
      headingClass: 'text-white',
      multicolorHeading: [
        { word: 'the ', className: 'text-[#94fcb7]' },
        { word: 'card ', className: 'text-[#fff79a]' },
        { word: 'room', className: 'text-[#ffb8d0]' },
      ],
      taglineClass: 'text-white/90',
      primaryBtnClass: 'bg-[#ffb8d0] hover:bg-[#ffd0e0] text-white',
      secondaryBtnClass: 'bg-app-bg hover:brightness-110 text-white',
      pillActiveClass: 'bg-[#ffb8d0] text-app-bg',
      testBtnClass: 'border-app-bg hover:border-white text-app-bg hover:text-white',
      radius: { panel: 'rounded-[48px]', button: 'rounded-full', input: 'rounded-full', pillOuter: 'rounded-full', pillInner: 'rounded-full', testButton: 'rounded' },
      decoration: 'okitoki-scatter',
    },
  },
};

export const THEME_ORDER: ThemeKey[] = ['swank', 'goof', 'heist', 'okitoki'];
export const DEFAULT_THEME: ThemeKey = 'swank';

export function isThemeKey(value: string | null | undefined): value is ThemeKey {
  return !!value && value in THEMES;
}
