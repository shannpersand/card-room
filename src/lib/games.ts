import { createDeck, createGolfJokers, shuffle } from './deck';
import { supabase } from './supabase';
import type { Card, GeneratedGameConfig, GolfZeroRank, Player, Room } from '@/types';

export interface GameDeal {
  hands: Card[][];
  communityCards: Card[];
  discardPile: Card[];
  remainingDeck: Card[];
}

export interface GameConfig {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  instructions: string;
  turnBased: boolean;
  canDrawFromDiscard: boolean;
  showBlackjackControls: boolean;
  showHoldemControls: boolean;
  isGoFishLike?: boolean;
  isGolfLike?: boolean;
  golfZeroRank?: GolfZeroRank;
  golfPairsCancel?: boolean;
  deal(playerCount: number): GameDeal;
}

const ALL_GAMES: GameConfig[] = [
  {
    id: 'texas-holdem',
    name: "Texas Hold'em",
    description: '2 hole cards + 5 community cards',
    minPlayers: 2,
    maxPlayers: 9,
    turnBased: false,
    canDrawFromDiscard: false,
    showBlackjackControls: false,
    showHoldemControls: true,
    instructions:
      "Each player gets 2 private hole cards. The dealer reveals 5 community cards in stages: Flop (3), Turn (1), River (1). Make the best 5-card hand from any combination.",
    deal(playerCount) {
      const deck = shuffle(createDeck());
      let i = 0;
      const hands: Card[][] = Array.from({ length: playerCount }, () => []);
      for (let round = 0; round < 2; round++) {
        for (let p = 0; p < playerCount; p++) {
          hands[p].push({ ...deck[i++], faceUp: false });
        }
      }
      const communityCards = deck.slice(i, i + 5).map(c => ({ ...c, faceUp: false }));
      i += 5;
      return { hands, communityCards, discardPile: [], remainingDeck: deck.slice(i) };
    },
  },
  {
    id: 'blackjack',
    name: 'Blackjack',
    description: 'Get closest to 21 without going over',
    minPlayers: 2,
    maxPlayers: 7,
    turnBased: true,
    canDrawFromDiscard: false,
    showBlackjackControls: true,
    showHoldemControls: false,
    instructions:
      "Get as close to 21 as possible. Number cards = face value, face cards = 10, Ace = 1 or 11. First player is the dealer — their second card is hidden. Players Hit (draw) or Stand. Dealer plays last.",
    deal(playerCount) {
      const deck = shuffle(createDeck());
      let i = 0;
      const hands: Card[][] = Array.from({ length: playerCount }, () => []);
      for (let round = 0; round < 2; round++) {
        for (let p = 0; p < playerCount; p++) {
          // Dealer (seat 0) second card face down
          const faceUp = !(p === 0 && round === 1);
          hands[p].push({ ...deck[i++], faceUp });
        }
      }
      return { hands, communityCards: [], discardPile: [], remainingDeck: deck.slice(i) };
    },
  },
  {
    id: 'go-fish',
    name: 'Go Fish',
    description: 'Collect sets of four matching cards',
    minPlayers: 2,
    maxPlayers: 6,
    turnBased: true,
    canDrawFromDiscard: false,
    showBlackjackControls: false,
    showHoldemControls: false,
    isGoFishLike: true,
    instructions:
      "On your turn, ask another player for a specific rank. If they have it, they give you all those cards. If not — Go Fish, draw from the deck. Collect all four of a rank to score a set. Most sets wins.",
    deal(playerCount) {
      const deck = shuffle(createDeck());
      const perPlayer = playerCount <= 2 ? 7 : 5;
      let i = 0;
      const hands: Card[][] = Array.from({ length: playerCount }, () => []);
      for (let round = 0; round < perPlayer; round++) {
        for (let p = 0; p < playerCount; p++) {
          hands[p].push({ ...deck[i++], faceUp: true });
        }
      }
      return { hands, communityCards: [], discardPile: [], remainingDeck: deck.slice(i) };
    },
  },
  {
    id: 'war',
    name: 'War',
    description: 'Battle for the entire deck',
    minPlayers: 2,
    maxPlayers: 4,
    turnBased: false,
    canDrawFromDiscard: false,
    showBlackjackControls: false,
    showHoldemControls: false,
    instructions:
      "Each player gets an equal share of the deck, face down. Each round everyone plays their top card — highest wins all played cards. Ties = War: flip 3 face-down then 1 face-up. Player who collects all cards wins.",
    deal(playerCount) {
      const deck = shuffle(createDeck());
      const perPlayer = Math.floor(deck.length / playerCount);
      let i = 0;
      const hands: Card[][] = Array.from({ length: playerCount }, () => []);
      for (let p = 0; p < playerCount; p++) {
        for (let j = 0; j < perPlayer; j++) {
          hands[p].push({ ...deck[i++], faceUp: false });
        }
      }
      return { hands, communityCards: [], discardPile: [], remainingDeck: [] };
    },
  },
  {
    id: 'rummy',
    name: 'Gin Rummy',
    description: 'Form sets and runs, then knock',
    minPlayers: 2,
    maxPlayers: 6,
    turnBased: true,
    canDrawFromDiscard: true,
    showBlackjackControls: false,
    showHoldemControls: false,
    instructions:
      "Draw from the deck or discard pile, then discard one card. Form melds: sets of 3–4 same rank, or runs of 3+ consecutive same suit. Knock when unmelded cards total ≤ 10. Gin (all melded) earns a bonus.",
    deal(playerCount) {
      const deck = shuffle(createDeck());
      const perPlayer = playerCount <= 2 ? 10 : playerCount <= 4 ? 7 : 6;
      let i = 0;
      const hands: Card[][] = Array.from({ length: playerCount }, () => []);
      for (let round = 0; round < perPlayer; round++) {
        for (let p = 0; p < playerCount; p++) {
          hands[p].push({ ...deck[i++], faceUp: true });
        }
      }
      const discardPile: Card[] = [{ ...deck[i++], faceUp: true }];
      return { hands, communityCards: [], discardPile, remainingDeck: deck.slice(i) };
    },
  },
  {
    id: 'golf',
    name: 'Golf',
    description: '4-card grid — lowest score wins',
    minPlayers: 2,
    maxPlayers: 6,
    turnBased: true,
    canDrawFromDiscard: true,
    showBlackjackControls: false,
    showHoldemControls: false,
    isGolfLike: true,
    golfZeroRank: 'Q',
    golfPairsCancel: false,
    instructions:
      "Each player gets 4 cards face down in a 2×2 grid. At the start, you may peek at exactly 2 of your own 4 cards — tap one to flip it up, tap it again to flip it back down, and it's locked after that. On your turn, tap the draw or discard pile, then either tap one of your 4 cards to swap it in (the replaced card goes face up to the discard pile, and the new one goes in face down without you seeing it) or discard the drawn card outright and keep your grid as-is. Opponents' cards stay hidden the whole game. When you're ready, tap Knock instead of drawing — everyone else gets exactly one more turn, then every hand is revealed and scored automatically. Queens = 0 points (a Settings toggle can switch this to Kings), 2s = -2, Jokers = 10, Aces = 1, other number cards = face value, remaining face cards = 10. A Settings toggle can also make two matching ranks in the same row or column (not diagonal) cancel out to 0. Lowest total wins.",
    deal(playerCount) {
      const deck = shuffle([...createDeck(), ...createGolfJokers()]);
      let i = 0;
      const hands: Card[][] = Array.from({ length: playerCount }, () => []);
      for (let round = 0; round < 4; round++) {
        for (let p = 0; p < playerCount; p++) {
          hands[p].push({ ...deck[i++], faceUp: false });
        }
      }
      const discardPile: Card[] = [{ ...deck[i++], faceUp: true }];
      return { hands, communityCards: [], discardPile, remainingDeck: deck.slice(i) };
    },
  },
  {
    id: 'crazy-eights',
    name: 'Crazy Eights',
    description: 'Match by rank or suit — 8s are wild',
    minPlayers: 2,
    maxPlayers: 5,
    turnBased: true,
    canDrawFromDiscard: false,
    showBlackjackControls: false,
    showHoldemControls: false,
    instructions:
      "Match the top discard by suit or rank. 8s are wild — play one to change the suit. Can't play? Draw from the deck. First to empty their hand wins.",
    deal(playerCount) {
      const deck = shuffle(createDeck());
      const perPlayer = playerCount <= 2 ? 7 : 5;
      let i = 0;
      const hands: Card[][] = Array.from({ length: playerCount }, () => []);
      for (let round = 0; round < perPlayer; round++) {
        for (let p = 0; p < playerCount; p++) {
          hands[p].push({ ...deck[i++], faceUp: true });
        }
      }
      // Starting discard can't be an 8
      while (deck[i].rank === '8') i++;
      const discardPile: Card[] = [{ ...deck[i++], faceUp: true }];
      return { hands, communityCards: [], discardPile, remainingDeck: deck.slice(i) };
    },
  },
];

// Trimmed to just these two presets for now — the rest are still fully defined above
// in ALL_GAMES, so restoring one is just adding its id back to this filter.
const ENABLED_GAME_IDS = ['blackjack', 'golf'];
export const GAMES: GameConfig[] = ALL_GAMES.filter(g => ENABLED_GAME_IDS.includes(g.id));

export const getGame = (id: string): GameConfig | undefined => GAMES.find(g => g.id === id);

/** Generic dealer for AI-generated games: parameterizes deal() over the same primitives every preset uses. */
export function dealFromGeneratedConfig(config: GeneratedGameConfig, playerCount: number): GameDeal {
  if (config.showHoldemControls) {
    const deck = shuffle(createDeck());
    let i = 0;
    const hands: Card[][] = Array.from({ length: playerCount }, () => []);
    for (let round = 0; round < 2; round++) {
      for (let p = 0; p < playerCount; p++) {
        hands[p].push({ ...deck[i++], faceUp: false });
      }
    }
    const communityCards = deck.slice(i, i + 5).map(c => ({ ...c, faceUp: false }));
    i += 5;
    return { hands, communityCards, discardPile: [], remainingDeck: deck.slice(i) };
  }

  if (config.showBlackjackControls) {
    const deck = shuffle(createDeck());
    let i = 0;
    const hands: Card[][] = Array.from({ length: playerCount }, () => []);
    for (let round = 0; round < 2; round++) {
      for (let p = 0; p < playerCount; p++) {
        // Dealer (seat 0) second card face down
        const faceUp = !(p === 0 && round === 1);
        hands[p].push({ ...deck[i++], faceUp });
      }
    }
    return { hands, communityCards: [], discardPile: [], remainingDeck: deck.slice(i) };
  }

  // Generic play/discard mode, parameterized by dealPlan
  const deck = shuffle(config.isGolfLike ? [...createDeck(), ...createGolfJokers()] : createDeck());
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  let i = 0;
  if (config.dealPlan.splitEntireDeck) {
    const perPlayer = Math.floor(deck.length / playerCount);
    for (let p = 0; p < playerCount; p++) {
      for (let j = 0; j < perPlayer; j++) {
        hands[p].push({ ...deck[i++], faceUp: false });
      }
    }
  } else {
    // Clamp to the deck size so a bad AI-suggested hand size can't run off the end of the deck.
    const perPlayer = Math.max(1, Math.min(config.dealPlan.cardsPerPlayer, Math.floor(deck.length / playerCount)));
    for (let round = 0; round < perPlayer; round++) {
      for (let p = 0; p < playerCount; p++) {
        hands[p].push({ ...deck[i++], faceUp: config.dealPlan.handFaceUp });
      }
    }
  }
  const discardPile: Card[] = config.dealPlan.discardPileStart && i < deck.length
    ? [{ ...deck[i++], faceUp: true }]
    : [];
  return { hands, communityCards: [], discardPile, remainingDeck: deck.slice(i) };
}

/** Resolves the currently active game for a room, whether it's a preset or an AI-generated custom game. */
export function resolveGame(room: Pick<Room, 'game_id' | 'custom_game'> | null | undefined): GameConfig | GeneratedGameConfig | null {
  if (!room?.game_id) return null;
  if (room.game_id === 'custom') return room.custom_game;
  return getGame(room.game_id) ?? null;
}

/**
 * Deals `game` to `orderedPlayers` and writes the result to Supabase. Shared by the Lobby's
 * initial deal and the Game screen's "Deal Again" — same write shape either way.
 */
export async function dealGame(
  room: Pick<Room, 'id'>,
  game: GameConfig | GeneratedGameConfig,
  orderedPlayers: Player[],
): Promise<void> {
  const isCustom = !('deal' in game);
  const { hands, communityCards, discardPile, remainingDeck } = isCustom
    ? dealFromGeneratedConfig(game as GeneratedGameConfig, orderedPlayers.length)
    : (game as GameConfig).deal(orderedPlayers.length);
  const firstTurnId = game.turnBased
    ? orderedPlayers[game.showBlackjackControls ? 1 : 0]?.id ?? null
    : null;

  for (let i = 0; i < orderedPlayers.length; i++) {
    await supabase.from('players')
      .update({ hand: hands[i], is_standing: false })
      .eq('id', orderedPlayers[i].id);
  }

  await supabase.from('rooms').update({
    game_id: isCustom ? 'custom' : (game as GameConfig).id,
    game_name: game.name,
    state: 'playing',
    deck: remainingDeck,
    community_cards: communityCards,
    discard_pile: discardPile,
    current_turn: firstTurnId,
    holdem_stage: game.showHoldemControls ? 'preflop' : null,
    custom_game: isCustom ? (game as GeneratedGameConfig) : null,
    action_log: [],
    golf_knocked_by: null,
  }).eq('id', room.id);
}

/**
 * Presets aren't backed by a `dealPlan` — promote one into an equivalent editable config the
 * first time a dealer opens the in-game Settings panel on a preset room. Blackjack/Hold'em keep
 * dealing exactly the same way afterward since `dealFromGeneratedConfig` ignores `dealPlan` for
 * those two modes; the other presets get reasonable (not exact) defaults the dealer can adjust.
 */
export function toEditableConfig(game: GameConfig | GeneratedGameConfig): GeneratedGameConfig {
  if (!('deal' in game)) return game;
  return {
    name: game.name,
    description: game.description,
    instructions: game.instructions,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    turnBased: game.turnBased,
    canDrawFromDiscard: game.canDrawFromDiscard,
    showBlackjackControls: game.showBlackjackControls,
    showHoldemControls: game.showHoldemControls,
    isGoFishLike: !!game.isGoFishLike,
    isGolfLike: !!game.isGolfLike,
    golfZeroRank: game.golfZeroRank ?? 'Q',
    golfPairsCancel: !!game.golfPairsCancel,
    dealPlan: {
      cardsPerPlayer: game.id === 'golf' ? 4 : 5,
      splitEntireDeck: game.id === 'war',
      discardPileStart: game.id === 'rummy' || game.id === 'crazy-eights' || game.id === 'golf',
      handFaceUp: game.id !== 'war' && game.id !== 'golf',
    },
    clarifyingOptions: [],
  };
}
