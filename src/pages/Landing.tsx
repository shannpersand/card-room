import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getErrorMessage } from '@/lib/supabase';
import { generateRoomCode } from '@/lib/deck';
import { generateFunName } from '@/lib/names';
import { useTheme } from '@/lib/ThemeContext';
import { THEMES, THEME_ORDER } from '@/lib/themes';

// Swank
import suitPatternSwank from '@/assets/landing/suit-group.svg';
import refreshIconSwank from '@/assets/landing/refresh-icon-swank.svg';
// Goof
import goofTile from '@/assets/landing/goof/tile.svg';
import refreshIconGoof from '@/assets/landing/goof/refresh-icon.svg';
// Heist
import heistBlobSalmonA from '@/assets/landing/heist/blob-salmon-a.svg';
import heistBlobSalmonB from '@/assets/landing/heist/blob-salmon-b.svg';
import heistBlobRustA from '@/assets/landing/heist/blob-rust-a.svg';
import heistBlobRustB from '@/assets/landing/heist/blob-rust-b.svg';
import refreshIconHeist from '@/assets/landing/heist/refresh-icon.svg';
// Oki Toki
import okitokiShapeYellowA from '@/assets/landing/okitoki/shape-yellow-a.svg';
import okitokiShapeYellowB from '@/assets/landing/okitoki/shape-yellow-b.svg';
import okitokiShapeMintA from '@/assets/landing/okitoki/shape-mint-a.svg';
import okitokiShapeMintB from '@/assets/landing/okitoki/shape-mint-b.svg';
import okitokiShapePink from '@/assets/landing/okitoki/shape-pink.svg';
import refreshIconOkitoki from '@/assets/landing/okitoki/refresh-icon.svg';

const REFRESH_ICONS = {
  swank: refreshIconSwank,
  goof: refreshIconGoof,
  heist: refreshIconHeist,
  okitoki: refreshIconOkitoki,
};

/** Per-theme decorative backdrop — each Figma mockup used a structurally different
 * decoration (a tiled diagonal pattern, side columns, scattered oversized blobs, or
 * scattered confetti shapes), so this renders each theme's own layout rather than
 * forcing one generic pattern to fit all four. */
function ThemeBackdrop({ themeKey }: { themeKey: keyof typeof THEMES }) {
  if (themeKey === 'swank') {
    return (
      <div
        className="absolute inset-0 opacity-90 pointer-events-none"
        style={{ backgroundImage: `url(${suitPatternSwank})`, backgroundRepeat: 'repeat', backgroundSize: '300px 431px', backgroundPosition: '-40px -60px' }}
      />
    );
  }
  if (themeKey === 'goof') {
    // The exported asset is one tall 52×964 column that already alternates the three
    // neon colors internally — tiled at its natural size (not stretched) it reproduces
    // the repeating multi-column strip from the mockup.
    return (
      <div
        className="absolute inset-y-0 right-0 w-40 opacity-40 pointer-events-none hidden sm:block"
        style={{
          backgroundImage: `url(${goofTile})`, backgroundRepeat: 'repeat', backgroundSize: '52px 964px',
          maskImage: 'linear-gradient(to left, black 60%, transparent)',
          WebkitMaskImage: 'linear-gradient(to left, black 60%, transparent)',
        }}
      />
    );
  }
  if (themeKey === 'heist') {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden hidden sm:block">
        <img src={heistBlobSalmonA} alt="" className="absolute w-[420px] -top-24 -left-24 rotate-12 opacity-60" />
        <img src={heistBlobRustA} alt="" className="absolute w-[380px] top-1/3 -right-16 rotate-[-18deg] opacity-50" />
        <img src={heistBlobSalmonB} alt="" className="absolute w-[300px] -bottom-20 left-1/4 rotate-45 opacity-40" />
        <img src={heistBlobRustB} alt="" className="absolute w-[260px] bottom-10 right-1/4 rotate-[-30deg] opacity-40" />
      </div>
    );
  }
  // okitoki-scatter
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden hidden sm:block">
      <img src={okitokiShapeYellowA} alt="" className="absolute w-16 top-[8%] left-[6%] rotate-12" />
      <img src={okitokiShapeMintA} alt="" className="absolute w-14 top-[18%] left-[42%] -rotate-12" />
      <img src={okitokiShapePink} alt="" className="absolute w-16 top-[6%] right-[28%] rotate-6" />
      <img src={okitokiShapeMintB} alt="" className="absolute w-12 top-[40%] left-[14%] rotate-[-8deg]" />
      <img src={okitokiShapeYellowB} alt="" className="absolute w-14 bottom-[22%] left-[8%] rotate-[20deg]" />
      <img src={okitokiShapePink} alt="" className="absolute w-12 bottom-[10%] left-[38%] rotate-[-15deg]" />
      <img src={okitokiShapeYellowA} alt="" className="absolute w-14 bottom-[30%] right-[30%] rotate-[10deg]" />
      <img src={okitokiShapeMintA} alt="" className="absolute w-16 bottom-[6%] right-[26%] rotate-[8deg]" />
    </div>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const { themeKey, theme, setTheme } = useTheme();
  const t = theme.landing;
  const [name, setName] = useState(() => localStorage.getItem('cardroom_name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'home' | 'join'>('home');

  const savedName = name.trim();

  async function createRoom() {
    const playerName = savedName || generateFunName();
    if (!savedName) setName(playerName);
    setLoading(true);
    setError('');
    try {
      // Generate a unique code (retry on collision)
      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateRoomCode();
        const { data } = await supabase.from('rooms').select('id').eq('code', candidate).maybeSingle();
        if (!data) { code = candidate; break; }
      }
      if (!code) throw new Error('Could not generate a unique room code. Try again.');

      const { data: room, error: roomErr } = await supabase
        .from('rooms')
        .insert({ code, back_color: theme.backColor })
        .select()
        .single();
      if (roomErr) throw roomErr;

      const { data: player, error: playerErr } = await supabase
        .from('players')
        .insert({ room_id: room.id, name: playerName, seat_order: 0 })
        .select()
        .single();
      if (playerErr) throw playerErr;

      localStorage.setItem('cardroom_name', playerName);
      localStorage.setItem('cardroom_player_id', player.id);
      localStorage.setItem('cardroom_room_code', code);
      navigate(`/lobby/${code}`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function startTestGame() {
    const playerName = savedName || generateFunName();
    if (!savedName) setName(playerName);
    setLoading(true);
    setError('');
    try {
      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateRoomCode();
        const { data } = await supabase.from('rooms').select('id').eq('code', candidate).maybeSingle();
        if (!data) { code = candidate; break; }
      }
      if (!code) throw new Error('Could not generate a unique room code. Try again.');

      const { data: room, error: roomErr } = await supabase
        .from('rooms')
        .insert({ code, back_color: theme.backColor })
        .select()
        .single();
      if (roomErr) throw roomErr;

      const { data: player, error: playerErr } = await supabase
        .from('players')
        .insert({ room_id: room.id, name: playerName, seat_order: 0 })
        .select()
        .single();
      if (playerErr) throw playerErr;

      const { error: botsErr } = await supabase.from('players').insert([
        { room_id: room.id, name: 'Computer 1', seat_order: 1, is_bot: true },
        { room_id: room.id, name: 'Computer 2', seat_order: 2, is_bot: true },
      ]);
      if (botsErr) throw botsErr;

      localStorage.setItem('cardroom_name', playerName);
      localStorage.setItem('cardroom_player_id', player.id);
      localStorage.setItem('cardroom_room_code', code);
      navigate(`/lobby/${code}`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    const playerName = savedName || generateFunName();
    if (!savedName) setName(playerName);
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) return setError('Room code must be 4 characters');
    setLoading(true);
    setError('');
    try {
      const { data: room, error: roomErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code)
        .maybeSingle();
      if (roomErr) throw roomErr;
      if (!room) return setError('Room not found. Check the code and try again.');
      if (room.state === 'playing') return setError('That game has already started.');

      // Check if this player is rejoining
      const existingId = localStorage.getItem('cardroom_player_id');
      if (existingId && localStorage.getItem('cardroom_room_code') === code) {
        const { data: existing } = await supabase
          .from('players')
          .select('id')
          .eq('id', existingId)
          .eq('room_id', room.id)
          .maybeSingle();
        if (existing) {
          await supabase.from('players').update({ is_active: true, last_seen: new Date().toISOString() }).eq('id', existing.id);
          localStorage.setItem('cardroom_name', playerName);
          navigate(`/lobby/${code}`);
          return;
        }
      }

      const { data: existing } = await supabase
        .from('players')
        .select('seat_order')
        .eq('room_id', room.id)
        .order('seat_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSeat = existing ? existing.seat_order + 1 : 0;

      const { data: player, error: playerErr } = await supabase
        .from('players')
        .insert({ room_id: room.id, name: playerName, seat_order: nextSeat })
        .select()
        .single();
      if (playerErr) throw playerErr;

      localStorage.setItem('cardroom_name', playerName);
      localStorage.setItem('cardroom_player_id', player.id);
      localStorage.setItem('cardroom_room_code', code);
      navigate(`/lobby/${code}`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative bg-app-bg overflow-hidden transition-colors">
      <ThemeBackdrop themeKey={themeKey} />

      <div className="relative flex flex-col sm:flex-row sm:min-h-screen">
        {/* Brand column */}
        <div className="flex-1 flex flex-col justify-center px-6 pt-14 pb-10 sm:px-8 sm:py-0 md:px-12 lg:px-16">
          <h1
            className={`font-display ${theme.fontDisplayClass} leading-[0.9] tracking-tight text-[15vw] sm:text-5xl md:text-6xl lg:text-8xl xl:text-[9rem] ${t.multicolorHeading ? '' : t.headingClass}`}
          >
            {t.multicolorHeading
              ? t.multicolorHeading.map(({ word, className }) => (
                  <span key={word} className={className}>{word}</span>
                ))
              : 'The Card Room'}
          </h1>
          <p className={`font-display ${theme.fontDisplayClass} italic ${t.taglineClass} text-xl sm:text-lg md:text-xl lg:text-3xl mt-4 max-w-xl`}>
            Create a room or join one! No app needed, just start winnin’
          </p>
        </div>

        {/* Form card */}
        <div className="w-full sm:w-[300px] md:w-[360px] lg:w-[440px] flex items-center justify-center px-6 pb-14 sm:p-6 md:p-8 lg:p-12">
          <div className={`w-full max-w-sm ${t.panelClass} ${t.radius.panel} shadow-xl p-5 sm:p-5 md:p-7 lg:p-8 transition-colors`}>
            <h2 className={`font-display ${theme.fontDisplayClass} text-app-accent text-3xl sm:text-4xl text-center mb-6`}>Welcome!</h2>

            {mode === 'home' ? (
              <>
                {/* Theme */}
                <div className="mb-4">
                  <p className="text-app-label text-xs font-semibold mb-2">Theme</p>
                  <div className={`flex gap-1 bg-white/5 border border-white/10 p-1 ${t.radius.pillOuter}`}>
                    {THEME_ORDER.map(key => (
                      <button
                        key={key}
                        onClick={() => setTheme(key)}
                        className={`flex-1 py-2 px-0.5 text-[11px] sm:text-xs md:text-sm font-semibold whitespace-nowrap transition-colors ${t.radius.pillInner}
                          ${themeKey === key ? t.pillActiveClass : 'text-white/50 hover:text-white'}`}
                      >
                        {THEMES[key].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Name */}
                <div className="mb-6">
                  <label className="block text-app-label text-xs font-semibold mb-1">Your name is</label>
                  <div className={`flex items-center gap-2 bg-white/10 border border-white/20 px-4 py-3 focus-within:ring-2 focus-within:ring-app-primaryLighter ${t.radius.input}`}>
                    <input
                      className="flex-1 min-w-0 bg-transparent text-white placeholder-white/40 focus:outline-none text-[15px]"
                      placeholder="Enter your name…"
                      value={name}
                      maxLength={20}
                      onChange={e => setName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && createRoom()}
                    />
                    <button
                      type="button"
                      onClick={() => setName(generateFunName())}
                      className="shrink-0 opacity-90 hover:opacity-100 transition-opacity"
                      title="Shuffle a random name"
                      aria-label="Shuffle a random name"
                    >
                      <img src={REFRESH_ICONS[themeKey]} alt="" className="w-3.5 h-[18px]" />
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                  <button
                    onClick={createRoom}
                    disabled={loading}
                    className={`w-full py-4 text-xl md:text-2xl font-display ${theme.fontDisplayClass} tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${t.radius.button} ${t.primaryBtnClass}`}
                  >
                    {loading ? 'Creating…' : 'Create Room'}
                  </button>
                  <button
                    onClick={() => { setMode('join'); setError(''); }}
                    className={`w-full py-4 text-xl md:text-2xl font-display ${theme.fontDisplayClass} tracking-wide transition-colors ${t.radius.button} ${t.secondaryBtnClass}`}
                  >
                    Join a Game
                  </button>
                  <button
                    onClick={startTestGame}
                    disabled={loading}
                    className={`w-full py-2.5 text-xs font-sans font-semibold border border-dashed transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${t.radius.testButton} ${t.testBtnClass}`}
                  >
                    {loading ? 'Setting up…' : 'Start Test Game (vs Computer)'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-app-label text-xs font-semibold mb-1">Room code</label>
                  <input
                    className={`w-full bg-white/10 border border-white/20 px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-app-primaryLighter text-2xl font-bold tracking-widest uppercase text-center ${t.radius.input}`}
                    placeholder="ABCD"
                    value={joinCode}
                    maxLength={4}
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && joinRoom()}
                    autoFocus
                  />
                </div>
                <button
                  onClick={joinRoom}
                  disabled={loading || joinCode.length !== 4}
                  className={`w-full py-4 text-xl md:text-2xl font-display ${theme.fontDisplayClass} tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${t.radius.button} ${t.primaryBtnClass}`}
                >
                  {loading ? 'Joining…' : 'Join Room'}
                </button>
                <button
                  onClick={() => { setMode('home'); setError(''); setJoinCode(''); }}
                  className="w-full text-white/60 hover:text-white py-2 text-sm font-sans transition-colors"
                >
                  Back
                </button>
              </div>
            )}

            {error && (
              <p className="mt-4 text-red-400 text-sm text-center bg-red-900/30 border border-red-700/50 rounded px-4 py-2">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
