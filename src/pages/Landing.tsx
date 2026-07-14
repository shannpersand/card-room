import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getErrorMessage } from '@/lib/supabase';
import { generateRoomCode } from '@/lib/deck';

export function Landing() {
  const navigate = useNavigate();
  const [name, setName] = useState(() => localStorage.getItem('cardroom_name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'home' | 'join'>('home');

  const savedName = name.trim();

  async function createRoom() {
    if (!savedName) return setError('Enter your name first');
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
        .insert({ code })
        .select()
        .single();
      if (roomErr) throw roomErr;

      const { data: player, error: playerErr } = await supabase
        .from('players')
        .insert({ room_id: room.id, name: savedName, seat_order: 0 })
        .select()
        .single();
      if (playerErr) throw playerErr;

      localStorage.setItem('cardroom_name', savedName);
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
    if (!savedName) return setError('Enter your name first');
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
        .insert({ code })
        .select()
        .single();
      if (roomErr) throw roomErr;

      const { data: player, error: playerErr } = await supabase
        .from('players')
        .insert({ room_id: room.id, name: savedName, seat_order: 0 })
        .select()
        .single();
      if (playerErr) throw playerErr;

      const { error: botsErr } = await supabase.from('players').insert([
        { room_id: room.id, name: 'Computer 1', seat_order: 1, is_bot: true },
        { room_id: room.id, name: 'Computer 2', seat_order: 2, is_bot: true },
      ]);
      if (botsErr) throw botsErr;

      localStorage.setItem('cardroom_name', savedName);
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
    if (!savedName) return setError('Enter your name first');
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
          localStorage.setItem('cardroom_name', savedName);
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
        .insert({ room_id: room.id, name: savedName, seat_order: nextSeat })
        .select()
        .single();
      if (playerErr) throw playerErr;

      localStorage.setItem('cardroom_name', savedName);
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
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-8">
      {/* Logo */}
      <div className="text-center">
        <div className="text-6xl mb-2">♠ ♥</div>
        <h1 className="text-4xl font-bold tracking-tight">Card Room</h1>
        <p className="text-emerald-400 mt-1 text-sm">Play card games with friends, live</p>
      </div>

      {/* Name input */}
      <div className="w-full max-w-sm">
        <label className="block text-sm text-emerald-300 mb-1 font-medium">Your name</label>
        <input
          className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-lg"
          placeholder="Enter your name…"
          value={name}
          maxLength={20}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (mode === 'join' ? joinRoom() : createRoom())}
        />
      </div>

      {/* Actions */}
      {mode === 'home' ? (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <button
            onClick={createRoom}
            disabled={loading || !savedName}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-lg transition-colors"
          >
            {loading ? 'Creating…' : 'Create Game'}
          </button>
          <button
            onClick={() => { setMode('join'); setError(''); }}
            className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-4 rounded-xl text-lg transition-colors"
          >
            Join a Game
          </button>
          <button
            onClick={startTestGame}
            disabled={loading || !savedName}
            className="w-full bg-transparent border border-dashed border-white/20 hover:border-white/40 disabled:opacity-50 disabled:cursor-not-allowed text-white/60 hover:text-white font-semibold py-3 rounded-xl text-sm transition-colors"
          >
            {loading ? 'Setting up…' : 'Start Test Game (vs Computer)'}
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <div>
            <label className="block text-sm text-emerald-300 mb-1 font-medium">Room code</label>
            <input
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-2xl font-bold tracking-widest uppercase text-center"
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
            disabled={loading || !savedName || joinCode.length !== 4}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-lg transition-colors"
          >
            {loading ? 'Joining…' : 'Join Room'}
          </button>
          <button
            onClick={() => { setMode('home'); setError(''); setJoinCode(''); }}
            className="w-full bg-transparent text-white/60 hover:text-white py-2 text-sm transition-colors"
          >
            Back
          </button>
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm text-center bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2 max-w-sm">
          {error}
        </p>
      )}

      <div className="text-xs text-white/30 text-center">
        <div>♣ ♦</div>
      </div>
    </div>
  );
}
