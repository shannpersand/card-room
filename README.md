# Card Room

A real-time multiplayer virtual card table. Play Texas Hold'em, Blackjack, Go Fish, War, Gin Rummy, or Crazy Eights with friends — on web, iOS, or Android.

---

## Setup

### 1. Install Node.js

```bash
brew install node
```

### 2. Install dependencies

```bash
cd card-room
npm install
```

### 3. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Open **SQL Editor** and paste + run the contents of `supabase-schema.sql`.
3. In **Project Settings → API**, copy your **Project URL** and **anon public key**.

### 4. Configure environment variables

```bash
cp .env.example .env
# Then edit .env and fill in your Supabase URL and anon key
```

### 5. Run the web app

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### 6. (Optional) Enable AI game design

The dealer can type any game name/description and have AI configure it, instead of only picking from the preset list. This requires deploying one Supabase Edge Function and setting an Anthropic API key as a server-side secret (never exposed to the browser).

```bash
# Install the Supabase CLI if you haven't: https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy design-game
```

Without this step, the app still works fully — the dealer just won't see the "Describe a game" option resolve (it'll show an error and they can fall back to the preset dropdown).

---

## iOS / Android (Capacitor)

Once the web app is working:

```bash
# Add platforms (first time only)
npx cap add ios
npx cap add android

# Build web app and sync to native projects
npm run cap:sync

# Open in Xcode / Android Studio
npm run cap:ios
npm run cap:android
```

Requirements: Xcode (Mac, for iOS) or Android Studio (for Android).

---

## How it works

| Step | What happens |
|------|-------------|
| Create room | Generates a random 4-letter code (e.g. `KQJX`) |
| Share code | Friends type the code to join the room |
| Lobby | First player in = Dealer; picks a preset game, or describes any game for AI to configure, then clicks Deal |
| Game | Cards dealt instantly to all players via Supabase Realtime |
| Play | Tap a card to select → Play to Table or Discard |

### Supported games

- **Texas Hold'em** — 2 hole cards + staged community card reveals
- **Blackjack** — Hit / Stand with dealer's hole card hidden
- **Go Fish** — Ask any player for a rank; auto-draws on miss
- **War** — Even split; play top card to table each round
- **Gin Rummy** — Draw from deck or discard pile, then discard
- **Crazy Eights** — Match by rank or suit; 8s are wild

### AI-designed games

The dealer can also type any other game (e.g. "Egyptian Ratscrew" or "a simple matching game for kids") into the "Describe a game" box. AI picks the closest-fitting interaction mode from the ones above, configures the deal (hand size, discard pile, visibility), and writes custom instructions — asking the dealer a couple of quick questions first if the request is ambiguous. See [Setup step 6](#6-optional-enable-ai-game-design) to enable this. It doesn't invent new rules enforcement beyond what's listed above — like the presets, house rules are honor-system.

### Player privacy

Card hands are stored in Supabase and technically accessible to all clients that know the room code. This is an honor-system design suitable for casual play among friends. For competitive play, hands would need to be enforced server-side via Supabase Edge Functions.
