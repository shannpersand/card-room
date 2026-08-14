import type { Card, Suit, Rank, GolfZeroRank } from '@/types';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function createDeck(): Card[] {
  return SUITS.flatMap(suit =>
    RANKS.map(rank => ({ id: `${rank}-${suit}`, suit, rank, faceUp: true }))
  );
}

export function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, 'Joker': 15,
};

/** Golf: the 2 jokers, added to a standard deck — not part of createDeck() since no other game uses them. */
export function createGolfJokers(): Card[] {
  return [
    { id: 'Joker-spades', suit: 'spades', rank: 'Joker', faceUp: true },
    { id: 'Joker-hearts', suit: 'hearts', rank: 'Joker', faceUp: true },
  ];
}

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
};

/** Blackjack hand value, with Aces counting as 11 unless that would bust the hand. */
export function blackjackValue(hand: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') { total += 11; aces++; }
    else if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J' || card.rank === '10') total += 10;
    else total += Number(card.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

/** Per-card point value for Golf, given which court-card rank is worth 0. */
function golfCardValue(rank: Rank, zeroRank: GolfZeroRank): number {
  if (rank === zeroRank) return 0;
  if (rank === 'Joker') return 10;
  if (rank === '2') return -2;
  if (rank === 'A') return 1;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank); // '3'..'10'
}

// Row and column pairs within the 2x2 grid (index 0/1 top row, 2/3 bottom row) — deliberately
// excludes the two diagonals (0,3) and (1,2).
const GOLF_GRID_PAIRS: [number, number][] = [[0, 1], [2, 3], [0, 2], [1, 3]];

/**
 * Golf hand value: face value for number cards, J/Q/K = 10 except whichever rank is
 * `zeroRank` (worth 0), 2 = -2, Joker = 10, Ace = 1. When `pairsCancel` is set, two cards of
 * the same rank sharing a row or column (not diagonal) both score 0 instead.
 */
export function golfHandValue(hand: Card[], options?: { zeroRank?: GolfZeroRank; pairsCancel?: boolean }): number {
  const zeroRank = options?.zeroRank ?? 'Q';
  const values = hand.map(card => golfCardValue(card.rank, zeroRank));

  if (options?.pairsCancel && hand.length === 4) {
    const canceled = new Set<number>();
    for (const [a, b] of GOLF_GRID_PAIRS) {
      if (hand[a].rank === hand[b].rank) { canceled.add(a); canceled.add(b); }
    }
    return values.reduce((total, v, i) => total + (canceled.has(i) ? 0 : v), 0);
  }

  return values.reduce((total, v) => total + v, 0);
}

/** Generate a random 4-character room code using unambiguous characters */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Returns the next player id in seat_order after currentId, wrapping around */
export function nextPlayerInOrder(
  players: { id: string; seat_order: number; is_active: boolean }[],
  currentId: string | null
): string | null {
  const active = players.filter(p => p.is_active).sort((a, b) => a.seat_order - b.seat_order);
  if (active.length === 0) return null;
  if (!currentId) return active[0].id;
  const idx = active.findIndex(p => p.id === currentId);
  return active[(idx + 1) % active.length].id;
}
