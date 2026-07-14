import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { resolveGame } from '@/lib/games';
import { nextPlayerInOrder } from '@/lib/deck';
import { PlayingCard } from '@/components/PlayingCard';
import type { Room, Player, HoldemStage, Rank } from '@/types';

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

  // --- Actions ---

  async function drawFromDeck() {
    if (!room || !myPlayer || room.deck.length === 0) return setActionError('No cards left in the deck.');
    setActionError('');
    const [drawn, ...remainingDeck] = room.deck;
    const newHand = [...myPlayer.hand, drawn];
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
    await Promise.all([
      supabase.from('players').update({ is_standing: true }).eq('id', myPlayer.id),
      supabase.from('rooms').update({ current_turn: nextTurn }).eq('id', room.id),
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
                  <div className="text-amber-400 text-xs mt-1 font-semibold">STAND</div>
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
            <span className="text-amber-400 text-xs font-semibold">STANDING</span>
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
        {game?.showBlackjackControls && !myPlayer?.is_standing ? (
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

        {!canAct && game?.turnBased && (
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
    </div>
  );
}
