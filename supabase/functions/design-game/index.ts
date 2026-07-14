// Supabase Edge Function: design-game
//
// Given a free-text game idea from the dealer, asks Claude to configure it as
// a playable game within Card Room's existing engine: pick the closest-fit
// interaction mode (generic play/discard, Blackjack, Hold'em, Go Fish, Rummy),
// parameterize the deal, write instructions text, and surface clarifying
// questions when the request is genuinely ambiguous.
//
// Deploy: supabase functions deploy design-game
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@^0.32.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLARIFYING_KEYS = [
  'cardsPerPlayer', 'discardPileStart', 'handFaceUp', 'canDrawFromDiscard',
  'turnBased', 'splitEntireDeck', 'minPlayers', 'maxPlayers',
];

const GAME_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    instructions: { type: 'string' },
    minPlayers: { type: 'integer' },
    maxPlayers: { type: 'integer' },
    turnBased: { type: 'boolean' },
    canDrawFromDiscard: { type: 'boolean' },
    showBlackjackControls: { type: 'boolean' },
    showHoldemControls: { type: 'boolean' },
    isGoFishLike: { type: 'boolean' },
    dealPlan: {
      type: 'object',
      properties: {
        cardsPerPlayer: { type: 'integer' },
        splitEntireDeck: { type: 'boolean' },
        discardPileStart: { type: 'boolean' },
        handFaceUp: { type: 'boolean' },
      },
      required: ['cardsPerPlayer', 'splitEntireDeck', 'discardPileStart', 'handFaceUp'],
      additionalProperties: false,
    },
    clarifyingOptions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: CLARIFYING_KEYS },
          label: { type: 'string' },
          type: { type: 'string', enum: ['select', 'toggle'] },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['label', 'value'],
              additionalProperties: false,
            },
          },
        },
        required: ['key', 'label', 'type', 'choices'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'name', 'description', 'instructions', 'minPlayers', 'maxPlayers', 'turnBased',
    'canDrawFromDiscard', 'showBlackjackControls', 'showHoldemControls', 'isGoFishLike',
    'dealPlan', 'clarifyingOptions',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You configure card games for "Card Room," a real-time multiplayer virtual card table. The dealer describes a game they want to play; you turn that into a config that plugs into the app's existing engine.

The engine only supports five interaction modes — pick the single closest fit, don't invent new mechanics:
1. Blackjack-style: showBlackjackControls=true. Always exactly 2 cards each, dealt automatically by the engine; dealer's (seat 0) second card is hidden. Players Hit or Stand.
2. Hold'em-style: showHoldemControls=true. Always 2 private hole cards + 5 community cards revealed in stages (flop/turn/river), dealt automatically by the engine.
3. Go Fish-style: isGoFishLike=true. Players ask each other for a rank; turnBased must be true.
4. Rummy-style: canDrawFromDiscard=true, turnBased=true. Players draw from the deck or discard pile, then discard.
5. Generic play/discard: turnBased and canDrawFromDiscard as appropriate. Players select a card from their hand and either play it to the shared table or discard it.

For modes 3-5, set dealPlan: cardsPerPlayer (reasonable hand size, 1-13), splitEntireDeck (true only for War-like games that split the whole deck evenly instead of dealing a hand), discardPileStart (true if the game needs a starting discard/table card), handFaceUp (true if opponents' hands should be visible to everyone, e.g. Go Fish; false for private hands like Rummy or poker-style games). For modes 1-2, dealPlan is ignored by the engine — still fill it with reasonable defaults (cardsPerPlayer: 2, splitEntireDeck: false, discardPileStart: false, handFaceUp: false).

Only include clarifyingOptions (max 3) when the request is genuinely ambiguous in a way that changes the deal or mode — e.g. an unfamiliar or made-up game where hand size or visibility isn't implied. For well-known games (Hold'em, Blackjack, War, Go Fish, Rummy, Crazy Eights, Egyptian Ratscrew, Speed, etc.) or clearly-specified custom games, return an empty clarifyingOptions array. Each clarifying option's "key" must reference one of the dealPlan/top-level fields it should override, and "choices" must be 2-4 concrete options with string "value"s matching the field's type (e.g. "true"/"false" for booleans, a number as a string for cardsPerPlayer).

Write "instructions" as a single concise paragraph in a friendly, direct tone, matching how you'd explain the rules to someone about to play — similar in length and style to: "Get as close to 21 as possible. Number cards = face value, face cards = 10, Ace = 1 or 11. First player is the dealer — their second card is hidden. Players Hit (draw) or Stand. Dealer plays last." Do not mention the engine, modes, or config fields in the instructions text — it's shown directly to players.

minPlayers and maxPlayers should be sensible for the game (most card games: 2-8).`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => null);
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const playerCount = Number.isInteger(body?.playerCount) ? body.playerCount : null;

    if (!prompt || prompt.length > 200) {
      return new Response(JSON.stringify({ error: 'Describe the game in 1-200 characters.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    if (!playerCount || playerCount < 1) {
      return new Response(JSON.stringify({ error: 'playerCount must be a positive integer.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'AI game design is not configured on this server.' }), {
        status: 503,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: GAME_CONFIG_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Game to design: "${prompt}"\nCurrent players seated: ${playerCount}` },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return new Response(JSON.stringify({ error: 'That request was declined. Try describing a different game.' }), {
        status: 422,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    if (!textBlock) {
      return new Response(JSON.stringify({ error: 'AI did not return a game config. Try again.' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const config = JSON.parse(textBlock.text);
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('design-game error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `Failed to design game: ${message}` }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
