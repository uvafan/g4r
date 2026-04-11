# Glory 4 Rome

A web implementation of Glory to Rome with modifications (Glory 4 Rome / G4R).

## Quick Reference
- `npm run dev` — dev server at localhost:5173
- `npm test` — run Vitest suite
- `npm run test:watch` — tests in watch mode

## Game Rules
- Original rules: https://www.glory-to-rome.com/Glory_to_Rome_rules.html
- G4R modifications: https://docs.google.com/document/d/1F8PkozBXOsRGOEB1rD_SbB8cYdCmRA3Wmy9emnflM2s/edit?tab=t.0
- See README.md for full implementation status (what's done vs not yet implemented)

## Architecture

**Pure game logic (`src/game/`) is fully separated from React UI (`src/components/`).**

- `types.ts` — All interfaces: `GameState`, `Player`, `Card`, `CardDef`, `Building`, `Phase`, `GameAction`
- `cards.ts` — 48 card definitions, material-to-role mappings, deck creation
- `engine.ts` — Single reducer function `gameReducer(state, action) → state`. All game logic lives here. Also exports `getAvailableActions(state)` and `calculateVP(state, playerId)`
- `scenarios.ts` — Pre-built game states for dev/testing
- `App.tsx` — Holds `GameState` in React `useState`, persists to localStorage, exposes `window.g4r` console API

**State is immutable** — the reducer returns new state objects via spread. Never mutate state directly.

**Card identity** — Every card instance has a unique `uid` (monotonic counter via `state.nextUid`). The `defId` links to the static `CardDef`. Always compare cards by `uid`, not by `defId`.

**Phase flow:** Lead → Follow → Action → (Legionary Demand if applicable) → next player's Lead. The `phase` field on `GameState` is a discriminated union — check `phase.type` to determine what actions are valid.

## Key Conventions

**Material-to-role mapping (G4R-specific, differs from original GTR):**
Rubble=Laborer, Wood=Craftsman, Brick=Legionary, Concrete=Architect, Stone=Merchant, Marble=Patron

**Materials lose identity**: Once a card is placed as material in a building or is in the pool, only its material type matters — the building name on that card is irrelevant. The UI should show material counts, not individual card names.

**Adding a new game action:**
1. Add the action type to the `GameAction` union in `types.ts`
2. Add a case in `gameReducer` in `engine.ts`
3. Update `getAvailableActions` so the UI knows when the action is valid
4. Add UI controls in `ActionBar.tsx` / `GameBoard.tsx`
5. Write tests in `engine.test.ts`

**Modifying an existing action (e.g. adding a variant like 3-of-a-kind):**
- Prefer adding optional fields to existing action types (e.g. `extraCardUids?: number[]`) over creating new action types — this minimizes churn in the reducer, `getAvailableActions`, and all UI components.
- The same applies to `AvailableActions` option types — extend with optional fields rather than adding parallel option arrays.
- The key touchpoints for lead/follow mechanics are: `GameAction` type in `types.ts`, `LEAD_ROLE`/`FOLLOW_ROLE` cases in `gameReducer`, the lead/follow sections of `getAvailableActions` (both in `engine.ts`), and the lead/follow button rendering in `ActionBar.tsx`.
- `GameBoard.tsx` highlighting logic usually needs no changes for lead/follow variants since it derives from `getAvailableActions` output.

## Testing

Tests live in `src/game/engine.test.ts` (Vitest). Game logic is tested in isolation from React.

- **Run `npm run test:watch` in a background terminal** at the start of a session (`run_in_background`). This keeps vitest's Node process warm so re-runs on file save are near-instant (~20ms) instead of paying the ~2s cold-start each time you invoke `npm test`.
- Use `createSeededRng(seed)` for deterministic tests
- Use scenario builder from `scenarios.ts` or construct `GameState` manually for specific setups
- **Regression tests on corrections**: Whenever a bug or incorrect behavior is reported, write a failing test first, then fix the code

## Development Practices
- **Claude for Chrome**: Browser automation tools may be used for debugging purposes only.
