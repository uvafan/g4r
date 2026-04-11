import { GameState, Card, Building, MaterialType, ActiveRole, Player } from './types';
import { createInitialState } from './engine';
import { CARD_DEFS, genericDefIdForMaterial } from './cards';

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
