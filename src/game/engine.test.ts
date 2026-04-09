import { describe, it, expect } from 'vitest';
import { createInitialState, gameReducer, getActivePlayerId, getAvailableActions, getNeighborIds, getClientCountForRole } from './engine';
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
    expect(newState.pendingPool.some(c => c.uid === concreteCardUid)).toBe(true);
    expect(newState.pool).toHaveLength(0);
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

  it('cards do not enter pool until after all actions resolve', () => {
    const { state, concreteCardUid } = getStateWithConcreteCard();

    // Lead with concrete card
    let s = gameReducer(state, {
      type: 'LEAD_ROLE',
      role: 'Architect',
      cardUid: concreteCardUid,
    });

    // Card should be in pendingPool, not pool
    expect(s.pendingPool).toHaveLength(1);
    expect(s.pool).toHaveLength(0);

    // Follower thinks → enters action phase
    s = gameReducer(s, { type: 'THINK', option: { kind: 'refresh' } });
    expect(s.phase.type).toBe('action');
    // Still not in pool during action phase
    expect(s.pool).toHaveLength(0);
    expect(s.pendingPool).toHaveLength(1);

    // Skip action → turn ends, advances leader
    s = gameReducer(s, { type: 'SKIP_ACTION' });
    expect(s.phase.type).toBe('lead');
    // Now the card should be in pool
    expect(s.pool).toHaveLength(1);
    expect(s.pool.some(c => c.uid === concreteCardUid)).toBe(true);
    expect(s.pendingPool).toHaveLength(0);
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

  it('Brick card defs have role Legionary, Legionary leads with Brick', () => {
    expect(MATERIAL_TO_ROLE.Brick).toBe('Legionary');
    expect(ROLE_TO_MATERIAL.Legionary).toBe('Brick');
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

  it('all Brick card defs have role Legionary', () => {
    for (const def of CARD_DEFS) {
      if (def.material === 'Brick') {
        expect(def.role).toBe('Legionary');
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
    expect(state.pendingPool.some(c => c.uid === genericConcrete.uid)).toBe(true);
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
        i === 0 ? { ...p, influence: 1, stockpile: [brickStockpile] } : p
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
        i === 0 ? { ...p, influence: 1, stockpile: [brickStockpile] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Brick' });

    expect(state.phase.type).toBe('lead');
  });

  it('leading Merchant requires a Stone card', () => {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    const actions = getAvailableActions(state);
    for (const opt of actions.leadOptions) {
      if (opt.role === 'Merchant') {
        const card = state.players[0]!.hand.find(c => c.uid === opt.cardUid)!;
        expect(getCardDef(card).material).toBe('Stone');
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
        i === 0 ? { ...p, influence: 5, stockpile: [brickStockpile, woodStockpile] } : p
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

  it('vault capacity is limited by influence', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brick1: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const brick2: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Brick') };
    const vaultCard: Card = { uid: state.nextUid + 2, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 3,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 1, vault: [vaultCard], stockpile: [brick1, brick2] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    // Vault is full (1/1), should reject
    const stateBefore = state;
    state = gameReducer(state, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Brick' });
    expect(state.players[0]!.vault).toHaveLength(1);
    expect(state.players[0]!.stockpile).toHaveLength(2);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('allows vault addition when under capacity', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brick: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 2, stockpile: [brick] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    // Vault is 0/2, should allow
    state = gameReducer(state, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Brick' });
    expect(state.players[0]!.vault).toHaveLength(1);
    expect(state.players[0]!.stockpile).toHaveLength(0);
  });

  it('rejects vault addition with 0 influence', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brick: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 0, stockpile: [brick] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Brick' });
    expect(state.players[0]!.vault).toHaveLength(0);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('merchantOptions is empty when vault is at capacity', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brick: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const vaultCard: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 1, vault: [vaultCard], stockpile: [brick] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.merchantOptions).toHaveLength(0);
  });
});

describe('Legionary action', () => {
  function makeLegionaryState(playerCount: number = 2): GameState {
    const rng = seededRng(42);
    let state = createInitialState(playerCount, ['A', 'B', 'C', 'D'].slice(0, playerCount), rng);

    // Give player 0 a Wood card to reveal
    const woodCard: Card = { uid: state.nextUid, defId: CARD_DEFS.find(d => d.material === 'Wood')!.id };
    // Give player 1 a Wood card to be demanded
    const woodCard2: Card = { uid: state.nextUid + 1, defId: CARD_DEFS.find(d => d.material === 'Wood')!.id };
    // Put a Wood card in the pool
    const woodPoolCard: Card = { uid: state.nextUid + 2, defId: CARD_DEFS.find(d => d.material === 'Wood')!.id };

    state = {
      ...state,
      nextUid: state.nextUid + 3,
      pool: [woodPoolCard],
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, hand: [woodCard, ...p.hand] };
        if (i === 1) return { ...p, hand: [woodCard2, ...p.hand] };
        return p;
      }),
      phase: { type: 'action', ledRole: 'Legionary', actors: [0], currentActorIndex: 0 },
    };
    return state;
  }

  it('Brick maps to Legionary role', () => {
    expect(MATERIAL_TO_ROLE['Brick']).toBe('Legionary');
    expect(ROLE_TO_MATERIAL['Legionary']).toBe('Brick');
  });

  it('Brick cards can lead Legionary', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);
    const brickCard: Card = { uid: state.nextUid, defId: CARD_DEFS.find(d => d.material === 'Brick')!.id };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, brickCard] } : p
      ),
    };
    const actions = getAvailableActions(state);
    expect(actions.leadOptions.some(o => o.role === 'Legionary' && o.cardUid === brickCard.uid)).toBe(true);
  });

  it('revealing takes matching material from pool to stockpile', () => {
    let state = makeLegionaryState();
    const woodCard = state.players[0]!.hand[0]!;
    expect(getCardDef(woodCard).material).toBe('Wood');
    state = gameReducer(state, { type: 'LEGIONARY_REVEAL', cardUid: woodCard.uid });

    // Should have taken the wood card from pool
    const woodInPool = state.pool.filter(c => getCardDef(c).material === 'Wood').length;
    expect(woodInPool).toBe(0);
    // Should be in stockpile
    const woodInStockpile = state.players[0]!.stockpile.filter(c => getCardDef(c).material === 'Wood');
    expect(woodInStockpile.length).toBeGreaterThanOrEqual(1);
  });

  it('enters legionary_demand phase when neighbor has matching card', () => {
    let state = makeLegionaryState();
    const woodCard = state.players[0]!.hand[0]!;

    state = gameReducer(state, { type: 'LEGIONARY_REVEAL', cardUid: woodCard.uid });

    expect(state.phase.type).toBe('legionary_demand');
    if (state.phase.type === 'legionary_demand') {
      expect(state.phase.revealedMaterial).toBe('Wood');
      expect(state.phase.demandees).toContain(1);
      expect(getActivePlayerId(state)).toBe(1);
    }
  });

  it('LEGIONARY_GIVE transfers card to actor stockpile and advances', () => {
    let state = makeLegionaryState();
    const woodCard = state.players[0]!.hand[0]!;

    state = gameReducer(state, { type: 'LEGIONARY_REVEAL', cardUid: woodCard.uid });
    expect(state.phase.type).toBe('legionary_demand');

    // Player 1 gives their wood card
    const p1WoodCard = state.players[1]!.hand.find(c => !isJackCard(c) && getCardDef(c).material === 'Wood')!;
    const p1HandBefore = state.players[1]!.hand.length;

    state = gameReducer(state, { type: 'LEGIONARY_GIVE', cardUid: p1WoodCard.uid });

    // Card removed from player 1's hand
    expect(state.players[1]!.hand.length).toBe(p1HandBefore - 1);
    // Card added to player 0's stockpile
    expect(state.players[0]!.stockpile.some(c => c.uid === p1WoodCard.uid)).toBe(true);
    // Should advance past action phase (only 1 actor)
    expect(state.phase.type).toBe('lead');
  });

  it('skips demand phase when no neighbor has matching material', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Give player 0 a Stone card; player 1 has no Stone
    const stoneCard: Card = { uid: state.nextUid, defId: CARD_DEFS.find(d => d.material === 'Stone')!.id };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, hand: [stoneCard] };
        if (i === 1) return { ...p, hand: [] }; // empty hand
        return p;
      }),
      pool: [],
      phase: { type: 'action', ledRole: 'Legionary', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'LEGIONARY_REVEAL', cardUid: stoneCard.uid });
    // Should skip straight to next phase since no pool match and no neighbor match
    expect(state.phase.type).toBe('lead');
  });

  it('card stays in hand after reveal', () => {
    let state = makeLegionaryState();
    const woodCard = state.players[0]!.hand[0]!;
    const handBefore = state.players[0]!.hand.length;

    state = gameReducer(state, { type: 'LEGIONARY_REVEAL', cardUid: woodCard.uid });

    // Card should still be in hand (just revealed, not consumed)
    expect(state.players[0]!.hand.length).toBe(handBefore);
    expect(state.players[0]!.hand.some(c => c.uid === woodCard.uid)).toBe(true);
  });

  it('cannot reveal a Jack', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);
    const jackCard: Card = { uid: state.nextUid, defId: 'jack' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [jackCard] } : p
      ),
      phase: { type: 'action', ledRole: 'Legionary', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, { type: 'LEGIONARY_REVEAL', cardUid: jackCard.uid });
    expect(state).toBe(stateBefore); // no change
  });

  it('legionaryOptions lists non-Jack cards during Legionary action', () => {
    let state = makeLegionaryState();
    const actions = getAvailableActions(state);
    expect(actions.legionaryOptions.length).toBeGreaterThan(0);
    // No jacks in legionary options
    for (const opt of actions.legionaryOptions) {
      const card = state.players[0]!.hand.find(c => c.uid === opt.cardUid)!;
      expect(isJackCard(card)).toBe(false);
    }
  });
});

describe('Patron action', () => {
  it('hires a card from pool into clientele', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const poolCard: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      pool: [poolCard],
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 1 } : p
      ),
      phase: { type: 'action', ledRole: 'Patron', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'PATRON_HIRE', material: 'Wood' });

    expect(state.players[0]!.clientele).toHaveLength(1);
    expect(getCardDef(state.players[0]!.clientele[0]!).material).toBe('Wood');
    expect(state.pool).toHaveLength(0);
  });

  it('rejects if material not in pool', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    state = {
      ...state,
      pool: [],
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 1 } : p
      ),
      phase: { type: 'action', ledRole: 'Patron', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, { type: 'PATRON_HIRE', material: 'Brick' });

    expect(state.players[0]!.clientele).toHaveLength(0);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('rejects if clientele is at capacity (limited by influence)', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const existingClient: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const poolCard: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      pool: [poolCard],
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 1, clientele: [existingClient] } : p
      ),
      phase: { type: 'action', ledRole: 'Patron', actors: [0], currentActorIndex: 0 },
    };

    const stateBefore = state;
    state = gameReducer(state, { type: 'PATRON_HIRE', material: 'Wood' });

    expect(state.players[0]!.clientele).toHaveLength(1);
    expect(state.pool).toHaveLength(1);
    expect(state.phase).toEqual(stateBefore.phase);
  });

  it('rejects if not in Patron action phase', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const poolCard: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      pool: [poolCard],
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 1 } : p
      ),
      phase: { type: 'action', ledRole: 'Laborer', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'PATRON_HIRE', material: 'Wood' });

    expect(state.players[0]!.clientele).toHaveLength(0);
    expect(state.pool).toHaveLength(1);
  });

  it('advances actor after patron action', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const poolCard: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      pool: [poolCard],
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 1 } : p
      ),
      phase: { type: 'action', ledRole: 'Patron', actors: [0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'PATRON_HIRE', material: 'Wood' });

    expect(state.phase.type).toBe('lead');
  });

  it('leading Patron requires a Marble card', () => {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    const actions = getAvailableActions(state);
    for (const opt of actions.leadOptions) {
      if (opt.role === 'Patron') {
        const card = state.players[0]!.hand.find(c => c.uid === opt.cardUid)!;
        const def = getCardDef(card);
        expect(def.material === 'Marble' || isJackCard(card)).toBe(true);
      }
    }
  });

  it('patronOptions lists pool material types when clientele has capacity', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const poolBrick: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const poolWood: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      pool: [poolBrick, poolWood],
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 2 } : p
      ),
      phase: { type: 'action', ledRole: 'Patron', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.patronOptions).toContain('Brick');
    expect(actions.patronOptions).toContain('Wood');
  });

  it('patronOptions is empty when clientele is full', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const existingClient: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Brick') };
    const poolCard: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      pool: [poolCard],
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 1, clientele: [existingClient] } : p
      ),
      phase: { type: 'action', ledRole: 'Patron', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.patronOptions).toHaveLength(0);
  });

  it('patronOptions is empty with 0 influence', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    const poolCard: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      pool: [poolCard],
      phase: { type: 'action', ledRole: 'Patron', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.patronOptions).toHaveLength(0);
  });
});

describe('getNeighborIds', () => {
  it('2-player: each player has one neighbor', () => {
    expect(getNeighborIds(0, 2)).toEqual([1]);
    expect(getNeighborIds(1, 2)).toEqual([0]);
  });

  it('3-player: each player has two neighbors (all others)', () => {
    expect(getNeighborIds(0, 3)).toEqual([2, 1]);
    expect(getNeighborIds(1, 3)).toEqual([0, 2]);
    expect(getNeighborIds(2, 3)).toEqual([1, 0]);
  });

  it('4-player: only left and right, not diagonal', () => {
    expect(getNeighborIds(0, 4)).toEqual([3, 1]);
    expect(getNeighborIds(1, 4)).toEqual([0, 2]);
    expect(getNeighborIds(2, 4)).toEqual([1, 3]);
    expect(getNeighborIds(3, 4)).toEqual([2, 0]);
  });

  it('4-player: diagonal players are NOT neighbors', () => {
    // Player 0 and 2 are diagonal
    expect(getNeighborIds(0, 4)).not.toContain(2);
    // Player 1 and 3 are diagonal
    expect(getNeighborIds(1, 4)).not.toContain(3);
  });
});

describe('Clientele action production', () => {
  function setupWithClients(): GameState {
    // Create a 2-player state with player 0 having an Architect client
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Give player 0 a Concrete card in clientele (= Architect client)
    const clientCard: Card = { uid: 8000, defId: 'road' }; // Concrete card
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, clientele: [clientCard], influence: 3 } : p
      ),
    };
    return state;
  }

  it('getClientCountForRole counts matching clients', () => {
    const state = setupWithClients();
    const player0 = state.players[0]!;
    expect(getClientCountForRole(player0, 'Architect')).toBe(1);
    expect(getClientCountForRole(player0, 'Craftsman')).toBe(0);
    expect(getClientCountForRole(player0, 'Laborer')).toBe(0);
  });

  it('leader with matching clients gets extra actions', () => {
    let state = setupWithClients();

    // Find a Concrete card in player 0's hand to lead Architect
    let concreteCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Concrete');
    if (!concreteCard) {
      // Add one if not present
      concreteCard = { uid: 8001, defId: 'road' };
      state = {
        ...state,
        players: state.players.map((p, i) =>
          i === 0 ? { ...p, hand: [...p.hand, concreteCard!] } : p
        ),
      };
    }

    // Lead Architect
    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: concreteCard.uid });
    expect(state.phase.type).toBe('follow');

    // Player 1 thinks
    state = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });
    expect(state.phase.type).toBe('action');

    if (state.phase.type === 'action') {
      // Player 0 should have 2 actions: 1 from leading + 1 from Architect client
      expect(state.phase.actors).toEqual([0, 0]);
    }
  });

  it('follower with matching clients gets extra actions', () => {
    let state = setupWithClients();

    // Give player 1 a Concrete card in clientele too, plus influence
    const clientCard: Card = { uid: 8002, defId: 'tower' }; // Concrete card
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, clientele: [clientCard], influence: 3 } : p
      ),
    };

    // Find Concrete cards for both players
    let p0Concrete = state.players[0]!.hand.find(c => getCardDef(c).material === 'Concrete');
    if (!p0Concrete) {
      p0Concrete = { uid: 8003, defId: 'road' };
      state = {
        ...state,
        players: state.players.map((p, i) =>
          i === 0 ? { ...p, hand: [...p.hand, p0Concrete!] } : p
        ),
      };
    }

    // Lead Architect
    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: p0Concrete.uid });

    // Player 1 follows
    let p1Concrete = state.players[1]!.hand.find(c => getCardDef(c).material === 'Concrete');
    if (p1Concrete) {
      state = gameReducer(state, { type: 'FOLLOW_ROLE', cardUid: p1Concrete.uid });
      expect(state.phase.type).toBe('action');

      if (state.phase.type === 'action') {
        // Player 0: 1 (lead) + 1 (client) = 2
        // Player 1: 1 (follow) + 1 (client) = 2
        expect(state.phase.actors).toEqual([0, 0, 1, 1]);
      }
    }
  });

  it('thinker with matching clients still gets client actions', () => {
    let state = setupWithClients();

    // Give player 1 two Concrete clients + influence
    const clientCard1: Card = { uid: 8010, defId: 'tower' };
    const clientCard2: Card = { uid: 8011, defId: 'road' };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, clientele: [clientCard1, clientCard2], influence: 3 } : p
      ),
    };

    // Player 0 leads Architect
    let concreteCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Concrete');
    if (!concreteCard) {
      concreteCard = { uid: 8012, defId: 'road' };
      state = {
        ...state,
        players: state.players.map((p, i) =>
          i === 0 ? { ...p, hand: [...p.hand, concreteCard!] } : p
        ),
      };
    }

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: concreteCard.uid });

    // Player 1 thinks (does NOT follow)
    state = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });
    expect(state.phase.type).toBe('action');

    if (state.phase.type === 'action') {
      // Player 0: 1 (lead) + 1 (client) = 2
      // Player 1: 0 (thought) + 2 (clients) = 2
      expect(state.phase.actors).toEqual([0, 0, 1, 1]);
    }
  });

  it('player with non-matching clients gets no bonus actions', () => {
    let state = setupWithClients();
    // Player 0 has an Architect client (Concrete)

    // Find a Wood card to lead Craftsman
    let woodCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Wood');
    if (!woodCard) {
      woodCard = { uid: 8020, defId: 'crane' };
      state = {
        ...state,
        players: state.players.map((p, i) =>
          i === 0 ? { ...p, hand: [...p.hand, woodCard!] } : p
        ),
      };
    }

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Craftsman', cardUid: woodCard.uid });

    // Player 1 thinks
    state = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });
    expect(state.phase.type).toBe('action');

    if (state.phase.type === 'action') {
      // Player 0 has Architect client, not Craftsman — only 1 action from leading
      expect(state.phase.actors).toEqual([0]);
    }
  });

  it('multiple client actions can each be used independently', () => {
    let state = setupWithClients();

    // Give player 0 two Architect clients
    const clientCard2: Card = { uid: 8030, defId: 'tower' };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, clientele: [...p.clientele, clientCard2] } : p
      ),
    };

    // Lead Architect
    let concreteCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Concrete');
    if (!concreteCard) {
      concreteCard = { uid: 8031, defId: 'road' };
      state = {
        ...state,
        players: state.players.map((p, i) =>
          i === 0 ? { ...p, hand: [...p.hand, concreteCard!] } : p
        ),
      };
    }

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Architect', cardUid: concreteCard.uid });
    state = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });
    expect(state.phase.type).toBe('action');

    if (state.phase.type === 'action') {
      // 1 (lead) + 2 (clients) = 3 actions
      expect(state.phase.actors).toEqual([0, 0, 0]);

      // Skip first action
      state = gameReducer(state, { type: 'SKIP_ACTION' });
      expect(state.phase.type).toBe('action');
      expect(getActivePlayerId(state)).toBe(0); // Still player 0's turn

      // Skip second action
      state = gameReducer(state, { type: 'SKIP_ACTION' });
      expect(state.phase.type).toBe('action');
      expect(getActivePlayerId(state)).toBe(0); // Still player 0's turn

      // Skip third action — turn ends
      state = gameReducer(state, { type: 'SKIP_ACTION' });
      expect(state.phase.type).toBe('lead');
    }
  });

  it('patron clients produce extra patron actions for hiring', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Give player 0 a Marble client (Patron) + influence + pool cards to hire from
    const patronClient: Card = { uid: 8040, defId: 'latrine' }; // Marble card
    const poolCard1: Card = { uid: 8041, defId: 'crane' }; // Wood
    const poolCard2: Card = { uid: 8042, defId: 'barracks' }; // Rubble
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, clientele: [patronClient], influence: 5 } : p
      ),
      pool: [poolCard1, poolCard2],
    };

    // Find a Marble card to lead Patron
    let marbleCard = state.players[0]!.hand.find(c => getCardDef(c).material === 'Marble');
    if (!marbleCard) {
      marbleCard = { uid: 8043, defId: 'latrine' };
      state = {
        ...state,
        players: state.players.map((p, i) =>
          i === 0 ? { ...p, hand: [...p.hand, marbleCard!] } : p
        ),
      };
    }

    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Patron', cardUid: marbleCard.uid });
    state = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });

    if (state.phase.type === 'action') {
      // 1 (lead) + 1 (Patron client) = 2 Patron actions
      expect(state.phase.actors).toEqual([0, 0]);

      // Use first action to hire Wood from pool
      state = gameReducer(state, { type: 'PATRON_HIRE', material: 'Wood' });
      expect(state.players[0]!.clientele).toHaveLength(2); // original + hired
      expect(state.phase.type).toBe('action');

      // Use second action to hire Rubble from pool
      state = gameReducer(state, { type: 'PATRON_HIRE', material: 'Rubble' });
      expect(state.players[0]!.clientele).toHaveLength(3);
      expect(state.phase.type).toBe('lead'); // turn ends
    }
  });
});
