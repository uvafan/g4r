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
  /** Atrium cards go face-down into vault — material unknown until game end */
  faceDown?: boolean;
}

export interface Building {
  foundationCard: Card;
  materials: Card[];
  completed: boolean;
  outOfTown?: boolean;
  /** Stairway: this building's function is shared with all players */
  shared?: boolean;
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

export type PendingAbility =
  | { kind: 'quarry' }
  | { kind: 'encampment'; material: MaterialType }
  | { kind: 'junkyard' }
  | { kind: 'foundry' }
  | { kind: 'school'; remainingThinks: number }
  | { kind: 'amphitheatre'; remainingActions: number }
  | { kind: 'aqueduct'; remainingActions: number }
  | { kind: 'stage' }
  | { kind: 'bar'; revealedCard: Card | null }
  | { kind: 'bath'; role: ActiveRole }
  | { kind: 'academy' }
  | { kind: 'sanctuary' }
  | { kind: 'prison'; maxCount: number }
  | { kind: 'basilica' }
  | { kind: 'fountain'; flippedCard: Card }
  | { kind: 'circus_maximus_completion'; clientMaterials: MaterialType[] };

export type Phase =
  | { type: 'setup' }
  | { type: 'lead'; leaderId: number }
  | { type: 'follow'; leaderId: number; ledRole: ActiveRole; currentFollowerIndex: number; followers: number[]; actors: number[]; leaderCardCount?: number }
  | { type: 'thinkRound'; leaderId: number; followers: number[]; currentFollowerIndex: number }
  | { type: 'action'; ledRole: ActiveRole; actors: number[]; currentActorIndex: number;
      pendingAbilities?: PendingAbility[];
      /** Track which players performed Craftsman actions (for Academy) */
      craftsmanPerformed?: number[];
      /** Track which players performed Merchant actions (for Basilica) */
      merchantPerformed?: number[];
    }
  | { type: 'legionary_demand'; revealedMaterial: MaterialType; demandees: number[]; currentDemandeeIndex: number; actionActors: number[]; actionCurrentActorIndex: number; actionPendingAbilities?: PendingAbility[]; actionCraftsmanPerformed?: number[] }
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
  /** Cards drawn via Think that are deferred until end of round */
  pendingThinkCards?: Record<number, Card[]>;
  /** What each player declared this round (think/lead/follow) */
  playerRoundStatus?: Record<number, PlayerRoundStatus>;
  /** Keep: override leader for N turns */
  keepTurnsRemaining?: number;
  keepLeaderId?: number;
  /** Sewer: track cards each player used to lead/follow (non-jacks) */
  roundLeadFollowCards?: Record<number, Card[]>;
  /** Senate: multi-step refresh draws remaining */
  senateDrawsRemaining?: number;
  senateDrawPlayerId?: number;
  senateDeferred?: boolean;
}

export type ThinkOption =
  | { kind: 'refresh' }
  | { kind: 'draw1' }
  | { kind: 'generic'; material: MaterialType }
  | { kind: 'jack' };

export interface PlayerRoundStatus {
  declaration: 'think' | 'lead' | 'follow';
  role?: ActiveRole;
  thinkOption?: ThinkOption;
}

export type GameAction =
  | { type: 'START_GAME'; playerCount: number; playerNames: string[] }
  | { type: 'LEAD_ROLE'; role: ActiveRole; cardUid: number; extraCardUids?: number[]; palace?: boolean }
  | { type: 'THINK'; option: ThinkOption; vomitorium?: { keepJacks: boolean }; latrineCardUid?: number }
  | { type: 'FOLLOW_ROLE'; cardUid: number; extraCardUids?: number[]; palace?: boolean }
  | { type: 'ARCHITECT_START'; cardUid: number; outOfTown?: boolean; craneCardUid?: number; craneOutOfTown?: boolean }
  | { type: 'CRAFTSMAN_ADD'; buildingIndex: number; cardUid: number; fromPool?: boolean }
  | { type: 'LABORER_POOL_TO_STOCKPILE'; materials: MaterialType[] }
  | { type: 'LABORER_HAND_TO_STOCKPILE'; cardUid: number }
  | { type: 'LABORER_STOCKPILE_TO_BUILDING'; material: MaterialType; buildingIndex: number; fromPool?: boolean }
  | { type: 'MERCHANT_STOCKPILE_TO_VAULT'; material: MaterialType; fromPool?: boolean }
  | { type: 'LEGIONARY_REVEAL'; cardUid: number; bridge?: boolean }
  | { type: 'LEGIONARY_GIVE'; cardUid: number }
  | { type: 'PATRON_HIRE'; material: MaterialType; circusMaximus?: boolean }
  | { type: 'QUARRY_CRAFTSMAN'; buildingIndex: number; cardUid: number; fromPool?: boolean }
  | { type: 'ENCAMPMENT_START'; cardUid: number; outOfTown?: boolean }
  | { type: 'JUNKYARD_ACTIVATE'; keepJacks: boolean }
  | { type: 'FOUNDRY_ACTIVATE'; takePool: boolean; takeHand: boolean }
  | { type: 'ABILITY_THINK'; option: ThinkOption }
  | { type: 'ABILITY_CRAFTSMAN'; buildingIndex: number; cardUid: number; fromPool?: boolean }
  | { type: 'ABILITY_PATRON'; material: MaterialType; circusMaximus?: boolean }
  | { type: 'BAR_FLIP' }
  | { type: 'BAR_CHOOSE'; toClientele: boolean; circusMaximus?: boolean }
  | { type: 'CIRCUS_MAXIMUS_CHOOSE'; materials: MaterialType[] }
  | { type: 'ATRIUM_MERCHANT' }
  | { type: 'SANCTUARY_STEAL'; targetPlayerId: number; material: MaterialType }
  | { type: 'PRISON_MOVE'; cardUids: number[] }
  | { type: 'BASILICA_VAULT'; cardUid: number }
  | { type: 'FOUNTAIN_FLIP' }
  | { type: 'FOUNTAIN_CHOOSE'; buildingIndex?: number }
  | { type: 'STAIRWAY_ADD'; targetPlayerId: number; buildingIndex: number; cardUid: number; fromPool?: boolean; fromStockpile?: boolean }
  | { type: 'SENATE_DRAW'; option: ThinkOption }
  | { type: 'SKIP_ACTION' };
