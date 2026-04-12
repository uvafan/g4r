import { GameState } from './types';
import { createInitialState } from './engine';
import { seededRng, makeScenarioState, mkBuilding, buildScenario, withActionPhase } from './stateBuilder';

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
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 100);
  const result = buildScenario(state, pool, [{}, {}]);
  return {
    name: 'Architect action',
    description: 'Player 0 in Architect action phase',
    state: withActionPhase(result, 'Architect'),
  };
}

/** Craftsman action with an open Brick building */
export function craftsmanWithBuilding(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 200);
  const foundation = pool.card('foundry');
  const building = mkBuilding(foundation, [], false);
  // Ensure P0 has a Brick card in hand for adding material
  const brickCard = pool.material('Brick');
  pool.returnCards(state.players[0]!.hand);
  const hand = [brickCard, pool.material('Wood'), pool.material('Concrete'), pool.material('Stone'), pool.material('Rubble')];
  const result = buildScenario(state, pool, [{ buildings: [building], hand }, {}]);
  return {
    name: 'Craftsman with building',
    description: 'Player 0 has open Brick building, Craftsman action',
    state: withActionPhase(result, 'Craftsman'),
  };
}

/** Legionary action — player 0 can reveal, player 1 has matching cards */
export function legionaryAction(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const p0Wood = pool.material('Wood');
  const p1Wood = pool.material('Wood');
  const poolWood = pool.material('Wood');
  const result = buildScenario(state, pool, [
    { hand: [p0Wood, ...state.players[0]!.hand] },
    { hand: [p1Wood, ...state.players[1]!.hand] },
  ], [poolWood]);
  return {
    name: 'Legionary action',
    description: 'Player 0 Legionary with Wood cards in pool + opponent hand',
    state: withActionPhase(result, 'Legionary'),
  };
}

/** Laborer action — pool has materials to take */
export function laborerAction(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const gamePool = [pool.material('Wood'), pool.material('Brick'), pool.material('Rubble')];
  const result = buildScenario(state, pool, [{}, {}], gamePool);
  return {
    name: 'Laborer action',
    description: 'Player 0 Laborer with 3 materials in pool',
    state: withActionPhase(result, 'Laborer'),
  };
}

/** Merchant action — player 0 has materials in stockpile and influence to vault */
export function merchantAction(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const building = mkBuilding(pool.card('barracks'), [pool.material('Rubble')], true);
  const stockpile = [pool.material('Stone'), pool.material('Brick')];
  const result = buildScenario(state, pool, [{ buildings: [building], stockpile }, {}]);
  return {
    name: 'Merchant action',
    description: 'Player 0 Merchant with Stone + Brick in stockpile, 1 influence',
    state: withActionPhase(result, 'Merchant'),
  };
}

/** Patron action — pool has cards to hire as clients */
export function patronAction(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const buildings = [
    mkBuilding(pool.card('road'), [pool.material('Concrete'), pool.material('Concrete')], true),
    mkBuilding(pool.card('barracks'), [pool.material('Rubble')], true),
  ];
  const gamePool = [pool.material('Wood'), pool.material('Concrete')];
  const result = buildScenario(state, pool, [{ buildings }, {}], gamePool);
  return {
    name: 'Patron action',
    description: 'Player 0 Patron with Wood + Concrete clients available in pool',
    state: withActionPhase(result, 'Patron'),
  };
}

/** Mid-game with completed buildings, clientele, vault, etc. */
export function midGame(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);

  const p0Buildings = [
    mkBuilding(pool.card('barracks'), [pool.material('Rubble')], true),
    mkBuilding(pool.card('foundry'), [pool.material('Brick')], false),
  ];
  const p1Buildings = [
    mkBuilding(pool.card('villa'), [pool.material('Stone'), pool.material('Stone'), pool.material('Stone')], true),
  ];

  const gamePool = [pool.material('Wood'), pool.material('Concrete')];

  return {
    name: 'Mid-game',
    description: '2p mid-game: buildings, clients, stockpile, vault',
    state: buildScenario(state, pool, [
      {
        buildings: p0Buildings,
        clientele: [pool.material('Concrete')],
        stockpile: [pool.material('Wood')],
        vault: [pool.material('Stone')],
      },
      {
        buildings: p1Buildings,
        clientele: [pool.material('Marble')],
        vault: [pool.material('Brick'), pool.material('Brick')],
      },
    ], gamePool),
  };
}

/** Clientele production — player 0 has Architect client and is leading */
export function clienteleProduction(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const building = mkBuilding(pool.card('villa'), [pool.material('Stone'), pool.material('Stone'), pool.material('Stone')], true);
  const client = pool.material('Concrete');
  const result = buildScenario(state, pool, [
    { buildings: [building], clientele: [client] },
    {},
  ]);
  return {
    name: 'Clientele production',
    description: 'Player 0 has Architect client (gets extra Architect actions)',
    state: result,
  };
}

/** Late game — both players have multiple completed buildings, full clientele, vaults */
export function lateGame(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);

  const p0Buildings = [
    mkBuilding(pool.card('barracks'), [pool.material('Rubble')], true),
    mkBuilding(pool.card('crane'), [pool.material('Wood')], true),
    mkBuilding(pool.card('road'), [pool.material('Concrete'), pool.material('Concrete')], true),
    mkBuilding(pool.card('villa'), [pool.material('Stone'), pool.material('Stone')], false), // 2 of 3
  ];

  const p1Buildings = [
    mkBuilding(pool.card('foundry'), [pool.material('Brick'), pool.material('Brick')], true),
    mkBuilding(pool.card('latrine'), [pool.material('Marble'), pool.material('Marble'), pool.material('Marble')], true),
    mkBuilding(pool.card('amphitheatre'), [pool.material('Concrete')], false), // 1 of 2
  ];

  const gamePool = [pool.material('Rubble'), pool.material('Wood')];

  return {
    name: 'Late game',
    description: '2p late game: many buildings, full clientele, depleted sites',
    state: buildScenario(state, pool, [
      {
        buildings: p0Buildings,
        clientele: [pool.material('Concrete'), pool.material('Wood'), pool.material('Stone')],
        stockpile: [pool.material('Stone'), pool.material('Marble')],
        vault: [pool.material('Stone'), pool.material('Marble'), pool.material('Brick')],
      },
      {
        buildings: p1Buildings,
        clientele: [pool.material('Brick'), pool.material('Marble')],
        stockpile: [pool.material('Concrete'), pool.material('Rubble'), pool.material('Wood')],
        vault: [pool.material('Stone'), pool.material('Stone'), pool.material('Concrete'), pool.material('Brick')],
      },
    ], gamePool),
  };
}

/** Near end — small deck, one player close to winning */
export function nearEnd(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);

  const p0Buildings = [
    mkBuilding(pool.card('statue'), [pool.material('Wood')], true),
    mkBuilding(pool.card('crane'), [pool.material('Wood')], true),
    mkBuilding(pool.card('road'), [pool.material('Concrete'), pool.material('Concrete')], true),
    mkBuilding(pool.card('villa'), [pool.material('Stone'), pool.material('Stone'), pool.material('Stone')], true),
  ];

  const p1Buildings = [
    mkBuilding(pool.card('foundry'), [pool.material('Brick'), pool.material('Brick')], true),
    mkBuilding(pool.card('palisade'), [pool.material('Wood')], true),
    mkBuilding(pool.card('latrine'), [pool.material('Marble'), pool.material('Marble'), pool.material('Marble')], true),
    mkBuilding(pool.card('colosseum'), [pool.material('Stone')], false), // 1 of 3
  ];

  const gamePool = [pool.material('Rubble'), pool.material('Brick'), pool.material('Marble')];

  return {
    name: 'Near end',
    description: 'Small deck, P0 ahead on VP, P1 trying to catch up',
    state: buildScenario(state, pool, [
      {
        buildings: p0Buildings,
        clientele: [pool.material('Concrete'), pool.material('Wood'), pool.material('Stone'), pool.material('Rubble')],
        stockpile: [pool.material('Marble')],
        vault: [pool.material('Stone'), pool.material('Marble'), pool.material('Brick'), pool.material('Concrete'), pool.material('Wood')],
      },
      {
        buildings: p1Buildings,
        clientele: [pool.material('Brick'), pool.material('Marble'), pool.material('Concrete')],
        stockpile: [pool.material('Stone'), pool.material('Stone')],
        vault: [pool.material('Stone'), pool.material('Stone'), pool.material('Marble'), pool.material('Marble')],
      },
    ], gamePool, { deckSize: 15 }),
  };
}

/** 3-player mid-game — tests multiplayer dynamics */
export function threePlayerMidGame(): Scenario {
  const { state, pool } = makeScenarioState(3, ['Alice', 'Bob', 'Carol'], 42);

  const p0Buildings = [
    mkBuilding(pool.card('dock'), [pool.material('Wood')], true),
    mkBuilding(pool.card('foundry'), [pool.material('Brick')], false), // 1 of 2
  ];
  const p1Buildings = [
    mkBuilding(pool.card('road'), [pool.material('Concrete'), pool.material('Concrete')], true),
  ];
  const p2Buildings = [
    mkBuilding(pool.card('barracks'), [pool.material('Rubble')], true),
    mkBuilding(pool.card('library'), [pool.material('Stone'), pool.material('Stone'), pool.material('Stone')], true),
  ];

  const gamePool = [pool.material('Wood'), pool.material('Concrete'), pool.material('Brick'), pool.material('Stone')];

  return {
    name: '3p mid-game',
    description: '3-player mid-game with varied board states',
    state: buildScenario(state, pool, [
      {
        buildings: p0Buildings,
        clientele: [pool.material('Wood')],
        stockpile: [pool.material('Brick')],
        vault: [pool.material('Rubble')],
      },
      {
        buildings: p1Buildings,
        clientele: [pool.material('Concrete')],
        vault: [pool.material('Brick'), pool.material('Stone')],
      },
      {
        buildings: p2Buildings,
        clientele: [pool.material('Rubble')],
        stockpile: [pool.material('Stone'), pool.material('Marble')],
        vault: [pool.material('Marble')],
      },
    ], gamePool),
  };
}

/** Heavy vault game — both players focused on Merchant/vault strategy */
export function heavyVault(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);

  const p0Buildings = [
    mkBuilding(pool.card('bazaar'), [pool.material('Wood')], true),
    mkBuilding(pool.card('atrium'), [pool.material('Brick'), pool.material('Brick')], true),
  ];
  const p1Buildings = [
    mkBuilding(pool.card('basilica'), [pool.material('Marble'), pool.material('Marble'), pool.material('Marble')], true),
    mkBuilding(pool.card('garden'), [pool.material('Stone'), pool.material('Stone'), pool.material('Stone')], true),
  ];

  const gamePool = [pool.material('Stone'), pool.material('Marble')];

  return {
    name: 'Heavy vault',
    description: 'Merchant-focused game, large vaults, Bazaar/Atrium/Basilica in play',
    state: buildScenario(state, pool, [
      {
        buildings: p0Buildings,
        clientele: [pool.material('Stone'), pool.material('Stone')],
        stockpile: [pool.material('Marble'), pool.material('Stone'), pool.material('Brick')],
        vault: [pool.material('Stone'), pool.material('Stone'), pool.material('Marble')],
      },
      {
        buildings: p1Buildings,
        clientele: [pool.material('Stone'), pool.material('Marble'), pool.material('Concrete')],
        stockpile: [pool.material('Stone'), pool.material('Wood')],
        vault: [pool.material('Marble'), pool.material('Marble'), pool.material('Stone'), pool.material('Brick')],
      },
    ], gamePool),
  };
}

/** Deck almost empty — game will end in a few rounds from deck exhaustion */
export function deckAlmostOut(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);

  const p0Buildings = [
    mkBuilding(pool.card('dock'), [pool.material('Wood')], true),
    mkBuilding(pool.card('road'), [pool.material('Concrete'), pool.material('Concrete')], true),
  ];
  const p1Buildings = [
    mkBuilding(pool.card('foundry'), [pool.material('Brick'), pool.material('Brick')], true),
    mkBuilding(pool.card('latrine'), [pool.material('Marble')], false), // 1 of 3
  ];

  const gamePool = [pool.material('Wood'), pool.material('Brick')];

  return {
    name: 'Deck almost out',
    description: 'Only 3 cards left in deck — game ends when deck empties at end of round',
    state: buildScenario(state, pool, [
      {
        buildings: p0Buildings,
        clientele: [pool.material('Concrete'), pool.material('Wood')],
        stockpile: [pool.material('Stone'), pool.material('Marble')],
        vault: [pool.material('Stone'), pool.material('Brick')],
      },
      {
        buildings: p1Buildings,
        clientele: [pool.material('Brick')],
        stockpile: [pool.material('Rubble'), pool.material('Wood')],
        vault: [pool.material('Marble'), pool.material('Concrete')],
      },
    ], gamePool, { deckSize: 3 }),
  };
}

/** Statue power — completed Statue gives +3 VP */
export function statuePower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);

  const p0Buildings = [
    mkBuilding(pool.card('statue'), [pool.material('Wood')], true),
  ];
  const p1Buildings = [
    mkBuilding(pool.card('crane'), [pool.material('Wood')], true),
  ];

  return {
    name: 'Statue power (+3 VP)',
    description: 'Player 0 has completed Statue — should see +3 VP building bonus',
    state: buildScenario(state, pool, [
      { buildings: p0Buildings },
      { buildings: p1Buildings },
    ]),
  };
}

/** Game over — final scoring state */
export function gameOver(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);

  const p0Buildings = [
    mkBuilding(pool.card('statue'), [pool.material('Wood')], true),
    mkBuilding(pool.card('crane'), [pool.material('Wood')], true),
    mkBuilding(pool.card('road'), [pool.material('Concrete'), pool.material('Concrete')], true),
    mkBuilding(pool.card('foundry'), [pool.material('Brick'), pool.material('Brick')], true),
  ];
  const p1Buildings = [
    mkBuilding(pool.card('latrine'), [pool.material('Marble'), pool.material('Marble'), pool.material('Marble')], true),
    mkBuilding(pool.card('barracks'), [pool.material('Rubble')], true),
    mkBuilding(pool.card('dock'), [pool.material('Wood')], true),
  ];

  const gamePool = [pool.material('Rubble'), pool.material('Wood'), pool.material('Brick')];

  const result = buildScenario(state, pool, [
    {
      buildings: p0Buildings,
      clientele: [pool.material('Concrete'), pool.material('Wood'), pool.material('Stone'), pool.material('Rubble')],
      vault: [pool.material('Stone'), pool.material('Marble'), pool.material('Brick'), pool.material('Concrete'), pool.material('Wood')],
    },
    {
      buildings: p1Buildings,
      clientele: [pool.material('Brick'), pool.material('Marble')],
      stockpile: [pool.material('Stone')],
      vault: [pool.material('Stone'), pool.material('Marble'), pool.material('Marble')],
    },
  ], gamePool);

  return {
    name: 'Game over',
    description: 'Finished game — view final scoring',
    state: { ...result, phase: { type: 'gameOver' } },
  };
}

/** Near building diversity end — player 0 has 2x Rubble, 2x Brick, 1x Stone complete + 1 Stone almost done */
export function nearDiversityEnd(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);

  const p0Buildings = [
    // 2x Rubble (cost 1)
    mkBuilding(pool.card('barracks'), [pool.material('Rubble')], true),
    mkBuilding(pool.card('bridge'), [pool.material('Rubble')], true),
    // 2x Brick (cost 2)
    mkBuilding(pool.card('foundry'), [pool.material('Brick'), pool.material('Brick')], true),
    mkBuilding(pool.card('stage'), [pool.material('Brick'), pool.material('Brick')], true),
    // 1x Stone (cost 3) complete
    mkBuilding(pool.card('villa'), [pool.material('Stone'), pool.material('Stone'), pool.material('Stone')], true),
    // 1x Stone (cost 3) needs one more material
    mkBuilding(pool.card('sewer'), [pool.material('Stone'), pool.material('Stone')], false),
  ];

  const p1Buildings = [
    mkBuilding(pool.card('palisade'), [pool.material('Wood')], true),
    mkBuilding(pool.card('amphitheatre'), [pool.material('Concrete')], false), // 1 of 2
  ];

  // Give player 0 a Stone card in hand to complete the sewer
  const stoneCard = pool.material('Stone');
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [stoneCard, pool.material('Wood'), pool.material('Concrete'), pool.material('Marble'), pool.material('Rubble')];

  const gamePool = [pool.material('Rubble'), pool.material('Wood'), pool.material('Stone')];

  return {
    name: 'Near diversity end',
    description: 'Player 0 one Stone material away from 2-2-2 same-type building diversity (game end trigger)',
    state: buildScenario(state, pool, [
      {
        buildings: p0Buildings,
        hand: p0Hand,
        stockpile: [pool.material('Stone')],
        vault: [pool.material('Stone'), pool.material('Brick')],
        clientele: [pool.material('Concrete'), pool.material('Wood')],
      },
      {
        buildings: p1Buildings,
        clientele: [pool.material('Brick')],
        stockpile: [pool.material('Rubble')],
        vault: [pool.material('Stone')],
      },
    ], gamePool),
  };
}

/** Cross power — +1 refresh hand size */
export function crossPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const building = mkBuilding(pool.card('cross'), [pool.material('Wood')], true);
  pool.returnCards(state.players[0]!.hand);
  const hand = [pool.material('Rubble'), pool.material('Brick'), pool.material('Concrete')];
  return {
    name: 'Cross power (+1 hand size)',
    description: 'Player 0 has completed Cross — refresh draws to 6 instead of 5',
    state: buildScenario(state, pool, [{ buildings: [building], hand }, {}]),
  };
}

/** Market power — on completion, take 1 of each material from Generic Supply */
export function marketPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const marketBuilding = mkBuilding(pool.card('market'), [], false); // needs 1 Wood material
  const woodCard = pool.material('Wood');
  pool.returnCards(state.players[0]!.hand);
  const hand = [woodCard, pool.material('Brick'), pool.material('Concrete'), pool.material('Stone'), pool.material('Marble')];
  return {
    name: 'Market power (complete it)',
    description: 'Player 0 has Market nearly complete — finish it to see generic supply materials added to hand',
    state: withActionPhase(
      buildScenario(state, pool, [{ buildings: [marketBuilding], hand }, {}]),
      'Craftsman',
    ),
  };
}

/** Dock power — Laborer: put 1 card from hand to stockpile */
export function dockPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const building = mkBuilding(pool.card('dock'), [pool.material('Wood')], true);
  const gamePool = [pool.material('Wood'), pool.material('Brick')];
  return {
    name: 'Dock power (Laborer)',
    description: 'Player 0 has completed Dock — can move hand cards to stockpile during Laborer',
    state: withActionPhase(
      buildScenario(state, pool, [{ buildings: [building] }, {}], gamePool),
      'Laborer',
    ),
  };
}

/** Bazaar power — Merchant: move pool material to vault */
export function bazaarPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const building = mkBuilding(pool.card('bazaar'), [pool.material('Wood')], true);
  const gamePool = [pool.material('Stone'), pool.material('Marble'), pool.material('Brick')];
  return {
    name: 'Bazaar power (Merchant)',
    description: 'Player 0 has completed Bazaar — can vault materials directly from pool',
    state: withActionPhase(
      buildScenario(state, pool, [
        { buildings: [building], stockpile: [pool.material('Wood')] },
        {},
      ], gamePool),
      'Merchant',
    ),
  };
}

/** Crane power — Architect: start 2 buildings from hand */
export function cranePower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const building = mkBuilding(pool.card('crane'), [pool.material('Wood')], true);
  const brickCard = pool.card('foundry');
  const stoneCard = pool.card('villa');
  const concreteCard = pool.card('road');
  pool.returnCards(state.players[0]!.hand);
  const hand = [brickCard, stoneCard, concreteCard, pool.material('Marble'), pool.material('Rubble')];
  return {
    name: 'Crane power (Architect)',
    description: 'Player 0 has completed Crane — select a card then click "Crane" to start 2 buildings',
    state: withActionPhase(
      buildScenario(state, pool, [{ buildings: [building], hand }, {}]),
      'Architect',
    ),
  };
}

/** Archway power — first incomplete Marble building provides its function */
export function archwayPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const archwayBuilding = mkBuilding(pool.card('archway'), [pool.material('Wood')], true);
  const templeBuilding = mkBuilding(pool.card('temple'), [pool.material('Marble')], false); // 1 of 3
  pool.returnCards(state.players[0]!.hand);
  const hand = [pool.material('Rubble'), pool.material('Brick'), pool.material('Concrete')];
  return {
    name: 'Archway power',
    description: 'Player 0 has Archway + incomplete Temple — Temple power activates via Archway (will work when Marble powers are implemented)',
    state: buildScenario(state, pool, [
      { buildings: [archwayBuilding, templeBuilding], hand },
      {},
    ]),
  };
}

/** Palisade power — blocks odd-numbered legionary demands */
export function palisadePower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  // P0 needs a completed Brick building for influence + Brick clients for multiple Legionary actions
  const p0Building = mkBuilding(pool.card('foundry'), [pool.material('Brick'), pool.material('Brick')], true);
  const p1Building = mkBuilding(pool.card('palisade'), [pool.material('Wood')], true);

  // P0 Legionary clients (Brick material) — 2 clients for 3 total actions
  const p0Clients = [pool.material('Brick'), pool.material('Brick')];

  // P0 hand: Wood cards to reveal for legionary demands
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [pool.material('Wood'), pool.material('Wood'), pool.material('Wood')];

  // P1 hand: Wood cards that match the demand
  pool.returnCards(state.players[1]!.hand);
  const p1Hand = [pool.material('Wood'), pool.material('Wood'), pool.material('Wood')];

  const gamePool = [pool.material('Wood'), pool.material('Wood')];

  const result = buildScenario(state, pool, [
    { buildings: [p0Building], clientele: p0Clients, hand: p0Hand },
    { buildings: [p1Building], hand: p1Hand },
  ], gamePool);

  return {
    name: 'Palisade power (Legionary)',
    description: 'Player 1 has Palisade — 1st, 3rd, 5th legionary demands from each player are blocked',
    // P0: 1 (led) + 2 (Brick clients) = 3 actions
    state: withActionPhase(result, 'Legionary', [0, 0, 0]),
  };
}

/** Vat power — Concrete buildings need only 1 material */
export function vatPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const vatBuilding = mkBuilding(pool.card('vat'), [pool.card('quarry')], true);
  const concreteBuilding = mkBuilding(pool.card('road'), [], false);
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [pool.material('Concrete'), pool.material('Concrete')];
  return {
    name: 'Vat power (Concrete)',
    description: 'Player 0 has Vat — Concrete buildings need only 1 material to complete',
    state: withActionPhase(buildScenario(state, pool, [
      { buildings: [vatBuilding, concreteBuilding], hand: p0Hand },
      {},
    ]), 'Craftsman'),
  };
}

/** Fortress power — pairs of same-type clients count as Legionary */
export function fortressPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const fortressBuilding = mkBuilding(pool.card('fortress'), [pool.card('quarry')], true);
  // Need a high-cost building for enough influence to hold 4 clients
  const villaBuilding = mkBuilding(pool.card('villa'), [pool.material('Stone'), pool.material('Stone'), pool.material('Stone')], true);
  const clients = [pool.material('Wood'), pool.material('Wood'), pool.material('Stone'), pool.material('Stone')];
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [pool.material('Brick'), pool.material('Brick')];
  return {
    name: 'Fortress power (Legionary)',
    description: 'Player 0 has Fortress + 2 pairs of clients — gets bonus Legionary actions',
    state: withActionPhase(buildScenario(state, pool, [
      { buildings: [fortressBuilding, villaBuilding], clientele: clients, hand: p0Hand },
      {},
    ]), 'Legionary', [0, 0, 0]),
  };
}

/** Barracks power — take all matching materials from pool and demand */
export function barracksPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const barracksBuilding = mkBuilding(pool.card('barracks'), [pool.card('quarry')], true);
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [pool.material('Wood'), pool.material('Wood')];
  pool.returnCards(state.players[1]!.hand);
  const p1Hand = [pool.material('Wood'), pool.material('Wood'), pool.material('Brick')];
  const gamePool = [pool.material('Wood'), pool.material('Wood'), pool.material('Brick')];
  return {
    name: 'Barracks power (Legionary)',
    description: 'Player 0 has Barracks — takes ALL matching from pool + demands ALL from neighbors',
    state: withActionPhase(buildScenario(state, pool, [
      { buildings: [barracksBuilding], hand: p0Hand },
      { hand: p1Hand },
    ], gamePool), 'Legionary'),
  };
}

/** Bridge power — take from opponents' stockpiles */
export function bridgePower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const bridgeBuilding = mkBuilding(pool.card('bridge'), [pool.card('quarry')], true);
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [pool.material('Wood'), pool.material('Stone')];
  const p1Stockpile = [pool.material('Wood'), pool.material('Stone'), pool.material('Brick')];
  return {
    name: 'Bridge power (Legionary)',
    description: 'Player 0 has Bridge — can take materials from opponents stockpiles instead of demanding',
    state: withActionPhase(buildScenario(state, pool, [
      { buildings: [bridgeBuilding], hand: p0Hand },
      { stockpile: p1Stockpile },
    ]), 'Legionary'),
  };
}

/** Junkyard power — upon completion, hand to stockpile */
export function junkyardPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const junkyardBuilding = mkBuilding(pool.card('junkyard'), [], false);
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [pool.material('Rubble'), pool.material('Wood'), pool.material('Brick')];
  let s = buildScenario(state, pool, [
    { buildings: [junkyardBuilding], hand: p0Hand },
    {},
  ]);
  // Add 2 Jacks to Alice's hand
  const jack1 = { uid: s.nextUid, defId: 'jack' };
  const jack2 = { uid: s.nextUid + 1, defId: 'jack' };
  s = {
    ...s,
    nextUid: s.nextUid + 2,
    jackPile: s.jackPile - 2,
    players: s.players.map((p, i) =>
      i === 0 ? { ...p, hand: [...p.hand, jack1, jack2] } : p
    ),
  };
  return {
    name: 'Junkyard power (completion)',
    description: 'Player 0 has Junkyard nearly complete — finish it to move hand to stockpile (keep Jacks option)',
    state: withActionPhase(s, 'Craftsman'),
  };
}

/** Quarry power — free Craftsman action after building completion */
export function quarryPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const quarryBuilding = mkBuilding(pool.card('quarry'), [pool.card('barracks')], true);
  const brickBuilding = mkBuilding(pool.card('foundry'), [pool.material('Brick')], false);
  const concreteBuilding = mkBuilding(pool.card('road'), [], false);
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [pool.material('Brick'), pool.material('Concrete'), pool.material('Concrete')];
  return {
    name: 'Quarry power (Craftsman)',
    description: 'Player 0 has Quarry — complete Foundry to get a free Craftsman action on Road',
    state: withActionPhase(buildScenario(state, pool, [
      { buildings: [quarryBuilding, brickBuilding, concreteBuilding], hand: p0Hand },
      {},
    ]), 'Craftsman'),
  };
}

/** Encampment power — start building of same type after completion */
export function encampmentPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const encampmentBuilding = mkBuilding(pool.card('encampment'), [pool.card('barracks')], true);
  const woodBuilding = mkBuilding(pool.card('crane'), [], false);
  pool.returnCards(state.players[0]!.hand);
  const p0Hand = [pool.material('Wood'), pool.card('dock'), pool.card('market')];
  return {
    name: 'Encampment power (start)',
    description: 'Player 0 has Encampment — complete Crane to start another Wood building free',
    state: withActionPhase(buildScenario(state, pool, [
      { buildings: [encampmentBuilding, woodBuilding], hand: p0Hand },
      {},
    ]), 'Craftsman'),
  };
}

/** Scriptorium power — Craftsman/Laborer can use pool cards */
export function scriptoriumPower(): Scenario {
  const { state, pool } = makeScenarioState(2, ['Alice', 'Bob'], 42);
  const scripBuilding = mkBuilding(pool.card('scriptorium'), [pool.card('quarry')], true);
  const brickBuilding = mkBuilding(pool.card('foundry'), [], false);
  const concreteBuilding = mkBuilding(pool.card('road'), [], false);
  const gamePool = [pool.material('Brick'), pool.material('Concrete'), pool.material('Wood')];
  return {
    name: 'Scriptorium power (Craftsman)',
    description: 'Player 0 has Scriptorium — can add materials from pool to buildings during Craftsman/Laborer',
    state: withActionPhase(buildScenario(state, pool, [
      { buildings: [scripBuilding, brickBuilding, concreteBuilding] },
      {},
    ], gamePool), 'Craftsman'),
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
  statuePower(),
  gameOver(),
  crossPower(),
  marketPower(),
  dockPower(),
  bazaarPower(),
  cranePower(),
  palisadePower(),
  archwayPower(),
  vatPower(),
  fortressPower(),
  barracksPower(),
  bridgePower(),
  junkyardPower(),
  quarryPower(),
  encampmentPower(),
  scriptoriumPower(),
];
