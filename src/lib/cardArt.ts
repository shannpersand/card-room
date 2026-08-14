import type { Card, Suit } from '@/types';

// Auto-imports every SVG in src/assets/cards/ as a hashed, cacheable asset URL —
// no per-file import statements to maintain as the art set grows or changes.
const urlModules = import.meta.glob('../assets/cards/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const urlByName: Record<string, string> = {};
for (const [filepath, url] of Object.entries(urlModules)) {
  const name = filepath.split('/').pop()!.replace(/\.svg$/, '');
  urlByName[name] = url;
}

const SUIT_LETTER: Record<Suit, string> = { spades: 's', hearts: 'h', clubs: 'c', diamonds: 'd' };

/** Custom card art URL for a given card, or undefined if that file hasn't been added yet. */
export function cardFrontUrl(card: Card): string | undefined {
  if (card.rank === 'Joker') return urlByName['joker'];
  return urlByName[`${card.rank}${SUIT_LETTER[card.suit]}`];
}

/** Custom joker art URL, dealt by Golf. */
export const jokerUrl: string | undefined = urlByName['joker'];

// The back is rendered inline (not as an <img>) so its background color can be swapped
// at runtime — an <img>'s SVG content is an opaque external document and can't be reached
// by CSS from outside it. The raw text is fetched once at runtime (not bundled at build
// time) so back.svg stays its own cacheable file instead of ~300KB baked into the JS bundle.
const backUrl: string | undefined = urlByName['back'];
let backSvgRawPromise: Promise<string | undefined> | null = null;

function fetchBackSvgRaw(): Promise<string | undefined> {
  if (!backUrl) return Promise.resolve(undefined);
  if (!backSvgRawPromise) {
    backSvgRawPromise = fetch(backUrl).then(res => res.text()).catch(() => undefined);
  }
  return backSvgRawPromise;
}

// The exact fill this back design uses for its solid color panel (everything else in
// the art is white line work on top of it) — see scripts/import-card-art.mjs output.
const BACK_ART_FILL = '#272780';

export const BACK_COLORS = {
  blue: '#272780',
  red: '#b91c1c',
  green: '#15803d',
  purple: '#6d28d9',
  black: '#18181b',
  gold: '#b45309',
} as const;

export type BackColorKey = keyof typeof BACK_COLORS;
export const DEFAULT_BACK_COLOR: BackColorKey = 'blue';

function isBackColorKey(value: string | null | undefined): value is BackColorKey {
  return !!value && value in BACK_COLORS;
}

/** Resolves a room's stored back_color to a hex value, falling back to the default. */
export function resolveBackColorHex(colorKey: string | null | undefined): string {
  return BACK_COLORS[isBackColorKey(colorKey) ? colorKey : DEFAULT_BACK_COLOR];
}

/** The card-back SVG markup with its background panel recolored, or undefined if back.svg is missing. */
export async function recoloredBackSvg(colorKey: string | null | undefined): Promise<string | undefined> {
  const raw = await fetchBackSvgRaw();
  if (!raw) return undefined;
  return raw.replace(`fill:${BACK_ART_FILL}`, `fill:${resolveBackColorHex(colorKey)}`);
}
