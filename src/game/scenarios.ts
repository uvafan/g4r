import { GameState, Card, Building } from './types';
import { createInitialState } from './engine';
import { getCardDef } from './cards';
import { seededRng, makeState, withActionPhase, updatePlayer, mkBuilding, finalize } from './stateBuilder';

export interface Scenario {
  name: string;
  description: string;
  state: GameState;
}

/** Fresh 2-player game, deterministic seed */
export function freshGame(): Scenario {
  return {
    name: 'Fresh 2p game',
    description: 'New 2-player game (seeded)',
    state: createInitialState(2, ['Alice', 'Bob'], seededRng(42)),
  };
}

/** Architect action phase — player 0 can start a building */
export function architectAction(): Scenario {
  const { state } = makeState(2, ['Alice', 'Bob'], 100);
  return {
    name: 'Architect action',
    description: 'Player 0 in Architect action phase',
    state: withActionPhase(state, 'Architect'),
  };
}

/** Craftsman action with an open Brick building */
export function craftsmanWithBuilding(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 200);
  const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
  if (!brickCard) {
    const card = uids.material('Brick');
    const building = mkBuilding(card, [], false);
    return {
      name: 'Craftsman with building',
      description: 'Player 0 has open Brick building, Craftsman action',
      state: withActionPhase(
        updatePlayer(finalize(state, uids), 0, { buildings: [building] }),
        'Craftsman',
      ),
    };
  }
  const building = mkBuilding(brickCard, [], false);
  return {
    name: 'Craftsman with building',
    description: 'Player 0 has open Brick building, Craftsman action',
    state: withActionPhase(
      updatePlayer(state, 0, {
        hand: state.players[0]!.hand.filter(c => c.uid !== brickCard.uid),
        buildings: [building],
      }),
      'Craftsman',
    ),
  };
}

/** Legionary action — player 0 can reveal, player 1 has matching cards */
export function legionaryAction(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);
  const woodCard = uids.material('Wood');
  const woodCard2 = uids.material('Wood');
  const woodPoolCard = uids.material('Wood');
  return {
    name: 'Legionary action',
    description: 'Player 0 Legionary with Wood cards in pool + opponent hand',
    state: withActionPhase({
      ...finalize(state, uids),
      pool: [woodPoolCard],
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, hand: [woodCard, ...p.hand] };
        if (i === 1) return { ...p, hand: [woodCard2, ...p.hand] };
        return p;
      }),
    }, 'Legionary'),
  };
}

/** Laborer action — pool has materials to take */
export function laborerAction(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);
  const poolCards = [uids.material('Wood'), uids.material('Brick'), uids.material('Rubble')];
  return {
    name: 'Laborer action',
    description: 'Player 0 Laborer with 3 materials in pool',
    state: withActionPhase({ ...finalize(state, uids), pool: poolCards }, 'Laborer'),
  };
}

/** Merchant action — player 0 has materials in stockpile */
export function merchantAction(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);
  const stockpileCards = [uids.material('Stone'), uids.material('Brick')];
  return {
    name: 'Merchant action',
    description: 'Player 0 Merchant with Stone + Brick in stockpile',
    state: withActionPhase(
      updatePlayer(finalize(state, uids), 0, { stockpile: stockpileCards }),
      'Merchant',
    ),
  };
}

/** Patron action — pool has cards to hire as clients */
export function patronAction(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);
  const poolCards = [uids.material('Wood'), uids.material('Concrete')];
  return {
    name: 'Patron action',
    description: 'Player 0 Patron with Wood + Concrete clients available in pool',
    state: withActionPhase({
      ...updatePlayer(finalize(state, uids), 0, { influence: 3 }),
      pool: poolCards,
    }, 'Patron'),
  };
}

/** Mid-game with completed buildings, clientele, vault, etc. */
export function midGame(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);

  const completedBuilding = mkBuilding(
    uids.material('Rubble'), [uids.material('Rubble')], true,
  );
  const openBuilding = mkBuilding(
    uids.material('Brick'), [uids.material('Brick')], false,
  );
  const p1Building = mkBuilding(
    uids.material('Stone'),
    [uids.material('Stone'), uids.material('Stone'), uids.material('Stone')],
    true,
  );

  return {
    name: 'Mid-game',
    description: '2p mid-game: buildings, clients, stockpile, vault',
    state: {
      ...finalize(state, uids),
      pool: [uids.material('Wood'), uids.material('Concrete')],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p,
          buildings: [completedBuilding, openBuilding],
          clientele: [uids.material('Concrete')],
          stockpile: [uids.material('Wood')],
          vault: [uids.material('Stone')],
          influence: 1,
        };
        if (i === 1) return {
          ...p,
          buildings: [p1Building],
          clientele: [uids.material('Marble')],
          vault: [uids.material('Brick'), uids.material('Brick')],
          influence: 3,
        };
        return p;
      }),
      sites: { ...state.sites, Rubble: state.sites.Rubble - 1, Brick: state.sites.Brick - 1, Stone: state.sites.Stone - 1 },
    },
  };
}

/** Clientele production — player 0 has Architect client and is leading */
export function clienteleProduction(): Scenario {
  const { state } = makeState(2, ['Alice', 'Bob'], 42);
  const clientCard: Card = { uid: 8000, defId: 'road' }; // Concrete = Architect
  return {
    name: 'Clientele production',
    description: 'Player 0 has Architect client (gets extra Architect actions)',
    state: updatePlayer(state, 0, { clientele: [clientCard], influence: 3 }),
  };
}

/** Late game — both players have multiple completed buildings, full clientele, vaults, depleted sites */
export function lateGame(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);

  const p0Buildings: Building[] = [
    mkBuilding(uids.card('barracks'), [uids.card('quarry')], true),
    mkBuilding(uids.card('crane'), [uids.card('dock')], true),
    mkBuilding(uids.card('road'), [uids.card('vomitorium'), uids.card('tower')], true),
    mkBuilding(uids.card('villa'), [uids.card('library')], false),
  ];

  const p1Buildings: Building[] = [
    mkBuilding(uids.card('foundry'), [uids.card('school'), uids.card('shrine')], true),
    mkBuilding(uids.card('latrine'), [uids.card('fountain'), uids.card('stairway')], true),
    mkBuilding(uids.card('amphitheatre'), [uids.card('wall')], false),
  ];

  return {
    name: 'Late game',
    description: '2p late game: many buildings, full clientele, depleted sites',
    state: {
      ...finalize(state, uids),
      pool: [uids.material('Rubble'), uids.material('Wood')],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p,
          buildings: p0Buildings,
          clientele: [uids.material('Concrete'), uids.material('Wood'), uids.material('Stone')],
          stockpile: [uids.material('Stone'), uids.material('Marble')],
          vault: [uids.material('Stone'), uids.material('Marble'), uids.material('Brick')],
          influence: 4,
        };
        if (i === 1) return {
          ...p,
          buildings: p1Buildings,
          clientele: [uids.material('Brick'), uids.material('Marble')],
          stockpile: [uids.material('Concrete'), uids.material('Rubble'), uids.material('Wood')],
          vault: [uids.material('Stone'), uids.material('Stone'), uids.material('Concrete'), uids.material('Brick')],
          influence: 5,
        };
        return p;
      }),
      sites: {
        Rubble: state.sites.Rubble - 2,
        Wood: state.sites.Wood - 1,
        Brick: state.sites.Brick - 1,
        Concrete: state.sites.Concrete - 2,
        Stone: state.sites.Stone - 1,
        Marble: state.sites.Marble - 1,
      },
    },
  };
}

/** Near end — sites almost depleted, one player close to winning */
export function nearEnd(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);

  const p0Buildings: Building[] = [
    mkBuilding(uids.card('statue'), [uids.card('market')], true),
    mkBuilding(uids.card('villa'), [uids.card('sanctuary'), uids.card('library')], true),
    mkBuilding(uids.card('barracks'), [uids.card('quarry')], true),
    mkBuilding(uids.card('road'), [uids.card('vomitorium'), uids.card('tower')], true),
  ];

  const p1Buildings: Building[] = [
    mkBuilding(uids.card('foundry'), [uids.card('school'), uids.card('shrine')], true),
    mkBuilding(uids.card('crane'), [uids.card('dock')], true),
    mkBuilding(uids.card('latrine'), [uids.card('fountain'), uids.card('stairway')], true),
    mkBuilding(uids.card('colosseum'), [uids.card('keep')], false),
  ];

  return {
    name: 'Near end',
    description: 'Sites nearly depleted, P0 ahead on VP, P1 trying to catch up',
    state: {
      ...finalize(state, uids),
      deck: state.deck.slice(0, 15),
      pool: [uids.material('Rubble'), uids.material('Brick'), uids.material('Marble')],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p,
          buildings: p0Buildings,
          clientele: [uids.material('Concrete'), uids.material('Wood'), uids.material('Stone'), uids.material('Rubble')],
          stockpile: [uids.material('Marble')],
          vault: [uids.material('Stone'), uids.material('Marble'), uids.material('Brick'), uids.material('Concrete'), uids.material('Wood')],
          influence: 5,
        };
        if (i === 1) return {
          ...p,
          buildings: p1Buildings,
          clientele: [uids.material('Brick'), uids.material('Marble'), uids.material('Concrete')],
          stockpile: [uids.material('Stone'), uids.material('Stone')],
          vault: [uids.material('Stone'), uids.material('Stone'), uids.material('Marble'), uids.material('Marble')],
          influence: 4,
        };
        return p;
      }),
      sites: { Rubble: 0, Wood: 0, Brick: 1, Concrete: 0, Stone: 1, Marble: 1 },
    },
  };
}

/** 3-player mid-game — tests multiplayer dynamics */
export function threePlayerMidGame(): Scenario {
  let { state, uids } = makeState(3, ['Alice', 'Bob', 'Carol'], 42);

  const p0Buildings: Building[] = [
    mkBuilding(uids.card('dock'), [uids.card('crane')], true),
    mkBuilding(uids.card('foundry'), [uids.card('school')], false),
  ];
  const p1Buildings: Building[] = [
    mkBuilding(uids.card('road'), [uids.card('vomitorium'), uids.card('tower')], true),
  ];
  const p2Buildings: Building[] = [
    mkBuilding(uids.card('barracks'), [uids.card('quarry')], true),
    mkBuilding(uids.card('library'), [uids.card('villa'), uids.card('sanctuary')], true),
  ];

  return {
    name: '3p mid-game',
    description: '3-player mid-game with varied board states',
    state: {
      ...finalize(state, uids),
      pool: [uids.material('Wood'), uids.material('Concrete'), uids.material('Brick'), uids.material('Stone')],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p, buildings: p0Buildings,
          clientele: [uids.material('Wood')],
          stockpile: [uids.material('Brick')],
          vault: [uids.material('Rubble')],
          influence: 2,
        };
        if (i === 1) return {
          ...p, buildings: p1Buildings,
          clientele: [uids.material('Concrete'), uids.material('Marble')],
          stockpile: [],
          vault: [uids.material('Brick'), uids.material('Stone')],
          influence: 3,
        };
        if (i === 2) return {
          ...p, buildings: p2Buildings,
          clientele: [uids.material('Rubble')],
          stockpile: [uids.material('Stone'), uids.material('Marble')],
          vault: [uids.material('Marble')],
          influence: 3,
        };
        return p;
      }),
      sites: {
        Rubble: state.sites.Rubble - 2,
        Wood: state.sites.Wood - 1,
        Brick: state.sites.Brick - 1,
        Concrete: state.sites.Concrete - 1,
        Stone: state.sites.Stone - 2,
        Marble: state.sites.Marble,
      },
    },
  };
}

/** Heavy vault game — both players focused on Merchant/vault strategy */
export function heavyVault(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);

  const p0Buildings: Building[] = [
    mkBuilding(uids.card('bazaar'), [uids.card('market')], true),
    mkBuilding(uids.card('atrium'), [uids.card('bath'), uids.card('stage')], true),
  ];
  const p1Buildings: Building[] = [
    mkBuilding(uids.card('basilica'), [uids.card('palace'), uids.card('temple')], true),
    mkBuilding(uids.card('garden'), [uids.card('sewer'), uids.card('keep')], true),
  ];

  return {
    name: 'Heavy vault',
    description: 'Merchant-focused game, large vaults, Bazaar/Atrium/Basilica in play',
    state: {
      ...finalize(state, uids),
      pool: [uids.material('Stone'), uids.material('Marble')],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p, buildings: p0Buildings,
          clientele: [uids.material('Stone'), uids.material('Stone')],
          stockpile: [uids.material('Marble'), uids.material('Stone'), uids.material('Brick')],
          vault: [uids.material('Stone'), uids.material('Stone'), uids.material('Marble')],
          influence: 3,
        };
        if (i === 1) return {
          ...p, buildings: p1Buildings,
          clientele: [uids.material('Stone'), uids.material('Marble'), uids.material('Concrete')],
          stockpile: [uids.material('Stone'), uids.material('Wood')],
          vault: [uids.material('Marble'), uids.material('Marble'), uids.material('Stone'), uids.material('Brick')],
          influence: 4,
        };
        return p;
      }),
      sites: {
        Rubble: state.sites.Rubble,
        Wood: state.sites.Wood - 1,
        Brick: state.sites.Brick - 1,
        Concrete: state.sites.Concrete,
        Stone: state.sites.Stone - 2,
        Marble: state.sites.Marble - 2,
      },
    },
  };
}

/** Deck almost empty — game will end in a few rounds from deck exhaustion */
export function deckAlmostOut(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);

  const p0Buildings: Building[] = [
    mkBuilding(uids.card('dock'), [uids.card('crane')], true),
    mkBuilding(uids.card('road'), [uids.card('vomitorium'), uids.card('tower')], true),
  ];
  const p1Buildings: Building[] = [
    mkBuilding(uids.card('foundry'), [uids.card('school'), uids.card('shrine')], true),
    mkBuilding(uids.card('latrine'), [uids.card('fountain')], false),
  ];

  return {
    name: 'Deck almost out',
    description: 'Only 3 cards left in deck — game ends when deck empties at end of round',
    state: {
      ...finalize(state, uids),
      deck: state.deck.slice(0, 3),
      pool: [uids.material('Wood'), uids.material('Brick')],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p, buildings: p0Buildings,
          clientele: [uids.material('Concrete'), uids.material('Wood')],
          stockpile: [uids.material('Stone'), uids.material('Marble')],
          vault: [uids.material('Stone'), uids.material('Brick')],
          influence: 3,
        };
        if (i === 1) return {
          ...p, buildings: p1Buildings,
          clientele: [uids.material('Brick')],
          stockpile: [uids.material('Rubble'), uids.material('Wood')],
          vault: [uids.material('Marble'), uids.material('Concrete')],
          influence: 2,
        };
        return p;
      }),
      sites: {
        Rubble: state.sites.Rubble - 1,
        Wood: state.sites.Wood - 1,
        Brick: state.sites.Brick - 1,
        Concrete: state.sites.Concrete - 1,
        Stone: state.sites.Stone - 1,
        Marble: state.sites.Marble,
      },
    },
  };
}

/** Game over — final scoring state */
export function gameOver(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);

  const p0Buildings: Building[] = [
    mkBuilding(uids.card('statue'), [uids.card('cross')], true),
    mkBuilding(uids.card('villa'), [uids.card('sanctuary'), uids.card('library')], true),
    mkBuilding(uids.card('road'), [uids.card('vomitorium'), uids.card('tower')], true),
    mkBuilding(uids.card('foundry'), [uids.card('school'), uids.card('shrine')], true),
  ];
  const p1Buildings: Building[] = [
    mkBuilding(uids.card('latrine'), [uids.card('fountain'), uids.card('stairway')], true),
    mkBuilding(uids.card('barracks'), [uids.card('quarry')], true),
    mkBuilding(uids.card('crane'), [uids.card('dock')], true),
  ];

  return {
    name: 'Game over',
    description: 'Finished game — view final scoring',
    state: {
      ...finalize(state, uids),
      pool: [uids.material('Rubble'), uids.material('Wood'), uids.material('Brick')],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p, buildings: p0Buildings,
          clientele: [uids.material('Concrete'), uids.material('Wood'), uids.material('Stone'), uids.material('Rubble')],
          stockpile: [],
          vault: [uids.material('Stone'), uids.material('Marble'), uids.material('Brick'), uids.material('Concrete'), uids.material('Wood'), uids.material('Rubble')],
          influence: 6,
        };
        if (i === 1) return {
          ...p, buildings: p1Buildings,
          clientele: [uids.material('Brick'), uids.material('Marble')],
          stockpile: [uids.material('Stone')],
          vault: [uids.material('Stone'), uids.material('Marble'), uids.material('Marble')],
          influence: 4,
        };
        return p;
      }),
      phase: { type: 'gameOver' },
      sites: { Rubble: 0, Wood: 0, Brick: 0, Concrete: 0, Stone: 1, Marble: 1 },
    },
  };
}

/** Near building diversity end — player 0 has 2x Rubble, 2x Brick, 1x Stone complete + 1 Stone almost done */
export function nearDiversityEnd(): Scenario {
  let { state, uids } = makeState(2, ['Alice', 'Bob'], 42);

  const p0Buildings: Building[] = [
    // 2x Rubble (cost 1) — same material
    mkBuilding(uids.card('barracks'), [uids.card('quarry')], true),
    mkBuilding(uids.card('bridge'), [uids.card('junkyard')], true),
    // 2x Brick (cost 2) — same material
    mkBuilding(uids.card('foundry'), [uids.card('school'), uids.card('shrine')], true),
    mkBuilding(uids.card('stage'), [uids.card('bath'), uids.card('atrium')], true),
    // 1x Stone (cost 3) complete
    mkBuilding(uids.card('villa'), [uids.card('sanctuary'), uids.card('library')], true),
    // 1x Stone (cost 3) needs one more material
    mkBuilding(uids.card('sewer'), [uids.card('garden'), uids.card('keep')], false),
  ];

  const p1Buildings: Building[] = [
    mkBuilding(uids.card('palisade'), [uids.card('market')], true),
    mkBuilding(uids.card('amphitheatre'), [uids.card('wall')], false),
  ];

  // Give player 0 a Stone card in hand to complete the sewer
  const stoneCard = uids.material('Stone');
  // Also give a Stone in stockpile as alternative completion path via Laborer
  const stoneStockpile = uids.material('Stone');

  return {
    name: 'Near diversity end',
    description: 'Player 0 one Stone material away from 2-2-2 same-type building diversity (game end trigger)',
    state: {
      ...finalize(state, uids),
      pool: [uids.material('Rubble'), uids.material('Wood'), uids.material('Stone')],
      players: state.players.map((p, i) => {
        if (i === 0) return {
          ...p,
          buildings: p0Buildings,
          hand: [stoneCard, ...p.hand.slice(0, 4)],
          stockpile: [stoneStockpile],
          vault: [uids.material('Stone'), uids.material('Brick')],
          clientele: [uids.material('Concrete'), uids.material('Wood')],
          influence: 9, // 1+1+2+2+3 from completed buildings
        };
        if (i === 1) return {
          ...p,
          buildings: p1Buildings,
          clientele: [uids.material('Brick')],
          stockpile: [uids.material('Rubble')],
          vault: [uids.material('Stone')],
          influence: 1,
        };
        return p;
      }),
      sites: {
        Rubble: state.sites.Rubble - 2,
        Wood: state.sites.Wood,
        Brick: state.sites.Brick - 2,
        Concrete: state.sites.Concrete,
        Stone: state.sites.Stone - 2,
        Marble: state.sites.Marble,
      },
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
  lateGame(),
  nearEnd(),
  threePlayerMidGame(),
  heavyVault(),
  deckAlmostOut(),
  nearDiversityEnd(),
  gameOver(),
];
