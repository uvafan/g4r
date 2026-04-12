export type MaterialType = 'Rubble' | 'Wood' | 'Brick' | 'Concrete' | 'Stone' | 'Marble';

export type Role = 'Patron' | 'Laborer' | 'Craftsman' | 'Architect' | 'Legionary' | 'Merchant';

export type ActiveRole = 'Architect' | 'Craftsman' | 'Laborer' | 'Legionary' | 'Merchant' | 'Patron';

export interface CardDef {
  id: string;
  name: string;
  material: MaterialType;
  cost: number;
  role: Role;
  power: string;
}

export interface Card {
  uid: number;
  defId: string;
}

export interface Building {
  foundationCard: Card;
  materials: Card[];
  completed: boolean;
  outOfTown?: boolean;
}

export interface Player {
  id: number;
  name: string;
  hand: Card[];
  stockpile: Card[];
  vault: Card[];
  buildings: Building[];
  clientele: Card[];
  influence: number;
}

export type Phase =
  | { type: 'setup' }
  | { type: 'lead'; leaderId: number }
  | { type: 'follow'; leaderId: number; ledRole: ActiveRole; currentFollowerIndex: number; followers: number[]; actors: number[] }
  | { type: 'thinkRound'; leaderId: number; followers: number[]; currentFollowerIndex: number }
  | { type: 'action'; ledRole: ActiveRole; actors: number[]; currentActorIndex: number;
      pendingAbilities?: Array<
        | { kind: 'quarry' }
        | { kind: 'encampment'; material: MaterialType }
        | { kind: 'junkyard' }
      > }
  | { type: 'legionary_demand'; revealedMaterial: MaterialType; demandees: number[]; currentDemandeeIndex: number; actionActors: number[]; actionCurrentActorIndex: number }
  | { type: 'gameOver' };

export interface Sites {
  Rubble: number;
  Wood: number;
  Brick: number;
  Concrete: number;
  Stone: number;
  Marble: number;
}

export interface GenericSupply {
  Rubble: number;
  Wood: number;
  Brick: number;
  Concrete: number;
  Stone: number;
  Marble: number;
}

export interface GameState {
  players: Player[];
  deck: Card[];
  pool: Card[];
  pendingPool: Card[];
  sites: Sites;
  outOfTownSites: Sites;
  genericSupply: GenericSupply;
  jackPile: number;
  nextUid: number;
  phase: Phase;
  handLimit: number;
  playerCount: number;
  leadPlayerIdx: number;
  gameEndTriggered?: boolean;
  /** Per-round legionary demand counts: key "attackerId-targetId" → count */
  legionaryDemandCounts?: Record<string, number>;
}

export type ThinkOption =
  | { kind: 'refresh' }
  | { kind: 'draw1' }
  | { kind: 'generic'; material: MaterialType }
  | { kind: 'jack' };

export type GameAction =
  | { type: 'START_GAME'; playerCount: number; playerNames: string[] }
  | { type: 'LEAD_ROLE'; role: ActiveRole; cardUid: number; extraCardUids?: number[] }
  | { type: 'THINK'; option: ThinkOption }
  | { type: 'FOLLOW_ROLE'; cardUid: number; extraCardUids?: number[] }
  | { type: 'ARCHITECT_START'; cardUid: number; outOfTown?: boolean; craneCardUid?: number; craneOutOfTown?: boolean }
  | { type: 'CRAFTSMAN_ADD'; buildingIndex: number; cardUid: number; fromPool?: boolean }
  | { type: 'LABORER_POOL_TO_STOCKPILE'; materials: MaterialType[] }
  | { type: 'LABORER_HAND_TO_STOCKPILE'; cardUid: number }
  | { type: 'LABORER_STOCKPILE_TO_BUILDING'; material: MaterialType; buildingIndex: number; fromPool?: boolean }
  | { type: 'MERCHANT_STOCKPILE_TO_VAULT'; material: MaterialType; fromPool?: boolean }
  | { type: 'LEGIONARY_REVEAL'; cardUid: number; bridge?: boolean }
  | { type: 'LEGIONARY_GIVE'; cardUid: number }
  | { type: 'PATRON_HIRE'; material: MaterialType }
  | { type: 'QUARRY_CRAFTSMAN'; buildingIndex: number; cardUid: number; fromPool?: boolean }
  | { type: 'ENCAMPMENT_START'; cardUid: number; outOfTown?: boolean }
  | { type: 'JUNKYARD_ACTIVATE'; keepJacks: boolean }
  | { type: 'SKIP_ACTION' };
