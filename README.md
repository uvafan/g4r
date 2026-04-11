# Glory 4 Rome (G4R)

A web implementation of [Glory to Rome](https://www.glory-to-rome.com/Glory_to_Rome_rules.html) with [G4R modifications](https://docs.google.com/document/d/1F8PkozBXOsRGOEB1rD_SbB8cYdCmRA3Wmy9emnflM2s/edit?tab=t.0).

## Setup

```bash
npm install
npm run dev        # Dev server at http://localhost:5173
npm test           # Run tests
npm run test:watch # Tests in watch mode
npm run build      # Production build
```

**Tech stack:** React 19 + TypeScript + Vite

## Implementation Status

### Implemented

- **Game setup** -- 2-4 player hot-seat multiplayer with named players
- **Full turn cycle** -- Lead -> Follow -> Action -> next leader
- **Think action** -- Leader or follower draws cards (refill to hand limit of 5, or draw 1 if already at limit)
- **Lead/Follow** -- Play a card matching the role's material to lead or follow
- **Architect role** -- Place a card from hand as a building foundation; site availability and duplicate-material checks enforced; cost-1 buildings auto-complete
- **Craftsman role** -- Add matching material cards to incomplete buildings; buildings complete and grant influence when fully built
- **Laborer role** -- Take up to 2 materials from pool into stockpile, or move 1 material from stockpile into an in-progress building; leads/follows with Rubble cards
- **Legionary role** -- Reveal a card to demand matching materials from the pool and neighbors
- **Merchant role** -- Move materials from stockpile to vault; vault capacity limited by influence
- **Patron role** -- Hire cards from the pool into clientele; clientele capacity limited by influence
- **48 card definitions** -- All cards defined with name, material, cost, role, and power text (3 copies each for 2-4 players, 4 copies for 5+)
- **G4R material-to-role mapping** -- Rubble=Laborer, Wood=Craftsman, Brick=Legionary, Concrete=Architect, Stone=Merchant, Marble=Patron
- **Site management** -- Sites per material = playerCount + 1; sites decrement when buildings are placed; displayed in UI
- **Pool/deck tracking** -- Cards flow correctly between deck, hands, pool, and buildings
- **Undo** -- Full game state history with undo button
- **UI** -- Dark-themed board with color-coded cards, phase indicator, player areas, hand view, and context-aware action bar with hints
- **Jack cards** -- Wild cards that can match any role when leading or following
- **Clientele production** -- Clients produce bonus actions each turn
- **VP scoring** -- Full victory point calculation: influence (1 VP per point), vault (material values), merchant bonus (3 VP per category lead), and building bonuses (Statue +3, Wall +1/3 stockpile, Colosseum +1/hand card). Per-material VP breakdown displayed inline on vault chips
- **Three-of-a-kind as Jack** -- Playing 3 cards of the same role to act as a Jack
- **Dev tools** -- Copy/import game state JSON, shareable state URLs, loadable test scenarios
- **120 tests** -- Covering initialization, think, lead/follow, architect, craftsman, laborer, legionary, merchant, patron, jack cards, round lifecycle, available actions, G4R material mapping, and VP scoring

### Not Yet Implemented

- **Out-of-town sites** -- Referenced by some card powers but not in engine
- **Game end conditions** -- No end-game detection (e.g., all sites of a type claimed, deck exhaustion)
- **Card powers** -- All 48 buildings have power text defined but none are mechanically active
- **Display card text**
- **Multi-player between people on different computers**
- **Turn timers**

## Project Structure

```
src/
  game/
    types.ts        # Game state interfaces and type definitions
    cards.ts        # 48 card definitions, material/role mappings, deck creation
    engine.ts       # Game reducer, action handling, phase transitions, VP scoring
    engine.test.ts  # Test suite (120 tests)
    scenarios.ts    # Predefined game states for dev/testing
  components/
    SetupScreen.tsx   # Player count and name entry
    GameBoard.tsx     # Main game container
    PhaseIndicator.tsx# Current phase, active player, deck/pool counts
    PlayerArea.tsx    # Buildings, influence, hand count per player
    HandView.tsx      # Current player's hand with card selection
    ActionBar.tsx     # Context-aware action buttons and hints
    CardView.tsx      # Individual card rendering (color-coded by material)
  App.tsx           # Root component with game state and undo
  App.css           # All styling
```

## Game Rules Reference

- [Original Glory to Rome rules](https://www.glory-to-rome.com/Glory_to_Rome_rules.html)
- [G4R modifications](https://docs.google.com/document/d/1F8PkozBXOsRGOEB1rD_SbB8cYdCmRA3Wmy9emnflM2s/edit?tab=t.0)
