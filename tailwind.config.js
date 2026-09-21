/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        card: ['Georgia', 'serif'],
        // Sourced from CSS custom properties the ThemeProvider sets per active theme
        // (see src/lib/themes.ts / src/lib/ThemeContext.tsx) — each var already carries
        // its own fallback chain, so no array here.
        display: 'var(--font-display)',
        sans: 'var(--font-sans)',
      },
      colors: {
        // Theme-driven tokens. Stored as "R G B" CSS vars (not hex) so Tailwind's
        // opacity modifiers (bg-app-panel/50, etc.) work the same as any built-in color.
        app: {
          bg: 'rgb(var(--color-bg-rgb) / <alpha-value>)',
          panel: 'rgb(var(--color-panel-rgb) / <alpha-value>)',
          primary: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
          primaryLight: 'rgb(var(--color-primary-light-rgb) / <alpha-value>)',
          primaryLighter: 'rgb(var(--color-primary-lighter-rgb) / <alpha-value>)',
          accent: 'rgb(var(--color-accent-rgb) / <alpha-value>)',
          label: 'rgb(var(--color-label-rgb) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
