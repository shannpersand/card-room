import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, getErrorMessage, getEdgeFunctionErrorMessage } from '@/lib/supabase';
import { resolveGame, dealGame, toEditableConfig } from '@/lib/games';
import { nextPlayerInOrder, blackjackValue, golfHandValue, RANKS, SUIT_SYMBOLS } from '@/lib/deck';
import { PlayingCard } from '@/components/PlayingCard';
import { BACK_COLORS, type BackColorKey } from '@/lib/cardArt';
import type { Room, Player, Card, HoldemStage, Rank, GeneratedGameConfig, DealPlan } from '@/types';

type PendingMode = 'freeplay' | 'blackjack' | 'holdem' | 'gofish' | 'golf';

const RANK_NAMES: Partial<Record<Rank, string>> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
const SUIT_NAMES: Record<Card['suit'], string> = { spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs' };
/** "King of Hearts" / "7 of Diamonds" — the name label shown under a hovered/selected card. */
function cardFullName(card: Card): string {
  if (card.rank === 'Joker') return 'Joker';
  return `${RANK_NAMES[card.rank] ?? card.rank} of ${SUIT_NAMES[card.suit]}`;
}

export function Game() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  // Desktop-only hover preview for the default hand (mouse-driven; irrelevant on touch).
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showAskDialog, setShowAskDialog] = useState(false);
  const [askRank, setAskRank] = useState<Rank>('A');
  const [askTargetId, setAskTargetId] = useState('');
  const [actionError, setActionError] = useState('');

  // --- Settings panel / Deal Again ---
  const [showSettings, setShowSettings] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<GeneratedGameConfig | null>(null);
  const [featurePrompt, setFeaturePrompt] = useState('');
  const [amending, setAmending] = useState(false);
  const [redealing, setRedealing] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [playingAgain, setPlayingAgain] = useState(false);

  // --- Golf: local-only peek state (never synced, so opponents never see it) + pending
  // draw-and-replace flow ---
  const [golfPeekedNow, setGolfPeekedNow] = useState<Set<string>>(new Set());
  const [golfPeekUsed, setGolfPeekUsed] = useState<Set<string>>(new Set());
  const [golfPendingDraw, setGolfPendingDraw] = useState<{ card: Card; source: 'deck' | 'discard' } | null>(null);
  // Desktop-only hover ring on a grid slot (peek target or swap target) — no touch equivalent.
  const [hoveredGolfIdx, setHoveredGolfIdx] = useState<number | null>(null);
  const prevDeckLenRef = useRef<number | null>(null);

  const myPlayerId = localStorage.getItem('cardroom_player_id');

  const orderedPlayers = players.filter(p => p.is_active).sort((a, b) => a.seat_order - b.seat_order);
  const myPlayer = players.find(p => p.id === myPlayerId) ?? null;
  const otherPlayers = orderedPlayers.filter(p => p.id !== myPlayerId);
  const dealer = orderedPlayers[0];
  const isDealer = dealer?.id === myPlayerId;

  const game = resolveGame(room);
  const isMyTurn = room?.current_turn === myPlayerId;
  const canAct = !game?.turnBased || isMyTurn;
  const selectedCard = myPlayer?.hand.find(c => c.id === selectedCardId) ?? null;
  const topDiscard = room?.discard_pile.at(-1) ?? null;
  // Blackjack, Hold'em, and Go Fish never touch room.discard_pile at all — showing an
  // always-empty "Discard" placeholder for them is dead UI, not just an empty state.
  const usesDiscardPile = !game?.showBlackjackControls && !game?.showHoldemControls && !game?.isGoFishLike;
  const allBlackjackDone = !!game?.showBlackjackControls
    && orderedPlayers.length > 0
    && orderedPlayers.every(p => p.is_standing);
  const golfRevealed = !!room?.golf_knocked_by
    && orderedPlayers.length > 0
    && orderedPlayers.every(p => p.hand.every(c => c.faceUp));
  const golfScore = (hand: Card[]) =>
    golfHandValue(hand, { zeroRank: game?.golfZeroRank, pairsCancel: game?.golfPairsCancel });
  const golfPeeksLeft = Math.max(0, 2 - golfPeekUsed.size - golfPeekedNow.size);
  // Desktop status headline, matching the Figma "Game desktop Golf" frames' amber caption.
  const golfStatusText = golfRevealed
    ? 'Round over'
    : golfPendingDraw
    ? 'Swap or discard'
    : isMyTurn
    ? 'It’s your turn'
    : `${orderedPlayers.find(p => p.id === room?.current_turn)?.name ?? 'A player'}’s turn`;

  function appendLog(current: string[] | null | undefined, entry: string): string[] {
    return [...(current ?? []), entry].slice(-30);
  }

  // Best-effort, isolated from the critical game-state path — a failure here (e.g. the
  // action_log column not existing yet because a migration hasn't been run) must never
  // block a turn from advancing.
  async function logAction(entry: string) {
    if (!room) return;
    try {
      const { data } = await supabase.from('rooms').select('action_log').eq('id', room.id).single();
      const current = (data as { action_log: string[] } | null)?.action_log;
      await supabase.from('rooms').update({ action_log: appendLog(current, entry) }).eq('id', room.id);
    } catch {
      // Ignore — history is a nice-to-have, not required for gameplay to proceed.
    }
  }

  function blackjackOutcome(playerValue: number, dealerValue: number): 'win' | 'lose' | 'push' {
    if (playerValue > 21) return 'lose';
    if (dealerValue > 21) return 'win';
    if (playerValue > dealerValue) return 'win';
    if (playerValue < dealerValue) return 'lose';
    return 'push';
  }

  const load = useCallback(async () => {
    if (!code) return;
    const { data: roomData } = await supabase.from('rooms').select('*').eq('code', code).maybeSingle();
    if (!roomData) { navigate('/'); return; }
    if (roomData.state !== 'playing') { navigate(`/lobby/${code}`); return; }
    setRoom(roomData as Room);

    const { data: playersData } = await supabase
      .from('players').select('*').eq('room_id', roomData.id).order('seat_order');
    setPlayers((playersData as Player[]) ?? []);
    setLoading(false);
  }, [code, navigate]);

  useEffect(() => { load(); }, [load]);

  // Golf: the deck only ever shrinks during a round — an increase means a fresh deal just
  // landed, so reset the local peek budget and any in-flight draw.
  useEffect(() => {
    if (!room) return;
    const len = room.deck.length;
    if (prevDeckLenRef.current !== null && len > prevDeckLenRef.current) {
      setGolfPeekedNow(new Set());
      setGolfPeekUsed(new Set());
      setGolfPendingDraw(null);
    }
    prevDeckLenRef.current = len;
  }, [room?.deck.length]);

  useEffect(() => {
    if (!room?.id) return;
    const channel = supabase
      .channel(`game-${room.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
        (payload) => setRoom(payload.new as Room)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setPlayers(prev => prev.map(p => p.id === payload.new.id ? payload.new as Player : p));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room?.id]);

  // --- Computer opponents ---
  // A single browser tab (whoever has this room open) drives bot turns. Bots reuse the same
  // lenient, unvalidated state transitions the human action functions below use — this app
  // doesn't enforce game-specific rules server-side, so bots don't need to "know the rules"
  // beyond making a legal-shaped move.
  const botActingRef = useRef(false);

  async function performBotTurn(bot: Player) {
    if (!room) return;
    const { data: freshRoomData } = await supabase.from('rooms').select('*').eq('id', room.id).single();
    const { data: freshBotData } = await supabase.from('players').select('*').eq('id', bot.id).single();
    if (!freshRoomData || !freshBotData) return;
    const freshRoom = freshRoomData as Room;
    let hand = (freshBotData as Player).hand;

    if (game?.showBlackjackControls) {
      let deck = freshRoom.deck;
      while (blackjackValue(hand) < 17 && deck.length > 0) {
        const [drawn, ...rest] = deck;
        deck = rest;
        hand = [...hand, { ...drawn, faceUp: true }];
        const value = blackjackValue(hand);
        await Promise.all([
          supabase.from('rooms').update({ deck }).eq('id', room.id),
          supabase.from('players').update({ hand }).eq('id', bot.id),
        ]);
        await logAction(value > 21 ? `${bot.name} hit and busted with ${value}` : `${bot.name} hit — now at ${value}`);
      }
      const finalValue = blackjackValue(hand);
      const nextTurn = nextPlayerInOrder(orderedPlayers, bot.id);
      await Promise.all([
        supabase.from('players').update({ is_standing: true }).eq('id', bot.id),
        supabase.from('rooms').update({ current_turn: nextTurn }).eq('id', room.id),
      ]);
      if (finalValue <= 21) await logAction(`${bot.name} stood on ${finalValue}`);
      return;
    }

    if (game?.isGoFishLike) {
      const others = orderedPlayers.filter(p => p.id !== bot.id);
      // Cap successful-ask chains so a lucky bot can't hold the turn forever.
      for (let asks = 0; asks < 8 && others.length > 0; asks++) {
        const target = others[Math.floor(Math.random() * others.length)];
        const ranksInHand = [...new Set(hand.map(c => c.rank))];
        const askRank: Rank = ranksInHand.length > 0
          ? ranksInHand[Math.floor(Math.random() * ranksInHand.length)]
          : RANKS[Math.floor(Math.random() * RANKS.length)];

        const { data: freshTargetData } = await supabase.from('players').select('*').eq('id', target.id).single();
        const targetHand: Card[] = (freshTargetData as Player | null)?.hand ?? [];
        const matching = targetHand.filter(c => c.rank === askRank);

        if (matching.length === 0) {
          const { data: currentRoomData } = await supabase.from('rooms').select('deck').eq('id', room.id).single();
          const deck: Card[] = (currentRoomData as Room | null)?.deck ?? [];
          if (deck.length > 0) {
            const [drawn, ...remainingDeck] = deck;
            hand = [...hand, drawn];
            await Promise.all([
              supabase.from('rooms').update({ deck: remainingDeck }).eq('id', room.id),
              supabase.from('players').update({ hand }).eq('id', bot.id),
            ]);
          }
          break;
        }

        hand = [...hand, ...matching];
        const newTargetHand = targetHand.filter(c => c.rank !== askRank);
        await Promise.all([
          supabase.from('players').update({ hand }).eq('id', bot.id),
          supabase.from('players').update({ hand: newTargetHand }).eq('id', target.id),
        ]);
        // Successful ask — bot goes again, matching Go Fish rules.
      }
      const nextTurn = nextPlayerInOrder(orderedPlayers, bot.id);
      await supabase.from('rooms').update({ current_turn: nextTurn }).eq('id', room.id);
      return;
    }

    // Generic turn-based mode (Rummy-style draw/discard, Crazy Eights, and AI-designed games).
    let deck = freshRoom.deck;
    let discardPile = freshRoom.discard_pile;
    if (game?.canDrawFromDiscard && discardPile.length > 0) {
      const drawn = discardPile[discardPile.length - 1];
      discardPile = discardPile.slice(0, -1);
      // Golf: cards in hand stay hidden until the final reveal, even the one just drawn.
      hand = [...hand, { ...drawn, faceUp: !game?.isGolfLike }];
    } else if (deck.length > 0) {
      const [drawn, ...rest] = deck;
      deck = rest;
      hand = [...hand, game?.isGolfLike ? { ...drawn, faceUp: false } : drawn];
    }

    let communityCards = freshRoom.community_cards;
    if (hand.length > 0) {
      const [toPlay, ...remainingHand] = hand;
      hand = remainingHand;
      const played = { ...toPlay, faceUp: true };
      if (game?.canDrawFromDiscard) discardPile = [...discardPile, played];
      else communityCards = [...communityCards, played];
    }

    const nextTurn = nextPlayerInOrder(orderedPlayers, bot.id);
    // Golf: if this turn wraps back around to whoever knocked, the round ends — reveal every
    // hand instead of just advancing the turn (bots never knock themselves, only humans do).
    const revealing = game?.isGolfLike && !!freshRoom.golf_knocked_by && nextTurn === freshRoom.golf_knocked_by;
    const writes: PromiseLike<unknown>[] = [
      supabase.from('players').update({ hand: revealing ? hand.map(c => ({ ...c, faceUp: true })) : hand }).eq('id', bot.id),
      supabase.from('rooms').update({
        deck, discard_pile: discardPile, community_cards: communityCards,
        current_turn: revealing ? null : nextTurn,
      }).eq('id', room.id),
    ];
    if (revealing) {
      for (const p of orderedPlayers) {
        if (p.id === bot.id) continue;
        writes.push(supabase.from('players').update({ hand: p.hand.map(c => ({ ...c, faceUp: true })) }).eq('id', p.id));
      }
    }
    await Promise.all(writes);
  }

  useEffect(() => {
    if (!room || !game?.turnBased || !room.current_turn) return;
    const turnPlayer = orderedPlayers.find(p => p.id === room.current_turn);
    if (!turnPlayer?.is_bot || botActingRef.current) return;

    const timeout = setTimeout(async () => {
      botActingRef.current = true;
      try {
        await performBotTurn(turnPlayer);
      } finally {
        botActingRef.current = false;
      }
    }, 1200);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.current_turn, room?.id, game?.turnBased]);

  // Once every Blackjack player is standing/busted, reveal the dealer's hidden card so the
  // round result is computable — not gated to the dealer's own tab, since the dealer seat
  // might be a bot with nobody around to click "Reveal Hand".
  useEffect(() => {
    if (!allBlackjackDone) return;
    const dealerPlayer = orderedPlayers[0];
    if (!dealerPlayer || dealerPlayer.hand.every(c => c.faceUp)) return;
    const revealedHand = dealerPlayer.hand.map(c => ({ ...c, faceUp: true }));
    supabase.from('players').update({ hand: revealedHand }).eq('id', dealerPlayer.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBlackjackDone, room?.id]);

  // --- Settings panel / Deal Again ---

  const pendingMode: PendingMode = pendingConfig?.showBlackjackControls ? 'blackjack'
    : pendingConfig?.showHoldemControls ? 'holdem'
    : pendingConfig?.isGoFishLike ? 'gofish'
    : pendingConfig?.isGolfLike ? 'golf'
    : 'freeplay';

  function openSettings() {
    if (!game) return;
    setPendingConfig(toEditableConfig(game));
    setSettingsError('');
    setFeaturePrompt('');
    setSaveName('');
    setShowSettings(true);
  }

  function applyModeChange(newMode: PendingMode) {
    setPendingConfig(prev => {
      if (!prev) return prev;
      const turnBased = newMode === 'holdem' ? false : newMode === 'freeplay' ? prev.turnBased : true;
      return {
        ...prev,
        showBlackjackControls: newMode === 'blackjack',
        showHoldemControls: newMode === 'holdem',
        isGoFishLike: newMode === 'gofish',
        isGolfLike: newMode === 'golf',
        canDrawFromDiscard: newMode === 'golf' ? true : prev.canDrawFromDiscard,
        turnBased,
        dealPlan: newMode === 'golf'
          ? { ...prev.dealPlan, cardsPerPlayer: 4, discardPileStart: true, handFaceUp: false }
          : prev.dealPlan,
      };
    });
  }

  function updateField<K extends keyof GeneratedGameConfig>(key: K, value: GeneratedGameConfig[K]) {
    setPendingConfig(prev => prev && { ...prev, [key]: value });
  }

  function updateDealPlan<K extends keyof DealPlan>(key: K, value: DealPlan[K]) {
    setPendingConfig(prev => prev && { ...prev, dealPlan: { ...prev.dealPlan, [key]: value } });
  }

  async function amendWithAI() {
    const prompt = featurePrompt.trim();
    if (!prompt || !pendingConfig) return;
    setAmending(true);
    setSettingsError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('design-game', {
        body: { prompt, playerCount: orderedPlayers.length, currentConfig: pendingConfig },
      });
      if (fnError) {
        throw new Error(await getEdgeFunctionErrorMessage(fnError, 'Failed to update the game. Try again.'));
      }
      if (data?.error) throw new Error(data.error);
      setPendingConfig(data as GeneratedGameConfig);
      setFeaturePrompt('');
    } catch (e) {
      setSettingsError(getErrorMessage(e, 'Failed to update the game. Try again.'));
    } finally {
      setAmending(false);
    }
  }

  async function saveToLibrary() {
    const name = saveName.trim();
    if (!name || !pendingConfig) return;
    setSaving(true);
    setSettingsError('');
    try {
      const { error: saveErr } = await supabase.from('saved_games').insert({ name, config: pendingConfig });
      if (saveErr) throw saveErr;
      setSaveName('');
    } catch (e) {
      setSettingsError(getErrorMessage(e, 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  }

  async function dealAgain() {
    if (!room || !pendingConfig) return;
    setRedealing(true);
    setSettingsError('');
    try {
      await dealGame(room, pendingConfig, orderedPlayers);
      setShowSettings(false);
    } catch (e) {
      setSettingsError(getErrorMessage(e, 'Failed to deal again. Try again.'));
    } finally {
      setRedealing(false);
    }
  }

  /** Quick rematch — redeals the current game exactly as-is, no editing. */
  async function playAgain() {
    if (!room || !game) return;
    setPlayingAgain(true);
    setActionError('');
    try {
      await dealGame(room, game, orderedPlayers);
    } catch (e) {
      setActionError(getErrorMessage(e, 'Failed to start a new round. Try again.'));
    } finally {
      setPlayingAgain(false);
    }
  }

  /** Cosmetic only, so it applies instantly rather than waiting for a redeal. */
  async function setBackColor(color: BackColorKey) {
    if (!room) return;
    setSettingsError('');
    const { error } = await supabase.from('rooms').update({ back_color: color }).eq('id', room.id);
    if (error) setSettingsError(getErrorMessage(error, 'Failed to change card back color.'));
  }

  // --- Actions ---

  async function drawFromDeck() {
    if (!room || !myPlayer || room.deck.length === 0) return setActionError('No cards left in the deck.');
    setActionError('');
    const [drawn, ...remainingDeck] = room.deck;
    const newHand = [...myPlayer.hand, drawn];

    if (game?.showBlackjackControls) {
      const value = blackjackValue(newHand);
      const busted = value > 21;
      const roomUpdate: Record<string, unknown> = { deck: remainingDeck };
      if (busted) roomUpdate.current_turn = nextPlayerInOrder(orderedPlayers, myPlayerId ?? null);
      await Promise.all([
        supabase.from('rooms').update(roomUpdate).eq('id', room.id),
        supabase.from('players').update({ hand: newHand, is_standing: busted }).eq('id', myPlayer.id),
      ]);
      await logAction(busted ? `${myPlayer.name} hit and busted with ${value}` : `${myPlayer.name} hit — now at ${value}`);
      return;
    }

    await Promise.all([
      supabase.from('rooms').update({ deck: remainingDeck }).eq('id', room.id),
      supabase.from('players').update({ hand: newHand }).eq('id', myPlayer.id),
    ]);
    await logAction(`${myPlayer.name} drew from the deck`);
  }

  async function drawFromDiscard() {
    if (!room || !myPlayer || room.discard_pile.length === 0) return setActionError('Discard pile is empty.');
    setActionError('');
    const drawn = room.discard_pile.at(-1)!;
    const newDiscard = room.discard_pile.slice(0, -1);
    const newHand = [...myPlayer.hand, { ...drawn, faceUp: true }];
    await Promise.all([
      supabase.from('rooms').update({ discard_pile: newDiscard }).eq('id', room.id),
      supabase.from('players').update({ hand: newHand }).eq('id', myPlayer.id),
    ]);
    await logAction(`${myPlayer.name} drew ${drawn.rank}${SUIT_SYMBOLS[drawn.suit]} from the discard pile`);
  }

  async function playToTable() {
    if (!room || !myPlayer || !selectedCard) return;
    setActionError('');
    const newHand = myPlayer.hand.filter(c => c.id !== selectedCard.id);
    const played = { ...selectedCard, faceUp: true };
    const newCommunity = [...room.community_cards, played];
    const nextTurn = game?.turnBased ? nextPlayerInOrder(orderedPlayers, myPlayerId ?? null) : room.current_turn;
    setSelectedCardId(null);
    await Promise.all([
      supabase.from('rooms').update({ community_cards: newCommunity, current_turn: nextTurn }).eq('id', room.id),
      supabase.from('players').update({ hand: newHand }).eq('id', myPlayer.id),
    ]);
    await logAction(`${myPlayer.name} played ${selectedCard.rank}${SUIT_SYMBOLS[selectedCard.suit]} to the table`);
  }

  async function discardSelected() {
    if (!room || !myPlayer || !selectedCard) return;
    setActionError('');
    const newHand = myPlayer.hand.filter(c => c.id !== selectedCard.id);
    const discarded = { ...selectedCard, faceUp: true };
    const newDiscard = [...room.discard_pile, discarded];
    const nextTurn = game?.turnBased ? nextPlayerInOrder(orderedPlayers, myPlayerId ?? null) : room.current_turn;
    setSelectedCardId(null);
    await Promise.all([
      supabase.from('rooms').update({ discard_pile: newDiscard, current_turn: nextTurn }).eq('id', room.id),
      supabase.from('players').update({ hand: newHand }).eq('id', myPlayer.id),
    ]);
    await logAction(`${myPlayer.name} discarded ${selectedCard.rank}${SUIT_SYMBOLS[selectedCard.suit]}`);
  }

  // --- Golf ---

  async function golfDrawFromDeck() {
    if (!room || !myPlayer || !canAct || golfPendingDraw || room.deck.length === 0) return;
    setActionError('');
    const [drawn, ...remainingDeck] = room.deck;
    setGolfPendingDraw({ card: drawn, source: 'deck' });
    await supabase.from('rooms').update({ deck: remainingDeck }).eq('id', room.id);
  }

  async function golfDrawFromDiscard() {
    if (!room || !myPlayer || !canAct || golfPendingDraw || room.discard_pile.length === 0) return;
    setActionError('');
    const drawn = room.discard_pile.at(-1)!;
    const remainingDiscard = room.discard_pile.slice(0, -1);
    setGolfPendingDraw({ card: { ...drawn, faceUp: true }, source: 'discard' });
    await supabase.from('rooms').update({ discard_pile: remainingDiscard }).eq('id', room.id);
  }

  /**
   * Reveals every active player's hand — used when a turn wraps back around to whoever
   * knocked. Pass `exceptPlayerId` when that player's own (changed) hand is being written
   * separately in the same batch, so it isn't double-written here with stale data.
   */
  async function revealAllGolfHands(exceptPlayerId?: string) {
    await Promise.all(
      orderedPlayers
        .filter(p => p.id !== exceptPlayerId)
        .map(p => supabase.from('players').update({ hand: p.hand.map(c => ({ ...c, faceUp: true })) }).eq('id', p.id))
    );
  }

  /** Swaps the pending drawn card into hand slot `idx`; the replaced card goes face up to discard. */
  async function performGolfSwap(idx: number) {
    if (!room || !myPlayer || !golfPendingDraw) return;
    const oldCard = myPlayer.hand[idx];
    const newHand = myPlayer.hand.map((c, i) => i === idx ? { ...golfPendingDraw.card, faceUp: false } : c);
    const discarded = { ...oldCard, faceUp: true };
    const newDiscard = [...room.discard_pile, discarded];
    const nextTurn = nextPlayerInOrder(orderedPlayers, myPlayerId ?? null);
    const revealing = !!room.golf_knocked_by && nextTurn === room.golf_knocked_by;
    setGolfPendingDraw(null);
    // The replaced card is gone — free its peek-tracking, but permanently count any in-progress
    // peek as used so swapping mid-peek can't be used to dodge the two-peek budget.
    setGolfPeekedNow(prev => { const n = new Set(prev); n.delete(oldCard.id); return n; });
    setGolfPeekUsed(prev => new Set(prev).add(oldCard.id));
    await Promise.all([
      supabase.from('rooms').update({ discard_pile: newDiscard, current_turn: revealing ? null : nextTurn }).eq('id', room.id),
      supabase.from('players').update({
        hand: revealing ? newHand.map(c => ({ ...c, faceUp: true })) : newHand,
      }).eq('id', myPlayer.id),
      ...(revealing ? [revealAllGolfHands(myPlayer.id)] : []),
    ]);
    await logAction(`${myPlayer.name} swapped in a card, discarding ${oldCard.rank}${SUIT_SYMBOLS[oldCard.suit]}`);
  }

  /** Declines the swap — the drawn card goes straight to discard and your hand stays as-is. */
  async function golfDiscardDrawn() {
    if (!room || !myPlayer || !golfPendingDraw) return;
    const discarded = { ...golfPendingDraw.card, faceUp: true };
    const newDiscard = [...room.discard_pile, discarded];
    const nextTurn = nextPlayerInOrder(orderedPlayers, myPlayerId ?? null);
    const revealing = !!room.golf_knocked_by && nextTurn === room.golf_knocked_by;
    setGolfPendingDraw(null);
    await Promise.all([
      supabase.from('rooms').update({ discard_pile: newDiscard, current_turn: revealing ? null : nextTurn }).eq('id', room.id),
      ...(revealing ? [revealAllGolfHands()] : []),
    ]);
    await logAction(`${myPlayer.name} discarded ${discarded.rank}${SUIT_SYMBOLS[discarded.suit]} without swapping`);
  }

  /** Ends your turn without drawing — everyone else gets exactly one more turn, then all hands reveal. */
  async function golfKnock() {
    if (!room || !myPlayer || !canAct || golfPendingDraw || room.golf_knocked_by) return;
    setActionError('');
    const nextTurn = nextPlayerInOrder(orderedPlayers, myPlayerId ?? null);
    await supabase.from('rooms').update({ golf_knocked_by: myPlayer.id, current_turn: nextTurn }).eq('id', room.id);
    await logAction(`${myPlayer.name} knocked`);
  }

  function handleGolfCardClick(card: Card, idx: number) {
    if (!myPlayer || golfRevealed) return;
    // Peeking is a private action with no turn restriction; only the swap step is turn-gated,
    // and golfPendingDraw can only be set on this client after it drew on its own turn.
    if (golfPendingDraw) {
      performGolfSwap(idx);
      return;
    }
    if (golfPeekUsed.has(card.id)) return;
    if (golfPeekedNow.has(card.id)) {
      setGolfPeekedNow(prev => { const n = new Set(prev); n.delete(card.id); return n; });
      setGolfPeekUsed(prev => new Set(prev).add(card.id));
      return;
    }
    if (golfPeekedNow.size + golfPeekUsed.size >= 2) return;
    setGolfPeekedNow(prev => new Set(prev).add(card.id));
  }

  async function stand() {
    if (!room || !myPlayer) return;
    setActionError('');
    const nextTurn = nextPlayerInOrder(orderedPlayers, myPlayerId ?? null);
    await Promise.all([
      supabase.from('players').update({ is_standing: true }).eq('id', myPlayer.id),
      supabase.from('rooms').update({ current_turn: nextTurn }).eq('id', room.id),
    ]);
    if (game?.showBlackjackControls) {
      await logAction(`${myPlayer.name} stood on ${blackjackValue(myPlayer.hand)}`);
    }
  }

  async function revealDealerHand() {
    if (!room || !isDealer) return;
    const dealerPlayer = orderedPlayers[0];
    if (!dealerPlayer) return;
    const revealedHand = dealerPlayer.hand.map(c => ({ ...c, faceUp: true }));
    await supabase.from('players').update({ hand: revealedHand }).eq('id', dealerPlayer.id);
  }

  async function revealHoldemStage(stage: HoldemStage) {
    if (!room) return;
    let cards = [...room.community_cards];
    if (stage === 'flop') cards = cards.map((c, i) => i < 3 ? { ...c, faceUp: true } : c);
    else if (stage === 'turn') cards = cards.map((c, i) => i < 4 ? { ...c, faceUp: true } : c);
    else if (stage === 'river') cards = cards.map(c => ({ ...c, faceUp: true }));
    await supabase.from('rooms').update({ community_cards: cards, holdem_stage: stage }).eq('id', room.id);
  }

  async function executeGoFishAsk() {
    if (!room || !myPlayer) return;
    const target = orderedPlayers.find(p => p.id === askTargetId);
    if (!target) return;
    const matchingCards = target.hand.filter(c => c.rank === askRank);
    if (matchingCards.length === 0) {
      // "Go Fish" — draw from deck automatically
      if (room.deck.length > 0) {
        const [drawn, ...remainingDeck] = room.deck;
        const newHand = [...myPlayer.hand, drawn];
        await Promise.all([
          supabase.from('rooms').update({ deck: remainingDeck }).eq('id', room.id),
          supabase.from('players').update({ hand: newHand }).eq('id', myPlayer.id),
        ]);
      }
      const nextTurn = nextPlayerInOrder(orderedPlayers, myPlayerId ?? null);
      await supabase.from('rooms').update({ current_turn: nextTurn }).eq('id', room.id);
    } else {
      // Transfer cards from target to asker
      const newMyHand = [...myPlayer.hand, ...matchingCards];
      const newTargetHand = target.hand.filter(c => c.rank !== askRank);
      await Promise.all([
        supabase.from('players').update({ hand: newMyHand }).eq('id', myPlayer.id),
        supabase.from('players').update({ hand: newTargetHand }).eq('id', target.id),
      ]);
      // Player gets another turn after a successful ask
    }
    setShowAskDialog(false);
  }

  // --- Render helpers ---

  /** Full-width player roster / turn indicator — the current turn-holder is called out
      in amber with an underline, matching the Figma "Game Desktop" TURN bar. */
  function TurnTabs() {
    if (orderedPlayers.length === 0) return null;
    return (
      <div className="flex items-center gap-5 sm:gap-8 px-4 sm:px-8 py-2.5 bg-black/10 border-b border-white/10 overflow-x-auto no-scrollbar">
        <span className="text-[10px] font-bold tracking-widest text-white/30 shrink-0">TURN</span>
        {orderedPlayers.map(p => {
          const isTurn = !!game?.turnBased && room?.current_turn === p.id;
          return (
            <div key={p.id} className="relative shrink-0 pb-2 -mb-2">
              <span className={`font-display text-base sm:text-lg tracking-wide whitespace-nowrap ${isTurn ? 'text-amber-400' : 'text-app-label'}`}>
                {p.name}{p.id === myPlayerId && ' (you)'}
              </span>
              {isTurn && <span className="absolute left-0 right-0 bottom-0 h-[3px] bg-amber-400 rounded-full" />}
            </div>
          );
        })}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/60 text-lg">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-app-bg safe-top safe-bottom">

      {/* Header — big game name (matches the Figma "Game Desktop" header) with room info
          beside it; nav links float right on desktop, drop to their own row on mobile. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6 px-4 py-3 sm:px-8 bg-black/20 border-b border-white/10">
        <div className="flex items-center justify-between sm:contents">
          <h1 className="font-display text-2xl sm:text-3xl md:text-4xl text-white tracking-wide">{room?.game_name}</h1>
          <div className="text-right sm:text-left">
            <div className="text-app-label text-xs font-semibold">Room {code}</div>
            <div className="text-white/40 text-xs">{orderedPlayers.length} players · {room?.deck.length ?? 0} cards left</div>
          </div>
        </div>
        <div className="sm:flex-1" />
        <div className="flex items-center justify-center flex-wrap gap-4">
          <button onClick={() => setShowInstructions(v => !v)} className="text-white/40 hover:text-white text-xs">
            Rules
          </button>
          {isDealer && (
            <>
              <button onClick={playAgain} disabled={playingAgain} className="text-white/40 hover:text-white text-xs disabled:opacity-50">
                {playingAgain ? 'Dealing…' : 'Play Again'}
              </button>
              <button onClick={openSettings} className="text-white/40 hover:text-white text-xs">
                Settings
              </button>
            </>
          )}
        </div>
      </div>

      <TurnTabs />

      {/* Instructions panel */}
      {showInstructions && game && (
        <div className="bg-black/30 border-b border-white/10 px-4 py-3">
          <p className="text-white/70 text-xs leading-relaxed">{game.instructions}</p>
        </div>
      )}

      {/* Dealer controls for Hold'em */}
      {game?.showHoldemControls && isDealer && (
        <div className="bg-amber-900/30 border-b border-amber-700/30 px-4 py-2 flex gap-2 overflow-x-auto">
          <span className="text-amber-400 text-xs font-semibold shrink-0 self-center">Reveal:</span>
          {(['flop', 'turn', 'river'] as HoldemStage[]).map(stage => {
            const alreadyRevealed =
              stage === 'flop' ? room?.community_cards[2]?.faceUp :
              stage === 'turn' ? room?.community_cards[3]?.faceUp :
              room?.community_cards[4]?.faceUp;
            return (
              <button key={stage}
                disabled={!!alreadyRevealed}
                onClick={() => revealHoldemStage(stage)}
                className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 hover:bg-amber-500/40 disabled:opacity-30 disabled:cursor-not-allowed capitalize shrink-0"
              >
                {stage}
              </button>
            );
          })}
        </div>
      )}

      {/* Dealer controls for Blackjack */}
      {game?.showBlackjackControls && isDealer && (
        <div className="bg-amber-900/30 border-b border-amber-700/30 px-4 py-2 flex gap-2">
          <span className="text-amber-400 text-xs font-semibold self-center">Dealer:</span>
          <button
            onClick={revealDealerHand}
            className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 hover:bg-amber-500/40"
          >
            Reveal Hand
          </button>
        </div>
      )}

      {/* Blackjack: round results, once everyone is standing/busted */}
      {allBlackjackDone && dealer && (
        <div className="mx-4 mt-3 bg-amber-900/30 border border-amber-700/40 rounded px-4 py-3">
          <p className="text-amber-300 text-xs font-bold uppercase tracking-wide mb-2">Round Results</p>
          <div className="flex flex-col gap-1">
            {orderedPlayers.slice(1).map(p => {
              const value = blackjackValue(p.hand);
              const dealerValue = blackjackValue(dealer.hand);
              const outcome = blackjackOutcome(value, dealerValue);
              const label = outcome === 'win' ? 'Win' : outcome === 'lose' ? (value > 21 ? 'Bust' : 'Lose') : 'Push';
              const color = outcome === 'win' ? 'text-app-label' : outcome === 'lose' ? 'text-red-400' : 'text-white/60';
              return (
                <div key={p.id} className="flex justify-between text-sm">
                  <span className="text-white/80">{p.name} ({value})</span>
                  <span className={`font-semibold ${color}`}>{label}</span>
                </div>
              );
            })}
            <div className="flex justify-between text-sm border-t border-amber-700/30 mt-1 pt-1">
              <span className="text-amber-200">Dealer ({blackjackValue(dealer.hand)})</span>
              {blackjackValue(dealer.hand) > 21 && <span className="text-red-400 font-semibold">Bust</span>}
            </div>
          </div>
          {isDealer && (
            <button
              onClick={playAgain}
              disabled={playingAgain}
              className="w-full mt-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 font-bold py-2 rounded text-sm transition-colors"
            >
              {playingAgain ? 'Dealing…' : 'Play Again'}
            </button>
          )}
        </div>
      )}

      {/* Golf: round results, once the final round wraps back to whoever knocked */}
      {game?.isGolfLike && golfRevealed && (
        <div className="mx-4 mt-3 bg-amber-900/30 border border-amber-700/40 rounded px-4 py-3">
          <p className="text-amber-300 text-xs font-bold uppercase tracking-wide mb-2">Round Results</p>
          <div className="flex flex-col gap-1">
            {[...orderedPlayers]
              .sort((a, b) => golfScore(a.hand) - golfScore(b.hand))
              .map((p, i) => (
                <div key={p.id} className="flex justify-between text-sm">
                  <span className={i === 0 ? 'text-app-label font-semibold' : 'text-white/80'}>
                    {p.name}{p.id === room?.golf_knocked_by ? ' (knocked)' : ''}
                  </span>
                  <span className={i === 0 ? 'text-app-label font-semibold' : 'text-white/60'}>
                    {golfScore(p.hand)}
                  </span>
                </div>
              ))}
          </div>
          {isDealer && (
            <button
              onClick={playAgain}
              disabled={playingAgain}
              className="w-full mt-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 font-bold py-2 rounded text-sm transition-colors"
            >
              {playingAgain ? 'Dealing…' : 'Play Again'}
            </button>
          )}
        </div>
      )}

      {/* Action History — full-width banner on mobile, right sidebar on desktop (see below).
          Now populated for any game mode, not just Blackjack. */}
      {(room?.action_log?.length ?? 0) > 0 && (
        <div className="mx-4 mt-3 bg-black/20 border border-white/10 rounded px-3 py-2 max-h-28 overflow-y-auto sm:hidden">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-1">Action History</p>
          <div className="flex flex-col gap-0.5">
            {room!.action_log.map((entry, i) => (
              <p key={i} className="text-white/60 text-xs">{entry}</p>
            ))}
          </div>
        </div>
      )}

      {/* Board: opponents sidebar, table/hand/actions centered, action history, on desktop;
          stacked on mobile. pb-28 on mobile reserves room at the bottom so the now-`fixed`
          hand/action-bar (see below) never overlaps the tail of the grid/opponents. */}
      <div className="flex-1 flex flex-col pb-28 sm:pb-0 sm:flex-row sm:items-stretch sm:gap-6 sm:px-6 sm:py-6 sm:overflow-hidden">

      {/* Other players */}
      <div className="px-4 pt-4 pb-2 sm:w-[220px] sm:shrink-0 sm:px-0 sm:pt-0 sm:pb-0 sm:overflow-y-auto">
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 sm:flex-col sm:overflow-visible sm:pb-0">
          {otherPlayers.map(player => {
            const isTurn = room?.current_turn === player.id;
            return (
              <div key={player.id}
                className={`shrink-0 bg-white/5 border rounded px-3 py-2 min-w-24 sm:min-w-0 sm:w-full
                  ${isTurn ? 'border-app-primaryLighter/60 bg-app-panel/30' : 'border-white/10'}`}
              >
                <div className="flex items-center gap-1 mb-2">
                  {isTurn && <span className="w-2 h-2 rounded-full bg-app-primaryLighter animate-pulse" />}
                  <span className="text-white text-xs font-semibold truncate max-w-20">{player.name}</span>
                  {player.id === dealer?.id && <span className="text-amber-400 text-xs">★</span>}
                </div>
                {player.hand.length > 0 ? (
                  game?.isGolfLike ? (
                    <div className="grid grid-cols-2 gap-1 w-fit">
                      {player.hand.slice(0, 4).map((card, i) => (
                        <PlayingCard key={card.id + i} card={card} size="sm" backColor={room?.back_color} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      {player.hand.slice(0, 4).map((card, i) => (
                        <PlayingCard key={card.id + i} card={card} size="sm" backColor={room?.back_color} />
                      ))}
                      {player.hand.length > 4 && (
                        <div className="w-[4.5rem] aspect-[177.84/249.84] flex items-center justify-center text-white/40 text-sm">
                          +{player.hand.length - 4}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <span className="text-white/30 text-xs">No cards</span>
                )}
                {player.is_standing && game?.showBlackjackControls && (
                  <div className={`text-xs mt-1 font-semibold ${blackjackValue(player.hand) > 21 ? 'text-red-400' : 'text-amber-400'}`}>
                    {blackjackValue(player.hand) > 21 ? 'BUST' : 'STAND'}
                  </div>
                )}
              </div>
            );
          })}
          {otherPlayers.length === 0 && (
            <p className="text-white/30 text-sm">No other players yet</p>
          )}
        </div>
      </div>

      {/* Center column: table, hand, and actions. Golf gets its own desktop arrangement —
          Deck beside the 2x2 grid rather than above it, matching the Figma "Game desktop
          Golf" frames — via flex-wrap + order rather than restructuring the DOM, so mobile
          (which stays stacked, unchanged) shares the exact same markup. */}
      <div className={`flex-1 flex flex-col sm:justify-center sm:gap-4 sm:mx-auto sm:w-full sm:min-h-0
        ${game?.isGolfLike ? 'sm:flex-row sm:flex-wrap sm:items-start sm:max-w-4xl' : 'sm:items-center sm:max-w-2xl'}`}>

      {/* Deck + Table, side by side on desktop (matches the Figma "Game Desktop" body),
          stacked on mobile */}
      <div className={`flex-1 px-4 py-2 sm:flex-none sm:px-0 sm:py-0 sm:flex sm:gap-16 sm:justify-center sm:items-start
        ${game?.isGolfLike ? 'sm:order-1 sm:w-auto' : 'sm:w-full'}`}>
        {/* Deck group: draw + discard piles */}
        <div className="mb-4 sm:mb-0">
          <p className="font-display text-app-label text-sm tracking-wide mb-2 sm:text-center">Deck</p>
          <div className="flex gap-4 items-center sm:justify-center">
            {/* Draw pile */}
            <button
              onClick={
                !canAct ? undefined
                : game?.isGolfLike ? (golfPendingDraw ? undefined : golfDrawFromDeck)
                : drawFromDeck
              }
              disabled={!canAct || (room?.deck.length ?? 0) === 0 || (game?.isGolfLike && !!golfPendingDraw)}
              className="flex flex-col items-center gap-1"
            >
              <PlayingCard
                card={{ id: 'draw-pile', rank: 'A', suit: 'spades', faceUp: false }}
                size="md"
                backColor={room?.back_color}
              />
              <span className="text-white/40 text-xs">Draw · {room?.deck.length ?? 0}</span>
            </button>

            {/* Discard pile / draw from discard — hidden for games that never use it */}
            {usesDiscardPile && (
              <div className="flex flex-col items-center gap-1">
                {topDiscard ? (
                  <div
                    onClick={
                      !(game?.canDrawFromDiscard && canAct) ? undefined
                      : game?.isGolfLike ? (golfPendingDraw ? undefined : golfDrawFromDiscard)
                      : drawFromDiscard
                    }
                    className={game?.canDrawFromDiscard && canAct && !(game?.isGolfLike && golfPendingDraw) ? 'cursor-pointer' : 'cursor-default'}>
                    <PlayingCard card={topDiscard} size="md" backColor={room?.back_color} />
                  </div>
                ) : (
                  <div className="w-28 aspect-[177.84/249.84] rounded border-2 border-dashed border-white/20 flex items-center justify-center">
                    <span className="text-white/20 text-sm">Empty</span>
                  </div>
                )}
                <span className="text-white/40 text-xs">
                  {game?.canDrawFromDiscard && canAct ? 'Tap to draw' : 'Discard'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Table group: community / played cards */}
        {(room?.community_cards.length ?? 0) > 0 && (
          <div>
            <p className="font-display text-app-label text-sm tracking-wide mb-2 sm:text-center">Table</p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar sm:justify-center">
              {room!.community_cards.map((card, i) => (
                <PlayingCard key={card.id + i} card={card} size="md" backColor={room?.back_color} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {actionError && (
        <div className="px-4 pb-1 sm:px-0 sm:w-full">
          <p className="text-red-400 text-xs bg-red-900/30 border border-red-700/30 rounded px-3 py-1.5">{actionError}</p>
        </div>
      )}

      {/* Your hand + action bar are pinned to the bottom of the viewport on mobile via
          `fixed`, not `sticky` — sticky only holds an element in place once scrolling
          would carry it past the threshold, it doesn't pull an element up from beyond
          the fold when the page hasn't been scrolled yet, which is exactly Golf's case
          (opponent grids alone can exceed one screen). `fixed` always renders at the
          true viewport bottom regardless of scroll position or content height above it.
          sm:contents removes this wrapper from desktop layout entirely, so the two
          children go back to being normal flex items in the centered column. */}
      <div className="fixed inset-x-0 bottom-0 z-10 bg-app-bg safe-bottom sm:static sm:contents">
      {/* Your hand */}
      <div className={`border-t border-white/10 bg-black/20 px-4 pt-3 pb-2 sm:border-t-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:pb-0
        ${game?.isGolfLike ? 'sm:order-2 sm:w-auto sm:flex sm:flex-col sm:items-center' : 'sm:w-full'}`}>
        {/* Desktop status headline for Golf, matching the amber Ohno Blazeface caption in
            the Figma "Game desktop Golf" frames. Mobile keeps the small muted header. */}
        {game?.isGolfLike && (
          <p className="hidden sm:block font-display text-amber-400 text-2xl tracking-wide mb-3">{golfStatusText}</p>
        )}
        <div className="flex items-center justify-between mb-2 sm:justify-center sm:gap-3">
          <p className={`text-white/60 text-xs font-medium ${game?.isGolfLike ? 'sm:hidden' : ''}`}>Your hand · {myPlayer?.name}</p>
          {myPlayer?.is_standing && game?.showBlackjackControls && (
            <span className={`text-xs font-semibold ${blackjackValue(myPlayer.hand) > 21 ? 'text-red-400' : 'text-amber-400'}`}>
              {blackjackValue(myPlayer.hand) > 21 ? 'BUSTED' : 'STANDING'}
            </span>
          )}
          {game?.isGolfLike && !golfRevealed && (
            <span className="text-white/30 text-xs sm:hidden">
              {golfPendingDraw ? 'Tap a card to replace it' : `Peeks left: ${golfPeeksLeft}`}
            </span>
          )}
        </div>
        {golfPendingDraw && (
          <div className="flex items-center gap-2 mb-2 sm:flex-col sm:mb-4">
            <div className="sm:ring-2 sm:ring-amber-400 sm:rounded sm:shadow-[0_0_12px_rgba(245,158,11,0.5)]">
              <PlayingCard card={{ ...golfPendingDraw.card, faceUp: true }} size="sm" />
            </div>
            <span className="text-amber-300 text-xs font-medium sm:hidden">
              Drew {golfPendingDraw.card.rank}{SUIT_SYMBOLS[golfPendingDraw.card.suit]} — tap one of your cards below
            </span>
            <span className="hidden sm:block font-display text-amber-400 text-sm tracking-wide">
              {cardFullName(golfPendingDraw.card)}
            </span>
          </div>
        )}
        {(myPlayer?.hand.length ?? 0) > 0 ? (
          game?.isGolfLike ? (
            <>
              <div className="grid grid-cols-2 gap-2 w-fit mx-auto pb-1 pt-1">
                {myPlayer!.hand.map((card, idx) => (
                  <div
                    key={card.id}
                    onMouseEnter={() => setHoveredGolfIdx(idx)}
                    onMouseLeave={() => setHoveredGolfIdx(prev => (prev === idx ? null : prev))}
                    className={`sm:rounded sm:transition-shadow ${hoveredGolfIdx === idx && !golfRevealed
                      ? 'sm:ring-2 sm:ring-blue-400 sm:shadow-[0_0_12px_rgba(112,156,251,0.6)]' : ''}`}
                  >
                    <PlayingCard
                      card={{ ...card, faceUp: card.faceUp || golfPeekedNow.has(card.id) }}
                      isOwner={false}
                      size="lg"
                      backColor={room?.back_color}
                      onClick={() => handleGolfCardClick(card, idx)}
                    />
                  </div>
                ))}
              </div>
              {!golfRevealed && (
                <p className="hidden sm:block font-display text-app-label text-sm tracking-wide mt-3">
                  {golfPendingDraw ? 'Tap a card to replace it' : `Peeks left: ${golfPeeksLeft}`}
                </p>
              )}
            </>
          ) : (
            <>
              {/* Fanned hand — on desktop, cards overlap and respond to hover: the hovered/
                  selected card lifts and pops full-color while its neighbors dim, matching
                  the Figma "Game Desktop 3/4" hover and selection states. Touch has no
                  hover, so mobile just keeps the plain tap-to-select row (unchanged). */}
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 pt-1 sm:flex-wrap sm:justify-center sm:overflow-visible sm:gap-0 sm:pt-3">
                {myPlayer!.hand.map((card, idx) => {
                  const activeId = selectedCardId ?? hoveredCardId;
                  const isSelected = selectedCardId === card.id;
                  const isActive = activeId === card.id;
                  const isDimmed = !!activeId && !isActive;
                  return (
                    <div
                      key={card.id}
                      onMouseEnter={() => setHoveredCardId(card.id)}
                      onMouseLeave={() => setHoveredCardId(prev => (prev === card.id ? null : prev))}
                      className={`relative transition-all duration-150 ease-out rounded
                        ${idx > 0 ? 'sm:-ml-10' : ''}
                        ${isSelected ? 'z-20 -translate-y-3 sm:-translate-y-6 ring-2 ring-blue-400 shadow-[0_0_16px_rgba(112,156,251,0.6)]' : isActive ? 'sm:z-10 sm:-translate-y-3' : 'sm:z-0'}
                        ${isDimmed ? 'sm:grayscale sm:opacity-60' : ''}`}
                    >
                      <PlayingCard
                        card={card}
                        isOwner
                        size="lg"
                        onClick={() => {
                          setSelectedCardId(prev => (prev === card.id ? null : card.id));
                          setActionError('');
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Desktop-only: active card's full name + a contextual Play/Discard/Cancel
                  popover once one is actually selected (not just hovered). Mobile keeps
                  using the bottom action bar below for these same actions. */}
              {(() => {
                const activeCard = myPlayer!.hand.find(c => c.id === (selectedCardId ?? hoveredCardId));
                if (!activeCard) return null;
                return (
                  <div className="hidden sm:flex sm:flex-col sm:items-center sm:gap-3 sm:mt-4">
                    <p className="font-display text-amber-400 text-lg tracking-wide">{cardFullName(activeCard)}</p>
                    {selectedCardId === activeCard.id && canAct && (
                      <div className="flex flex-col items-center gap-2">
                        <button
                          onClick={playToTable}
                          className="w-44 bg-blue-600 hover:bg-blue-500 text-white font-display text-lg py-2.5 rounded-xl shadow-lg transition-colors"
                        >
                          Play to Table
                        </button>
                        <div className="flex gap-4">
                          <button onClick={discardSelected} className="text-xs text-red-400 hover:text-red-300 font-semibold px-2 py-1">
                            Discard
                          </button>
                          <button onClick={() => setSelectedCardId(null)} className="text-xs text-white/40 hover:text-white px-2 py-1">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )
        ) : (
          <p className="text-white/30 text-sm py-3">No cards in hand</p>
        )}
      </div>

      {/* Golf: big Knock! button, desktop-only, sitting to the right of the grid and
          vertically centered against it (sm:self-center within the row). */}
      {game?.isGolfLike && canAct && !golfPendingDraw && !room?.golf_knocked_by && !golfRevealed && (
        <button
          onClick={golfKnock}
          className="hidden sm:block sm:order-2 sm:self-center bg-amber-500 hover:bg-amber-400 text-white font-display text-3xl tracking-wide px-10 py-4 rounded-2xl shadow-lg transition-colors"
        >
          Knock!
        </button>
      )}

      {/* Action bar */}
      <div className={`px-4 py-3 bg-black/30 border-t border-white/10 safe-bottom sm:bg-transparent sm:border-t-0 sm:px-0 sm:py-0 sm:w-full sm:max-w-sm sm:mx-auto
        ${game?.isGolfLike ? 'sm:order-3 sm:basis-full' : ''}`}>
        {game?.showBlackjackControls ? (
          !myPlayer?.is_standing ? (
            // Blackjack controls
            <div className="flex gap-2">
              <button
                onClick={canAct ? drawFromDeck : undefined}
                disabled={!canAct}
                className="flex-1 bg-app-primary hover:bg-app-primaryLight disabled:opacity-40 text-white font-bold py-3 rounded transition-colors"
              >
                Hit
              </button>
              <button
                onClick={canAct ? stand : undefined}
                disabled={!canAct}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold py-3 rounded transition-colors"
              >
                Stand
              </button>
            </div>
          ) : allBlackjackDone ? (
            <p className="text-white/40 text-sm text-center py-2">Round over — see results above.</p>
          ) : (
            <p className="text-white/40 text-sm text-center py-2">
              You {blackjackValue(myPlayer?.hand ?? []) > 21 ? 'busted' : 'stood'} on {blackjackValue(myPlayer?.hand ?? [])} — waiting for other players…
            </p>
          )
        ) : game?.isGoFishLike ? (
          // Go Fish controls
          <div className="flex gap-2">
            <button
              onClick={canAct ? drawFromDeck : undefined}
              disabled={!canAct}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-3 rounded transition-colors text-sm"
            >
              Go Fish (Draw)
            </button>
            <button
              onClick={() => {
                if (!canAct) return;
                setAskTargetId(otherPlayers[0]?.id ?? '');
                setShowAskDialog(true);
              }}
              disabled={!canAct || otherPlayers.length === 0}
              className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold py-3 rounded transition-colors text-sm"
            >
              Ask for Rank
            </button>
          </div>
        ) : game?.isGolfLike ? (
          // Golf controls — drawing/replacing happens by tapping the piles and grid directly
          <>
            {room?.golf_knocked_by && !golfRevealed && (
              <p className="text-amber-300 text-xs text-center mb-2">
                {room.golf_knocked_by === myPlayerId ? 'You knocked' : `${players.find(p => p.id === room.golf_knocked_by)?.name ?? 'A player'} knocked`} — final round in progress
              </p>
            )}
            {golfRevealed ? (
              <p className="text-white/40 text-sm text-center py-2">Round over — see results above.</p>
            ) : golfPendingDraw ? (
              <div className="flex flex-col gap-2">
                <p className="text-white/60 text-sm text-center font-medium">Tap one of your cards to replace it</p>
                <button
                  onClick={golfDiscardDrawn}
                  className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-2 rounded text-sm transition-colors"
                >
                  Discard drawn card instead
                </button>
              </div>
            ) : canAct ? (
              <div className="flex gap-2 items-center">
                <p className="flex-1 text-white/40 text-xs">Tap the draw or discard pile to draw a card</p>
                {/* Desktop uses the big Knock! button beside the grid instead (see below). */}
                {!room?.golf_knocked_by && (
                  <button
                    onClick={golfKnock}
                    className="shrink-0 sm:hidden bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold px-4 py-2 rounded text-sm transition-colors"
                  >
                    Knock
                  </button>
                )}
              </div>
            ) : null}
          </>
        ) : (
          // Default controls — desktop uses the floating Play/Discard popover under the
          // selected card instead (see the hand render above), so this bar is mobile-only.
          <div className="flex gap-2 sm:hidden">
            <button
              onClick={selectedCard && canAct ? playToTable : undefined}
              disabled={!selectedCard || !canAct}
              className="flex-1 bg-app-primary hover:bg-app-primaryLight disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded transition-colors text-sm"
            >
              Play to Table
            </button>
            <button
              onClick={selectedCard && canAct ? discardSelected : undefined}
              disabled={!selectedCard || !canAct}
              className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded transition-colors text-sm"
            >
              Discard
            </button>
          </div>
        )}

        {!canAct && game?.turnBased && !(game?.showBlackjackControls && myPlayer?.is_standing) && (
          <p className="text-white/30 text-xs text-center mt-2">Wait for your turn…</p>
        )}
        {!selectedCard && canAct && !game?.showBlackjackControls && !game?.isGoFishLike && !game?.isGolfLike && (
          <p className="text-white/30 text-xs text-center mt-2 sm:hidden">Tap a card to select it</p>
        )}
      </div>
      </div>

      </div>

      {/* Action History — desktop-only right sidebar (mobile gets the banner above) */}
      {(room?.action_log?.length ?? 0) > 0 && (
        <div className="hidden sm:block sm:w-[260px] sm:shrink-0 sm:self-start bg-black/20 border border-white/10 rounded-xl px-4 py-3 max-h-[420px] overflow-y-auto">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-2">Action History</p>
          <div className="flex flex-col gap-1.5">
            {room!.action_log.map((entry, i) => (
              <p key={i} className="text-white/60 text-xs">{entry}</p>
            ))}
          </div>
        </div>
      )}

      </div>

      {/* Go Fish: Ask dialog */}
      {showAskDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={() => setShowAskDialog(false)}>
          <div className="bg-app-panel border border-app-primary/40 rounded-t-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-app-accent text-2xl mb-4">Ask for a card</h3>
            <div className="mb-4">
              <label className="text-white/60 text-sm mb-1 block">Ask player</label>
              <select value={askTargetId} onChange={e => setAskTargetId(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none">
                {otherPlayers.map(p => <option key={p.id} value={p.id} className="bg-app-bg">{p.name}</option>)}
              </select>
            </div>
            <div className="mb-6">
              <label className="text-white/60 text-sm mb-1 block">For rank</label>
              <div className="flex flex-wrap gap-2">
                {(['A','2','3','4','5','6','7','8','9','10','J','Q','K'] as Rank[]).map(r => (
                  <button key={r} onClick={() => setAskRank(r)}
                    className={`px-3 py-2 rounded font-bold text-sm transition-colors
                      ${askRank === r ? 'bg-app-primaryLight text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAskDialog(false)} className="flex-1 bg-white/10 text-white py-3 rounded font-semibold">Cancel</button>
              <button onClick={executeGoFishAsk} className="flex-1 bg-app-primaryLight text-white py-3 rounded font-bold">Ask!</button>
            </div>
          </div>
        </div>
      )}

      {/* Dealer: Game Settings panel */}
      {showSettings && pendingConfig && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-app-panel border border-app-primary/40 rounded-t-lg w-full max-w-md p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-app-accent text-2xl mb-4">Game Settings</h3>

            <div className="mb-4">
              <label className="text-white/60 text-sm mb-1 block">Name</label>
              <input
                value={pendingConfig.name}
                onChange={e => updateField('name', e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none"
              />
            </div>

            <div className="mb-4">
              <label className="text-white/60 text-sm mb-2 block">Card back color</label>
              <div className="flex gap-2">
                {(Object.keys(BACK_COLORS) as BackColorKey[]).map(key => (
                  <button
                    key={key}
                    onClick={() => setBackColor(key)}
                    title={key}
                    aria-label={key}
                    className={`w-9 h-9 rounded-full border-2 transition-transform
                      ${room?.back_color === key || (!room?.back_color && key === 'blue')
                        ? 'border-white scale-110'
                        : 'border-white/20 hover:border-white/50'}`}
                    style={{ backgroundColor: BACK_COLORS[key] }}
                  />
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-white/60 text-sm mb-1 block">Mode</label>
              <select
                value={pendingMode}
                onChange={e => applyModeChange(e.target.value as PendingMode)}
                className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none appearance-none"
              >
                <option value="freeplay" className="bg-app-bg">Free play (play/discard)</option>
                <option value="blackjack" className="bg-app-bg">Blackjack (hit/stand)</option>
                <option value="golf" className="bg-app-bg">Golf (4-card grid)</option>
              </select>
            </div>

            {/* Golf-specific settings — separate from the freeplay/deal-plan fields below,
                since those would let a dealer break the fixed 4-card 2x2 grid Golf assumes. */}
            {pendingMode === 'golf' && (
              <div className="mb-4 flex flex-col gap-3">
                <div>
                  <label className="text-white/60 text-sm mb-2 block">Zero-point card</label>
                  <div className="flex gap-2">
                    {(['Q', 'K'] as const).map(rank => (
                      <button
                        key={rank}
                        onClick={() => updateField('golfZeroRank', rank)}
                        className={`flex-1 py-2 rounded text-sm font-semibold transition-colors
                          ${pendingConfig.golfZeroRank === rank ? 'bg-app-primary text-white' : 'bg-white/10 text-white/60 hover:text-white'}`}
                      >
                        {rank === 'Q' ? 'Queens' : 'Kings'}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-white/80 text-sm">
                  <input type="checkbox" checked={pendingConfig.golfPairsCancel}
                    onChange={e => updateField('golfPairsCancel', e.target.checked)} />
                  Matching pairs in a row or column cancel to 0
                </label>
              </div>
            )}

            {pendingMode === 'freeplay' && (
              <div className="mb-4 flex flex-col gap-3">
                <label className="flex items-center gap-2 text-white/80 text-sm">
                  <input type="checkbox" checked={pendingConfig.turnBased}
                    onChange={e => updateField('turnBased', e.target.checked)} />
                  Turn-based
                </label>
                <label className="flex items-center gap-2 text-white/80 text-sm">
                  <input type="checkbox" checked={pendingConfig.canDrawFromDiscard}
                    onChange={e => updateField('canDrawFromDiscard', e.target.checked)} />
                  Players can draw from the discard pile
                </label>
              </div>
            )}

            {/* Go Fish also deals via the generic dealPlan-driven path, so these apply there too */}
            {(pendingMode === 'freeplay' || pendingMode === 'gofish') && (
              <div className="mb-4 flex flex-col gap-3">
                <div>
                  <label className="text-white/60 text-sm mb-1 block">Cards per player</label>
                  <input
                    type="number" min={1} max={13}
                    value={pendingConfig.dealPlan.cardsPerPlayer}
                    onChange={e => updateDealPlan('cardsPerPlayer', Math.max(1, Math.min(13, Number(e.target.value) || 1)))}
                    className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none"
                  />
                </div>
                {pendingMode === 'freeplay' && (
                  <label className="flex items-center gap-2 text-white/80 text-sm">
                    <input type="checkbox" checked={pendingConfig.dealPlan.splitEntireDeck}
                      onChange={e => updateDealPlan('splitEntireDeck', e.target.checked)} />
                    Split the whole deck evenly (War-style)
                  </label>
                )}
                {pendingMode === 'freeplay' && (
                  <label className="flex items-center gap-2 text-white/80 text-sm">
                    <input type="checkbox" checked={pendingConfig.dealPlan.discardPileStart}
                      onChange={e => updateDealPlan('discardPileStart', e.target.checked)} />
                    Start with a table/discard card
                  </label>
                )}
                <label className="flex items-center gap-2 text-white/80 text-sm">
                  <input type="checkbox" checked={pendingConfig.dealPlan.handFaceUp}
                    onChange={e => updateDealPlan('handFaceUp', e.target.checked)} />
                  Hands visible to everyone
                </label>
              </div>
            )}

            <div className="mb-4 flex gap-3">
              <div className="flex-1">
                <label className="text-white/60 text-sm mb-1 block">Min players</label>
                <input
                  type="number" min={1}
                  value={pendingConfig.minPlayers}
                  onChange={e => updateField('minPlayers', Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="text-white/60 text-sm mb-1 block">Max players</label>
                <input
                  type="number" min={1}
                  value={pendingConfig.maxPlayers}
                  onChange={e => updateField('maxPlayers', Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-white/60 text-sm mb-1 block">Instructions</label>
              <textarea
                value={pendingConfig.instructions}
                onChange={e => updateField('instructions', e.target.value)}
                rows={3}
                className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none text-sm"
              />
            </div>

            <div className="mb-4 border-t border-white/10 pt-4">
              <label className="text-white/60 text-sm mb-1 block">Describe a change</label>
              <input
                value={featurePrompt}
                onChange={e => setFeaturePrompt(e.target.value)}
                placeholder="e.g. add jokers as wild cards"
                maxLength={200}
                className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white placeholder-white/40 focus:outline-none"
              />
              <button
                onClick={amendWithAI}
                disabled={amending || !featurePrompt.trim()}
                className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded transition-colors text-sm"
              >
                {amending ? 'Asking AI…' : 'Ask AI'}
              </button>
            </div>

            <div className="mb-4 border-t border-white/10 pt-4">
              <label className="text-white/60 text-sm mb-1 block">Save these settings</label>
              <input
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="e.g. Friday Night Rummy"
                maxLength={60}
                className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white placeholder-white/40 focus:outline-none"
              />
              <button
                onClick={saveToLibrary}
                disabled={saving || !saveName.trim()}
                className="w-full mt-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded transition-colors text-sm"
              >
                {saving ? 'Saving…' : 'Save to Library'}
              </button>
            </div>

            {settingsError && (
              <p className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded px-4 py-2 mb-4">{settingsError}</p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setShowSettings(false)} className="flex-1 bg-white/10 text-white py-3 rounded font-semibold">
                Cancel
              </button>
              <button
                onClick={dealAgain}
                disabled={redealing}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 py-3 rounded font-bold"
              >
                {redealing ? 'Dealing…' : 'Deal Again'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
