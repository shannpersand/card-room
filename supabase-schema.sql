-- ============================================================
-- Card Room — Supabase Schema
-- Run this in your Supabase project's SQL Editor
-- ============================================================

-- Rooms table
CREATE TABLE IF NOT EXISTS public.rooms (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code            char(4) UNIQUE NOT NULL,
  game_id         text,
  game_name       text,
  state           text DEFAULT 'lobby' CHECK (state IN ('lobby', 'playing', 'finished')),
  deck            jsonb NOT NULL DEFAULT '[]',
  community_cards jsonb NOT NULL DEFAULT '[]',
  discard_pile    jsonb NOT NULL DEFAULT '[]',
  current_turn    uuid,
  holdem_stage    text CHECK (holdem_stage IN ('preflop', 'flop', 'turn', 'river')),
  custom_game     jsonb,
  action_log      jsonb NOT NULL DEFAULT '[]',
  back_color      text NOT NULL DEFAULT 'blue',
  golf_knocked_by uuid,
  created_at      timestamptz DEFAULT now()
);

-- Migration for existing installs (safe to re-run)
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS custom_game jsonb;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS action_log jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS back_color text NOT NULL DEFAULT 'blue';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS golf_knocked_by uuid;

-- Players table
CREATE TABLE IF NOT EXISTS public.players (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id     uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name        text NOT NULL,
  hand        jsonb NOT NULL DEFAULT '[]',
  seat_order  integer NOT NULL,
  is_standing boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  is_bot      boolean NOT NULL DEFAULT false,
  last_seen   timestamptz DEFAULT now()
);

-- Migration for existing installs (safe to re-run)
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

-- Saved games — reusable AI-designed / edited configs, shared across all players
CREATE TABLE IF NOT EXISTS public.saved_games (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  config      jsonb NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(code);
CREATE INDEX IF NOT EXISTS idx_players_room ON public.players(room_id);
CREATE INDEX IF NOT EXISTS idx_saved_games_created ON public.saved_games(created_at DESC);

-- Row Level Security (honor-system: all operations allowed via anon key)
ALTER TABLE public.rooms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rooms_all_anon"   ON public.rooms   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "players_all_anon" ON public.players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "saved_games_all_anon" ON public.saved_games FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;

-- Optional: auto-delete rooms older than 24 hours (run as a cron via pg_cron or Supabase Edge Function)
-- DELETE FROM public.rooms WHERE created_at < now() - interval '24 hours';
