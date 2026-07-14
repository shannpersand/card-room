import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, getErrorMessage } from '@/lib/supabase';
import { getGame, GAMES, dealFromGeneratedConfig, type GameConfig } from '@/lib/games';
import type { Room, Player, GeneratedGameConfig } from '@/types';

export function Lobby() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedGameId, setSelectedGameId] = useState('texas-holdem');
  const [loading, setLoading] = useState(true);
  const [dealing, setDealing] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [gamePrompt, setGamePrompt] = useState('');
  const [designing, setDesigning] = useState(false);
  const [draftConfig, setDraftConfig] = useState<GeneratedGameConfig | null>(null);
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<string, string>>({});

  const myPlayerId = localStorage.getItem('cardroom_player_id');

  const activePlayersOrdered = players
    .filter(p => p.is_active)
    .sort((a, b) => a.seat_order - b.seat_order);

  const dealer = activePlayersOrdered[0];
  const isDealer = dealer?.id === myPlayerId;

  const load = useCallback(async () => {
    if (!code) return;
    const { data: roomData } = await supabase.from('rooms').select('*').eq('code', code).maybeSingle();
    if (!roomData) { navigate('/'); return; }
    setRoom(roomData as Room);

    const { data: playersData } = await supabase
      .from('players').select('*').eq('room_id', roomData.id).order('seat_order');
    setPlayers((playersData as Player[]) ?? []);
    setLoading(false);
  }, [code, navigate]);

  useEffect(() => { load(); }, [load]);

  // Heartbeat: mark player as active
  useEffect(() => {
    if (!myPlayerId) return;
    const interval = setInterval(() => {
      supabase.from('players').update({ last_seen: new Date().toISOString(), is_active: true }).eq('id', myPlayerId);
    }, 10000);
    return () => clearInterval(interval);
  }, [myPlayerId]);

  // Real-time subscriptions
  useEffect(() => {
    if (!room?.id) return;
    const channel = supabase
      .channel(`lobby-${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Room;
            setRoom(updated);
            if (updated.state === 'playing') navigate(`/game/${code}`);
          }
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setPlayers(prev => [...prev, payload.new as Player].sort((a, b) => a.seat_order - b.seat_order));
          else if (payload.eventType === 'UPDATE') setPlayers(prev => prev.map(p => p.id === payload.new.id ? payload.new as Player : p));
          else if (payload.eventType === 'DELETE') setPlayers(prev => prev.filter(p => p.id !== (payload.old as Player).id));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room?.id, code, navigate]);

  async function designGame() {
    const prompt = gamePrompt.trim();
    if (!prompt) return;
    setDesigning(true);
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('design-game', {
        body: { prompt, playerCount: activePlayersOrdered.length },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setDraftConfig(data as GeneratedGameConfig);
      setClarifyingAnswers({});
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to design game. Try again, or pick a preset instead.'));
    } finally {
      setDesigning(false);
    }
  }

  function applyClarifyingAnswers() {
    if (!draftConfig) return;
    const updated: GeneratedGameConfig = {
      ...draftConfig,
      dealPlan: { ...draftConfig.dealPlan },
      clarifyingOptions: [],
    };
    for (const option of draftConfig.clarifyingOptions) {
      const value = clarifyingAnswers[option.key] ?? option.choices[0]?.value;
      if (value === undefined) continue;
      switch (option.key) {
        case 'cardsPerPlayer': updated.dealPlan.cardsPerPlayer = Number(value); break;
        case 'discardPileStart': updated.dealPlan.discardPileStart = value === 'true'; break;
        case 'handFaceUp': updated.dealPlan.handFaceUp = value === 'true'; break;
        case 'splitEntireDeck': updated.dealPlan.splitEntireDeck = value === 'true'; break;
        case 'canDrawFromDiscard': updated.canDrawFromDiscard = value === 'true'; break;
        case 'turnBased': updated.turnBased = value === 'true'; break;
        case 'minPlayers': updated.minPlayers = Number(value); break;
        case 'maxPlayers': updated.maxPlayers = Number(value); break;
      }
    }
    setDraftConfig(updated);
    setClarifyingAnswers({});
  }

  async function startGame() {
    if (!room || !isDealer) return;
    const game: GameConfig | GeneratedGameConfig | undefined =
      mode === 'custom' ? draftConfig ?? undefined : getGame(selectedGameId);
    if (!game) return;
    if (mode === 'custom' && draftConfig && draftConfig.clarifyingOptions.length > 0) return;

    if (activePlayersOrdered.length < game.minPlayers) {
      return setError(`${game.name} needs at least ${game.minPlayers} players.`);
    }
    if (activePlayersOrdered.length > game.maxPlayers) {
      return setError(`${game.name} supports at most ${game.maxPlayers} players.`);
    }

    setDealing(true);
    setError('');
    try {
      const { hands, communityCards, discardPile, remainingDeck } =
        mode === 'custom'
          ? dealFromGeneratedConfig(game as GeneratedGameConfig, activePlayersOrdered.length)
          : (game as GameConfig).deal(activePlayersOrdered.length);
      const firstTurnId = game.turnBased
        ? activePlayersOrdered[game.showBlackjackControls ? 1 : 0]?.id ?? null
        : null;

      // Update each player's hand
      for (let i = 0; i < activePlayersOrdered.length; i++) {
        await supabase.from('players')
          .update({ hand: hands[i], is_standing: false })
          .eq('id', activePlayersOrdered[i].id);
      }

      // Update room state to playing
      await supabase.from('rooms').update({
        game_id: mode === 'custom' ? 'custom' : (game as GameConfig).id,
        game_name: game.name,
        state: 'playing',
        deck: remainingDeck,
        community_cards: communityCards,
        discard_pile: discardPile,
        current_turn: firstTurnId,
        holdem_stage: game.showHoldemControls ? 'preflop' : null,
        custom_game: mode === 'custom' ? (game as GeneratedGameConfig) : null,
      }).eq('id', room.id);
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to start game. Please try again.'));
    } finally {
      setDealing(false);
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(code ?? '').catch(() => {});
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/60 text-lg">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-6 safe-top safe-bottom">
      {/* Room code header */}
      <div className="text-center mb-8">
        <p className="text-emerald-400 text-sm font-medium mb-1">Room Code</p>
        <button
          onClick={copyCode}
          className="text-5xl font-bold tracking-[0.2em] text-white hover:text-emerald-300 transition-colors"
        >
          {code}
        </button>
        <p className="text-white/40 text-xs mt-1">Tap to copy · Share with friends</p>
      </div>

      {/* Player list */}
      <div className="flex-1">
        <p className="text-emerald-400 text-sm font-medium mb-3">
          Players ({activePlayersOrdered.length})
        </p>
        <div className="flex flex-col gap-2">
          {activePlayersOrdered.map((player, idx) => (
            <div key={player.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border
                ${player.id === myPlayerId
                  ? 'bg-emerald-900/50 border-emerald-600/50'
                  : 'bg-white/5 border-white/10'}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                ${idx === 0 ? 'bg-amber-500 text-amber-950' : 'bg-white/20'}`}
              >
                {idx === 0 ? '★' : idx + 1}
              </div>
              <div className="flex-1">
                <span className="font-semibold">{player.name}</span>
                {player.id === myPlayerId && <span className="text-white/40 text-xs ml-2">(you)</span>}
              </div>
              {idx === 0 && (
                <span className="text-amber-400 text-xs font-semibold uppercase tracking-wide">Dealer</span>
              )}
            </div>
          ))}
        </div>

        {activePlayersOrdered.length < 2 && (
          <p className="text-white/40 text-sm text-center mt-6">
            Waiting for at least one more player to join…
          </p>
        )}
      </div>

      {/* Dealer controls */}
      {isDealer ? (
        <div className="mt-6 flex flex-col gap-4">
          {/* Preset vs. AI-designed mode toggle */}
          <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <button
              onClick={() => { setMode('preset'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
                ${mode === 'preset' ? 'bg-emerald-600 text-white' : 'text-white/50 hover:text-white'}`}
            >
              Choose a game
            </button>
            <button
              onClick={() => { setMode('custom'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
                ${mode === 'custom' ? 'bg-emerald-600 text-white' : 'text-white/50 hover:text-white'}`}
            >
              Describe a game
            </button>
          </div>

          {mode === 'preset' ? (
            <>
              <div>
                <label className="block text-sm text-emerald-300 mb-2 font-medium">Choose a game</label>
                <select
                  value={selectedGameId}
                  onChange={e => { setSelectedGameId(e.target.value); setError(''); }}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 text-base appearance-none"
                >
                  {GAMES.map(g => (
                    <option key={g.id} value={g.id} className="bg-emerald-950 text-white">
                      {g.name} — {g.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Game instructions preview */}
              <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <p className="text-white/50 text-xs">{getGame(selectedGameId)?.instructions}</p>
              </div>
            </>
          ) : !draftConfig ? (
            <div>
              <label className="block text-sm text-emerald-300 mb-2 font-medium">What do you want to play?</label>
              <input
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                placeholder="e.g. Egyptian Ratscrew, a simple matching game for kids…"
                value={gamePrompt}
                maxLength={200}
                onChange={e => setGamePrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && designGame()}
              />
              <button
                onClick={designGame}
                disabled={designing || !gamePrompt.trim()}
                className="w-full mt-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {designing ? 'Designing game…' : 'Design Game'}
              </button>
            </div>
          ) : draftConfig.clarifyingOptions.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-white/60 text-sm">
                A couple questions about <span className="text-white font-semibold">{draftConfig.name}</span>:
              </p>
              {draftConfig.clarifyingOptions.map(option => (
                <div key={option.key}>
                  <label className="block text-sm text-emerald-300 mb-1 font-medium">{option.label}</label>
                  <select
                    value={clarifyingAnswers[option.key] ?? option.choices[0]?.value ?? ''}
                    onChange={e => setClarifyingAnswers(prev => ({ ...prev, [option.key]: e.target.value }))}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none appearance-none"
                  >
                    {option.choices.map(choice => (
                      <option key={choice.value} value={choice.value} className="bg-emerald-950 text-white">
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <button
                onClick={applyClarifyingAnswers}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => { setDraftConfig(null); setClarifyingAnswers({}); }}
                className="text-white/40 hover:text-white text-xs self-start"
              >
                ← Start over
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <p className="text-white font-semibold mb-1">{draftConfig.name}</p>
                <p className="text-white/50 text-xs">{draftConfig.instructions}</p>
              </div>
              <button
                onClick={() => { setDraftConfig(null); setGamePrompt(''); }}
                className="text-white/40 hover:text-white text-xs self-start"
              >
                ← Describe a different game
              </button>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2">{error}</p>
          )}

          <button
            onClick={startGame}
            disabled={dealing || activePlayersOrdered.length < 2 || (mode === 'custom' && (!draftConfig || draftConfig.clarifyingOptions.length > 0))}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-amber-950 font-bold py-4 rounded-xl text-lg transition-colors"
          >
            {dealing ? 'Dealing cards…' : 'Deal Cards'}
          </button>
          <p className="text-white/30 text-xs text-center">You are the dealer. Only you can start the game.</p>
        </div>
      ) : (
        <div className="mt-6 bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-center">
          <p className="text-white/60">Waiting for <span className="text-white font-semibold">{dealer?.name ?? 'the dealer'}</span> to start the game…</p>
        </div>
      )}
    </div>
  );
}
