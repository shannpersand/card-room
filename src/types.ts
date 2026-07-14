export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;      // e.g. 'A-spades' — unique across a fresh deck
  suit: Suit;
  rank: Rank;
  faceUp: boolean; // true = visible to all players on table/community; player always sees own hand
}

export interface Player {
  id: string;
  room_id: string;
  name: string;
  hand: Card[];
  seat_order: number;
  is_standing: boolean; // Blackjack: has this player chosen to stand?
  is_active: boolean;
  last_seen: string;
}

export type GameState = 'lobby' | 'playing' | 'finished';
export type HoldemStage = 'preflop' | 'flop' | 'turn' | 'river';

export interface DealPlan {
  cardsPerPlayer: number;
  splitEntireDeck: boolean;   // War-style: ignore cardsPerPlayer, split whole deck evenly
  discardPileStart: boolean;  // start discard pile with 1 face-up card
  handFaceUp: boolean;        // are dealt hand cards visible to everyone (not just owner)
}

export interface ClarifyingOption {
  key: 'cardsPerPlayer' | 'discardPileStart' | 'handFaceUp' | 'canDrawFromDiscard'
     | 'turnBased' | 'splitEntireDeck' | 'minPlayers' | 'maxPlayers';
  label: string;
  type: 'select' | 'toggle';
  choices: { label: string; value: string }[];
}

export interface GeneratedGameConfig {
  name: string;
  description: string;
  instructions: string;
  minPlayers: number;
  maxPlayers: number;
  turnBased: boolean;
  canDrawFromDiscard: boolean;
  showBlackjackControls: boolean;
  showHoldemControls: boolean;
  isGoFishLike: boolean;
  dealPlan: DealPlan;
  clarifyingOptions: ClarifyingOption[];
}

export interface Room {
  id: string;
  code: string;
  game_id: string | null;
  game_name: string | null;
  state: GameState;
  deck: Card[];
  community_cards: Card[];
  discard_pile: Card[];
  current_turn: string | null; // player id
  holdem_stage: HoldemStage | null;
  custom_game: GeneratedGameConfig | null;
  created_at: string;
}
