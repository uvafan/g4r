import { describe, it, expect } from 'vitest';
import { createInitialState, gameReducer, getActivePlayerId, getAvailableActions, getNeighborIds, getClientCountForRole, calculateVP, getEffectiveHandLimit, hasActiveBuildingPower, getRequiredMaterials } from './engine';
import { getCardDef, CARD_DEFS, MATERIAL_TO_ROLE, ROLE_TO_MATERIAL, isGenericCard, genericDefIdForMaterial, isJackCard } from './cards';
import { GameState, Card, Building } from './types';
import { seededRng, makeState, mkBuilding, updatePlayer, finalize, withActionPhase } from './stateBuilder';
import { architectAction, legionaryAction, clienteleProduction } from './scenarios';

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
    expect(state.sites.Rubble).toBe(4);
    expect(state.sites.Wood).toBe(4);
    expect(state.sites.Brick).toBe(4);
    expect(state.sites.Concrete).toBe(4);
    expect(state.sites.Stone).toBe(4);
    expect(state.sites.Marble).toBe(4);
  });

  it('starts in lead phase with player 0', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(state.phase).toEqual({ type: 'lead', leaderId: 0 });
    expect(state.leadPlayerIdx).toBe(0);
  });
});

describe('Think action', () => {
  it('leader think: enters thinkRound for followers', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Remove some cards from player 0's hand to test draw
    const modState: GameState = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.slice(0, 2) } : p
      ),
    };
    const afterLeader = gameReducer(modState, { type: 'THINK', option: { kind: 'refresh' } });
    // Player 0 had 2 cards, should draw to 5
    expect(afterLeader.players[0]!.hand).toHaveLength(5);
    // Follower hasn't acted yet
    expect(afterLeader.phase.type).toBe('thinkRound');
    // Now follower thinks
    const newState = gameReducer(afterLeader, { type: 'THINK', option: { kind: 'refresh' } });
    // Player 1 had 5 cards, should draw 1 (refresh at limit)
    expect(newState.players[1]!.hand).toHaveLength(6);
    // Should advance leader
    expect(newState.phase).toEqual({ type: 'lead', leaderId: 1 });
  });

  it('think at hand limit draws 1 card', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    const afterLeader = gameReducer(state, { type: 'THINK', option: { kind: 'refresh' } });
    // Leader had 5 cards (at limit), draws 1
    expect(afterLeader.players[0]!.hand).toHaveLength(6);
    // Follower thinks too
    const newState = gameReducer(afterLeader, { type: 'THINK', option: { kind: 'refresh' } });
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
    return architectAction().state;
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

  it('allows starting a building of same material when existing one is completed', () => {
    let state = getActionState();

    // Find a Brick card
    const brick1 = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
    if (!brick1) return;

    // Manually place a completed Brick building for player 0
    const completedBuilding: import('./types').Building = {
      foundationCard: brick1,
      materials: [brick1, brick1], // enough materials for cost-2
      completed: true,
    };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter(c => c.uid !== brick1.uid),
              buildings: [completedBuilding],
            }
          : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
    };

    // Find another Brick card in hand
    const brick2 = state.players[0]!.hand.find(c => getCardDef(c).material === 'Brick');
    if (!brick2) return;

    const buildingsBefore = state.players[0]!.buildings.length;
    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brick2.uid });

    // Should have started a new building since existing one is completed
    expect(state.players[0]!.buildings.length).toBe(buildingsBefore + 1);
  });
});

describe('Out of town sites', () => {
  it('initializes with 2 out-of-town sites per type', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(state.outOfTownSites.Rubble).toBe(2);
    expect(state.outOfTownSites.Stone).toBe(2);
    expect(state.outOfTownSites.Marble).toBe(2);
  });

  it('uses out-of-town site when normal sites are depleted', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    // Deplete all Brick normal sites
    state = { ...state, sites: { ...state.sites, Brick: 0 } };

    // Give player a Brick card and 2 architect actions
    const brickCard: Card = { uid: 9000, defId: 'foundry' }; // Brick material
    state = {
      ...state,
      nextUid: 9001,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [brickCard, ...p.hand] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0, 0], currentActorIndex: 0 },
    };

    const ootBefore = state.outOfTownSites.Brick;
    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brickCard.uid });

    // Out-of-town site should be decremented
    expect(state.outOfTownSites.Brick).toBe(ootBefore - 1);
    // Normal sites should still be 0
    expect(state.sites.Brick).toBe(0);
    // Building should be marked as out of town
    const building = state.players[0]!.buildings.find(b => b.foundationCard.uid === brickCard.uid);
    expect(building?.outOfTown).toBe(true);
  });

  it('costs 2 actions to start on out-of-town site', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    // Deplete Brick normal sites, give player 3 architect actions
    state = { ...state, sites: { ...state.sites, Brick: 0 } };
    const brickCard: Card = { uid: 9000, defId: 'foundry' };
    state = {
      ...state,
      nextUid: 9001,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [brickCard, ...p.hand] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0, 0, 0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brickCard.uid });

    // Should have advanced by 2 (from index 0 to index 2)
    expect(state.phase.type).toBe('action');
    if (state.phase.type === 'action') {
      expect(state.phase.currentActorIndex).toBe(2);
    }
  });

  it('cannot start out-of-town with only 1 remaining action', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    // Deplete Brick normal sites, give player only 1 architect action
    state = { ...state, sites: { ...state.sites, Brick: 0 } };
    const brickCard: Card = { uid: 9000, defId: 'foundry' };
    state = {
      ...state,
      nextUid: 9001,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [brickCard, ...p.hand] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
    };

    // Check available actions — should NOT include Brick options
    const actions = getAvailableActions(state);
    const brickOption = actions.architectOptions.find(o => o.cardUid === brickCard.uid);
    expect(brickOption).toBeUndefined();

    // Trying to start should be a no-op
    const stateBefore = state;
    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brickCard.uid });
    expect(state.players[0]!.buildings.length).toBe(stateBefore.players[0]!.buildings.length);
  });

  it('prefers normal sites over out-of-town when normal sites exist', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    // Normal Brick sites exist
    expect(state.sites.Brick).toBeGreaterThan(0);

    const brickCard: Card = { uid: 9000, defId: 'foundry' };
    state = {
      ...state,
      nextUid: 9001,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [brickCard, ...p.hand] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
    };

    const sitesBefore = state.sites.Brick;
    const ootBefore = state.outOfTownSites.Brick;
    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brickCard.uid });

    // Normal site should be decremented, out-of-town unchanged
    expect(state.sites.Brick).toBe(sitesBefore - 1);
    expect(state.outOfTownSites.Brick).toBe(ootBefore);
    // Building should NOT be out of town
    const building = state.players[0]!.buildings.find(b => b.foundationCard.uid === brickCard.uid);
    expect(building?.outOfTown).toBeUndefined();
  });

  it('getAvailableActions marks out-of-town options correctly', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    // Deplete Brick normal sites
    state = { ...state, sites: { ...state.sites, Brick: 0 } };
    const brickCard: Card = { uid: 9000, defId: 'foundry' };
    state = {
      ...state,
      nextUid: 9001,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [brickCard, ...p.hand] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0, 0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    const brickOption = actions.architectOptions.find(o => o.cardUid === brickCard.uid);
    expect(brickOption).toBeDefined();
    expect(brickOption!.outOfTown).toBe(true);
  });

  it('cannot start building when both normal and out-of-town sites are depleted', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    state = {
      ...state,
      sites: { ...state.sites, Brick: 0 },
      outOfTownSites: { ...state.outOfTownSites, Brick: 0 },
    };
    const brickCard: Card = { uid: 9000, defId: 'foundry' };
    state = {
      ...state,
      nextUid: 9001,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [brickCard, ...p.hand] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0, 0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    const brickOption = actions.architectOptions.find(o => o.cardUid === brickCard.uid);
    expect(brickOption).toBeUndefined();
  });

  it('out-of-town with exactly 2 remaining actions advances to next leader', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    state = { ...state, sites: { ...state.sites, Brick: 0 } };
    const brickCard: Card = { uid: 9000, defId: 'foundry' };
    state = {
      ...state,
      nextUid: 9001,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [brickCard, ...p.hand] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0, 0], currentActorIndex: 0 },
    };

    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brickCard.uid });

    // With 2 actions, out-of-town consumes both — should advance to next leader
    expect(state.phase.type).toBe('lead');
  });

  it('handles mixed normal and out-of-town in same turn', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));

    // Deplete Brick but not Wood
    state = { ...state, sites: { ...state.sites, Brick: 0 } };
    const woodCard: Card = { uid: 9000, defId: 'crane' }; // Wood
    const brickCard: Card = { uid: 9001, defId: 'foundry' }; // Brick
    state = {
      ...state,
      nextUid: 9002,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [woodCard, brickCard, ...p.hand] } : p
      ),
      phase: { type: 'action', ledRole: 'Architect', actors: [0, 0, 0], currentActorIndex: 0 },
    };

    // Start wood building (normal site, 1 action)
    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: woodCard.uid });
    expect(state.phase.type).toBe('action');
    if (state.phase.type === 'action') {
      expect(state.phase.currentActorIndex).toBe(1);
    }

    // Now has 2 remaining actions — can start out-of-town Brick
    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: brickCard.uid });
    // Should have consumed 2 more actions (advancing past end = next leader)
    expect(state.phase.type).toBe('lead');

    // Verify both buildings exist
    const buildings = state.players[0]!.buildings;
    const woodBuilding = buildings.find(b => b.foundationCard.uid === woodCard.uid);
    const brickBuilding = buildings.find(b => b.foundationCard.uid === brickCard.uid);
    expect(woodBuilding).toBeDefined();
    expect(woodBuilding!.outOfTown).toBeUndefined();
    expect(brickBuilding).toBeDefined();
    expect(brickBuilding!.outOfTown).toBe(true);
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
    const sitesBefore = state.sites.Brick;

    // Place building directly (simulates having started it, consuming a site)
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
      sites: { ...state.sites, Brick: state.sites.Brick - 1 }, // simulate site consumption
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
    // Site is NOT returned on completion (stays consumed)
    expect(state.sites.Brick).toBe(sitesBefore - 1);
  });

  it('allows starting new building of same material after completing one via craftsman', () => {
    const rng = seededRng(200);
    let state = createInitialState(2, ['A', 'B'], rng);

    const brickCards = state.players[0]!.hand.filter(c => getCardDef(c).material === 'Brick');
    if (brickCards.length < 4) return; // need foundation + 2 materials + 1 new foundation

    const [foundation, mat1, mat2, newFoundation] = brickCards;

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

    // Complete building via craftsman: add 2 materials
    state = {
      ...state,
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };
    state = gameReducer(state, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: mat1!.uid });
    state = {
      ...state,
      phase: { type: 'action', ledRole: 'Craftsman', actors: [0], currentActorIndex: 0 },
    };
    state = gameReducer(state, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: mat2!.uid });
    expect(state.players[0]!.buildings[0]!.completed).toBe(true);

    // Now try to start a new Brick building — should succeed
    state = {
      ...state,
      phase: { type: 'action', ledRole: 'Architect', actors: [0], currentActorIndex: 0 },
    };
    const buildingsBefore = state.players[0]!.buildings.length;
    state = gameReducer(state, { type: 'ARCHITECT_START', cardUid: newFoundation!.uid });
    expect(state.players[0]!.buildings.length).toBe(buildingsBefore + 1);
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
    const afterLeader = gameReducer(state, { type: 'THINK', option: { kind: 'draw1' } });
    // Leader draws exactly 1 (not refresh to 5), so hand goes from 2 -> 3
    expect(afterLeader.players[0]!.hand).toHaveLength(3);
    // Follower hasn't acted yet (thinkRound phase)
    expect(afterLeader.phase.type).toBe('thinkRound');
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

  it('leader think with generic: follower gets own think choice', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Reduce player 1's hand to 3
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: p.hand.slice(0, 3) } : p
      ),
    };
    const afterLeader = gameReducer(state, {
      type: 'THINK',
      option: { kind: 'generic', material: 'Wood' },
    });
    // Leader gets generic Wood
    expect(afterLeader.genericSupply.Wood).toBe(8);
    // Follower hasn't acted yet
    expect(afterLeader.phase.type).toBe('thinkRound');
    // Follower chooses refresh
    const newState = gameReducer(afterLeader, { type: 'THINK', option: { kind: 'refresh' } });
    // Follower (player 1) had 3 cards, should refresh to 5
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
  it('initializes with correct jack count per player count', () => {
    const state2 = createInitialState(2, ['A', 'B'], seededRng(42));
    expect(state2.jackPile).toBe(4); // 2+2

    const state3 = createInitialState(3, ['A', 'B', 'C'], seededRng(42));
    expect(state3.jackPile).toBe(6); // special case for 3p

    const state4 = createInitialState(4, ['A', 'B', 'C', 'D'], seededRng(42));
    expect(state4.jackPile).toBe(6); // 4+2

    const state5 = createInitialState(5, ['A', 'B', 'C', 'D', 'E'], seededRng(42));
    expect(state5.jackPile).toBe(7); // 5+2
  });

  it('think jack: draws a Jack card and decrements pile', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    const newState = gameReducer(state, { type: 'THINK', option: { kind: 'jack' } });
    expect(newState.jackPile).toBe(3);
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
    expect(actions.vaultFull).toBe(true);
  });

  it('vaultFull is false when stockpile is empty but vault has room', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, influence: 2, vault: [], stockpile: [] } : p
      ),
      phase: { type: 'action', ledRole: 'Merchant', actors: [0], currentActorIndex: 0 },
    };

    const actions = getAvailableActions(state);
    expect(actions.merchantOptions).toHaveLength(0);
    expect(actions.vaultFull).toBe(false);
  });
});

describe('Legionary action', () => {
  function makeLegionaryState(): GameState {
    return legionaryAction().state;
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
    return clienteleProduction().state;
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

describe('calculateVP', () => {
  it('returns 0 VP for a fresh game', () => {
    const state = createInitialState(2, ['A', 'B'], seededRng(42));
    const vp = calculateVP(state, 0);
    expect(vp.influence).toBe(0);
    expect(vp.vault).toBe(0);
    expect(vp.merchantBonus).toBe(0);
    expect(vp.buildingBonus).toBe(0);
    expect(vp.total).toBe(0);
  });

  it('counts influence from completed buildings', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Give player a completed cost-2 building
    const brickCard: Card = { uid: state.nextUid, defId: 'foundry' };
    const mat1: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Brick') };
    const mat2: Card = { uid: state.nextUid + 2, defId: genericDefIdForMaterial('Brick') };
    state = {
      ...state,
      nextUid: state.nextUid + 3,
      players: state.players.map((p, i) =>
        i === 0 ? {
          ...p,
          influence: 2,
          buildings: [{ foundationCard: brickCard, materials: [mat1, mat2], completed: true }],
        } : p
      ),
    };
    const vp = calculateVP(state, 0);
    expect(vp.influence).toBe(2);
    expect(vp.total).toBeGreaterThanOrEqual(2);
  });

  it('counts vault material values', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const rubble: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Rubble') }; // value 1
    const stone: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Stone') }; // value 3
    const brick: Card = { uid: state.nextUid + 2, defId: genericDefIdForMaterial('Brick') }; // value 2
    state = {
      ...state,
      nextUid: state.nextUid + 3,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, vault: [rubble, stone, brick] } : p
      ),
    };
    const vp = calculateVP(state, 0);
    expect(vp.vault).toBe(6); // 1 + 3 + 2
  });

  it('awards merchant bonus for winning a category', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const wood1: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Wood') };
    const wood2: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, vault: [wood1, wood2] } : p
      ),
    };
    const vp = calculateVP(state, 0);
    expect(vp.merchantBonus).toBe(3);
    expect(vp.merchantBonusCategories).toEqual(['Wood']);
  });

  it('no merchant bonus on tie', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const wood0: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Wood') };
    const wood1: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, vault: [wood0] } :
        i === 1 ? { ...p, vault: [wood1] } : p
      ),
    };
    const vp0 = calculateVP(state, 0);
    const vp1 = calculateVP(state, 1);
    expect(vp0.merchantBonus).toBe(0);
    expect(vp1.merchantBonus).toBe(0);
  });

  it('awards multiple merchant bonuses', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const wood: Card = { uid: state.nextUid, defId: genericDefIdForMaterial('Wood') };
    const marble: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Marble') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, vault: [wood, marble] } : p
      ),
    };
    const vp = calculateVP(state, 0);
    expect(vp.merchantBonus).toBe(6); // 2 categories * 3 VP
    expect(vp.merchantBonusCategories).toContain('Wood');
    expect(vp.merchantBonusCategories).toContain('Marble');
  });

  it('statue gives +3 VP', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const statueCard: Card = { uid: state.nextUid, defId: 'statue' };
    const mat: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    state = {
      ...state,
      nextUid: state.nextUid + 2,
      players: state.players.map((p, i) =>
        i === 0 ? {
          ...p,
          influence: 1,
          buildings: [{ foundationCard: statueCard, materials: [mat], completed: true }],
        } : p
      ),
    };
    const vp = calculateVP(state, 0);
    expect(vp.buildingBonus).toBe(3);
  });

  it('wall gives 1 VP per 3 stockpile materials', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const wallCard: Card = { uid: state.nextUid, defId: 'wall' };
    const mat1: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Concrete') };
    const mat2: Card = { uid: state.nextUid + 2, defId: genericDefIdForMaterial('Concrete') };
    const sp1: Card = { uid: state.nextUid + 3, defId: genericDefIdForMaterial('Rubble') };
    const sp2: Card = { uid: state.nextUid + 4, defId: genericDefIdForMaterial('Wood') };
    const sp3: Card = { uid: state.nextUid + 5, defId: genericDefIdForMaterial('Brick') };
    const sp4: Card = { uid: state.nextUid + 6, defId: genericDefIdForMaterial('Stone') };
    state = {
      ...state,
      nextUid: state.nextUid + 7,
      players: state.players.map((p, i) =>
        i === 0 ? {
          ...p,
          influence: 2,
          buildings: [{ foundationCard: wallCard, materials: [mat1, mat2], completed: true }],
          stockpile: [sp1, sp2, sp3, sp4],
        } : p
      ),
    };
    const vp = calculateVP(state, 0);
    expect(vp.buildingBonus).toBe(1); // floor(4/3) = 1
  });

  it('colosseum gives +1 VP per card in hand', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const colosseumCard: Card = { uid: state.nextUid, defId: 'colosseum' };
    const mat1: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Stone') };
    const mat2: Card = { uid: state.nextUid + 2, defId: genericDefIdForMaterial('Stone') };
    const mat3: Card = { uid: state.nextUid + 3, defId: genericDefIdForMaterial('Stone') };
    state = {
      ...state,
      nextUid: state.nextUid + 4,
      players: state.players.map((p, i) =>
        i === 0 ? {
          ...p,
          influence: 3,
          buildings: [{ foundationCard: colosseumCard, materials: [mat1, mat2, mat3], completed: true }],
        } : p
      ),
    };
    const vp = calculateVP(state, 0);
    // Player has 5 cards in hand from initial deal
    expect(vp.buildingBonus).toBe(state.players[0]!.hand.length);
  });

  it('incomplete buildings give no bonus', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const statueCard: Card = { uid: state.nextUid, defId: 'statue' };
    state = {
      ...state,
      nextUid: state.nextUid + 1,
      players: state.players.map((p, i) =>
        i === 0 ? {
          ...p,
          buildings: [{ foundationCard: statueCard, materials: [], completed: false }],
        } : p
      ),
    };
    const vp = calculateVP(state, 0);
    expect(vp.buildingBonus).toBe(0);
  });

  it('total combines all VP sources', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    const statueCard: Card = { uid: state.nextUid, defId: 'statue' };
    const woodMat: Card = { uid: state.nextUid + 1, defId: genericDefIdForMaterial('Wood') };
    const vaultStone: Card = { uid: state.nextUid + 2, defId: genericDefIdForMaterial('Stone') };
    state = {
      ...state,
      nextUid: state.nextUid + 3,
      players: state.players.map((p, i) =>
        i === 0 ? {
          ...p,
          influence: 1,
          buildings: [{ foundationCard: statueCard, materials: [woodMat], completed: true }],
          vault: [vaultStone],
        } : p
      ),
    };
    const vp = calculateVP(state, 0);
    // influence=1, vault=3 (Stone), merchant bonus=3 (Stone category), building=3 (Statue)
    expect(vp.influence).toBe(1);
    expect(vp.vault).toBe(3);
    expect(vp.merchantBonus).toBe(3);
    expect(vp.buildingBonus).toBe(3);
    expect(vp.total).toBe(10);
  });
});

describe('3-of-a-kind as jack', () => {
  // Helper: create a state where player 0 has 3 Brick cards in hand during lead phase
  function stateWith3Brick(): GameState {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    const brickCards: Card[] = [
      { uid: 9001, defId: 'foundry' },
      { uid: 9002, defId: 'school' },
      { uid: 9003, defId: 'shrine' },
    ];
    return {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...brickCards, ...p.hand.slice(0, 2)] } : p
      ),
    };
  }

  it('getAvailableActions: 3 cards of same material produce lead options for all roles', () => {
    const state = stateWith3Brick();
    const actions = getAvailableActions(state);

    // Should have 3oak lead options for each of the 6 roles for each of the 3 brick cards
    const threeOakOptions = actions.leadOptions.filter(o => o.extraCardUids);
    expect(threeOakOptions.length).toBeGreaterThanOrEqual(6 * 3);

    // For card 9001, should have all 6 roles available as 3oak
    const optionsForCard = threeOakOptions.filter(o => o.cardUid === 9001);
    const roles = new Set(optionsForCard.map(o => o.role));
    expect(roles).toEqual(new Set(['Architect', 'Craftsman', 'Laborer', 'Legionary', 'Merchant', 'Patron']));

    // Each 3oak option should have exactly 2 extra card UIDs
    for (const opt of optionsForCard) {
      expect(opt.extraCardUids).toHaveLength(2);
    }
  });

  it('getAvailableActions: 2 cards of same material do NOT produce 3oak lead options', () => {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    // Give player 0 exactly 2 brick cards
    const twoState: GameState = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [
          { uid: 9001, defId: 'foundry' },
          { uid: 9002, defId: 'school' },
          { uid: 9003, defId: 'road' }, // Concrete, not Brick
        ] } : p
      ),
    };
    const actions = getAvailableActions(twoState);
    const threeOakOptions = actions.leadOptions.filter(o => o.extraCardUids);
    expect(threeOakOptions).toHaveLength(0);
  });

  it('leading with 3-of-a-kind removes all 3 cards and puts them in pending pool', () => {
    const state = stateWith3Brick();
    const handBefore = state.players[0]!.hand.length;

    const newState = gameReducer(state, {
      type: 'LEAD_ROLE',
      role: 'Merchant', // Not the natural role for Brick (Legionary)
      cardUid: 9001,
      extraCardUids: [9002, 9003],
    });

    expect(newState.players[0]!.hand).toHaveLength(handBefore - 3);
    expect(newState.pendingPool).toHaveLength(3);
    expect(newState.pendingPool.some(c => c.uid === 9001)).toBe(true);
    expect(newState.pendingPool.some(c => c.uid === 9002)).toBe(true);
    expect(newState.pendingPool.some(c => c.uid === 9003)).toBe(true);
    expect(newState.phase.type).toBe('follow');
    if (newState.phase.type === 'follow') {
      expect(newState.phase.ledRole).toBe('Merchant');
    }
  });

  it('3-of-a-kind can lead any role (not just natural role)', () => {
    const state = stateWith3Brick();
    // Brick natural role is Legionary, but 3oak should allow Patron
    const newState = gameReducer(state, {
      type: 'LEAD_ROLE',
      role: 'Patron',
      cardUid: 9001,
      extraCardUids: [9002, 9003],
    });

    expect(newState.phase.type).toBe('follow');
    if (newState.phase.type === 'follow') {
      expect(newState.phase.ledRole).toBe('Patron');
    }
  });

  it('3-of-a-kind rejects mismatched materials', () => {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    const mixedState: GameState = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [
          { uid: 9001, defId: 'foundry' },  // Brick
          { uid: 9002, defId: 'school' },    // Brick
          { uid: 9003, defId: 'road' },      // Concrete — mismatch!
        ] } : p
      ),
    };

    const newState = gameReducer(mixedState, {
      type: 'LEAD_ROLE',
      role: 'Patron',
      cardUid: 9001,
      extraCardUids: [9002, 9003],
    });

    // Should be rejected — state unchanged
    expect(newState.phase.type).toBe('lead');
    expect(newState.players[0]!.hand).toHaveLength(3);
  });

  it('3-of-a-kind rejects jacks as part of the trio', () => {
    const rng = seededRng(42);
    const state = createInitialState(2, ['A', 'B'], rng);
    const jackState: GameState = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [
          { uid: 9001, defId: 'foundry' },  // Brick
          { uid: 9002, defId: 'school' },    // Brick
          { uid: 9003, defId: 'jack' },      // Jack — not valid for 3oak
        ] } : p
      ),
    };

    const newState = gameReducer(jackState, {
      type: 'LEAD_ROLE',
      role: 'Patron',
      cardUid: 9001,
      extraCardUids: [9002, 9003],
    });

    // Should be rejected
    expect(newState.phase.type).toBe('lead');
  });

  it('following with 3-of-a-kind works for non-matching material', () => {
    // Set up: player 0 leads Merchant. Player 1 has 3 Brick cards (not Stone).
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Give player 0 a Stone card to lead Merchant
    const stoneCard: Card = { uid: 8000, defId: 'sanctuary' };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [stoneCard, ...p.hand.slice(0, 4)] } : p
      ),
    };

    // Lead Merchant
    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Merchant', cardUid: 8000 });
    expect(state.phase.type).toBe('follow');

    // Give player 1 three Brick cards
    const brickCards: Card[] = [
      { uid: 9001, defId: 'foundry' },
      { uid: 9002, defId: 'school' },
      { uid: 9003, defId: 'shrine' },
    ];
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...brickCards, ...p.hand.slice(0, 2)] } : p
      ),
    };

    const p1HandBefore = state.players[1]!.hand.length;

    // Follow Merchant with 3-of-a-kind Brick
    const newState = gameReducer(state, {
      type: 'FOLLOW_ROLE',
      cardUid: 9001,
      extraCardUids: [9002, 9003],
    });

    expect(newState.players[1]!.hand).toHaveLength(p1HandBefore - 3);
    expect(newState.pendingPool.some(c => c.uid === 9001)).toBe(true);
    expect(newState.pendingPool.some(c => c.uid === 9002)).toBe(true);
    expect(newState.pendingPool.some(c => c.uid === 9003)).toBe(true);
    // Player 1 should be an actor
    expect(newState.phase.type).toBe('action');
    if (newState.phase.type === 'action') {
      expect(newState.phase.actors).toContain(1);
    }
  });

  it('getAvailableActions: 3oak follow options appear for non-matching material', () => {
    const rng = seededRng(42);
    let state = createInitialState(2, ['A', 'B'], rng);

    // Give player 0 a Stone card and lead Merchant
    const stoneCard: Card = { uid: 8000, defId: 'sanctuary' };
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [stoneCard, ...p.hand.slice(0, 4)] } : p
      ),
    };
    state = gameReducer(state, { type: 'LEAD_ROLE', role: 'Merchant', cardUid: 8000 });

    // Give player 1 three Brick cards (not Stone)
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [
          { uid: 9001, defId: 'foundry' },
          { uid: 9002, defId: 'school' },
          { uid: 9003, defId: 'shrine' },
          { uid: 9004, defId: 'road' }, // Concrete card, not part of 3oak
          { uid: 9005, defId: 'crane' }, // Wood card, not part of 3oak
        ] } : p
      ),
    };

    const actions = getAvailableActions(state);
    // Should have no normal follow options (no Stone cards)
    const normalOptions = actions.followOptions.filter(o => !o.extraCardUids);
    expect(normalOptions).toHaveLength(0);

    // Should have 3oak follow options for each of the 3 Brick cards
    const threeOakOptions = actions.followOptions.filter(o => o.extraCardUids);
    expect(threeOakOptions).toHaveLength(3);

    for (const opt of threeOakOptions) {
      expect(opt.extraCardUids).toHaveLength(2);
    }
  });
});

describe('Game end - deck exhaustion', () => {
  it('game ends when deck is empty at end of round', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Empty the deck
    state = { ...state, deck: [] };
    // Player 0 leads with a think (all players think)
    const result = gameReducer(state, { type: 'THINK', option: { kind: 'jack' } });
    // After leader thinks, follower must act; think with jack too
    const result2 = gameReducer(result, { type: 'THINK', option: { kind: 'jack' } });
    // Round is over, advanceLeader should detect empty deck
    expect(result2.phase.type).toBe('gameOver');
  });

  it('game does not end mid-round when leader empties deck', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Leave exactly 1 card in the deck
    state = { ...state, deck: state.deck.slice(0, 1) };
    // Player 0 thinks with draw1 (draws the last card)
    const result = gameReducer(state, { type: 'THINK', option: { kind: 'draw1' } });
    // Follower still needs to think — game not over yet
    expect(result.phase.type).toBe('thinkRound');
    // Follower thinks with jack (deck is empty, can't draw from deck)
    const result2 = gameReducer(result, { type: 'THINK', option: { kind: 'jack' } });
    // Now the round ends and deck is empty -> game over
    expect(result2.phase.type).toBe('gameOver');
  });

  it('game continues if deck still has cards at end of round', () => {
    let state = createInitialState(2, ['A', 'B'], seededRng(42));
    // Leave a few cards
    state = { ...state, deck: state.deck.slice(0, 5) };
    const result = gameReducer(state, { type: 'THINK', option: { kind: 'jack' } });
    const result2 = gameReducer(result, { type: 'THINK', option: { kind: 'jack' } });
    expect(result2.phase.type).toBe('lead');
  });
});

describe('Game end - building diversity', () => {
  // Requires 2 completed buildings of the SAME material at each cost tier (1, 2, 3)
  function makeDiversityState() {
    const { state, uids } = makeState(2, ['A', 'B'], 500);
    // 2x Rubble (cost 1), 2x Brick (cost 2), 1x Stone (cost 3) complete
    // Plus one incomplete Stone building needing one more material
    const completedBuildings: Building[] = [
      mkBuilding(uids.material('Rubble'), [uids.material('Rubble')], true),
      mkBuilding(uids.material('Rubble'), [uids.material('Rubble')], true),
      mkBuilding(uids.material('Brick'), [uids.material('Brick'), uids.material('Brick')], true),
      mkBuilding(uids.material('Brick'), [uids.material('Brick'), uids.material('Brick')], true),
      mkBuilding(uids.material('Stone'), [uids.material('Stone'), uids.material('Stone'), uids.material('Stone')], true),
    ];
    // Incomplete Stone building with 2 of 3 materials
    const incompleteBuilding = mkBuilding(
      uids.material('Stone'),
      [uids.material('Stone'), uids.material('Stone')],
      false,
    );
    // Card in hand to add as material
    const stoneInHand = uids.material('Stone');

    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [...completedBuildings, incompleteBuilding],
      hand: [stoneInHand, ...s.players[0]!.hand],
      influence: 11, // sum of completed building costs: 1+1+2+2+3
    });
    return { state: s, stoneCardUid: stoneInHand.uid, incompleteBuildingIndex: 5 };
  }

  it('triggers game end when player completes 2 buildings of same material at each cost tier', () => {
    const { state, stoneCardUid, incompleteBuildingIndex } = makeDiversityState();
    let s = withActionPhase(state, 'Craftsman');
    s = gameReducer(s, {
      type: 'CRAFTSMAN_ADD',
      buildingIndex: incompleteBuildingIndex,
      cardUid: stoneCardUid,
    });
    expect(s.gameEndTriggered).toBe(true);
  });

  it('game ends at next leader advance after diversity trigger', () => {
    const { state, stoneCardUid, incompleteBuildingIndex } = makeDiversityState();
    let s = withActionPhase(state, 'Craftsman', [0]);
    s = gameReducer(s, {
      type: 'CRAFTSMAN_ADD',
      buildingIndex: incompleteBuildingIndex,
      cardUid: stoneCardUid,
    });
    expect(s.phase.type).toBe('gameOver');
  });

  it('does not trigger when 2 buildings at a cost tier are different materials', () => {
    const { state: baseState, uids } = makeState(2, ['A', 'B'], 600);
    // 1 Rubble + 1 Wood (both cost 1 but different materials), 2x Brick, 2x Stone
    const buildings: Building[] = [
      mkBuilding(uids.material('Rubble'), [uids.material('Rubble')], true),
      mkBuilding(uids.material('Wood'), [uids.material('Wood')], true),
      mkBuilding(uids.material('Brick'), [uids.material('Brick'), uids.material('Brick')], true),
      mkBuilding(uids.material('Brick'), [uids.material('Brick'), uids.material('Brick')], true),
      mkBuilding(uids.material('Stone'), [uids.material('Stone'), uids.material('Stone'), uids.material('Stone')], true),
      mkBuilding(uids.material('Stone'), [uids.material('Stone'), uids.material('Stone'), uids.material('Stone')], true),
    ];
    let s = finalize(baseState, uids);
    s = updatePlayer(s, 0, { buildings, influence: 14 });
    s = { ...s, phase: { type: 'lead', leaderId: 0 } };
    const r1 = gameReducer(s, { type: 'THINK', option: { kind: 'jack' } });
    const r2 = gameReducer(r1, { type: 'THINK', option: { kind: 'jack' } });
    expect(r2.phase.type).toBe('lead');
    expect(r2.gameEndTriggered).toBeFalsy();
  });

  it('does not trigger with only 1 completed building of a material at a cost tier', () => {
    const { state: baseState, uids } = makeState(2, ['A', 'B'], 600);
    // 2x Rubble, 2x Brick, but only 1x Stone
    const buildings: Building[] = [
      mkBuilding(uids.material('Rubble'), [uids.material('Rubble')], true),
      mkBuilding(uids.material('Rubble'), [uids.material('Rubble')], true),
      mkBuilding(uids.material('Brick'), [uids.material('Brick'), uids.material('Brick')], true),
      mkBuilding(uids.material('Brick'), [uids.material('Brick'), uids.material('Brick')], true),
      mkBuilding(uids.material('Stone'), [uids.material('Stone'), uids.material('Stone'), uids.material('Stone')], true),
    ];
    let s = finalize(baseState, uids);
    s = updatePlayer(s, 0, { buildings, influence: 9 });
    s = { ...s, phase: { type: 'lead', leaderId: 0 } };
    const r1 = gameReducer(s, { type: 'THINK', option: { kind: 'jack' } });
    const r2 = gameReducer(r1, { type: 'THINK', option: { kind: 'jack' } });
    expect(r2.phase.type).toBe('lead');
    expect(r2.gameEndTriggered).toBeFalsy();
  });

  it('does not count incomplete buildings toward diversity', () => {
    const { state: baseState, uids } = makeState(2, ['A', 'B'], 700);
    // 2x Rubble, 2x Brick complete, 1x Stone complete + 1x Stone INCOMPLETE
    const buildings: Building[] = [
      mkBuilding(uids.material('Rubble'), [uids.material('Rubble')], true),
      mkBuilding(uids.material('Rubble'), [uids.material('Rubble')], true),
      mkBuilding(uids.material('Brick'), [uids.material('Brick'), uids.material('Brick')], true),
      mkBuilding(uids.material('Brick'), [uids.material('Brick'), uids.material('Brick')], true),
      mkBuilding(uids.material('Stone'), [uids.material('Stone'), uids.material('Stone'), uids.material('Stone')], true),
      mkBuilding(uids.material('Stone'), [uids.material('Stone')], false), // incomplete!
    ];
    let s = finalize(baseState, uids);
    s = updatePlayer(s, 0, { buildings, influence: 9 });
    s = { ...s, phase: { type: 'lead', leaderId: 0 } };
    const r1 = gameReducer(s, { type: 'THINK', option: { kind: 'jack' } });
    const r2 = gameReducer(r1, { type: 'THINK', option: { kind: 'jack' } });
    expect(r2.phase.type).toBe('lead');
    expect(r2.gameEndTriggered).toBeFalsy();
  });
});

// ===== Wood Building Powers =====

describe('Cross power (+1 Refresh Hand Size)', () => {
  it('getEffectiveHandLimit returns base limit without Cross', () => {
    const { state } = makeState(2, ['A', 'B'], 42);
    expect(getEffectiveHandLimit(state, 0)).toBe(5);
  });

  it('getEffectiveHandLimit returns +1 with completed Cross', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const crossBuilding = mkBuilding(uids.card('cross'), [uids.card('dock')], true);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [crossBuilding], influence: 1 });
    expect(getEffectiveHandLimit(s, 0)).toBe(6);
    // Player 1 without Cross still has 5
    expect(getEffectiveHandLimit(s, 1)).toBe(5);
  });

  it('refresh draws up to 6 with Cross', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const crossBuilding = mkBuilding(uids.card('cross'), [uids.card('dock')], true);
    let s = finalize(state, uids);
    // Give player 0 Cross and only 2 cards
    s = updatePlayer(s, 0, {
      buildings: [crossBuilding],
      influence: 1,
      hand: s.players[0]!.hand.slice(0, 2),
    });
    s = { ...s, phase: { type: 'lead', leaderId: 0 } };
    const result = gameReducer(s, { type: 'THINK', option: { kind: 'refresh' } });
    // Should draw 4 cards to reach hand limit of 6
    expect(result.players[0]!.hand).toHaveLength(6);
  });

  it('incomplete Cross does not increase hand limit', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const crossBuilding = mkBuilding(uids.card('cross'), [], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [crossBuilding] });
    expect(getEffectiveHandLimit(s, 0)).toBe(5);
  });
});

describe('Market power (on-completion: generic supply to hand)', () => {
  it('completing Market adds 1 of each material from generic supply to hand', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    // Market needs 1 material (Wood cost 1). Give player a Market foundation + Wood card to add
    const woodCard = uids.card('crane'); // any Wood card
    const marketBuilding = mkBuilding(uids.card('market'), [], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [marketBuilding],
      hand: [woodCard, ...s.players[0]!.hand.slice(0, 4)],
      influence: 0,
    });
    s = withActionPhase(s, 'Craftsman');

    const handSizeBefore = s.players[0]!.hand.length;
    const result = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: woodCard.uid });
    const player = result.players[0]!;
    // Building should be complete
    expect(player.buildings[0]!.completed).toBe(true);
    // Hand should gain 6 generic cards (1 of each type), minus 1 used for crafting
    expect(player.hand).toHaveLength(handSizeBefore - 1 + 6);
    const handMaterials = player.hand.map(c => getCardDef(c).material);
    expect(handMaterials).toContain('Rubble');
    expect(handMaterials).toContain('Wood');
    expect(handMaterials).toContain('Brick');
    expect(handMaterials).toContain('Concrete');
    expect(handMaterials).toContain('Stone');
    expect(handMaterials).toContain('Marble');
    // Stockpile should be empty (materials go to hand, not stockpile)
    expect(player.stockpile).toHaveLength(0);
    // Generic supply should be decremented
    expect(result.genericSupply.Rubble).toBe(8);
    expect(result.genericSupply.Wood).toBe(8);
    // Influence should increase by 1 (cost of Wood building)
    expect(player.influence).toBe(1);
  });

  it('Market does not take from empty generic supply slots', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const woodCard = uids.card('crane');
    const marketBuilding = mkBuilding(uids.card('market'), [], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [marketBuilding],
      hand: [woodCard, ...s.players[0]!.hand.slice(0, 4)],
      influence: 0,
    });
    // Deplete Stone from generic supply
    s = { ...s, genericSupply: { ...s.genericSupply, Stone: 0 } };
    s = withActionPhase(s, 'Craftsman');

    const handSizeBefore = s.players[0]!.hand.length;
    const result = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: woodCard.uid });
    // Should only get 5 cards (no Stone) added to hand
    expect(result.players[0]!.hand).toHaveLength(handSizeBefore - 1 + 5);
    const handMaterials = result.players[0]!.hand.map(c => getCardDef(c).material);
    expect(handMaterials).not.toContain('Stone');
  });
});

describe('Dock power (Laborer: hand to stockpile)', () => {
  it('shows dock options when player has completed Dock during Laborer action', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const dockBuilding = mkBuilding(uids.card('dock'), [uids.card('crane')], true);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [dockBuilding], influence: 1 });
    s = withActionPhase(s, 'Laborer');

    const actions = getAvailableActions(s);
    expect(actions.laborerHandOptions.length).toBeGreaterThan(0);
    // Should not include Jacks
    for (const opt of actions.laborerHandOptions) {
      const card = s.players[0]!.hand.find(c => c.uid === opt.cardUid)!;
      expect(isJackCard(card)).toBe(false);
    }
  });

  it('does not show dock options without completed Dock', () => {
    const { state } = makeState(2, ['A', 'B'], 42);
    const s = withActionPhase(state, 'Laborer');
    const actions = getAvailableActions(s);
    expect(actions.laborerHandOptions).toHaveLength(0);
  });

  it('LABORER_HAND_TO_STOCKPILE moves card from hand to stockpile', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const dockBuilding = mkBuilding(uids.card('dock'), [uids.card('crane')], true);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [dockBuilding], influence: 1 });
    s = withActionPhase(s, 'Laborer');

    const cardToMove = s.players[0]!.hand[0]!;
    const initialHandSize = s.players[0]!.hand.length;
    const result = gameReducer(s, { type: 'LABORER_HAND_TO_STOCKPILE', cardUid: cardToMove.uid });

    expect(result.players[0]!.hand).toHaveLength(initialHandSize - 1);
    expect(result.players[0]!.hand.find(c => c.uid === cardToMove.uid)).toBeUndefined();
    expect(result.players[0]!.stockpile).toContainEqual(cardToMove);
  });

  it('LABORER_HAND_TO_STOCKPILE rejects Jacks', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const dockBuilding = mkBuilding(uids.card('dock'), [uids.card('crane')], true);
    const jack: Card = { uid: uids.next(), defId: 'jack' };
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [dockBuilding],
      hand: [jack, ...s.players[0]!.hand],
      influence: 1,
    });
    s = withActionPhase(s, 'Laborer');

    const result = gameReducer(s, { type: 'LABORER_HAND_TO_STOCKPILE', cardUid: jack.uid });
    // Should be unchanged (rejected)
    expect(result.players[0]!.hand).toContainEqual(jack);
    expect(result.players[0]!.stockpile).not.toContainEqual(jack);
  });

  it('LABORER_HAND_TO_STOCKPILE rejected without Dock', () => {
    const { state } = makeState(2, ['A', 'B'], 42);
    const s = withActionPhase(state, 'Laborer');
    const card = s.players[0]!.hand[0]!;
    const result = gameReducer(s, { type: 'LABORER_HAND_TO_STOCKPILE', cardUid: card.uid });
    // Should be unchanged
    expect(result.players[0]!.hand).toContainEqual(card);
  });
});

describe('Bazaar power (Merchant: pool to vault)', () => {
  it('shows bazaar options when player has completed Bazaar during Merchant action', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const bazaarBuilding = mkBuilding(uids.card('bazaar'), [uids.card('market')], true);
    const poolCard = uids.material('Stone');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [bazaarBuilding], influence: 1 });
    s = { ...s, pool: [poolCard] };
    s = withActionPhase(s, 'Merchant');

    const actions = getAvailableActions(s);
    expect(actions.bazaarOptions).toContain('Stone');
  });

  it('does not show bazaar options without completed Bazaar', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const poolCard = uids.material('Stone');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { influence: 3 });
    s = { ...s, pool: [poolCard] };
    s = withActionPhase(s, 'Merchant');

    const actions = getAvailableActions(s);
    expect(actions.bazaarOptions).toHaveLength(0);
  });

  it('does not show bazaar options when vault is full', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const bazaarBuilding = mkBuilding(uids.card('bazaar'), [uids.card('market')], true);
    const poolCard = uids.material('Stone');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [bazaarBuilding],
      influence: 1,
      vault: [uids.material('Rubble')], // 1 vault item = influence, so full
    });
    s = { ...s, pool: [poolCard] };
    s = withActionPhase(s, 'Merchant');

    const actions = getAvailableActions(s);
    expect(actions.bazaarOptions).toHaveLength(0);
    expect(actions.vaultFull).toBe(true);
  });

  it('MERCHANT_STOCKPILE_TO_VAULT with fromPool moves pool card to vault', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const bazaarBuilding = mkBuilding(uids.card('bazaar'), [uids.card('market')], true);
    const poolCard = uids.material('Stone');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [bazaarBuilding], influence: 1 });
    s = { ...s, pool: [poolCard] };
    s = withActionPhase(s, 'Merchant');

    const result = gameReducer(s, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Stone', fromPool: true });
    expect(result.players[0]!.vault).toHaveLength(1);
    expect(getCardDef(result.players[0]!.vault[0]!).material).toBe('Stone');
    expect(result.pool).toHaveLength(0);
  });

  it('MERCHANT_STOCKPILE_TO_VAULT with fromPool rejected without Bazaar', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const poolCard = uids.material('Stone');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { influence: 3 });
    s = { ...s, pool: [poolCard] };
    s = withActionPhase(s, 'Merchant');

    const result = gameReducer(s, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Stone', fromPool: true });
    // Should be unchanged
    expect(result.pool).toHaveLength(1);
    expect(result.players[0]!.vault).toHaveLength(0);
  });

  it('MERCHANT_STOCKPILE_TO_VAULT with fromPool respects vault capacity', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const bazaarBuilding = mkBuilding(uids.card('bazaar'), [uids.card('market')], true);
    const poolCard = uids.material('Stone');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [bazaarBuilding],
      influence: 1,
      vault: [uids.material('Rubble')], // vault full
    });
    s = { ...s, pool: [poolCard] };
    s = withActionPhase(s, 'Merchant');

    const result = gameReducer(s, { type: 'MERCHANT_STOCKPILE_TO_VAULT', material: 'Stone', fromPool: true });
    // Should be unchanged — vault is full
    expect(result.pool).toHaveLength(1);
    expect(result.players[0]!.vault).toHaveLength(1);
  });
});

describe('Crane power (Architect: start 2 buildings)', () => {
  it('shows crane options when player has completed Crane during Architect action', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const craneBuilding = mkBuilding(uids.card('crane'), [uids.card('dock')], true);
    const brickCard = uids.card('foundry');
    const stoneCard = uids.card('villa');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [craneBuilding],
      hand: [brickCard, stoneCard],
      influence: 1,
    });
    s = withActionPhase(s, 'Architect');

    const actions = getAvailableActions(s);
    expect(actions.architectCraneOptions.length).toBeGreaterThan(0);
    // Should have pairs with both orderings
    const hasPair = actions.architectCraneOptions.some(o =>
      (o.cardUid === brickCard.uid && o.craneCardUid === stoneCard.uid) ||
      (o.cardUid === stoneCard.uid && o.craneCardUid === brickCard.uid)
    );
    expect(hasPair).toBe(true);
  });

  it('does not show crane options without completed Crane', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const brickCard = uids.card('foundry');
    const stoneCard = uids.card('villa');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { hand: [brickCard, stoneCard], influence: 3 });
    s = withActionPhase(s, 'Architect');

    const actions = getAvailableActions(s);
    expect(actions.architectCraneOptions).toHaveLength(0);
  });

  it('ARCHITECT_START with craneCardUid starts 2 buildings', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const craneBuilding = mkBuilding(uids.card('crane'), [uids.card('dock')], true);
    const brickCard = uids.card('foundry');
    const stoneCard = uids.card('villa');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [craneBuilding],
      hand: [brickCard, stoneCard],
      influence: 1,
    });
    s = withActionPhase(s, 'Architect');

    const result = gameReducer(s, {
      type: 'ARCHITECT_START',
      cardUid: brickCard.uid,
      craneCardUid: stoneCard.uid,
    });

    const player = result.players[0]!;
    // Should have 3 buildings total (1 existing Crane + 2 new)
    expect(player.buildings).toHaveLength(3);
    expect(player.hand).toHaveLength(0);
    // Both new buildings should exist
    expect(player.buildings[1]!.foundationCard.uid).toBe(brickCard.uid);
    expect(player.buildings[2]!.foundationCard.uid).toBe(stoneCard.uid);
    // Sites should be decremented for both
    expect(result.sites.Brick).toBe(s.sites.Brick - 1);
    expect(result.sites.Stone).toBe(s.sites.Stone - 1);
  });

  it('ARCHITECT_START with craneCardUid rejected without completed Crane', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const brickCard = uids.card('foundry');
    const stoneCard = uids.card('villa');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { hand: [brickCard, stoneCard], influence: 3 });
    s = withActionPhase(s, 'Architect');

    const result = gameReducer(s, {
      type: 'ARCHITECT_START',
      cardUid: brickCard.uid,
      craneCardUid: stoneCard.uid,
    });
    // Should be unchanged
    expect(result.players[0]!.buildings).toHaveLength(0);
  });

  it('crane does not allow 2 buildings of same material', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const craneBuilding = mkBuilding(uids.card('crane'), [uids.card('dock')], true);
    const brick1 = uids.card('foundry');
    const brick2 = uids.card('school');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [craneBuilding],
      hand: [brick1, brick2],
      influence: 1,
    });
    s = withActionPhase(s, 'Architect');

    const actions = getAvailableActions(s);
    // Should not have crane option for 2 bricks (can't have 2 uncompleted of same material)
    const sameMaterialPair = actions.architectCraneOptions.some(o =>
      (o.cardUid === brick1.uid && o.craneCardUid === brick2.uid) ||
      (o.cardUid === brick2.uid && o.craneCardUid === brick1.uid)
    );
    expect(sameMaterialPair).toBe(false);
  });

  it('crane does not allow out-of-town buildings', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const craneBuilding = mkBuilding(uids.card('crane'), [uids.card('dock')], true);
    const brickCard = uids.card('foundry');
    const stoneCard = uids.card('villa');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [craneBuilding],
      hand: [brickCard, stoneCard],
      influence: 1,
    });
    // Deplete normal Brick sites so it would require out-of-town
    s = { ...s, sites: { ...s.sites, Brick: 0 } };
    s = withActionPhase(s, 'Architect');

    const actions = getAvailableActions(s);
    // Brick is out-of-town only, so no crane pairs should include it
    const hasBrickPair = actions.architectCraneOptions.some(o =>
      o.cardUid === brickCard.uid || o.craneCardUid === brickCard.uid
    );
    expect(hasBrickPair).toBe(false);
  });

  it('crane reducer rejects out-of-town first building', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const craneBuilding = mkBuilding(uids.card('crane'), [uids.card('dock')], true);
    const brickCard = uids.card('foundry');
    const stoneCard = uids.card('villa');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [craneBuilding],
      hand: [brickCard, stoneCard],
      influence: 1,
    });
    // Deplete normal Brick sites
    s = { ...s, sites: { ...s.sites, Brick: 0 } };
    s = withActionPhase(s, 'Architect', [0, 0]); // 2 actions for OOT

    const result = gameReducer(s, {
      type: 'ARCHITECT_START',
      cardUid: brickCard.uid,
      craneCardUid: stoneCard.uid,
    });
    // Should be rejected — out-of-town + crane not allowed
    expect(result.players[0]!.buildings).toHaveLength(1); // only Crane
  });
});

describe('Palisade power (block odd legionary demands)', () => {
  function setupLegionaryWithPalisade(opts: { palisade?: boolean; wall?: boolean; actorActions?: number }) {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const buildings: Building[] = [];
    if (opts.palisade) buildings.push(mkBuilding(uids.card('palisade'), [uids.card('market')], true));
    if (opts.wall) buildings.push(mkBuilding(uids.card('wall'), [uids.card('road'), uids.card('tower')], true));

    // Give player 0 (attacker) multiple legionary reveal cards
    const revealCards = [
      uids.material('Wood'), uids.material('Wood'), uids.material('Wood'),
      uids.material('Wood'), uids.material('Wood'),
    ];
    // Give player 1 (defender with Palisade) matching Wood cards to give
    const defenderWoodCards = [
      uids.material('Wood'), uids.material('Wood'), uids.material('Wood'),
      uids.material('Wood'), uids.material('Wood'),
    ];
    const poolWoodCards = [
      uids.material('Wood'), uids.material('Wood'), uids.material('Wood'),
      uids.material('Wood'), uids.material('Wood'),
    ];

    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { hand: revealCards, influence: 3 });
    s = updatePlayer(s, 1, { hand: defenderWoodCards, buildings, influence: buildings.length > 0 ? 3 : 0 });
    const actorCount = opts.actorActions ?? 5;
    const actors = Array(actorCount).fill(0);
    s = { ...s, pool: poolWoodCards };
    s = withActionPhase(s, 'Legionary', actors);
    return s;
  }

  it('without Palisade, all demands go through', () => {
    let s = setupLegionaryWithPalisade({});
    // 1st demand
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    // Should enter demand phase (not blocked)
    expect(s.phase.type).toBe('legionary_demand');
  });

  it('with Palisade, 1st demand is blocked, 2nd goes through', () => {
    let s = setupLegionaryWithPalisade({ palisade: true });

    // 1st demand — blocked by Palisade
    const card1 = s.players[0]!.hand[0]!;
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: card1.uid });
    // Should advance actor (demand blocked, no legionary_demand phase)
    expect(s.phase.type).toBe('action');

    // 2nd demand — goes through
    const card2 = s.players[0]!.hand[0]!;
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: card2.uid });
    expect(s.phase.type).toBe('legionary_demand');
  });

  it('with Palisade, 3rd demand is blocked, 4th goes through', () => {
    let s = setupLegionaryWithPalisade({ palisade: true });

    // 1st — blocked
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('action');

    // 2nd — through
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('legionary_demand');
    // Give the demanded card
    s = gameReducer(s, { type: 'LEGIONARY_GIVE', cardUid: s.players[1]!.hand[0]!.uid });

    // 3rd — blocked
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('action');

    // 4th — through
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('legionary_demand');
  });

  it('with Palisade + Wall, only every 4th demand goes through', () => {
    let s = setupLegionaryWithPalisade({ palisade: true, wall: true });

    // 1st, 2nd, 3rd — all blocked
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('action');
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('action');
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('action');

    // 4th — goes through
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('legionary_demand');
  });

  it('demand counts reset each round', () => {
    let s = setupLegionaryWithPalisade({ palisade: true, actorActions: 2 });

    // Round 1: 1st blocked, 2nd through
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('action');
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: s.players[0]!.hand[0]!.uid });
    expect(s.phase.type).toBe('legionary_demand');
    s = gameReducer(s, { type: 'LEGIONARY_GIVE', cardUid: s.players[1]!.hand[0]!.uid });
    // Round should advance to next leader
    expect(s.phase.type).toBe('lead');
    // Demand counts should be reset
    expect(s.legionaryDemandCounts).toBeUndefined();
  });
});

describe('Archway power (incomplete Marble buildings provide function)', () => {
  it('hasActiveBuildingPower returns true for completed buildings (non-Marble)', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const crossBuilding = mkBuilding(uids.card('cross'), [uids.card('dock')], true);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [crossBuilding], influence: 1 });
    expect(hasActiveBuildingPower(s.players[0]!, 'cross')).toBe(true);
  });

  it('hasActiveBuildingPower returns false for incomplete non-Marble buildings even with Archway', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const archwayBuilding = mkBuilding(uids.card('archway'), [uids.card('dock')], true);
    const crossBuilding = mkBuilding(uids.card('cross'), [], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [archwayBuilding, crossBuilding], influence: 1 });
    expect(hasActiveBuildingPower(s.players[0]!, 'cross')).toBe(false);
  });

  it('hasActiveBuildingPower activates first incomplete Marble building with Archway', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const archwayBuilding = mkBuilding(uids.card('archway'), [uids.card('dock')], true);
    const templeBuilding = mkBuilding(uids.card('temple'), [uids.material('Marble')], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [archwayBuilding, templeBuilding], influence: 1 });
    expect(hasActiveBuildingPower(s.players[0]!, 'temple')).toBe(true);
  });

  it('hasActiveBuildingPower does not activate without Archway', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const templeBuilding = mkBuilding(uids.card('temple'), [uids.material('Marble')], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [templeBuilding] });
    expect(hasActiveBuildingPower(s.players[0]!, 'temple')).toBe(false);
  });

  it('hasActiveBuildingPower only activates the first incomplete Marble building', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const archwayBuilding = mkBuilding(uids.card('archway'), [uids.card('dock')], true);
    const templeBuilding = mkBuilding(uids.card('temple'), [uids.material('Marble')], false);
    const palaceBuilding = mkBuilding(uids.card('palace'), [], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [archwayBuilding, templeBuilding, palaceBuilding], influence: 1 });
    // Temple is first incomplete Marble — it's active
    expect(hasActiveBuildingPower(s.players[0]!, 'temple')).toBe(true);
    // Palace is second — not active
    expect(hasActiveBuildingPower(s.players[0]!, 'palace')).toBe(false);
  });

  it('hasActiveBuildingPower skips completed Marble buildings when finding first incomplete', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const archwayBuilding = mkBuilding(uids.card('archway'), [uids.card('dock')], true);
    const templeBuilding = mkBuilding(uids.card('temple'), [uids.material('Marble'), uids.material('Marble'), uids.material('Marble')], true);
    const palaceBuilding = mkBuilding(uids.card('palace'), [], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [archwayBuilding, templeBuilding, palaceBuilding], influence: 4 });
    // Temple is completed (active regardless of Archway)
    expect(hasActiveBuildingPower(s.players[0]!, 'temple')).toBe(true);
    // Palace is the first *incomplete* Marble — Archway activates it
    expect(hasActiveBuildingPower(s.players[0]!, 'palace')).toBe(true);
  });
});

// ── Rubble Powers ──

describe('Vat power (Concrete buildings need 1 material)', () => {
  it('completes a Concrete building with 1 material when Vat is completed', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const vatBuilding = mkBuilding(uids.card('vat'), [uids.card('quarry')], true);
    const concreteBuilding = mkBuilding(uids.card('road'), [], false);
    const concreteCard = uids.material('Concrete');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [vatBuilding, concreteBuilding],
      hand: [concreteCard, ...s.players[0]!.hand.slice(0, 4)],
      influence: 1,
    });
    s = withActionPhase(s, 'Craftsman');
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 1, cardUid: concreteCard.uid });
    // Building should be complete with just 1 material (normally needs 2)
    expect(s.players[0]!.buildings[1]!.completed).toBe(true);
    expect(s.players[0]!.influence).toBe(3); // 1 existing + 2 from Concrete cost
  });

  it('retroactively completes Concrete buildings with 1 material when Vat itself completes', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    // Vat is incomplete, needs 1 Rubble material
    const vatBuilding = mkBuilding(uids.card('vat'), [], false);
    // Concrete building already has 1 material but isn't complete (normally needs 2)
    const concreteBuilding = mkBuilding(uids.card('road'), [uids.material('Concrete')], false);
    const rubbleCard = uids.material('Rubble');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [vatBuilding, concreteBuilding],
      hand: [rubbleCard, ...s.players[0]!.hand.slice(0, 4)],
    });
    s = { ...s, sites: { ...s.sites, Rubble: s.sites.Rubble - 1, Concrete: s.sites.Concrete - 1 } };
    s = withActionPhase(s, 'Craftsman');
    // Complete the Vat — should retroactively complete the Concrete building too
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: rubbleCard.uid });
    expect(s.players[0]!.buildings[0]!.completed).toBe(true); // Vat
    expect(s.players[0]!.buildings[1]!.completed).toBe(true); // Road (retroactive)
    // Influence: 1 (Vat) + 2 (Road) = 3
    expect(s.players[0]!.influence).toBe(3);
  });

  it('getRequiredMaterials returns 1 for Concrete with Vat, normal cost without', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const vatBuilding = mkBuilding(uids.card('vat'), [uids.card('quarry')], true);
    const concreteBuilding = mkBuilding(uids.card('road'), [], false);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [vatBuilding, concreteBuilding], influence: 1 });
    // With Vat
    expect(getRequiredMaterials(s.players[0]!, concreteBuilding)).toBe(1);
    // Without Vat (player 1)
    expect(getRequiredMaterials(s.players[1]!, concreteBuilding)).toBe(2);
  });

  it('does not complete Concrete building with 1 material without Vat', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const concreteBuilding = mkBuilding(uids.card('road'), [], false);
    const concreteCard = uids.material('Concrete');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [concreteBuilding],
      hand: [concreteCard, ...s.players[0]!.hand.slice(0, 4)],
    });
    s = withActionPhase(s, 'Craftsman');
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: concreteCard.uid });
    expect(s.players[0]!.buildings[0]!.completed).toBe(false);
  });
});

describe('Fortress power (client pairs count as Legionary)', () => {
  it('adds bonus Legionary actions from pairs of non-Brick clients', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const fortressBuilding = mkBuilding(uids.card('fortress'), [uids.card('quarry')], true);
    let s = finalize(state, uids);
    // 2 Wood (Craftsman) clients and 2 Stone (Merchant) clients
    s = updatePlayer(s, 0, {
      buildings: [fortressBuilding],
      clientele: [uids.material('Wood'), uids.material('Wood'), uids.material('Stone'), uids.material('Stone')],
      influence: 5,
    });
    // 2 Wood pairs = 1 extra, 2 Stone pairs = 1 extra = 2 total Legionary client actions
    expect(getClientCountForRole(s.players[0]!, 'Legionary')).toBe(2);
    // Non-Legionary roles unaffected
    expect(getClientCountForRole(s.players[0]!, 'Craftsman')).toBe(2);
  });

  it('does not count Brick client pairs as extra Legionary', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const fortressBuilding = mkBuilding(uids.card('fortress'), [uids.card('quarry')], true);
    let s = finalize(state, uids);
    // 2 Brick (Legionary) clients already count as 2 Legionary — no bonus from pairs
    s = updatePlayer(s, 0, {
      buildings: [fortressBuilding],
      clientele: [uids.material('Brick'), uids.material('Brick')],
      influence: 3,
    });
    expect(getClientCountForRole(s.players[0]!, 'Legionary')).toBe(2);
  });

  it('does not give bonus without completed Fortress', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      clientele: [uids.material('Wood'), uids.material('Wood')],
      influence: 3,
    });
    expect(getClientCountForRole(s.players[0]!, 'Legionary')).toBe(0);
  });
});

describe('Barracks power (take all matching materials)', () => {
  it('takes all matching materials from pool on LEGIONARY_REVEAL', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const barracksBuilding = mkBuilding(uids.card('barracks'), [uids.card('quarry')], true);
    const revealCard = uids.material('Wood');
    const poolWood1 = uids.material('Wood');
    const poolWood2 = uids.material('Wood');
    const poolBrick = uids.material('Brick');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [barracksBuilding],
      hand: [revealCard],
      influence: 1,
    });
    s = { ...s, pool: [poolWood1, poolWood2, poolBrick] };
    s = withActionPhase(s, 'Legionary');
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: revealCard.uid });
    // Should have taken BOTH Wood from pool, leaving only Brick
    expect(s.pool).toHaveLength(1);
    expect(getCardDef(s.pool[0]!).material).toBe('Brick');
    expect(s.players[0]!.stockpile).toHaveLength(2);
  });

  it('auto-takes all matching cards from neighbor hand (skips demand phase)', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const barracksBuilding = mkBuilding(uids.card('barracks'), [uids.card('quarry')], true);
    const revealCard = uids.material('Wood');
    const neighborWood1 = uids.material('Wood');
    const neighborWood2 = uids.material('Wood');
    const neighborBrick = uids.material('Brick');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [barracksBuilding],
      hand: [revealCard],
      influence: 1,
    });
    s = updatePlayer(s, 1, {
      hand: [neighborWood1, neighborWood2, neighborBrick],
    });
    s = { ...s, pool: [] };
    s = withActionPhase(s, 'Legionary');
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: revealCard.uid });
    // Should NOT enter demand phase — Barracks auto-collects
    expect(s.phase.type).not.toBe('legionary_demand');
    // Actor got both Wood cards
    expect(s.players[0]!.stockpile).toHaveLength(2);
    // Neighbor only has the Brick card left
    expect(s.players[1]!.hand).toHaveLength(1);
    expect(getCardDef(s.players[1]!.hand[0]!).material).toBe('Brick');
  });
});

describe('Bridge power (take from opponents stockpiles)', () => {
  it('takes matching material from all opponents stockpiles', () => {
    const { state, uids } = makeState(3, ['A', 'B', 'C'], 42);
    const bridgeBuilding = mkBuilding(uids.card('bridge'), [uids.card('quarry')], true);
    const revealCard = uids.material('Wood');
    const p1WoodStock = uids.material('Wood');
    const p2WoodStock = uids.material('Wood');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [bridgeBuilding],
      hand: [revealCard],
      influence: 1,
    });
    s = updatePlayer(s, 1, { stockpile: [p1WoodStock] });
    s = updatePlayer(s, 2, { stockpile: [p2WoodStock] });
    s = { ...s, pool: [] };
    s = withActionPhase(s, 'Legionary');
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: revealCard.uid, bridge: true });
    // Should advance past demand (Bridge doesn't use demand phase)
    expect(s.phase.type).not.toBe('legionary_demand');
    // Actor got 2 cards from stockpiles
    expect(s.players[0]!.stockpile).toHaveLength(2);
    expect(s.players[1]!.stockpile).toHaveLength(0);
    expect(s.players[2]!.stockpile).toHaveLength(0);
  });

  it('does not take from pool when using Bridge', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const bridgeBuilding = mkBuilding(uids.card('bridge'), [uids.card('quarry')], true);
    const revealCard = uids.material('Wood');
    const poolWood = uids.material('Wood');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [bridgeBuilding],
      hand: [revealCard],
      influence: 1,
    });
    s = { ...s, pool: [poolWood] };
    s = withActionPhase(s, 'Legionary');
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: revealCard.uid, bridge: true });
    // Pool should be unchanged
    expect(s.pool).toHaveLength(1);
  });

  it('Bridge + Barracks takes all matching from opponents stockpiles', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const bridgeBuilding = mkBuilding(uids.card('bridge'), [uids.card('quarry')], true);
    const barracksBuilding = mkBuilding(uids.card('barracks'), [uids.card('vat')], true);
    const revealCard = uids.material('Wood');
    const stock1 = uids.material('Wood');
    const stock2 = uids.material('Wood');
    const stockBrick = uids.material('Brick');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [bridgeBuilding, barracksBuilding],
      hand: [revealCard],
      influence: 2,
    });
    s = updatePlayer(s, 1, { stockpile: [stock1, stock2, stockBrick] });
    s = { ...s, pool: [] };
    s = withActionPhase(s, 'Legionary');
    s = gameReducer(s, { type: 'LEGIONARY_REVEAL', cardUid: revealCard.uid, bridge: true });
    // Should take ALL Wood from opponent's stockpile (2), leave Brick
    expect(s.players[0]!.stockpile).toHaveLength(2);
    expect(s.players[1]!.stockpile).toHaveLength(1);
    expect(getCardDef(s.players[1]!.stockpile[0]!).material).toBe('Brick');
  });
});

describe('Junkyard power (upon completion: hand to stockpile)', () => {
  it('triggers pending ability when Junkyard completes', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const junkyardBuilding = mkBuilding(uids.card('junkyard'), [], false);
    const rubbleCard = uids.material('Rubble');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [junkyardBuilding],
      hand: [rubbleCard, ...s.players[0]!.hand.slice(0, 3)],
    });
    s = withActionPhase(s, 'Craftsman');
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: rubbleCard.uid });
    // Should have pending junkyard ability
    expect(s.phase.type).toBe('action');
    const actionPhase = s.phase as { type: 'action'; pendingAbilities?: any[] };
    expect(actionPhase.pendingAbilities).toBeDefined();
    expect(actionPhase.pendingAbilities![0]!.kind).toBe('junkyard');
  });

  it('JUNKYARD_ACTIVATE moves hand to stockpile keeping Jacks', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const junkyardBuilding = mkBuilding(uids.card('junkyard'), [uids.card('quarry')], true);
    const jack1: Card = { uid: uids.next(), defId: 'jack' };
    const jack2: Card = { uid: uids.next(), defId: 'jack' };
    const woodCard = uids.material('Wood');
    const brickCard = uids.material('Brick');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [junkyardBuilding],
      hand: [jack1, jack2, woodCard, brickCard],
      influence: 1,
    });
    s = withActionPhase(s, 'Laborer');
    s = { ...s, phase: { ...s.phase as any, pendingAbilities: [{ kind: 'junkyard' }] } };
    s = gameReducer(s, { type: 'JUNKYARD_ACTIVATE', keepJacks: true });
    // Both Jacks kept in hand, other cards moved to stockpile
    expect(s.players[0]!.hand).toHaveLength(2);
    expect(s.players[0]!.hand.every(c => isJackCard(c))).toBe(true);
    expect(s.players[0]!.stockpile).toHaveLength(2);
  });

  it('JUNKYARD_ACTIVATE without keeping Jacks: non-jacks to stockpile, jacks to jack pile', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const junkyardBuilding = mkBuilding(uids.card('junkyard'), [uids.card('quarry')], true);
    const jack1: Card = { uid: uids.next(), defId: 'jack' };
    const jack2: Card = { uid: uids.next(), defId: 'jack' };
    const woodCard = uids.material('Wood');
    let s = finalize(state, uids);
    const jackPileBefore = s.jackPile;
    s = updatePlayer(s, 0, {
      buildings: [junkyardBuilding],
      hand: [jack1, jack2, woodCard],
      influence: 1,
    });
    s = withActionPhase(s, 'Laborer');
    s = { ...s, phase: { ...s.phase as any, pendingAbilities: [{ kind: 'junkyard' }] } };
    s = gameReducer(s, { type: 'JUNKYARD_ACTIVATE', keepJacks: false });
    expect(s.players[0]!.hand).toHaveLength(0);
    // Only non-jack cards go to stockpile
    expect(s.players[0]!.stockpile).toHaveLength(1);
    expect(getCardDef(s.players[0]!.stockpile[0]!).material).toBe('Wood');
    // Jacks returned to jack pile
    expect(s.jackPile).toBe(jackPileBefore + 2);
  });
});

describe('Quarry power (free Craftsman after building completion)', () => {
  it('quarry scenario: completing Foundry triggers quarry and lets you add Concrete to Road', () => {
    // Replicate the exact scenario setup
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const quarryBuilding = mkBuilding(uids.card('quarry'), [uids.card('barracks')], true);
    const brickBuilding = mkBuilding(uids.card('foundry'), [uids.material('Brick')], false);
    const concreteBuilding = mkBuilding(uids.card('road'), [], false);
    const brickCard = uids.material('Brick');
    const concreteCard1 = uids.material('Concrete');
    const concreteCard2 = uids.material('Concrete');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [quarryBuilding, brickBuilding, concreteBuilding],
      hand: [brickCard, concreteCard1, concreteCard2],
      influence: 1,
    });
    s = { ...s, sites: { ...s.sites, Rubble: s.sites.Rubble - 1, Brick: s.sites.Brick - 1, Concrete: s.sites.Concrete - 1 } };
    s = withActionPhase(s, 'Craftsman');

    // Step 1: Complete the Foundry with the Brick card
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 1, cardUid: brickCard.uid });
    expect(s.players[0]!.buildings[1]!.completed).toBe(true);

    // Quarry should trigger
    const phase = s.phase as any;
    expect(phase.pendingAbilities).toBeDefined();
    expect(phase.pendingAbilities[0].kind).toBe('quarry');

    // Available actions should include quarry craftsman options for Road (Concrete)
    const actions = getAvailableActions(s);
    expect(actions.pendingAbilityKind).toBe('quarry');
    expect(actions.quarryCraftsmanOptions.length).toBeGreaterThan(0);
    const roadOption = actions.quarryCraftsmanOptions.find(o => o.buildingIndex === 2);
    expect(roadOption).toBeDefined();

    // Step 2: Use Quarry to add Concrete to Road
    s = gameReducer(s, { type: 'QUARRY_CRAFTSMAN', buildingIndex: 2, cardUid: concreteCard1.uid });
    expect(s.players[0]!.buildings[2]!.materials).toHaveLength(1);
    expect(getCardDef(s.players[0]!.buildings[2]!.materials[0]!).material).toBe('Concrete');
  });

  it('triggers pending quarry ability after completing a building', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const quarryBuilding = mkBuilding(uids.card('quarry'), [uids.card('barracks')], true);
    const brickBuilding = mkBuilding(uids.card('foundry'), [uids.material('Brick')], false);
    const concreteBuilding = mkBuilding(uids.card('road'), [], false); // Incomplete target for Quarry
    const brickCard = uids.material('Brick');
    const concreteCard = uids.material('Concrete');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [quarryBuilding, brickBuilding, concreteBuilding],
      hand: [brickCard, concreteCard, ...s.players[0]!.hand.slice(0, 3)],
      influence: 1,
    });
    s = { ...s, sites: { ...s.sites, Brick: s.sites.Brick - 1, Concrete: s.sites.Concrete - 1 } };
    s = withActionPhase(s, 'Craftsman');
    // Add last material to Brick building — completes it, triggers Quarry (concreteBuilding is still incomplete)
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 1, cardUid: brickCard.uid });
    expect(s.players[0]!.buildings[1]!.completed).toBe(true);
    const actionPhase = s.phase as { type: 'action'; pendingAbilities?: any[] };
    expect(actionPhase.pendingAbilities).toBeDefined();
    expect(actionPhase.pendingAbilities![0]!.kind).toBe('quarry');
  });

  it('QUARRY_CRAFTSMAN adds material from hand to building', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const quarryBuilding = mkBuilding(uids.card('quarry'), [uids.card('barracks')], true);
    const concreteBuilding = mkBuilding(uids.card('road'), [], false);
    const concreteCard = uids.material('Concrete');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [quarryBuilding, concreteBuilding],
      hand: [concreteCard],
      influence: 1,
    });
    s = withActionPhase(s, 'Craftsman');
    s = { ...s, phase: { ...s.phase as any, pendingAbilities: [{ kind: 'quarry' }] } };
    const actions = getAvailableActions(s);
    expect(actions.quarryCraftsmanOptions.length).toBeGreaterThan(0);
    s = gameReducer(s, { type: 'QUARRY_CRAFTSMAN', buildingIndex: 1, cardUid: concreteCard.uid });
    expect(s.players[0]!.buildings[1]!.materials).toHaveLength(1);
    expect(s.players[0]!.hand).toHaveLength(0);
  });

  it('Quarry does not trigger when no incomplete buildings exist', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const quarryBuilding = mkBuilding(uids.card('quarry'), [uids.card('barracks')], true);
    const woodBuilding = mkBuilding(uids.card('crane'), [], false);
    const woodCard = uids.material('Wood');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [quarryBuilding, woodBuilding],
      hand: [woodCard],
      influence: 1,
    });
    s = withActionPhase(s, 'Craftsman');
    // Complete the only other building — afterward no incomplete buildings remain
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 1, cardUid: woodCard.uid });
    // Quarry should NOT trigger (no incomplete buildings to Craftsman on)
    const actionPhase = s.phase as { type: 'action'; pendingAbilities?: any[] };
    expect(actionPhase.pendingAbilities ?? []).toHaveLength(0);
  });
});

describe('Encampment power (start building of same type after completion)', () => {
  it('triggers pending encampment ability after completing a building', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const encampmentBuilding = mkBuilding(uids.card('encampment'), [uids.card('barracks')], true);
    const woodBuilding = mkBuilding(uids.card('crane'), [], false);
    const woodCard = uids.material('Wood');
    const woodCard2 = uids.card('dock');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [encampmentBuilding, woodBuilding],
      hand: [woodCard, woodCard2],
      influence: 1,
    });
    s = withActionPhase(s, 'Craftsman');
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 1, cardUid: woodCard.uid });
    expect(s.players[0]!.buildings[1]!.completed).toBe(true);
    const actionPhase = s.phase as { type: 'action'; pendingAbilities?: any[] };
    expect(actionPhase.pendingAbilities).toBeDefined();
    expect(actionPhase.pendingAbilities![0]!.kind).toBe('encampment');
  });

  it('ENCAMPMENT_START creates a new building of the same material', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const encampmentBuilding = mkBuilding(uids.card('encampment'), [uids.card('barracks')], true);
    const dockCard = uids.card('dock');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [encampmentBuilding],
      hand: [dockCard],
      influence: 1,
    });
    s = withActionPhase(s, 'Craftsman');
    s = { ...s, phase: { ...s.phase as any, pendingAbilities: [{ kind: 'encampment', material: 'Wood' }] } };
    const actions = getAvailableActions(s);
    expect(actions.encampmentOptions.length).toBeGreaterThan(0);
    const sitesBefore = s.sites.Wood;
    s = gameReducer(s, { type: 'ENCAMPMENT_START', cardUid: dockCard.uid });
    // New building created but not yet complete (cost 1 needs 1 material via Craftsman)
    expect(s.players[0]!.buildings).toHaveLength(2);
    expect(s.players[0]!.buildings[1]!.completed).toBe(false);
    expect(getCardDef(s.players[0]!.buildings[1]!.foundationCard).material).toBe('Wood');
    expect(s.sites.Wood).toBe(sitesBefore - 1);
    // Card should be removed from hand
    expect(s.players[0]!.hand).toHaveLength(0);
  });

  it('Encampment does not trigger when no site available for the material', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const encampmentBuilding = mkBuilding(uids.card('encampment'), [uids.card('barracks')], true);
    const woodBuilding = mkBuilding(uids.card('crane'), [], false);
    const woodCard = uids.material('Wood');
    const woodCard2 = uids.card('dock');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [encampmentBuilding, woodBuilding],
      hand: [woodCard, woodCard2],
      influence: 1,
    });
    // Use up all Wood sites
    s = { ...s, sites: { ...s.sites, Wood: 0 }, outOfTownSites: { ...s.outOfTownSites, Wood: 0 } };
    s = withActionPhase(s, 'Craftsman');
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 1, cardUid: woodCard.uid });
    const actionPhase = s.phase as { type: 'action'; pendingAbilities?: any[] };
    // No site available, so Encampment should not trigger
    expect((actionPhase.pendingAbilities ?? []).filter(a => a.kind === 'encampment')).toHaveLength(0);
  });

  it('Encampment can start a building on an out-of-town site when normal sites are depleted', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const encampmentBuilding = mkBuilding(uids.card('encampment'), [uids.card('barracks')], true);
    const woodBuilding = mkBuilding(uids.card('crane'), [], false);
    const woodCard = uids.material('Wood');
    const woodCard2 = uids.card('dock');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [encampmentBuilding, woodBuilding],
      hand: [woodCard, woodCard2],
      influence: 1,
    });
    // Deplete normal Wood sites but leave out-of-town available
    s = { ...s, sites: { ...s.sites, Wood: 0 } };
    expect(s.outOfTownSites.Wood).toBeGreaterThan(0);
    s = withActionPhase(s, 'Craftsman');
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 1, cardUid: woodCard.uid });
    // Building should complete
    expect(s.players[0]!.buildings[1]!.completed).toBe(true);
    // Encampment should trigger since out-of-town sites are available
    const actionPhase = s.phase as { type: 'action'; pendingAbilities?: any[] };
    expect(actionPhase.pendingAbilities).toBeDefined();
    expect(actionPhase.pendingAbilities!.some((a: any) => a.kind === 'encampment')).toBe(true);

    // getAvailableActions should show encampment options marked as out-of-town
    const actions = getAvailableActions(s);
    expect(actions.encampmentOptions.length).toBeGreaterThan(0);
    expect(actions.encampmentOptions[0]!.outOfTown).toBe(true);

    // Perform the ENCAMPMENT_START — should use an out-of-town site
    const ootBefore = s.outOfTownSites.Wood;
    s = gameReducer(s, { type: 'ENCAMPMENT_START', cardUid: woodCard2.uid, outOfTown: true });
    expect(s.players[0]!.buildings).toHaveLength(3);
    const newBuilding = s.players[0]!.buildings[2]!;
    expect(newBuilding.outOfTown).toBe(true);
    expect(getCardDef(newBuilding.foundationCard).material).toBe('Wood');
    expect(s.outOfTownSites.Wood).toBe(ootBefore - 1);
  });
});

describe('Scriptorium power (Craftsman/Laborer use pool cards)', () => {
  it('Craftsman: add material from pool to building with Scriptorium', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const scripBuilding = mkBuilding(uids.card('scriptorium'), [uids.card('quarry')], true);
    const brickBuilding = mkBuilding(uids.card('foundry'), [], false);
    const poolBrick = uids.material('Brick');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [scripBuilding, brickBuilding],
      influence: 1,
    });
    s = { ...s, pool: [poolBrick] };
    s = withActionPhase(s, 'Craftsman');
    const actions = getAvailableActions(s);
    expect(actions.craftsmanOptions.some(o => o.fromPool && o.buildingIndex === 1)).toBe(true);
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 1, cardUid: 0, fromPool: true });
    expect(s.players[0]!.buildings[1]!.materials).toHaveLength(1);
    expect(s.pool).toHaveLength(0);
  });

  it('Laborer: add material from pool to building with Scriptorium', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const scripBuilding = mkBuilding(uids.card('scriptorium'), [uids.card('quarry')], true);
    const brickBuilding = mkBuilding(uids.card('foundry'), [], false);
    const poolBrick = uids.material('Brick');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [scripBuilding, brickBuilding],
      influence: 1,
    });
    s = { ...s, pool: [poolBrick] };
    s = withActionPhase(s, 'Laborer');
    const actions = getAvailableActions(s);
    expect(actions.laborerBuildingOptions.some(o => o.fromPool && o.buildingIndex === 1)).toBe(true);
    s = gameReducer(s, { type: 'LABORER_STOCKPILE_TO_BUILDING', material: 'Brick', buildingIndex: 1, fromPool: true });
    expect(s.players[0]!.buildings[1]!.materials).toHaveLength(1);
    expect(s.pool).toHaveLength(0);
  });

  it('rejects fromPool without completed Scriptorium', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const brickBuilding = mkBuilding(uids.card('foundry'), [], false);
    const poolBrick = uids.material('Brick');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, { buildings: [brickBuilding] });
    s = { ...s, pool: [poolBrick] };
    s = withActionPhase(s, 'Craftsman');
    const before = s;
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 0, cardUid: 0, fromPool: true });
    // Should be unchanged (rejected)
    expect(s).toBe(before);
  });
});

describe('Pending abilities: skip and chaining', () => {
  it('SKIP_ACTION skips current pending ability and moves to next', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    let s = finalize(state, uids);
    s = withActionPhase(s, 'Craftsman');
    s = {
      ...s,
      phase: {
        ...s.phase as any,
        pendingAbilities: [
          { kind: 'quarry' },
          { kind: 'encampment', material: 'Rubble' as any },
        ],
      },
    };
    // Skip quarry
    s = gameReducer(s, { type: 'SKIP_ACTION' });
    const p1 = s.phase as { type: 'action'; pendingAbilities?: any[] };
    expect(p1.pendingAbilities).toHaveLength(1);
    expect(p1.pendingAbilities![0]!.kind).toBe('encampment');
    // Skip encampment
    s = gameReducer(s, { type: 'SKIP_ACTION' });
    // Should have advanced past pending
    expect((s.phase as any).pendingAbilities).toBeUndefined();
  });

  it('completing a building triggers both Quarry and Encampment', () => {
    const { state, uids } = makeState(2, ['A', 'B'], 42);
    const quarryBuilding = mkBuilding(uids.card('quarry'), [uids.card('vat')], true);
    const encampmentBuilding = mkBuilding(uids.card('encampment'), [uids.card('barracks')], true);
    // A Wood building needing 1 more material to complete
    const woodBuilding = mkBuilding(uids.card('crane'), [], false);
    const woodCard = uids.material('Wood');
    const woodCard2 = uids.card('dock'); // For encampment to start
    const concreteBuilding = mkBuilding(uids.card('road'), [], false); // Target for quarry
    const concreteCard = uids.material('Concrete');
    let s = finalize(state, uids);
    s = updatePlayer(s, 0, {
      buildings: [quarryBuilding, encampmentBuilding, woodBuilding, concreteBuilding],
      hand: [woodCard, woodCard2, concreteCard],
      influence: 2,
    });
    s = { ...s, sites: { ...s.sites, Wood: s.sites.Wood - 1, Concrete: s.sites.Concrete - 1 } };
    s = withActionPhase(s, 'Craftsman');
    // Complete the Wood building — triggers both Quarry (for concreteBuilding) and Encampment (start another Wood)
    s = gameReducer(s, { type: 'CRAFTSMAN_ADD', buildingIndex: 2, cardUid: woodCard.uid });
    expect(s.players[0]!.buildings[2]!.completed).toBe(true);
    const actionPhase = s.phase as { type: 'action'; pendingAbilities?: any[] };
    expect(actionPhase.pendingAbilities).toBeDefined();
    // Should have both quarry and encampment
    const kinds = actionPhase.pendingAbilities!.map(a => a.kind);
    expect(kinds).toContain('quarry');
    expect(kinds).toContain('encampment');
  });
});
