import type { Card, Suit, Rank } from '@/types';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

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
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
};

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
