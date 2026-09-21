import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

// Shared button styling lifted from the "Landing Desktop" Figma design: rounded (4px)
// corners, the emerald/amber/white-10 color set, and a display-font treatment for the
// big marquee CTAs (size "lg") vs. a plain semibold sans face for compact controls.
// primary/secondary follow the active theme (see src/lib/themes.ts); accent/danger are
// fixed semantic colors (amber = in-game "reveal/deal" actions, red = destructive) that
// stay constant across themes for consistent meaning.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-app-primaryLight hover:bg-app-primaryLighter text-white',
  secondary: 'bg-white/10 hover:bg-white/20 text-white',
  ghost: 'bg-transparent border border-dashed border-white/20 hover:border-white/40 text-white/60 hover:text-white',
  accent: 'bg-amber-500 hover:bg-amber-400 text-amber-950',
  danger: 'bg-red-700 hover:bg-red-600 text-white',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'py-2.5 px-3 text-xs font-sans font-semibold',
  md: 'py-3 px-4 text-sm font-sans font-semibold',
  lg: 'py-4 px-4 text-xl md:text-2xl font-display tracking-wide',
};

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: Props) {
  return (
    <button
      className={`w-full rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
