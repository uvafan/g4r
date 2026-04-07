import { describe, it, expect } from 'vitest';
import { createInitialState, gameReducer, getActivePlayerId, getAvailableActions } from './engine';
import { getCardDef, CARD_DEFS, MATERIAL_TO_ROLE, ROLE_TO_MATERIAL, isGenericCard, genericDefIdForMaterial, isJackCard } from './cards';
import { GameState, Card, Building } from './types';

// Seeded RNG for deterministic tests
function seededRng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe('createInitialState', () => {
  it('creates correct number of players with 5 cards each', () => {
    const state = createInitialState(2, ['Alice', 'Bob'], seededRng(42));
    expect(state.players).toHaveLength(2);
    expect(state.players[0]!.hand).toHaveLength(5);
    expect(state.players[1]!.hand).toHaveLength(5);
    expect(state.players[0]!.name).toBe('Alice');
    expect(state.players[1]!.name).toBe('Bob');
  });

  it('starts with 0 influence', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(state.players[0]!.influence).toBe(0);
    expect(state.players[1]!.influence).toBe(0);
  });

  it('has correct deck size (144 - dealt cards)', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    // 48 cards * 3 copies = 144, minus 10 dealt
    expect(state.deck.length).toBe(134);
  });

  it('has correct site counts', () => {
    const state = createInitialState(3, ['A', 'B', 'C'], seededRng(42));
    expect(state.sites.Rubble).toBe(3);
    expect(state.sites.Wood).toBe(3);
    expect(state.sites.Brick).toBe(3);
    expect(state.sites.Concrete).toBe(3);
    expect(state.sites.Stone).toBe(3);
    expect(state.sites.Marble).toBe(3);
  });

  it('starts in lead phase with player 0', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(state.phase).toEqual({ type: 'lead', leaderId: 0 });
    expect(state.leadPlayerIdx).toBe(0);
  });
});

describe('Think action', () => {
  it('leader think: all players draw cards', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Remove some cards from player 0's hand to test draw
    const modState: GameState = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.slice(0, 2) } : p
      ),
    };
    const newState = gameReducer(modState, { type: 'THINK', option: { kind: 'refresh' } });
    // Player 0 had 2 cards, should draw to 5
    expect(newState.players[0]!.hand).toHaveLength(5);
    // Player 1 had 5 cards, should draw 1
    expect(newState.players[1]!.hand).toHaveLength(6);
    // Should advance leader
    expect(newState.phase).toEqual({ type: 'lead', leaderId: 1 });
  });

  it('think at hand limit draws 1 card', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    const newState = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });
    // Both players had 5 cards (at limit), each draws 1
    expect(newState.players[0]!.hand).toHaveLength(6);
    expect(newState.players[1]!.hand).toHaveLength(6);
  });
});

describe('Lead and Follow', () => {
  function getStateWithConcreteCard(): { state: GameState; concreteCardUid: number } {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Find a concrete card in player 0's hand
    const concreteCard = state.players[0]!.hand.find(
      c => getCardDef(c).material === 'Concrete'
    );

    if (!concreteCard) {
      // Give player 0 a concrete card
      const concreteDef = CARD_DEFS.find(d => d.material === 'Concrete')!;
      const fakeCard = { uid: 9999, defId: concreteDef.id };
      state = {
        ...state,
        players: state.players.map((p, i) =>
          i === 0 ? { ...p, hand: [...p.hand, fakeCard] } : p
        ),
      };
      return { state, concreteCardUid: 9999 };
    }

    return { state, concreteCardUid: concreteCard.uid };
  }

  it('leading Architect moves card to pool and enters follow phase', () => {
    const { state, concreteCardUid } = getStateWithConcreteCard();
    const handBefore = state.players[0]!.hand.length;

    const newState = gameReducer(state, {
      type: 'LEAD_ROLE',
      role: 'Architect',
      cardUid: concreteCardUid,
    });

    expect(newState.players[0]!.hand).toHaveLength(handBefore - 1);
    expect(newState.pool.some(c => c.uid === concreteCardUid)).toBe(true);
    expect(newState.phase.type).toBe('follow');
    if (newState.phase.type === 'follow') {
      expect(newState.phase.ledRole).toBe('Architect');
      expect(newState.phase.followers).toEqual([1]);
    }
  });

  it('following with matching card adds player to actors', () => {
    const { state, concreteCardUid } = getStateWithConcreteCard();
    let newState = gameReducer(state, {
      type: 'LEAD_ROLE',
      role: 'Architect',
      cardUid: concreteCardUid,
    });

    // Find a concrete card in player 1's hand
    const p1Concrete = newState.players[1]!.hand.find(
      c => getCardDef(c).material === 'Concrete'
    );

    if (p1Concrete) {
      newState = gameReducer(newState, {
        type: 'FOLLOW_ROLE',
        cardUid: p1Concrete.uid,
      });
      expect(newState.phase.type).toBe('action');
      if (newState.phase.type === 'action') {
        expect(newState.phase.actors).toContain(0);
        expect(newState.phase.actors).toContain(1);
      }
    }
  });

  it('thinking during follow does not add to actors', () => {
    const { state, concreteCardUid } = getStateWithConcreteCard();
    let newState = gameReducer(state, {
      type: 'LEAD_ROLE',
      role: 'Architect',
      cardUid: concreteCardUid,
    });

    newState = gameReducer(newState, { type: 'THINK', option: { kind: 'refresh' } });
    expect(newState.phase.type).toBe('action');
    if (newState.phase.type === 'action') {
      expect(newState.phase.actors).toEqual([0]); // Only leader
    }
  });
});

describe('Architect action', () => {
  function getActionState(): GameState {
    // Create a state already in action phase for Architect
    const rng = seededRng(100);
    const state = createInitialState(2, ['A', 'B'], rng);

    // Manually set to action phase
    return {
      ...state,
      phase: {
        type: 'action',
        ledRole: 'Architect',
        actors: [0],
        currentActorIndex: 0,
      },
    };
  }

  it('starts a building and decrements site', () => {
    let state = getActionState();
    const card = state.players[0]!.hand[0]!;
    const cardDef = getCardDef(card);
    const sitesBefore = state.sites[cardDef.material];

    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: card.uid });

    expect(state.sites[cardDef.material]).toBe(sitesBefore - 1);
    const player = state.players[0]!;
    expect(player.buildings.length).toBeGreaterThanOrEqual(1);
  });

  it('does not auto-complete cost-1 buildings on placement', () => {
    let state = getActionState();
    // Find a cost-1 card (Rubble or Wood) in hand
    const cost1Card = state.players[0]!.hand.find(c => getCardDef(c).cost === 1);

    if (cost1Card) {
      state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: cost1Card.uid });
      const player = state.players[0]!;
      const building = player.buildings.find(b => b.foundationCard.uid === cost1Card.uid);
      expect(building?.completed).toBe(false);
      expect(building?.materials).toHaveLength(0);
      expect(player.influence).toBe(0);
    }
  });

  it('prevents duplicate uncompleted buildings of same material', () => {
    let state = getActionState();

    // Find two cards of same material (cost 2+)
    const hand = state.players[0]!.hand;
    const brick1 = hand.find(c => getCardDef(c).material === 'Brick');

    if (brick1) {
      // Start first building
      state = {
        ...state,
        phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
      };
      state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brick1.uid });

      // Try to start second Brick building
      const brick2 = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
      if (brick2) {
        state = {
          ...state,
          phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
        };
        const stateBefore = state;
        state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brick2.uid });
        // Should not have changed (invalid action)
        expect(state.players[0]!.buildings.length).toBe(stateBefore.players[0]!.buildings.length);
      }
    }
  });
});

describe('Craftsman action', () => {
  it('does not complete brick building with only 1 material (needs 2)', () => {
    const rng = seededRng(200);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Find a cost-2 card and set up a building manually
    const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
    if (!brickCard) return;

    // Place building directly
    const building: import('./types').Building = {
      foundationCard: brickCard,
      materials: [],
      completed: false,
    };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== brickCard.uid),
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };

    // Find another brick card in hand to add as material
    const materialCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
    if (!materialCard) return;

    state = gameReducer(state, {
      type: 'CRAFTSMAN_ADD',
      buildingIndex: 0,
      cardUid: materialCard.uid,
    });

    const updatedBuilding = state.players[0]!.buildings[0]!;
    // Cost 2 needs 2 materials — 1 is not enough
    expect(updatedBuilding.materials).toHaveLength(1);
    expect(updatedBuilding.completed).toBe(false);
    expect(state.players[0]!.influence).toBe(0);
  });

  it('completes brick building after adding 2 materials', () => {
    const rng = seededRng(200);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickCards = state.players[0]!.hand.filter(c => getCardDef(c).material === 'Brick');
    if (brickCards.length < 3) return; // need foundation + 2 materials

    const [foundation, mat1, mat2] = brickCards;

    // Place building directly
    const building: import('./types').Building = {
      foundationCard: foundation!,
      materials: [],
      completed: false,
    };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== foundation!.uid),
              buildings: [building],
            }
          : p
      ),
    };

    // Add first material
    state = {
      ...state,
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };
    state = gameReducer(state, {
      type: 'CRAFTSMAN_ADD',
      buildingIndex: 0,
      cardUid: mat1!.uid,
    });
    expect(state.players[0]!.buildings[0]!.completed).toBe(false);

    // Add second material
    state = {
      ...state,
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };
    state = gameReducer(state, {
      type: 'CRAFTSMAN_ADD',
      buildingIndex: 0,
      cardUid: mat2!.uid,
    });
    expect(state.players[0]!.buildings[0]!.completed).toBe(true);
    expect(state.players[0]!.buildings[0]!.materials).toHaveLength(2);
    expect(state.players[0]!.influence).toBe(2);
  });

  it('rejects material of wrong type', () => {
    const rng = seededRng(200);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
    if (!brickCard) return;

    const building: import('./types').Building = {
      foundationCard: brickCard,
      materials: [],
      completed: false,
    };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== brickCard.uid),
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };

    // Try to add a non-brick card
    const wrongCard = state.players[0]!.hand.find(c => getCardDef(c).material !== 'Brick');
    if (!wrongCard) return;

    const stateBefore = state;
    state = gameReducer(state, {
      type: 'CRAFTSMAN_ADD',
      buildingIndex: 0,
      cardUid: wrongCard.uid,
    });

    expect(state.players[0]!.buildings[0]!.materials).toHaveLength(0);
    // Phase should not advance on invalid action
    expect(state.phase).toEqual(stateBefore.phase);
  });
});

describe('getActivePlayerId', () => {
  it('returns leader in lead phase', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(getActivePlayerId(state)).toBe(0);
  });

  it('returns null in setup phase', () => {
    const state: GameState = {
      ...createInitialState(2, ['A', 'B'], seededRng(42)),
      phase: { type: 'setup' },
    };
    expect(getActivePlayerId(state)).toBeNull();
  });
});

describe('Craftsman auto-select building', () => {
  it('craftsmanOptions has only one unique building per card when one building of that material exists', () => {
    const rng = seededRng(200);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Find brick cards in player 0's hand
    const brickCards = state.players[0]!.hand.filter(c => getCardDef(c).material === 'Brick');
    if (brickCards.length < 2) return; // need at least foundation + 1 material

    const [foundation, ...rest] = brickCards;

    // Set up exactly one open brick building
    const building: import('./types').Building = {
      foundationCard: foundation!,
      materials: [],
      completed: false,
    };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== foundation!.uid),
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);

    // For each brick card in hand, there should be exactly one matching building (index 0)
    for (const card of rest) {
      const matchingBuildings = actions.craftsmanOptions
        .filter(o => o.cardUid === card.uid)
        .map(o => o.buildingIndex);
      expect(matchingBuildings).toEqual([0]);
    }
  });
});

describe('getAvailableActions', () => {
  it('in lead phase: can think and lead with matching cards', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    const actions = getAvailableActions(state);
    expect(actions.canThink).toBe(true);
    // Should have some lead options (depends on hand)
    expect(actions.leadOptions.length + (actions.canThink ? 1 : 0)).toBeGreaterThan(0);
  });

  it('in action phase: can skip', () => {
    const state: GameState = {
      ...createInitialState(2, ['A', 'B'], seededRng(42)),
      phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
    };
    const actions = getAvailableActions(state);
    expect(actions.canSkip).toBe(true);
  });
});

describe('Full round lifecycle', () => {
  it('completes a full lead -> follow(think) -> action -> next leader cycle', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Find a concrete card to lead architect
    const concreteCard = state.players[0]!.hand.find(
      c => getCardDef(c).material === 'Concrete'
    );
    if (!concreteCard) return;

    // Step 1: Lead Architect
    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: concreteCard.uid });
    expect(state.phase.type).toBe('follow');

    // Step 2: Follower thinks
    state = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });
    expect(state.phase.type).toBe('action');

    // Step 3: Actor (leader) skips
    state = gameReducer(state, { type: 'SKIP_ACTION' });

    // Step 4: Should be next leader's turn
    expect(state.phase).toEqual({ type: 'lead', leaderId: 1 });
    expect(state.leadPlayerIdx).toBe(1);
  });
});

describe('Material-to-role mapping (G4R)', () => {
  it('Wood maps to Craftsman, not Laborer', () => {
    expect(MATERIAL_TO_ROLE.Wood).toBe('Craftsman');
    expect(ROLE_TO_MATERIAL.Craftsman).toBe('Wood');
  });

  it('Brick card defs have role Laborer, Laborer leads with Rubble', () => {
    expect(MATERIAL_TO_ROLE.Brick).toBe('Laborer');
    expect(ROLE_TO_MATERIAL.Laborer).toBe('Rubble');
  });

  it('leading Craftsman requires a Wood card', () => {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    const actions = getAvailableActions(state);
    for (const opt of actions.leadOptions) {
      if (opt.role === 'Craftsman') {
        const card = state.players[0]!.hand.find(c => c.uid === opt.cardUid)!;
        expect(getCardDef(card).material).toBe('Wood');
      }
    }
  });

  it('all Wood card defs have role Craftsman', () => {
    for (const def of CARD_DEFS) {
      if (def.material === 'Wood') {
        expect(def.role).toBe('Craftsman');
      }
    }
  });

  it('all Brick card defs have role Laborer', () => {
    for (const def of CARD_DEFS) {
      if (def.material === 'Brick') {
        expect(def.role).toBe('Laborer');
      }
    }
  });
});

describe('Generic supply', () => {
  it('initializes with 9 of each material', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(state.genericSupply.Rubble).toBe(9);
    expect(state.genericSupply.Wood).toBe(9);
    expect(state.genericSupply.Brick).toBe(9);
    expect(state.genericSupply.Concrete).toBe(9);
    expect(state.genericSupply.Stone).toBe(9);
    expect(state.genericSupply.Marble).toBe(9);
  });

  it('nextUid starts after deck cards', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    // 48 * 3 = 144 total cards
    expect(state.nextUid).toBe(144);
  });
});

describe('Think options', () => {
  it('think refresh: draws to hand limit', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Reduce player 0's hand to 2
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.slice(0, 2) } : p
      ),
    };
    const newState = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });
    expect(newState.players[0]!.hand).toHaveLength(5);
  });

  it('think draw1: draws exactly 1 card from deck', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Reduce player 0's hand to 2
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.slice(0, 2) } : p
      ),
    };
    const newState = gameReducer(state, { type: 'THINK', option: { kind: 'draw1' } });
    // Leader draws exactly 1 (not refresh to 5), so hand goes from 2 -> 3
    expect(newState.players[0]!.hand).toHaveLength(3);
    // Follower (player 1) at hand limit draws 1 via standard refresh
    expect(newState.players[1]!.hand).toHaveLength(6);
  });

  it('think generic: draws from generic supply', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    const newState = gameReducer(state, {
      type: 'THINK',
      option: { kind: 'generic', material: 'Brick' },
    });
    // Player 0 should have 6 cards (5 + 1 generic)
    expect(newState.players[0]!.hand).toHaveLength(6);
    // Generic supply decremented
    expect(newState.genericSupply.Brick).toBe(8);
    // The new card should be a generic brick
    const newCard = newState.players[0]!.hand[5]!;
    expect(isGenericCard(newCard)).toBe(true);
    expect(getCardDef(newCard).material).toBe('Brick');
    // nextUid incremented
    expect(newState.nextUid).toBe(state.nextUid + 1);
  });

  it('think generic: does nothing if supply is 0', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    state = { ...state, genericSupply: { ...state.genericSupply, Stone: 0 } };
    const newState = gameReducer(state, {
      type: 'THINK',
      option: { kind: 'generic', material: 'Stone' },
    });
    // Hand unchanged (leader still drew nothing, but followers get standard refresh)
    // Actually leader think advances, so check supply unchanged
    expect(newState.genericSupply.Stone).toBe(0);
  });

  it('leader think with generic: followers still get standard refresh', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Reduce player 1's hand to 3
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: p.hand.slice(0, 3) } : p
      ),
    };
    const newState = gameReducer(state, {
      type: 'THINK',
      option: { kind: 'generic', material: 'Wood' },
    });
    // Leader gets generic Wood
    expect(newState.genericSupply.Wood).toBe(8);
    // Follower (player 1) should refresh to 5
    expect(newState.players[1]!.hand).toHaveLength(5);
  });

  it('follower think with draw1: draws 1 during follow phase', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);
    // Find a concrete card to lead
    const concreteCard = state.players[0]!.hand.find(
      c => getCardDef(c).material === 'Concrete'
    );
    if (!concreteCard) return;

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: concreteCard.uid });
    const handBefore = state.players[1]!.hand.length;
    const deckBefore = state.deck.length;

    // Follower thinks with draw1
    state = gameReducer(state, { type: 'THINK', option: { kind: 'draw1' } });
    expect(state.players[1]!.hand).toHaveLength(handBefore + 1);
    expect(state.deck.length).toBe(deckBefore - 1);
  });

  it('available actions: thinkOptions reflect supply and hand state', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Player at hand limit
    const actions = getAvailableActions(state);
    expect(actions.thinkOptions.canRefresh).toBe(false); // at limit
    expect(actions.thinkOptions.canDraw1).toBe(true);
    expect(actions.thinkOptions.genericMaterials).toHaveLength(6);

    // Reduce hand below limit
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.slice(0, 3) } : p
      ),
    };
    const actions2 = getAvailableActions(state);
    expect(actions2.thinkOptions.canRefresh).toBe(true);
  });

  it('available actions: all generic materials always listed (even when supply is 0)', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    state = { ...state, genericSupply: { ...state.genericSupply, Marble: 0 } };
    const actions = getAvailableActions(state);
    expect(actions.thinkOptions.genericMaterials).toContain('Marble');
    expect(actions.thinkOptions.genericMaterials).toHaveLength(6);
  });
});

describe('Generic cards as materials and foundations', () => {
  it('generic card can be used as building foundation', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Give player 0 a generic Brick card
    const genericCard: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, genericCard] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: genericCard.uid });
    const building = state.players[0]!.buildings.find(
      b => b.foundationCard.uid === genericCard.uid
    );
    expect(building).toBeDefined();
    expect(isGenericCard(building!.foundationCard)).toBe(true);
  });

  it('generic card can be used as material for matching building', () => {
    const rng = seededRng(200);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
    if (!brickCard) return;

    // Set up a brick building
    const building: Building = { foundationCard: brickCard, materials: [], completed: false };
    const genericMaterial: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };

    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: [...p.hand.filter(c => c.uid !== brickCard.uid), genericMaterial],
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: genericMaterial.uid });
    expect(state.players[0]!.buildings[0]!.materials).toHaveLength(1);
    expect(isGenericCard(state.players[0]!.buildings[0]!.materials[0]!)).toBe(true);
  });

  it('completed generic building gives influence but no power', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Create a generic Rubble foundation (cost 1, auto-completes with 0 materials? No, cost-1 needs 1 material)
    // Actually cost-1 buildings don't auto-complete per existing tests. They need cost materials.
    // Wait: checkBuildingComplete checks materials.length >= def.cost. For cost 1, need 1 material.
    // But the test "does not auto-complete cost-1 buildings on placement" confirms this.

    // Use a generic Brick (cost 2) building, add 2 materials
    const genericFoundation: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const mat1: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Brick') };
    const mat2: Card = { uid: state.nextUid + 2, defId: genericDefIdForMaterial('Brick') };

    const building: Building = { foundationCard: genericFoundation, materials: [mat1], completed: false };

    state = {
      ...state,
      nextUid: state.nextUid + 3,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, hand: [mat2], buildings: [building] }
          : p
      ),
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: mat2.uid });
    expect(state.players[0]!.buildings[0]!.completed).toBe(true);
    // Influence = cost of the building = 2
    expect(state.players[0]!.influence).toBe(2);
    // Power is empty string
    expect(getCardDef(state.players[0]!.buildings[0]!.foundationCard).power).toBe('');
  });

  it('generic card can lead a role', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const genericConcrete: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Concrete') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, genericConcrete] } : p
      ),
    };

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: genericConcrete.uid });
    expect(state.phase.type).toBe('follow');
    expect(state.pool.some(c => c.uid === genericConcrete.uid)).toBe(true);
  });

  it('generic card can follow a role', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Lead with a regular concrete card
    const concreteCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Concrete');
    if (!concreteCard) return;

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: concreteCard.uid });

    // Give player 1 a generic concrete to follow with
    const genericConcrete: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Concrete') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, genericConcrete] } : p
      ),
    };

    state = gameReducer(state, { type: 'FOLLOW_ROLE', cardUid: genericConcrete.uid });
    expect(state.phase.type).toBe('action');
    if (state.phase.type === 'action') {
      expect(state.phase.actors).toContain(1);
    }
  });
});

describe('Jack pile', () => {
  it('initializes with playerCount + 1 jacks', () => {
    const state2 = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(state2.jackPile).toBe(3);

    const state3 = createInitialState(3, ['A', 'B', 'C'], seededRng(42));
    expect(state3.jackPile).toBe(4);
  });

  it('think jack: draws a Jack card and decrements pile', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    const newState = gameReducer(state, { type: 'THINK', option: { kind: 'jack' } });
    expect(newState.jackPile).toBe(2);
    // Leader gets the jack
    expect(newState.players[0]!.hand).toHaveLength(6);
    const lastCard = newState.players[0]!.hand[5]!;
    expect(isJackCard(lastCard)).toBe(true);
  });

  it('think jack: does nothing if pile is empty', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    state = { ...state, jackPile: 0 };
    const newState = gameReducer(state, { type: 'THINK', option: { kind: 'jack' } });
    expect(newState.jackPile).toBe(0);
    // Leader hand unchanged (jack draw failed, but followers still get refresh)
    expect(newState.players[0]!.hand).toHaveLength(5);
  });

  it('canDrawJack is true when pile > 0, false when empty', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    let actions = getAvailableActions(state);
    expect(actions.thinkOptions.canDrawJack).toBe(true);

    state = { ...state, jackPile: 0 };
    actions = getAvailableActions(state);
    expect(actions.thinkOptions.canDrawJack).toBe(false);
  });

  it('Jack can lead Architect', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const jack: Card = { uid: state.nextUid, defId: 'jack' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, jack] } : p
      ),
    };

    const jackPileBefore = state.jackPile;
    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: jack.uid });
    expect(state.phase.type).toBe('follow');
    // Jacks return to jack pile, not pool
    expect(state.pool.some(c => c.uid === jack.uid)).toBe(false);
    expect(state.jackPile).toBe(jackPileBefore + 1);
  });

  it('Jack can lead Craftsman', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const jack: Card = { uid: state.nextUid, defId: 'jack' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, jack] } : p
      ),
    };

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Craftsman', cardUid: jack.uid });
    expect(state.phase.type).toBe('follow');
    if (state.phase.type === 'follow') {
      expect(state.phase.ledRole).toBe('Craftsman');
    }
  });

  it('Jack can follow any led role', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    // Lead Architect with a regular concrete card
    const concreteCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Concrete');
    if (!concreteCard) return;

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: concreteCard.uid });

    // Give player 1 a Jack
    const jack: Card = { uid: state.nextUid, defId: 'jack' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, jack] } : p
      ),
    };

    const jackPileBefore = state.jackPile;
    state = gameReducer(state, { type: 'FOLLOW_ROLE', cardUid: jack.uid });
    expect(state.phase.type).toBe('action');
    if (state.phase.type === 'action') {
      expect(state.phase.actors).toContain(1);
    }
    // Jacks return to jack pile, not pool
    expect(state.pool.some(c => c.uid === jack.uid)).toBe(false);
    expect(state.jackPile).toBe(jackPileBefore + 1);
  });

  it('Jack appears in lead options for all active roles', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const jack: Card = { uid: state.nextUid, defId: 'jack' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, jack] } : p
      ),
    };

    const actions = getAvailableActions(state);
    const jackLeadOptions = actions.leadOptions.filter(o => o.cardUid === jack.uid);
    const roles = jackLeadOptions.map(o => o.role);
    expect(roles).toContain('Architect');
    expect(roles).toContain('Craftsman');
    expect(roles).toContain('Laborer');
    expect(roles).toContain('Merchant');
  });

  it('Jack appears in follow options regardless of led role', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const concreteCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Concrete');
    if (!concreteCard) return;

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: concreteCard.uid });

    // Give player 1 a Jack
    const jack: Card = { uid: state.nextUid, defId: 'jack' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, jack] } : p
      ),
    };

    const actions = getAvailableActions(state);
    expect(actions.followOptions.some(o => o.cardUid === jack.uid)).toBe(true);
  });

  it('Jack cannot be used as a building foundation', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const jack: Card = { uid: state.nextUid, defId: 'jack' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, jack] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.architectOptions.some(o => o.cardUid === jack.uid)).toBe(false);
  });

  it('Jack cannot be used as material in craftsman action', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
    if (!brickCard) return;

    const building: Building = { foundationCard: brickCard, materials: [], completed: false };
    const jack: Card = { uid: state.nextUid, defId: 'jack' };

    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: [...p.hand.filter(c => c.uid !== brickCard.uid), jack],
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.craftsmanOptions.some(o => o.cardUid === jack.uid)).toBe(false);
  });
});

describe('Laborer action', () => {
  it('leading Laborer requires a Rubble card', () => {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    const actions = getAvailableActions(state);
    for (const opt of actions.leadOptions) {
      if (opt.role === 'Laborer') {
        const card = state.players[0]!.hand.find(c => c.uid === opt.cardUid)!;
        const def = getCardDef(card);
        expect(def.material).toBe('Rubble');
      }
    }
  });

  it('pool to stockpile: moves 2 materials from pool to player stockpile', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Put some cards in the pool
    const rubbleCard1: Card = { uid: state.nextUid, defId: 'barracks' };
    const woodCard: Card = { uid: state.nextUid + 1, defId: 'crane' };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      pool: [rubbleCard1, woodCard],
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, {
      type: 'LABORER_POOL_TO_STOCKPILE',
      materials: ['Rubble', 'Wood'],
    });

    expect(state.pool).toHaveLength(0);
    expect(state.players[0]!.stockpile).toHaveLength(2);
    expect(state.players[0]!.stockpile.some(c => getCardDef(c).material === 'Rubble')).toBe(true);
    expect(state.players[0]!.stockpile.some(c => getCardDef(c).material === 'Wood')).toBe(true);
  });

  it('pool to stockpile: can take 1 material', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const rubbleCard: Card = { uid: state.nextUid, defId: 'barracks' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      pool: [rubbleCard],
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, {
      type: 'LABORER_POOL_TO_STOCKPILE',
      materials: ['Rubble'],
    });

    expect(state.pool).toHaveLength(0);
    expect(state.players[0]!.stockpile).toHaveLength(1);
  });

  it('pool to stockpile: rejects if material not in pool', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const rubbleCard: Card = { uid: state.nextUid, defId: 'barracks' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      pool: [rubbleCard],
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, {
      type: 'LABORER_POOL_TO_STOCKPILE',
      materials: ['Wood'],
    });

    // Should not change
    expect(state.pool).toHaveLength(1);
    expect(state.players[0]!.stockpile).toHaveLength(0);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('pool to stockpile: rejects more than 2 materials', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    state = {
      ...state,
      nextUid: state.nextUid + 3,
      pool: [
        { uid: state.nextUid, defId: 'barracks' },
        { uid: state.nextUid + 1, defId: 'quarry' },
        { uid: state.nextUid + 2, defId: 'bridge' },
      ],
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, {
      type: 'LABORER_POOL_TO_STOCKPILE',
      materials: ['Rubble', 'Rubble', 'Rubble'],
    });

    expect(state.pool).toHaveLength(3);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('stockpile to building: moves material from stockpile into building', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick')!;
    const brickStockpile: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };

    const building: Building = { foundationCard: brickCard, materials: [], completed: false };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== brickCard.uid),
              stockpile: [brickStockpile],
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, {
      type: 'LABORER_STOCKPILE_TO_BUILDING',
      material: 'Brick',
      buildingIndex: 0,
    });

    expect(state.players[0]!.stockpile).toHaveLength(0);
    expect(state.players[0]!.buildings[0]!.materials).toHaveLength(1);
  });

  it('stockpile to building: completes building when enough materials added', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick')!;
    const mat1: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const mat2: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Brick') };

    // Brick building needs 2 materials. Put 1 already in, add the 2nd from stockpile.
    const building: Building = { foundationCard: brickCard, materials: [mat1], completed: false };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== brickCard.uid),
              stockpile: [mat2],
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, {
      type: 'LABORER_STOCKPILE_TO_BUILDING',
      material: 'Brick',
      buildingIndex: 0,
    });

    expect(state.players[0]!.buildings[0]!.completed).toBe(true);
    expect(state.players[0]!.buildings[0]!.materials).toHaveLength(2);
    expect(state.players[0]!.influence).toBe(2);
  });

  it('stockpile to building: rejects wrong material type', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick')!;
    const woodStockpile: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Wood') };

    const building: Building = { foundationCard: brickCard, materials: [], completed: false };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== brickCard.uid),
              stockpile: [woodStockpile],
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, {
      type: 'LABORER_STOCKPILE_TO_BUILDING',
      material: 'Wood',
      buildingIndex: 0,
    });

    expect(state.players[0]!.stockpile).toHaveLength(1);
    expect(state.players[0]!.buildings[0]!.materials).toHaveLength(0);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('available actions: laborerPoolOptions lists pool material types', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    state = {
      ...state,
      pool: [
        { uid: state.nextUid, defId: 'barracks' },
        { uid: state.nextUid + 1, defId: 'crane' },
        { uid: state.nextUid + 2, defId: 'barracks' },
      ],
      nextUid: state.nextUid + 3,
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.laborerPoolOptions).toContain('Rubble');
    expect(actions.laborerPoolOptions).toContain('Wood');
    expect(actions.laborerPoolOptions).toHaveLength(2);
  });

  it('available actions: laborerBuildingOptions lists buildings matching stockpile', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick')!;
    const brickStockpile: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const building: Building = { foundationCard: brickCard, materials: [], completed: false };

    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== brickCard.uid),
              stockpile: [brickStockpile],
              buildings: [building],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.laborerBuildingOptions).toHaveLength(1);
    expect(actions.laborerBuildingOptions[0]).toEqual({ material: 'Brick', buildingIndex: 0 });
  });

  it('advances actor after laborer action', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    state = {
      ...state,
      pool: [{ uid: state.nextUid, defId: 'barracks' }],
      nextUid: state.nextUid + 1,
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, {
      type: 'LABORER_POOL_TO_STOCKPILE',
      materials: ['Rubble'],
    });

    // Should advance to next leader since only 1 actor
    expect(state.phase.type).toBe('lead');
  });
});

describe('Merchant action', () => {
  it('moves material from stockpile to vault', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickStockpile: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, stockpile: [brickStockpile] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Brick' });

    expect(state.players[0]!.stockpile).toHaveLength(0);
    expect(state.players[0]!.vault).toHaveLength(1);
    expect(getCardDef(state.players[0]!.vault[0]!).material).toBe('Brick');
  });

  it('rejects if material not in stockpile', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    state = {
      ...state,
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Brick' });

    expect(state.players[0]!.vault).toHaveLength(0);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('rejects if not in Merchant action phase', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickStockpile: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, stockpile: [brickStockpile] } : p
      ),
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Brick' });

    expect(state.players[0]!.stockpile).toHaveLength(1);
    expect(state.players[0]!.vault).toHaveLength(0);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('advances actor after merchant action', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickStockpile: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, stockpile: [brickStockpile] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Brick' });

    expect(state.phase.type).toBe('lead');
  });

  it('leading Merchant requires a Marble card', () => {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    const actions = getAvailableActions(state);
    for (const opt of actions.leadOptions) {
      if (opt.role === 'Merchant') {
        const card = state.players[0]!.hand.find(c => c.uid === opt.cardUid)!;
        expect(getCardDef(card).material).toBe('Marble');
      }
    }
  });

  it('merchantOptions lists stockpile material types', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickStockpile: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const woodStockpile: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, stockpile: [brickStockpile, woodStockpile] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.merchantOptions).toContain('Brick');
    expect(actions.merchantOptions).toContain('Wood');
    expect(actions.merchantOptions).toHaveLength(2);
  });

  it('merchantOptions is empty when stockpile is empty', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    state = {
      ...state,
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.merchantOptions).toHaveLength(0);
  });

  it('player vault initializes empty', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(state.players[0]!.vault).toHaveLength(0);
    expect(state.players[1]!.vault).toHaveLength(0);
  });

  it('Jack can lead Merchant', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const jack: Card = { uid: state.nextUid, defId: 'jack' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, jack] } : p
      ),
    };

    const actions = getAvailableActions(state);
    const jackLeadOptions = actions.leadOptions.filter(o => o.cardUid === jack.uid);
    expect(jackLeadOptions.some(o => o.role === 'Merchant')).toBe(true);
  });
});
