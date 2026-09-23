# TODO

Running list of open work, carried across sessions. Add to it any time; check
items off (`- [x]`) as they land, and leave a short note on anything non-obvious.
Priority: P1 = most important, P2 = next, P3 = nice-to-have / later.

## P1

- [x] Fix the game room layouts — see notes below; flag if there's more specific
      breakage you had in mind that this didn't cover.
- [ ] Fix Blackjack and Golf mechanisms
- [x] Fix UX of showing hand and interacting with cards — see notes below. Covers
      the default (play-to-table/discard) hand fully; Blackjack/Golf keep their
      own distinct mechanics, which is what the item above this one is for.

## P2

- [ ] Game room navigation bar
- [ ] Make game room designs update more with themes
- [ ] Make more games that work — restore Texas Hold'em / Go Fish / War / Gin Rummy
      / Crazy Eights (still fully defined in `ALL_GAMES` in `src/lib/games.ts`,
      just hidden via `ENABLED_GAME_IDS`) and/or add new ones
- [x] Turn history — Action History is now populated for every game mode (was
      Blackjack-only) and shown as a proper right sidebar on desktop, matching
      the Figma "Game Desktop" frame, with a mobile banner fallback.

## P3

- [ ] Add exit button
- [ ] Adjust each theme landing — includes revisiting the Goof / Heist / Oki Toki
      supporting colors, which were my own design pass (only Swank and all four
      themes' fonts came from an exact Figma spec)

## Unprioritized / notes

- [ ] Nothing from this session is pushed/deployed yet (GitHub Pages auto-deploys
      on push to `main`) — commit + push when ready to make it live.
- [ ] Theme choice is currently a personal per-device preference (localStorage),
      not synced per-room — revisit if it should be shared with the whole table.

## Done

- [x] Added a big "Knock!" button (amber, matches the app's supplied reference image)
      to the right of Golf's 2×2 grid on desktop, vertically centered against it —
      replaces the small inline Knock button there (mobile keeps the small one).
      While testing this, found and fixed a real bug from the earlier "game room
      layout" pass: the mobile hand/action-bar was `position: sticky`, which does
      NOT pull an element into view when its natural position already starts below
      the fold at scroll=0 (only Golf's tall opponent grids exposed this) — the
      Knock button was measurably off-screen (y=855 in an 844px viewport) despite
      looking fine in earlier screenshots. Switched to `position: fixed` on mobile,
      which always renders at the true viewport bottom regardless of scroll
      position, plus reserved bottom padding so it doesn't overlap the grid.
- [x] Landing page rebuilt from Figma ("Swank" frame), themed Button component,
      Lobby/Game color tokens.
- [x] Adobe Fonts (Typekit) wired in; 4-theme system (Swank/Goof/Heist/Oki Toki)
      with per-theme fonts, colors, decorative art, seeded card-back color.
- [x] Mobile breakpoint for Landing/Lobby/Game moved from `lg` (1024px) to `sm`
      (640px); Lobby and Game given real desktop layouts (two-column / sidebar
      layouts) matching the Figma "Lobby Desktop" / "Game Desktop" frames.
- [x] Games list trimmed to Blackjack + Golf only.
- [x] Name field starts pre-filled with a generated name, persists whatever's
      currently shown (typed or generated) as "last used".
- [x] Game room layout bugs: mobile header was cramming room code + turn badge +
      Rules/Play Again/Settings + game name into one row and wrapping badly — now
      a clean 2-row layout (1-row on desktop). Golf's Knock button and other hand
      controls could get pushed off-screen below the fold on mobile, requiring a
      scroll mid-turn — the hand + action bar now stick to the bottom of the
      viewport instead. Blackjack was showing an always-empty "Discard" pile
      placeholder (Blackjack never uses discard_pile) — now hidden for
      Blackjack/Hold'em/Go Fish, which don't use it.
- [x] Game room rebuilt from the Figma "Game Desktop 1–4" interaction-state frames:
      big game-name header, a "TURN" tab bar (replacing the small turn-badge pill)
      showing every player with the current turn-holder underlined in amber,
      "Deck"/"Table" headings with the piles grouped side by side, and — the main
      piece — a real hover → select → confirm flow for the default hand: hovering
      a card lifts it and dims its neighbors with a name label underneath: on
      selection it gets a blue ring and a floating "Play to Table / Discard /
      Cancel" popover (desktop only; mobile keeps tap-to-select + the sticky
      bottom bar, since hover doesn't exist on touch). Also extended action-log
      calls to draw/discard/play/golf-swap/knock so Action History has something
      to show outside Blackjack. Verified against Blackjack, Golf, and Gin Rummy
      (temporarily re-enabled to test, then reverted) at mobile and desktop.
- [x] Golf's desktop layout rebuilt from the Figma "Game desktop Golf 1–5" frames
      (frame 5 not fetched — hit the Figma MCP rate limit on the Starter plan):
      Deck sits beside the 2×2 grid instead of above it, an amber status headline
      above the grid ("It's your turn" / "Swap or discard" / opponent's turn),
      the pending drawn card gets an amber ring + full name label, and grid slots
      get a blue hover ring when choosing which card to peek at or swap in —
      matching the same hover language as the default hand. Mobile untouched
      (still the simpler stacked layout from the earlier layout-bug fixes).
