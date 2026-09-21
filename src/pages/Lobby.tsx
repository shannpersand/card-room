import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, getErrorMessage, getEdgeFunctionErrorMessage } from '@/lib/supabase';
import { getGame, GAMES, dealGame, type GameConfig } from '@/lib/games';
import type { Room, Player, GeneratedGameConfig, SavedGame } from '@/types';

export function Lobby() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedGameId, setSelectedGameId] = useState('blackjack');
  const [loading, setLoading] = useState(true);
  const [dealing, setDealing] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'preset' | 'custom' | 'saved'>('preset');
  const [gamePrompt, setGamePrompt] = useState('');
  const [designing, setDesigning] = useState(false);
  const [draftConfig, setDraftConfig] = useState<GeneratedGameConfig | null>(null);
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<string, string>>({});
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [savedGamesLoading, setSavedGamesLoading] = useState(false);
  const [selectedSavedId, setSelectedSavedId] = useState('');

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
      if (fnError) {
        throw new Error(await getEdgeFunctionErrorMessage(fnError, 'Failed to design game. Try again, or pick a preset instead.'));
      }
      if (data?.error) throw new Error(data.error);
      setDraftConfig(data as GeneratedGameConfig);
      setClarifyingAnswers({});
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to design game. Try again, or pick a preset instead.'));
    } finally {
      setDesigning(false);
    }
  }

  async function switchToSavedMode() {
    setMode('saved');
    setError('');
    if (savedGames.length > 0) return;
    setSavedGamesLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from('saved_games').select('*').order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      const loaded = (data as SavedGame[]) ?? [];
      setSavedGames(loaded);
      setSelectedSavedId(loaded[0]?.id ?? '');
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to load saved games.'));
    } finally {
      setSavedGamesLoading(false);
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
      mode !== 'preset' ? draftConfig ?? undefined : getGame(selectedGameId);
    if (!game) return;
    if (mode !== 'preset' && draftConfig && draftConfig.clarifyingOptions.length > 0) return;

    if (activePlayersOrdered.length < game.minPlayers) {
      return setError(`${game.name} needs at least ${game.minPlayers} players.`);
    }
    if (activePlayersOrdered.length > game.maxPlayers) {
      return setError(`${game.name} supports at most ${game.maxPlayers} players.`);
    }

    setDealing(true);
    setError('');
    try {
      await dealGame(room, game, activePlayersOrdered);
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
    <div className="min-h-screen flex flex-col sm:flex-row safe-top safe-bottom">
      {/* Left column: room code + player list */}
      <div className="p-6 sm:flex-1 sm:flex sm:flex-col sm:gap-10 sm:px-10 sm:py-12 md:px-16">
        {/* Room code header */}
        <div className="text-center sm:text-left mb-8 sm:mb-0">
          <p className="text-app-label text-sm font-medium mb-1">Room Code</p>
          <button
            onClick={copyCode}
            className="font-display text-5xl tracking-[0.2em] text-white hover:text-app-label transition-colors"
          >
            {code}
          </button>
          <p className="text-white/40 text-xs mt-1">Tap to copy · Share with friends</p>
        </div>

        {/* Player list */}
        <div className="flex-1">
          <p className="text-app-label text-sm font-medium mb-3">
            Players ({activePlayersOrdered.length})
          </p>
          <div className="flex flex-col gap-2">
            {activePlayersOrdered.map((player, idx) => (
              <div key={player.id}
                className={`flex items-center gap-3 px-4 py-3 rounded border
                  ${player.id === myPlayerId
                    ? 'bg-app-panel/50 border-app-primary/50'
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
            <p className="text-white/40 text-sm text-center sm:text-left mt-6">
              Waiting for at least one more player to join…
            </p>
          )}
        </div>
      </div>

      {/* Right column: dealer controls, centered in a panel on desktop */}
      <div className="p-6 sm:flex-1 sm:flex sm:items-center sm:justify-center sm:p-10">
      {isDealer ? (
        <div className="mt-6 sm:mt-0 flex flex-col gap-4 sm:w-full sm:max-w-[440px] sm:bg-white/5 sm:border sm:border-white/10 sm:rounded-xl sm:p-8">
          {/* Preset vs. AI-designed mode toggle */}
          <div className="flex gap-1 bg-white/5 border border-white/10 rounded p-1">
            <button
              onClick={() => { setMode('preset'); setError(''); }}
              className={`flex-1 py-2 rounded text-sm font-semibold transition-colors
                ${mode === 'preset' ? 'bg-app-primary text-white' : 'text-white/50 hover:text-white'}`}
            >
              Choose a game
            </button>
            <button
              onClick={() => { setMode('custom'); setError(''); }}
              className={`flex-1 py-2 rounded text-sm font-semibold transition-colors
                ${mode === 'custom' ? 'bg-app-primary text-white' : 'text-white/50 hover:text-white'}`}
            >
              Describe a game
            </button>
            <button
              onClick={switchToSavedMode}
              className={`flex-1 py-2 rounded text-sm font-semibold transition-colors
                ${mode === 'saved' ? 'bg-app-primary text-white' : 'text-white/50 hover:text-white'}`}
            >
              Saved Games
            </button>
          </div>

          {mode === 'preset' ? (
            <>
              <div>
                <label className="block text-sm text-app-label mb-2 font-medium">Choose a game</label>
                <select
                  value={selectedGameId}
                  onChange={e => { setSelectedGameId(e.target.value); setError(''); }}
                  className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-app-primaryLighter text-base appearance-none"
                >
                  {GAMES.map(g => (
                    <option key={g.id} value={g.id} className="bg-app-bg text-white">
                      {g.name} — {g.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Game instructions preview */}
              <div className="bg-white/5 border border-white/10 rounded px-4 py-3">
                <p className="text-white/50 text-xs">{getGame(selectedGameId)?.instructions}</p>
              </div>
            </>
          ) : mode === 'saved' ? (
            !draftConfig ? (
              <div>
                <label className="block text-sm text-app-label mb-2 font-medium">Pick a saved game</label>
                {savedGamesLoading ? (
                  <p className="text-white/40 text-sm">Loading…</p>
                ) : savedGames.length === 0 ? (
                  <p className="text-white/40 text-sm">
                    No saved games yet. Save one from the settings panel during a game, then it'll show up here.
                  </p>
                ) : (
                  <>
                    <select
                      value={selectedSavedId}
                      onChange={e => setSelectedSavedId(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-app-primaryLighter text-base appearance-none"
                    >
                      {savedGames.map(sg => (
                        <option key={sg.id} value={sg.id} className="bg-app-bg text-white">{sg.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const chosen = savedGames.find(sg => sg.id === selectedSavedId) ?? savedGames[0];
                        if (chosen) setDraftConfig(chosen.config);
                      }}
                      className="w-full mt-3 bg-app-primary hover:bg-app-primaryLight text-white font-semibold py-3 rounded transition-colors"
                    >
                      Load
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="bg-white/5 border border-white/10 rounded px-4 py-3">
                  <p className="text-white font-semibold mb-1">{draftConfig.name}</p>
                  <p className="text-white/50 text-xs">{draftConfig.instructions}</p>
                </div>
                <button
                  onClick={() => setDraftConfig(null)}
                  className="text-white/40 hover:text-white text-xs self-start"
                >
                  ← Choose a different saved game
                </button>
              </div>
            )
          ) : !draftConfig ? (
            <div>
              <label className="block text-sm text-app-label mb-2 font-medium">What do you want to play?</label>
              <input
                className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-app-primaryLighter"
                placeholder="e.g. Egyptian Ratscrew, a simple matching game for kids…"
                value={gamePrompt}
                maxLength={200}
                onChange={e => setGamePrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && designGame()}
              />
              <button
                onClick={designGame}
                disabled={designing || !gamePrompt.trim()}
                className="w-full mt-3 bg-app-primary hover:bg-app-primaryLight disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded transition-colors"
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
                  <label className="block text-sm text-app-label mb-1 font-medium">{option.label}</label>
                  <select
                    value={clarifyingAnswers[option.key] ?? option.choices[0]?.value ?? ''}
                    onChange={e => setClarifyingAnswers(prev => ({ ...prev, [option.key]: e.target.value }))}
                    className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-white focus:outline-none appearance-none"
                  >
                    {option.choices.map(choice => (
                      <option key={choice.value} value={choice.value} className="bg-app-bg text-white">
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <button
                onClick={applyClarifyingAnswers}
                className="w-full bg-app-primary hover:bg-app-primaryLight text-white font-semibold py-3 rounded transition-colors"
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
              <div className="bg-white/5 border border-white/10 rounded px-4 py-3">
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
            <p className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded px-4 py-2">{error}</p>
          )}

          <button
            onClick={startGame}
            disabled={dealing || activePlayersOrdered.length < 2 || (mode !== 'preset' && (!draftConfig || draftConfig.clarifyingOptions.length > 0))}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-amber-950 font-bold py-4 rounded text-lg transition-colors"
          >
            {dealing ? 'Dealing cards…' : 'Deal Cards'}
          </button>
          <p className="text-white/30 text-xs text-center">You are the dealer. Only you can start the game.</p>
        </div>
      ) : (
        <div className="mt-6 sm:mt-0 bg-white/5 border border-white/10 rounded px-4 py-4 text-center sm:w-full sm:max-w-[440px] sm:px-8 sm:py-8">
          <p className="text-white/60">Waiting for <span className="text-white font-semibold">{dealer?.name ?? 'the dealer'}</span> to start the game…</p>
        </div>
      )}
      </div>
    </div>
  );
}
