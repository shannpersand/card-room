import type { Card, Suit, Rank } from '@/types';

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
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

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
