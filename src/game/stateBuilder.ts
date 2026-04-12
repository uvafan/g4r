import { GameState, Card, Building, MaterialType, ActiveRole, Player, Sites } from './types';
import { createInitialState } from './engine';
import { CARD_DEFS, genericDefIdForMaterial, getCardDef } from './cards';

/** Seeded RNG for deterministic game states */
export function seededRng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Find the first card def ID for a given material type */
export function findDefId(material: MaterialType): string {
  return CARD_DEFS.find(d => d.material === material)!.id;
}

/** UID allocator — tracks next available UID and creates cards */
export class Uids {
  private _next: number;
  constructor(startUid: number) { this._next = startUid; }
  next(): number { return this._next++; }
  get value(): number { return this._next; }
  card(defId: string): Card { return { uid: this.next(), defId }; }
  material(mat: MaterialType): Card { return this.card(findDefId(mat)); }
  generic(mat: MaterialType): Card { return this.card(genericDefIdForMaterial(mat)); }
}

/** Create initial state and return alongside a UID allocator */
export function makeState(
  playerCount: number,
  names: string[],
  seed: number = 42,
): { state: GameState; uids: Uids } {
  const state = createInitialState(playerCount, names, seededRng(seed));
  return { state, uids: new Uids(state.nextUid) };
}

/** Set the phase to an action phase */
export function withActionPhase(
  state: GameState,
  role: ActiveRole,
  actors: number[] = [0],
  currentActorIndex: number = 0,
): GameState {
  return { ...state, phase: { type: 'action', ledRole: role, actors, currentActorIndex } };
}

/** Update a single player's fields */
export function updatePlayer(
  state: GameState,
  playerId: number,
  updates: Partial<Player>,
): GameState {
  return {
    ...state,
    players: state.players.map((p, i) =>
      i === playerId ? { ...p, ...updates } : p
    ),
  };
}

/** Create a building */
export function mkBuilding(foundation: Card, materials: Card[], completed: boolean): Building {
  return { foundationCard: foundation, materials, completed };
}

/** Finalize state after using a Uids allocator (sets nextUid) */
export function finalize(state: GameState, uids: Uids): GameState {
  return { ...state, nextUid: uids.value };
}

// --- Scenario building utilities ---

/** Card pool that draws from the remaining deck — ensures valid card counts (max 3 per defId) */
export class CardPool {
  private available: Card[];

  constructor(deck: Card[]) {
    this.available = [...deck];
  }

  /** Pull a specific card by defId */
  card(defId: string): Card {
    const idx = this.available.findIndex(c => c.defId === defId);
    if (idx === -1) throw new Error(`No '${defId}' in card pool (${this.available.length} cards left)`);
    return this.available.splice(idx, 1)[0]!;
  }

  /** Pull any card of the given material type */
  material(mat: MaterialType): Card {
    const idx = this.available.findIndex(c => getCardDef(c).material === mat);
    if (idx === -1) throw new Error(`No ${mat} card in card pool (${this.available.length} cards left)`);
    return this.available.splice(idx, 1)[0]!;
  }

  /** Return cards back to the pool */
  returnCards(cards: Card[]): void {
    this.available.push(...cards);
  }

  /** Get remaining cards (for the deck) */
  get remaining(): Card[] {
    return [...this.available];
  }
}

/** Create a scenario base state + card pool from the remaining deck */
export function makeScenarioState(
  playerCount: number,
  names: string[],
  seed: number = 42,
): { state: GameState; pool: CardPool } {
  const state = createInitialState(playerCount, names, seededRng(seed));
  const pool = new CardPool(state.deck);
  return { state: { ...state, deck: [] }, pool };
}

/** Compute influence from completed buildings (sum of costs + Villa bonus) */
export function computeInfluence(buildings: Building[]): number {
  return buildings.filter(b => b.completed)
    .reduce((sum, b) => {
      const def = getCardDef(b.foundationCard);
      return sum + def.cost + (def.id === 'villa' ? 3 : 0);
    }, 0);
}

/** Compute remaining sites based on buildings in play */
export function computeSites(state: GameState): Sites {
  const baseSites = state.playerCount + 1;
  const sites: Sites = {
    Rubble: baseSites, Wood: baseSites, Brick: baseSites,
    Concrete: baseSites, Stone: baseSites, Marble: baseSites,
  };
  for (const player of state.players) {
    for (const building of player.buildings) {
      if (!building.outOfTown) {
        sites[getCardDef(building.foundationCard).material]--;
      }
    }
  }
  return sites;
}

type PlayerOverrides = {
  buildings?: Building[];
  clientele?: Card[];
  stockpile?: Card[];
  vault?: Card[];
  hand?: Card[];
};

/**
 * Build a scenario state with auto-computed influence, sites, and validation.
 * When overriding a player's hand, return old hand cards to pool first via pool.returnCards().
 */
export function buildScenario(
  state: GameState,
  pool: CardPool,
  players: PlayerOverrides[],
  gamePool?: Card[],
  opts?: { deckSize?: number },
): GameState {
  const newPlayers = state.players.map((p, i) => {
    const o = players[i];
    if (!o) return p;
    const buildings = o.buildings ?? p.buildings;
    return {
      ...p,
      buildings,
      clientele: o.clientele ?? p.clientele,
      stockpile: o.stockpile ?? p.stockpile,
      vault: o.vault ?? p.vault,
      hand: o.hand ?? p.hand,
      influence: computeInfluence(buildings),
    };
  });

  const tempState = { ...state, players: newPlayers };
  const sites = computeSites(tempState);

  const remaining = pool.remaining;
  const deck = opts?.deckSize !== undefined
    ? remaining.slice(0, opts.deckSize)
    : remaining;

  const result: GameState = {
    ...state,
    players: newPlayers,
    sites,
    pool: gamePool ?? state.pool,
    deck,
  };

  validateScenarioState(result);
  return result;
}

const ALL_MATS: MaterialType[] = ['Rubble', 'Wood', 'Brick', 'Concrete', 'Stone', 'Marble'];

/** Validate that a game state could actually occur in a game. Throws on invalid state. */
export function validateScenarioState(state: GameState): void {
  const errors: string[] = [];

  for (const player of state.players) {
    // Vault ≤ influence
    if (player.vault.length > player.influence) {
      errors.push(`${player.name}: vault (${player.vault.length}) > influence (${player.influence})`);
    }
    // Clientele ≤ influence
    if (player.clientele.length > player.influence) {
      errors.push(`${player.name}: clientele (${player.clientele.length}) > influence (${player.influence})`);
    }
    // Influence = sum of completed building costs
    const expected = computeInfluence(player.buildings);
    if (player.influence !== expected) {
      errors.push(`${player.name}: influence ${player.influence} ≠ building sum ${expected}`);
    }
    // Completed buildings have enough materials
    for (const b of player.buildings) {
      const def = getCardDef(b.foundationCard);
      if (b.completed && b.materials.length < def.cost) {
        errors.push(`${player.name}: ${def.name} completed with ${b.materials.length}/${def.cost} materials`);
      }
      // Materials must match building's material type (Tower: Rubble in any, Road: any in Stone)
      const hasTower = player.buildings.some(b2 => b2.completed && getCardDef(b2.foundationCard).id === 'tower');
      const hasRoad = player.buildings.some(b2 => b2.completed && getCardDef(b2.foundationCard).id === 'road');
      for (const m of b.materials) {
        const matType = getCardDef(m).material;
        if (matType !== def.material) {
          if (hasTower && matType === 'Rubble') continue;
          if (hasRoad && def.material === 'Stone') continue;
          errors.push(`${player.name}: ${def.name} has wrong-material card ${getCardDef(m).name} (${matType} ≠ ${def.material})`);
        }
      }
    }
  }

  // Sites match buildings
  const baseSites = state.playerCount + 1;
  for (const mat of ALL_MATS) {
    let used = 0;
    for (const p of state.players) {
      for (const b of p.buildings) {
        if (!b.outOfTown && getCardDef(b.foundationCard).material === mat) used++;
      }
    }
    const exp = baseSites - used;
    if (state.sites[mat] !== exp) {
      errors.push(`Sites ${mat}: ${state.sites[mat]} ≠ expected ${exp} (${used} buildings)`);
    }
  }

  // Card copy counts (max 3 per defId in 2-4p)
  const counts: Record<string, number> = {};
  const count = (c: Card) => { counts[c.defId] = (counts[c.defId] || 0) + 1; };
  for (const c of state.deck) count(c);
  for (const c of state.pool) count(c);
  for (const c of state.pendingPool) count(c);
  if (state.pendingThinkCards) {
    for (const cards of Object.values(state.pendingThinkCards)) {
      for (const c of cards) count(c);
    }
  }
  for (const p of state.players) {
    for (const c of p.hand) count(c);
    for (const c of p.stockpile) count(c);
    for (const c of p.vault) count(c);
    for (const c of p.clientele) count(c);
    for (const b of p.buildings) {
      count(b.foundationCard);
      for (const c of b.materials) count(c);
    }
  }
  const max = state.playerCount <= 4 ? 3 : 4;
  for (const [defId, n] of Object.entries(counts)) {
    if (defId.startsWith('generic_') || defId === 'jack') continue;
    if (n > max) {
      errors.push(`Card '${defId}' has ${n} copies (max ${max})`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid scenario state:\n  - ${errors.join('\n  - ')}`);
  }
}
