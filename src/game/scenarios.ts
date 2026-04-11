import { GameState, Card, Building } from './types';
import { createInitialState } from './engine';
import { CARD_DEFS } from './cards';

// Seeded RNG for deterministic scenarios
function seededRng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function findDefId(material: string): string {
  return CARD_DEFS.find(d => d.material === material)!.id;
}

export interface Scenario {
  name: string;
  description: string;
  state: GameState;
}

/** Fresh 2-player game, deterministic seed */
function freshGame(): Scenario {
  return {
    name: 'Fresh 2p game',
    description: 'New 2-player game (seeded)',
    state: createInitialState(2, ['Alice', 'Bob'], seededRng(42)),
  };
}

/** Architect action phase — player 0 can start a building */
function architectAction(): Scenario {
  const state = createInitialState(2, ['Alice', 'Bob'], seededRng(100));
  return {
    name: 'Architect action',
    description: 'Player 0 in Architect action phase',
    state: {
      ...state,
      phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
    },
  };
}

/** Craftsman action with an open Brick building */
function craftsmanWithBuilding(): Scenario {
  const rng = seededRng(200);
  let state = createInitialState(2, ['Alice', 'Bob'], rng);
  const brickCard = state.players[0]!.hand.find(c => {
    const def = CARD_DEFS.find(d => d.id === c.defId);
    return def?.material === 'Brick';
  });
  if (!brickCard) {
    // Fallback: inject a brick card
    const card: Card = { uid: state.nextUid, defId: findDefId('Brick') };
    state = { ...state, nextUid: state.nextUid + 1 };
    const building: Building = { foundationCard: card, materials: [], completed: false };
    return {
      name: 'Craftsman with building',
      description: 'Player 0 has open Brick building, Craftsman action',
      state: {
        ...state,
        players: state.players.map((p, i) =>
          i === 0 ? { ...p, buildings: [building] } : p
        ),
        phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
      },
    };
  }
  const building: Building = { foundationCard: brickCard, materials: [], completed: false };
  return {
    name: 'Craftsman with building',
    description: 'Player 0 has open Brick building, Craftsman action',
    state: {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, hand: p.hand.filter(c => c.uid !== brickCard.uid), buildings: [building] }
          : p
      ),
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    },
  };
}

/** Legionary action — player 0 can reveal, player 1 has matching cards */
function legionaryAction(): Scenario {
  const rng = seededRng(42);
  let state = createInitialState(2, ['Alice', 'Bob'], rng);
  const woodCard: Card = { uid: state.nextUid, defId: findDefId('Wood') };
  const woodCard2: Card = { uid: state.nextUid + 1, defId: findDefId('Wood') };
  const woodPoolCard: Card = { uid: state.nextUid + 2, defId: findDefId('Wood') };
  return {
    name: 'Legionary action',
    description: 'Player 0 Legionary with Wood cards in pool + opponent hand',
    state: {
      ...state,
      nextUid: state.nextUid + 3,
      pool: [woodPoolCard],
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, hand: [woodCard, ...p.hand] };
        if (i === 1) return { ...p, hand: [woodCard2, ...p.hand] };
        return p;
      }),
      phase: { type: 'action', ledRole: 'Legionary', actors: [0], currentActorIndex: 0 },
    },
  };
}

/** Laborer action — pool has materials to take */
function laborerAction(): Scenario {
  const rng = seededRng(42);
  let state = createInitialState(2, ['Alice', 'Bob'], rng);
  const poolCards: Card[] = [
    { uid: state.nextUid, defId: findDefId('Wood') },
    { uid: state.nextUid + 1, defId: findDefId('Brick') },
    { uid: state.nextUid + 2, defId: findDefId('Rubble') },
  ];
  return {
    name: 'Laborer action',
    description: 'Player 0 Laborer with 3 materials in pool',
    state: {
      ...state,
      nextUid: state.nextUid + 3,
      pool: poolCards,
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    },
  };
}

/** Merchant action — player 0 has materials in stockpile */
function merchantAction(): Scenario {
  const rng = seededRng(42);
  let state = createInitialState(2, ['Alice', 'Bob'], rng);
  const stockpileCards: Card[] = [
    { uid: state.nextUid, defId: findDefId('Stone') },
    { uid: state.nextUid + 1, defId: findDefId('Brick') },
  ];
  return {
    name: 'Merchant action',
    description: 'Player 0 Merchant with Stone + Brick in stockpile',
    state: {
      ...state,
      nextUid: state.nextUid + 2,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, stockpile: stockpileCards } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    },
  };
}

/** Patron action — pool has cards to hire as clients */
function patronAction(): Scenario {
  const rng = seededRng(42);
  let state = createInitialState(2, ['Alice', 'Bob'], rng);
  const poolCards: Card[] = [
    { uid: state.nextUid, defId: findDefId('Wood') },
    { uid: state.nextUid + 1, defId: findDefId('Concrete') },
  ];
  return {
    name: 'Patron action',
    description: 'Player 0 Patron with Wood + Concrete clients available in pool',
    state: {
      ...state,
      nextUid: state.nextUid + 2,
      pool: poolCards,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 3 } : p
      ),
      phase: { type: 'action', ledRole: 'Patron', actors: [0], currentActorIndex: 0 },
    },
  };
}

/** Mid-game with completed buildings, clientele, vault, etc. */
function midGame(): Scenario {
  const rng = seededRng(42);
  let state = createInitialState(2, ['Alice', 'Bob'], rng);
  const uid = state.nextUid;

  // Player 0: completed Rubble building, open Brick building, clients, stockpile, vault
  const completedBuilding: Building = {
    foundationCard: { uid: uid, defId: findDefId('Rubble') },
    materials: [{ uid: uid + 1, defId: findDefId('Rubble') }],
    completed: true,
  };
  const openBuilding: Building = {
    foundationCard: { uid: uid + 2, defId: findDefId('Brick') },
    materials: [{ uid: uid + 3, defId: findDefId('Brick') }],
    completed: false,
  };

  // Player 1: one completed Stone building
  const p1Building: Building = {
    foundationCard: { uid: uid + 4, defId: findDefId('Stone') },
    materials: [
      { uid: uid + 5, defId: findDefId('Stone') },
      { uid: uid + 6, defId: findDefId('Stone') },
      { uid: uid + 7, defId: findDefId('Stone') },
    ],
    completed: true,
  };

  return {
    name: 'Mid-game',
    description: '2p mid-game: buildings, clients, stockpile, vault',
    state: {
      ...state,
      nextUid: uid + 8,
      pool: [
        { uid: uid + 8, defId: findDefId('Wood') },
        { uid: uid + 9, defId: findDefId('Concrete') },
      ],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p,
          buildings: [completedBuilding, openBuilding],
          clientele: [{ uid: uid + 10, defId: findDefId('Concrete') }],
          stockpile: [{ uid: uid + 11, defId: findDefId('Wood') }],
          vault: [{ uid: uid + 12, defId: findDefId('Stone') }],
          influence: 1,
        };
        if (i === 1) return {
          ...p,
          buildings: [p1Building],
          clientele: [{ uid: uid + 13, defId: findDefId('Marble') }],
          vault: [
            { uid: uid + 14, defId: findDefId('Brick') },
            { uid: uid + 15, defId: findDefId('Brick') },
          ],
          influence: 3,
        };
        return p;
      }),
      sites: { ...state.sites, Rubble: state.sites.Rubble - 1, Brick: state.sites.Brick - 1, Stone: state.sites.Stone - 1 },
    },
  };
}

/** Clientele production — player 0 has Architect client and is leading */
function clienteleProduction(): Scenario {
  const rng = seededRng(42);
  let state = createInitialState(2, ['Alice', 'Bob'], rng);
  const clientCard: Card = { uid: 8000, defId: 'road' }; // Concrete = Architect
  return {
    name: 'Clientele production',
    description: 'Player 0 has Architect client (gets extra Architect actions)',
    state: {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, clientele: [clientCard], influence: 3 } : p
      ),
    },
  };
}

export const SCENARIOS: Scenario[] = [
  freshGame(),
  architectAction(),
  craftsmanWithBuilding(),
  laborerAction(),
  merchantAction(),
  legionaryAction(),
  patronAction(),
  midGame(),
  clienteleProduction(),
];
