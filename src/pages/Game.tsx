import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, getErrorMessage, getEdgeFunctionErrorMessage } from '@/lib/supabase';
import { resolveGame, dealGame, toEditableConfig } from '@/lib/games';
import { nextPlayerInOrder, blackjackValue, RANKS } from '@/lib/deck';
import { PlayingCard } from '@/components/PlayingCard';
import type { Room, Player, Card, HoldemStage, Rank, GeneratedGameConfig, DealPlan } from '@/types';

type PendingMode = 'freeplay' | 'blackjack' | 'holdem' | 'gofish';

export function Game() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
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
  const allBlackjackDone = !!game?.showBlackjackControls
    && orderedPlayers.length > 0
    && orderedPlayers.every(p => p.is_standing);

  function appendLog(current: string[] | null | undefined, entry: string): string[] {
    return [...(current ?? []), entry].slice(-30);
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
      let log = freshRoom.action_log ?? [];
      while (blackjackValue(hand) < 17 && deck.length > 0) {
        const [drawn, ...rest] = deck;
        deck = rest;
        hand = [...hand, { ...drawn, faceUp: true }];
        const value = blackjackValue(hand);
        log = appendLog(log, value > 21 ? `${bot.name} hit and busted with ${value}` : `${bot.name} hit — now at ${value}`);
        await Promise.all([
          supabase.from('rooms').update({ deck, action_log: log }).eq('id', room.id),
          supabase.from('players').update({ hand }).eq('id', bot.id),
        ]);
      }
      const finalValue = blackjackValue(hand);
      if (finalValue <= 21) log = appendLog(log, `${bot.name} stood on ${finalValue}`);
      const nextTurn = nextPlayerInOrder(orderedPlayers, bot.id);
      await Promise.all([
        supabase.from('players').update({ is_standing: true }).eq('id', bot.id),
        supabase.from('rooms').update({ current_turn: nextTurn, action_log: log }).eq('id', room.id),
      ]);
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
      hand = [...hand, { ...drawn, faceUp: true }];
    } else if (deck.length > 0) {
      const [drawn, ...rest] = deck;
      deck = rest;
      hand = [...hand, drawn];
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
    await Promise.all([
      supabase.from('players').update({ hand }).eq('id', bot.id),
      supabase.from('rooms').update({
        deck, discard_pile: discardPile, community_cards: communityCards, current_turn: nextTurn,
      }).eq('id', room.id),
    ]);
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
        turnBased,
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

  // --- Actions ---

  async function drawFromDeck() {
    if (!room || !myPlayer || room.deck.length === 0) return setActionError('No cards left in the deck.');
    setActionError('');
    const [drawn, ...remainingDeck] = room.deck;
    const newHand = [...myPlayer.hand, drawn];

    if (game?.showBlackjackControls) {
      const value = blackjackValue(newHand);
      const busted = value > 21;
      const roomUpdate: Record<string, unknown> = {
        deck: remainingDeck,
        action_log: appendLog(room.action_log, busted
          ? `${myPlayer.name} hit and busted with ${value}`
          : `${myPlayer.name} hit — now at ${value}`),
      };
      if (busted) roomUpdate.current_turn = nextPlayerInOrder(orderedPlayers, myPlayerId ?? null);
      await Promise.all([
        supabase.from('rooms').update(roomUpdate).eq('id', room.id),
        supabase.from('players').update({ hand: newHand, is_standing: busted }).eq('id', myPlayer.id),
      ]);
      return;
    }

    await Promise.all([
      supabase.from('rooms').update({ deck: remainingDeck }).eq('id', room.id),
      supabase.from('players').update({ hand: newHand }).eq('id', myPlayer.id),
    ]);
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
  }

  async function stand() {
    if (!room || !myPlayer) return;
    setActionError('');
    const nextTurn = nextPlayerInOrder(orderedPlayers, myPlayerId ?? null);
    const roomUpdate: Record<string, unknown> = { current_turn: nextTurn };
    if (game?.showBlackjackControls) {
      roomUpdate.action_log = appendLog(room.action_log, `${myPlayer.name} stood on ${blackjackValue(myPlayer.hand)}`);
    }
    await Promise.all([
      supabase.from('players').update({ is_standing: true }).eq('id', myPlayer.id),
      supabase.from('rooms').update(roomUpdate).eq('id', room.id),
    ]);
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

  function TurnBadge() {
    if (!game?.turnBased) return null;
    const turningPlayer = orderedPlayers.find(p => p.id === room?.current_turn);
    if (!turningPlayer) return null;
    const label = turningPlayer.id === myPlayerId ? 'Your turn' : `${turningPlayer.name}'s turn`;
    return (
      <div className={`text-xs font-semibold px-3 py-1 rounded-full ${isMyTurn ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/60'}`}>
        {label}
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
    <div className="min-h-screen flex flex-col bg-emerald-950 safe-top safe-bottom">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/20 border-b border-white/10">
        <div>
          <span className="text-white/50 text-xs">Room </span>
          <span className="text-white font-bold tracking-widest">{code}</span>
        </div>
        <div className="flex items-center gap-2">
          <TurnBadge />
          <button onClick={() => setShowInstructions(v => !v)} className="text-white/40 hover:text-white text-xs">
            Rules
          </button>
          {isDealer && (
            <button onClick={openSettings} className="text-white/40 hover:text-white text-xs">
              Settings
            </button>
          )}
        </div>
        <div className="text-right">
          <span className="text-emerald-400 font-semibold text-sm">{room?.game_name}</span>
          <div className="text-white/40 text-xs">{room?.deck.length ?? 0} cards left</div>
        </div>
      </div>

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
        <div className="mx-4 mt-3 bg-amber-900/30 border border-amber-700/40 rounded-xl px-4 py-3">
          <p className="text-amber-300 text-xs font-bold uppercase tracking-wide mb-2">Round Results</p>
          <div className="flex flex-col gap-1">
            {orderedPlayers.slice(1).map(p => {
              const value = blackjackValue(p.hand);
              const dealerValue = blackjackValue(dealer.hand);
              const outcome = blackjackOutcome(value, dealerValue);
              const label = outcome === 'win' ? 'Win' : outcome === 'lose' ? (value > 21 ? 'Bust' : 'Lose') : 'Push';
              const color = outcome === 'win' ? 'text-emerald-400' : outcome === 'lose' ? 'text-red-400' : 'text-white/60';
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
        </div>
      )}

      {/* Blackjack: action history */}
      {game?.showBlackjackControls && (room?.action_log?.length ?? 0) > 0 && (
        <div className="mx-4 mt-3 bg-black/20 border border-white/10 rounded-xl px-3 py-2 max-h-28 overflow-y-auto">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-1">Action History</p>
          <div className="flex flex-col gap-0.5">
            {room!.action_log.map((entry, i) => (
              <p key={i} className="text-white/60 text-xs">{entry}</p>
            ))}
          </div>
        </div>
      )}

      {/* Other players */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
          {otherPlayers.map(player => {
            const isTurn = room?.current_turn === player.id;
            return (
              <div key={player.id}
                className={`shrink-0 bg-white/5 border rounded-xl px-3 py-2 min-w-24
                  ${isTurn ? 'border-emerald-500/60 bg-emerald-900/30' : 'border-white/10'}`}
              >
                <div className="flex items-center gap-1 mb-2">
                  {isTurn && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                  <span className="text-white text-xs font-semibold truncate max-w-20">{player.name}</span>
                  {player.id === dealer?.id && <span className="text-amber-400 text-xs">★</span>}
                </div>
                {player.hand.length > 0 ? (
                  <div className="flex gap-1">
                    {player.hand.slice(0, 4).map((card, i) => (
                      <PlayingCard key={card.id + i} card={card} size="sm" />
                    ))}
                    {player.hand.length > 4 && (
                      <div className="w-9 h-14 flex items-center justify-center text-white/40 text-xs">
                        +{player.hand.length - 4}
                      </div>
                    )}
                  </div>
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

      {/* Table area */}
      <div className="flex-1 px-4 py-2">
        {/* Community / table cards */}
        {(room?.community_cards.length ?? 0) > 0 && (
          <div className="mb-3">
            <p className="text-white/40 text-xs mb-2">Table</p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {room!.community_cards.map((card, i) => (
                <PlayingCard key={card.id + i} card={card} size="md" />
              ))}
            </div>
          </div>
        )}

        {/* Deck + Discard piles */}
        <div className="flex gap-4 items-center">
          {/* Draw pile */}
          <button
            onClick={canAct ? drawFromDeck : undefined}
            disabled={!canAct || (room?.deck.length ?? 0) === 0}
            className="flex flex-col items-center gap-1 disabled:opacity-40"
          >
            <div className={`w-14 h-20 rounded-lg border-2 border-blue-600 bg-blue-800 flex items-center justify-center shadow-lg
              ${canAct && (room?.deck.length ?? 0) > 0 ? 'hover:border-blue-400 cursor-pointer' : 'cursor-default'}
              card-back-pattern`}
            >
              <span className="text-white/40 text-xs font-bold">{room?.deck.length ?? 0}</span>
            </div>
            <span className="text-white/40 text-xs">Draw</span>
          </button>

          {/* Discard pile / draw from discard */}
          <div className="flex flex-col items-center gap-1">
            {topDiscard ? (
              <div onClick={game?.canDrawFromDiscard && canAct ? drawFromDiscard : undefined}
                className={game?.canDrawFromDiscard && canAct ? 'cursor-pointer' : 'cursor-default'}>
                <PlayingCard card={topDiscard} size="md" />
              </div>
            ) : (
              <div className="w-14 h-20 rounded-lg border-2 border-dashed border-white/20 flex items-center justify-center">
                <span className="text-white/20 text-xs">Empty</span>
              </div>
            )}
            <span className="text-white/40 text-xs">
              {game?.canDrawFromDiscard && canAct ? 'Tap to draw' : 'Discard'}
            </span>
          </div>
        </div>
      </div>

      {/* Error message */}
      {actionError && (
        <div className="px-4 pb-1">
          <p className="text-red-400 text-xs bg-red-900/30 border border-red-700/30 rounded-lg px-3 py-1.5">{actionError}</p>
        </div>
      )}

      {/* Your hand */}
      <div className="border-t border-white/10 bg-black/20 px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-white/60 text-xs font-medium">Your hand · {myPlayer?.name}</p>
          {myPlayer?.is_standing && game?.showBlackjackControls && (
            <span className={`text-xs font-semibold ${blackjackValue(myPlayer.hand) > 21 ? 'text-red-400' : 'text-amber-400'}`}>
              {blackjackValue(myPlayer.hand) > 21 ? 'BUSTED' : 'STANDING'}
            </span>
          )}
        </div>
        {(myPlayer?.hand.length ?? 0) > 0 ? (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 pt-1">
            {myPlayer!.hand.map(card => (
              <PlayingCard
                key={card.id}
                card={card}
                isOwner
                selected={selectedCardId === card.id}
                size="lg"
                onClick={() => {
                  setSelectedCardId(prev => prev === card.id ? null : card.id);
                  setActionError('');
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-white/30 text-sm py-3">No cards in hand</p>
        )}
      </div>

      {/* Action bar */}
      <div className="px-4 py-3 bg-black/30 border-t border-white/10 safe-bottom">
        {game?.showBlackjackControls ? (
          !myPlayer?.is_standing ? (
            // Blackjack controls
            <div className="flex gap-2">
              <button
                onClick={canAct ? drawFromDeck : undefined}
                disabled={!canAct}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors"
              >
                Hit
              </button>
              <button
                onClick={canAct ? stand : undefined}
                disabled={!canAct}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors"
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
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
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
              className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Ask for Rank
            </button>
          </div>
        ) : (
          // Default controls
          <div className="flex gap-2">
            <button
              onClick={selectedCard && canAct ? playToTable : undefined}
              disabled={!selectedCard || !canAct}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Play to Table
            </button>
            <button
              onClick={selectedCard && canAct ? discardSelected : undefined}
              disabled={!selectedCard || !canAct}
              className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Discard
            </button>
          </div>
        )}

        {!canAct && game?.turnBased && !(game?.showBlackjackControls && myPlayer?.is_standing) && (
          <p className="text-white/30 text-xs text-center mt-2">Wait for your turn…</p>
        )}
        {!selectedCard && canAct && !game?.showBlackjackControls && !game?.isGoFishLike && (
          <p className="text-white/30 text-xs text-center mt-2">Tap a card to select it</p>
        )}
      </div>

      {/* Go Fish: Ask dialog */}
      {showAskDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={() => setShowAskDialog(false)}>
          <div className="bg-emerald-900 border border-emerald-700 rounded-t-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg mb-4">Ask for a card</h3>
            <div className="mb-4">
              <label className="text-white/60 text-sm mb-1 block">Ask player</label>
              <select value={askTargetId} onChange={e => setAskTargetId(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none">
                {otherPlayers.map(p => <option key={p.id} value={p.id} className="bg-emerald-950">{p.name}</option>)}
              </select>
            </div>
            <div className="mb-6">
              <label className="text-white/60 text-sm mb-1 block">For rank</label>
              <div className="flex flex-wrap gap-2">
                {(['A','2','3','4','5','6','7','8','9','10','J','Q','K'] as Rank[]).map(r => (
                  <button key={r} onClick={() => setAskRank(r)}
                    className={`px-3 py-2 rounded-lg font-bold text-sm transition-colors
                      ${askRank === r ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAskDialog(false)} className="flex-1 bg-white/10 text-white py-3 rounded-xl font-semibold">Cancel</button>
              <button onClick={executeGoFishAsk} className="flex-1 bg-emerald-500 text-white py-3 rounded-xl font-bold">Ask!</button>
            </div>
          </div>
        </div>
      )}

      {/* Dealer: Game Settings panel */}
      {showSettings && pendingConfig && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-emerald-900 border border-emerald-700 rounded-t-2xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg mb-4">Game Settings</h3>

            <div className="mb-4">
              <label className="text-white/60 text-sm mb-1 block">Name</label>
              <input
                value={pendingConfig.name}
                onChange={e => updateField('name', e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none"
              />
            </div>

            <div className="mb-4">
              <label className="text-white/60 text-sm mb-1 block">Mode</label>
              <select
                value={pendingMode}
                onChange={e => applyModeChange(e.target.value as PendingMode)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none appearance-none"
              >
                <option value="freeplay" className="bg-emerald-950">Free play (play/discard)</option>
                <option value="blackjack" className="bg-emerald-950">Blackjack (hit/stand)</option>
                <option value="holdem" className="bg-emerald-950">Hold'em (community cards)</option>
                <option value="gofish" className="bg-emerald-950">Go Fish (ask for cards)</option>
              </select>
            </div>

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
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none"
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
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="text-white/60 text-sm mb-1 block">Max players</label>
                <input
                  type="number" min={1}
                  value={pendingConfig.maxPlayers}
                  onChange={e => updateField('maxPlayers', Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-white/60 text-sm mb-1 block">Instructions</label>
              <textarea
                value={pendingConfig.instructions}
                onChange={e => updateField('instructions', e.target.value)}
                rows={3}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none text-sm"
              />
            </div>

            <div className="mb-4 border-t border-white/10 pt-4">
              <label className="text-white/60 text-sm mb-1 block">Describe a change</label>
              <input
                value={featurePrompt}
                onChange={e => setFeaturePrompt(e.target.value)}
                placeholder="e.g. add jokers as wild cards"
                maxLength={200}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none"
              />
              <button
                onClick={amendWithAI}
                disabled={amending || !featurePrompt.trim()}
                className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
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
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none"
              />
              <button
                onClick={saveToLibrary}
                disabled={saving || !saveName.trim()}
                className="w-full mt-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                {saving ? 'Saving…' : 'Save to Library'}
              </button>
            </div>

            {settingsError && (
              <p className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2 mb-4">{settingsError}</p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setShowSettings(false)} className="flex-1 bg-white/10 text-white py-3 rounded-xl font-semibold">
                Cancel
              </button>
              <button
                onClick={dealAgain}
                disabled={redealing}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 py-3 rounded-xl font-bold"
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
