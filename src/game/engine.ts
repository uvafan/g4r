import {
  GameState, GameAction, Player, Phase, Sites, Building,
  Card, MaterialType, ActiveRole, GenericSupply, ThinkOption,
} from './types';
import { createDeck, getCardDef, RNG, ROLE_TO_MATERIAL, genericDefIdForMaterial, isJackCard } from './cards';

const DEFAULT_HAND_LIMIT = 5;
const SITES_PER_PLAYER = 1;
const GENERIC_SUPPLY_PER_TYPE = 9;

export function createInitialState(
  playerCount: number,
  playerNames: string[],
  rng?: RNG,
): GameState {
  const deck = createDeck(playerCount, rng);

  const players: Player[] = [];
  let deckIdx = 0;

  for (let i = 0; i < playerCount; i++) {
    const hand = deck.slice(deckIdx, deckIdx + DEFAULT_HAND_LIMIT);
    deckIdx += DEFAULT_HAND_LIMIT;
    players.push({
      id: i,
      name: playerNames[i] ?? `Player ${i + 1}`,
      hand,
      stockpile: [],
      vault: [],
      buildings: [],
      clientele: [],
      influence: 0,
    });
  }

  const sitesPerType = playerCount * SITES_PER_PLAYER;
  const sites: Sites = {
    Rubble: sitesPerType,
    Wood: sitesPerType,
    Brick: sitesPerType,
    Concrete: sitesPerType,
    Stone: sitesPerType,
    Marble: sitesPerType,
  };

  const genericSupply: GenericSupply = {
    Rubble: GENERIC_SUPPLY_PER_TYPE,
    Wood: GENERIC_SUPPLY_PER_TYPE,
    Brick: GENERIC_SUPPLY_PER_TYPE,
    Concrete: GENERIC_SUPPLY_PER_TYPE,
    Stone: GENERIC_SUPPLY_PER_TYPE,
    Marble: GENERIC_SUPPLY_PER_TYPE,
  };

  // nextUid starts after all deck cards
  const nextUid = deck.length;

  return {
    players,
    deck: deck.slice(deckIdx),
    pool: [],
    pendingPool: [],
    sites,
    genericSupply,
    jackPile: playerCount + 1,
    nextUid,
    phase: { type: 'lead', leaderId: 0 },
    handLimit: DEFAULT_HAND_LIMIT,
    playerCount,
    leadPlayerIdx: 0,
  };
}

function drawCards(state: GameState, playerId: number): GameState {
  const player = state.players[playerId]!;
  const count = player.hand.length < state.handLimit
    ? state.handLimit - player.hand.length
    : 1;
  const actualCount = Math.min(count, state.deck.length);
  const drawn = state.deck.slice(0, actualCount);
  const remaining = state.deck.slice(actualCount);

  return {
    ...state,
    deck: remaining,
    players: state.players.map(p =>
      p.id === playerId
        ? { ...p, hand: [...p.hand, ...drawn] }
        : p
    ),
  };
}

function applyThinkOption(state: GameState, playerId: number, option: ThinkOption): GameState {
  switch (option.kind) {
    case 'refresh': {
      // Draw from deck up to hand limit (minimum 1 if already at/above limit)
      return drawCards(state, playerId);
    }
    case 'draw1': {
      // Draw exactly 1 from deck
      if (state.deck.length === 0) return state;
      const drawn = state.deck[0]!;
      return {
        ...state,
        deck: state.deck.slice(1),
        players: state.players.map(p =>
          p.id === playerId ? { ...p, hand: [...p.hand, drawn] } : p
        ),
      };
    }
    case 'generic': {
      // Draw 1 from generic supply of chosen material
      const { material } = option;
      if (state.genericSupply[material] <= 0) return state;
      const newCard: Card = {
        uid: state.nextUid,
        defId: genericDefIdForMaterial(material),
      };
      return {
        ...state,
        nextUid: state.nextUid + 1,
        genericSupply: {
          ...state.genericSupply,
          [material]: state.genericSupply[material] - 1,
        },
        players: state.players.map(p =>
          p.id === playerId ? { ...p, hand: [...p.hand, newCard] } : p
        ),
      };
    }
    case 'jack': {
      if (state.jackPile <= 0) return state;
      const newCard: Card = {
        uid: state.nextUid,
        defId: 'jack',
      };
      return {
        ...state,
        nextUid: state.nextUid + 1,
        jackPile: state.jackPile - 1,
        players: state.players.map(p =>
          p.id === playerId ? { ...p, hand: [...p.hand, newCard] } : p
        ),
      };
    }
  }
}

function removeCardFromHand(player: Player, cardUid: number): { card: Card; newHand: Card[] } {
  const idx = player.hand.findIndex(c => c.uid === cardUid);
  if (idx === -1) throw new Error(`Card ${cardUid} not in player ${player.id}'s hand`);
  const card = player.hand[idx]!;
  const newHand = [...player.hand.slice(0, idx), ...player.hand.slice(idx + 1)];
  return { card, newHand };
}

function updatePlayer(state: GameState, playerId: number, update: Partial<Player>): GameState {
  return {
    ...state,
    players: state.players.map(p =>
      p.id === playerId ? { ...p, ...update } : p
    ),
  };
}

function getFollowerIds(state: GameState, leaderId: number): number[] {
  const ids: number[] = [];
  for (let i = 1; i < state.playerCount; i++) {
    ids.push((leaderId + i) % state.playerCount);
  }
  return ids;
}

function advanceLeader(state: GameState): GameState {
  const nextLeader = (state.leadPlayerIdx + 1) % state.playerCount;
  return {
    ...state,
    pool: [...state.pool, ...state.pendingPool],
    pendingPool: [],
    leadPlayerIdx: nextLeader,
    phase: { type: 'lead', leaderId: nextLeader },
  };
}

function advanceFollower(state: GameState, phase: Phase & { type: 'follow' }): GameState {
  const nextIdx = phase.currentFollowerIndex + 1;
  if (nextIdx >= phase.followers.length) {
    // All followers done, move to action phase
    const actors = [phase.leaderId, ...phase.actors];
    if (actors.length === 0) {
      return advanceLeader(state);
    }
    return {
      ...state,
      phase: {
        type: 'action',
        ledRole: phase.ledRole,
        actors,
        currentActorIndex: 0,
      },
    };
  }
  return {
    ...state,
    phase: { ...phase, currentFollowerIndex: nextIdx },
  };
}

function advanceActor(state: GameState, phase: Phase & { type: 'action' }): GameState {
  const nextIdx = phase.currentActorIndex + 1;
  if (nextIdx >= phase.actors.length) {
    return advanceLeader(state);
  }
  return {
    ...state,
    phase: { ...phase, currentActorIndex: nextIdx },
  };
}

export function getNeighborIds(playerId: number, playerCount: number): number[] {
  if (playerCount <= 1) return [];
  const left = (playerId - 1 + playerCount) % playerCount;
  const right = (playerId + 1) % playerCount;
  if (left === right) return [left]; // 2-player: same neighbor
  return [left, right];
}

function canStartBuildingOfMaterial(player: Player, material: MaterialType, sites: Sites): boolean {
  // Must have an available site
  if (sites[material] <= 0) return false;
  // Can't have an uncompleted building of the same material type
  const hasUncompleted = player.buildings.some(
    b => !b.completed && getCardDef(b.foundationCard).material === material
  );
  return !hasUncompleted;
}

function checkBuildingComplete(building: Building): boolean {
  const def = getCardDef(building.foundationCard);
  // Cost is the number of materials needed (not counting the foundation)
  return building.materials.length >= def.cost;
}

function completeBuildingIfReady(state: GameState, playerId: number, buildingIndex: number): GameState {
  const player = state.players[playerId]!;
  const building = player.buildings[buildingIndex]!;

  if (building.completed || !checkBuildingComplete(building)) {
    return state;
  }

  const def = getCardDef(building.foundationCard);
  const newBuildings = player.buildings.map((b, i) =>
    i === buildingIndex ? { ...b, completed: true } : b
  );

  return updatePlayer(state, playerId, {
    buildings: newBuildings,
    influence: player.influence + def.cost,
  });
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME':
      return createInitialState(action.playerCount, action.playerNames);

    case 'THINK': {
      const { phase } = state;
      const { option } = action;

      if (phase.type === 'lead') {
        // Leader thinks with chosen option, all followers get standard refresh
        let newState = applyThinkOption(state, phase.leaderId, option);
        const followers = getFollowerIds(state, phase.leaderId);
        for (const fId of followers) {
          newState = drawCards(newState, fId);
        }
        return advanceLeader(newState);
      }

      if (phase.type === 'follow') {
        const followerId = phase.followers[phase.currentFollowerIndex]!;
        let newState = applyThinkOption(state, followerId, option);
        // Follower does NOT become an actor
        newState = advanceFollower(newState, phase);
        return newState;
      }

      return state;
    }

    case 'LEAD_ROLE': {
      const { phase } = state;
      if (phase.type !== 'lead') return state;

      const leader = state.players[phase.leaderId]!;
      const { card, newHand } = removeCardFromHand(leader, action.cardUid);

      // Jacks can lead any role; other cards must match material
      if (!isJackCard(card)) {
        const requiredMaterial = ROLE_TO_MATERIAL[action.role];
        const cardDef = getCardDef(card);
        if (cardDef.material !== requiredMaterial) return state;
      }

      let newState = updatePlayer(state, phase.leaderId, { hand: newHand });
      if (isJackCard(card)) {
        newState = { ...newState, jackPile: newState.jackPile + 1 };
      } else {
        newState = { ...newState, pendingPool: [...newState.pendingPool, card] };
      }

      const followers = getFollowerIds(state, phase.leaderId);
      if (followers.length === 0) {
        // Solo game edge case - go straight to action
        return {
          ...newState,
          phase: {
            type: 'action',
            ledRole: action.role,
            actors: [phase.leaderId],
            currentActorIndex: 0,
          },
        };
      }

      return {
        ...newState,
        phase: {
          type: 'follow',
          leaderId: phase.leaderId,
          ledRole: action.role,
          currentFollowerIndex: 0,
          followers,
          actors: [],
        },
      };
    }

    case 'FOLLOW_ROLE': {
      const { phase } = state;
      if (phase.type !== 'follow') return state;

      const followerId = phase.followers[phase.currentFollowerIndex]!;
      const follower = state.players[followerId]!;
      const { card, newHand } = removeCardFromHand(follower, action.cardUid);

      // Jacks can follow any role; other cards must match material
      if (!isJackCard(card)) {
        const requiredMaterial = ROLE_TO_MATERIAL[phase.ledRole];
        const cardDef = getCardDef(card);
        if (cardDef.material !== requiredMaterial) return state;
      }

      let newState = updatePlayer(state, followerId, { hand: newHand });
      if (isJackCard(card)) {
        newState = { ...newState, jackPile: newState.jackPile + 1 };
      } else {
        newState = { ...newState, pendingPool: [...newState.pendingPool, card] };
      }

      // Add follower to actors list
      const newPhase = { ...phase, actors: [...phase.actors, followerId] };
      return advanceFollower(newState, newPhase);
    }

    case 'ARCHITECT_START': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Architect') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const { card, newHand } = removeCardFromHand(player, action.cardUid);
      const cardDef = getCardDef(card);

      // Validate
      if (!canStartBuildingOfMaterial(player, cardDef.material, state.sites)) return state;

      const newBuilding: Building = {
        foundationCard: card,
        materials: [],
        completed: false,
      };

      let newState = updatePlayer(state, actorId, {
        hand: newHand,
        buildings: [...player.buildings, newBuilding],
      });

      // Decrement site
      newState = {
        ...newState,
        sites: {
          ...newState.sites,
          [cardDef.material]: newState.sites[cardDef.material] - 1,
        },
      };

      // Check auto-complete for cost-1 buildings
      const buildingIdx = newState.players[actorId]!.buildings.length - 1;
      newState = completeBuildingIfReady(newState, actorId, buildingIdx);

      return advanceActor(newState, phase);
    }

    case 'CRAFTSMAN_ADD': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Craftsman') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const building = player.buildings[action.buildingIndex];
      if (!building || building.completed) return state;

      const { card, newHand } = removeCardFromHand(player, action.cardUid);
      const cardDef = getCardDef(card);
      const buildingDef = getCardDef(building.foundationCard);

      // Validate: material must match
      if (cardDef.material !== buildingDef.material) return state;

      const newBuildings = player.buildings.map((b, i) =>
        i === action.buildingIndex
          ? { ...b, materials: [...b.materials, card] }
          : b
      );

      let newState = updatePlayer(state, actorId, {
        hand: newHand,
        buildings: newBuildings,
      });

      newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
      return advanceActor(newState, phase);
    }

    case 'LABORER_POOL_TO_STOCKPILE': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Laborer') return state;
      if (action.materials.length === 0 || action.materials.length > 2) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      let newPool = [...state.pool];
      const movedCards: Card[] = [];

      for (const mat of action.materials) {
        const idx = newPool.findIndex(c => getCardDef(c).material === mat);
        if (idx === -1) return state;
        movedCards.push(newPool[idx]!);
        newPool = [...newPool.slice(0, idx), ...newPool.slice(idx + 1)];
      }

      const player = state.players[actorId]!;
      let newState: GameState = {
        ...state,
        pool: newPool,
      };
      newState = updatePlayer(newState, actorId, {
        stockpile: [...player.stockpile, ...movedCards],
      });

      return advanceActor(newState, phase);
    }

    case 'LABORER_STOCKPILE_TO_BUILDING': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Laborer') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const building = player.buildings[action.buildingIndex];
      if (!building || building.completed) return state;

      const buildingDef = getCardDef(building.foundationCard);
      if (action.material !== buildingDef.material) return state;

      const stockpileIdx = player.stockpile.findIndex(
        c => getCardDef(c).material === action.material
      );
      if (stockpileIdx === -1) return state;

      const card = player.stockpile[stockpileIdx]!;
      const newStockpile = [
        ...player.stockpile.slice(0, stockpileIdx),
        ...player.stockpile.slice(stockpileIdx + 1),
      ];
      const newBuildings = player.buildings.map((b, i) =>
        i === action.buildingIndex
          ? { ...b, materials: [...b.materials, card] }
          : b
      );

      let newState = updatePlayer(state, actorId, {
        stockpile: newStockpile,
        buildings: newBuildings,
      });

      newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
      return advanceActor(newState, phase);
    }

    case 'MERCHANT_STOCKPILE_TO_VAULT': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Merchant') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;

      // Vault capacity is limited by influence
      if (player.vault.length >= player.influence) return state;

      const stockpileIdx = player.stockpile.findIndex(
        c => getCardDef(c).material === action.material
      );
      if (stockpileIdx === -1) return state;

      const card = player.stockpile[stockpileIdx]!;
      const newStockpile = [
        ...player.stockpile.slice(0, stockpileIdx),
        ...player.stockpile.slice(stockpileIdx + 1),
      ];

      const newState = updatePlayer(state, actorId, {
        stockpile: newStockpile,
        vault: [...player.vault, card],
      });

      return advanceActor(newState, phase);
    }

    case 'LEGIONARY_REVEAL': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Legionary') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const card = player.hand.find(c => c.uid === action.cardUid);
      if (!card || isJackCard(card)) return state;

      const revealedMaterial = getCardDef(card).material;

      // Take one matching card from pool to stockpile
      let newState = { ...state };
      const poolIdx = newState.pool.findIndex(c => getCardDef(c).material === revealedMaterial);
      if (poolIdx !== -1) {
        const poolCard = newState.pool[poolIdx]!;
        newState = {
          ...newState,
          pool: [...newState.pool.slice(0, poolIdx), ...newState.pool.slice(poolIdx + 1)],
        };
        newState = updatePlayer(newState, actorId, {
          stockpile: [...newState.players[actorId]!.stockpile, poolCard],
        });
      }

      // Find neighbors who have matching material in hand
      const neighbors = getNeighborIds(actorId, state.playerCount);
      const demandees = neighbors.filter(nId => {
        const neighbor = newState.players[nId]!;
        return neighbor.hand.some(c => !isJackCard(c) && getCardDef(c).material === revealedMaterial);
      });

      if (demandees.length === 0) {
        // No neighbors to demand from, advance actor
        return advanceActor(newState, phase);
      }

      // Enter legionary_demand phase
      return {
        ...newState,
        phase: {
          type: 'legionary_demand',
          revealedMaterial,
          demandees,
          currentDemandeeIndex: 0,
          actionActors: phase.actors,
          actionCurrentActorIndex: phase.currentActorIndex,
        },
      };
    }

    case 'LEGIONARY_GIVE': {
      const { phase } = state;
      if (phase.type !== 'legionary_demand') return state;

      const demandeeId = phase.demandees[phase.currentDemandeeIndex]!;
      const demandee = state.players[demandeeId]!;
      const { card, newHand } = removeCardFromHand(demandee, action.cardUid);

      // Validate: card must match demanded material and not be a jack
      if (isJackCard(card) || getCardDef(card).material !== phase.revealedMaterial) return state;

      // Card goes to the legionary actor's stockpile
      const actorId = phase.actionActors[phase.actionCurrentActorIndex]!;
      let newState = updatePlayer(state, demandeeId, { hand: newHand });
      newState = updatePlayer(newState, actorId, {
        stockpile: [...newState.players[actorId]!.stockpile, card],
      });

      // Advance to next demandee or back to action phase
      const nextDemandeeIdx = phase.currentDemandeeIndex + 1;
      if (nextDemandeeIdx >= phase.demandees.length) {
        // Return to action phase and advance actor
        const actionPhase: Phase & { type: 'action' } = {
          type: 'action',
          ledRole: 'Legionary',
          actors: phase.actionActors,
          currentActorIndex: phase.actionCurrentActorIndex,
        };
        return advanceActor(newState, actionPhase);
      }

      return {
        ...newState,
        phase: { ...phase, currentDemandeeIndex: nextDemandeeIdx },
      };
    }

    case 'PATRON_HIRE': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Patron') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;

      // Clientele capacity is limited by influence
      if (player.clientele.length >= player.influence) return state;

      const poolIdx = state.pool.findIndex(c => getCardDef(c).material === action.material);
      if (poolIdx === -1) return state;

      const card = state.pool[poolIdx]!;
      const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];

      const newState = {
        ...updatePlayer(state, actorId, {
          clientele: [...player.clientele, card],
        }),
        pool: newPool,
      };

      return advanceActor(newState, phase);
    }

    case 'SKIP_ACTION': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      return advanceActor(state, phase);
    }

    default:
      return state;
  }
}

// Returns the player whose turn it is to act
export function getActivePlayerId(state: GameState): number | null {
  const { phase } = state;
  switch (phase.type) {
    case 'lead':
      return phase.leaderId;
    case 'follow':
      return phase.followers[phase.currentFollowerIndex] ?? null;
    case 'action':
      return phase.actors[phase.currentActorIndex] ?? null;
    case 'legionary_demand':
      return phase.demandees[phase.currentDemandeeIndex] ?? null;
    default:
      return null;
  }
}

export interface ThinkOptions {
  canRefresh: boolean;
  canDraw1: boolean;
  genericMaterials: MaterialType[];
  canDrawJack: boolean;
}

export interface AvailableActions {
  canThink: boolean;
  thinkOptions: ThinkOptions;
  leadOptions: { role: ActiveRole; cardUid: number }[];
  followOptions: { cardUid: number }[];
  architectOptions: { cardUid: number }[];
  craftsmanOptions: { buildingIndex: number; cardUid: number }[];
  laborerPoolOptions: MaterialType[];
  laborerBuildingOptions: { material: MaterialType; buildingIndex: number }[];
  merchantOptions: MaterialType[];
  patronOptions: MaterialType[];
  legionaryOptions: { cardUid: number }[];
  legionaryGiveOptions: { cardUid: number }[];
  canSkip: boolean;
}

export function getAvailableActions(state: GameState): AvailableActions {
  const noThink: ThinkOptions = { canRefresh: false, canDraw1: false, genericMaterials: [], canDrawJack: false };
  const result: AvailableActions = {
    canThink: false,
    thinkOptions: noThink,
    leadOptions: [],
    followOptions: [],
    architectOptions: [],
    craftsmanOptions: [],
    laborerPoolOptions: [],
    laborerBuildingOptions: [],
    merchantOptions: [],
    patronOptions: [],
    legionaryOptions: [],
    legionaryGiveOptions: [],
    canSkip: false,
  };

  const activeId = getActivePlayerId(state);
  if (activeId === null) return result;

  const player = state.players[activeId]!;
  const { phase } = state;

  if (phase.type === 'lead' || phase.type === 'follow') {
    result.canThink = true;
    const genericMaterials = Object.keys(state.genericSupply) as MaterialType[];
    result.thinkOptions = {
      canRefresh: player.hand.length < state.handLimit && state.deck.length > 0,
      canDraw1: state.deck.length > 0,
      genericMaterials,
      canDrawJack: state.jackPile > 0,
    };
  }

  if (phase.type === 'lead') {
    for (const card of player.hand) {
      if (isJackCard(card)) {
        // Jack can lead any active role
        result.leadOptions.push({ role: 'Architect', cardUid: card.uid });
        result.leadOptions.push({ role: 'Craftsman', cardUid: card.uid });
        result.leadOptions.push({ role: 'Laborer', cardUid: card.uid });
        result.leadOptions.push({ role: 'Legionary', cardUid: card.uid });
        result.leadOptions.push({ role: 'Merchant', cardUid: card.uid });
        result.leadOptions.push({ role: 'Patron', cardUid: card.uid });
      } else {
        const def = getCardDef(card);
        if (def.material === 'Concrete') {
          result.leadOptions.push({ role: 'Architect', cardUid: card.uid });
        }
        if (def.material === 'Wood') {
          result.leadOptions.push({ role: 'Craftsman', cardUid: card.uid });
        }
        if (def.material === 'Rubble') {
          result.leadOptions.push({ role: 'Laborer', cardUid: card.uid });
        }
        if (def.material === 'Brick') {
          result.leadOptions.push({ role: 'Legionary', cardUid: card.uid });
        }
        if (def.material === 'Stone') {
          result.leadOptions.push({ role: 'Merchant', cardUid: card.uid });
        }
        if (def.material === 'Marble') {
          result.leadOptions.push({ role: 'Patron', cardUid: card.uid });
        }
      }
    }
  }

  if (phase.type === 'follow') {
    const requiredMaterial = ROLE_TO_MATERIAL[phase.ledRole];
    for (const card of player.hand) {
      if (isJackCard(card)) {
        result.followOptions.push({ cardUid: card.uid });
      } else {
        const def = getCardDef(card);
        if (def.material === requiredMaterial) {
          result.followOptions.push({ cardUid: card.uid });
        }
      }
    }
  }

  if (phase.type === 'action') {
    result.canSkip = true;

    if (phase.ledRole === 'Architect') {
      for (const card of player.hand) {
        if (isJackCard(card)) continue; // Jacks can't be used as buildings
        const def = getCardDef(card);
        if (canStartBuildingOfMaterial(player, def.material, state.sites)) {
          result.architectOptions.push({ cardUid: card.uid });
        }
      }
    }

    if (phase.ledRole === 'Craftsman') {
      for (let bi = 0; bi < player.buildings.length; bi++) {
        const building = player.buildings[bi]!;
        if (building.completed) continue;
        const buildingDef = getCardDef(building.foundationCard);
        for (const card of player.hand) {
          if (isJackCard(card)) continue; // Jacks can't be used as materials
          const def = getCardDef(card);
          if (def.material === buildingDef.material) {
            result.craftsmanOptions.push({ buildingIndex: bi, cardUid: card.uid });
          }
        }
      }
    }

    if (phase.ledRole === 'Laborer') {
      // Pool materials available to take
      const poolMaterialSet = new Set<MaterialType>();
      for (const card of state.pool) {
        poolMaterialSet.add(getCardDef(card).material);
      }
      result.laborerPoolOptions = [...poolMaterialSet];

      // Stockpile to building options
      const stockpileMaterialSet = new Set<MaterialType>();
      for (const card of player.stockpile) {
        stockpileMaterialSet.add(getCardDef(card).material);
      }
      for (let bi = 0; bi < player.buildings.length; bi++) {
        const building = player.buildings[bi]!;
        if (building.completed) continue;
        const buildingDef = getCardDef(building.foundationCard);
        if (stockpileMaterialSet.has(buildingDef.material)) {
          result.laborerBuildingOptions.push({
            material: buildingDef.material,
            buildingIndex: bi,
          });
        }
      }
    }

    if (phase.ledRole === 'Merchant') {
      // Vault capacity is limited by influence
      if (player.vault.length < player.influence) {
        const stockpileMaterialSet = new Set<MaterialType>();
        for (const card of player.stockpile) {
          stockpileMaterialSet.add(getCardDef(card).material);
        }
        result.merchantOptions = [...stockpileMaterialSet];
      }
    }

    if (phase.ledRole === 'Patron') {
      // Clientele capacity is limited by influence
      if (player.clientele.length < player.influence) {
        const poolMaterialSet = new Set<MaterialType>();
        for (const card of state.pool) {
          poolMaterialSet.add(getCardDef(card).material);
        }
        result.patronOptions = [...poolMaterialSet];
      }
    }

    if (phase.ledRole === 'Legionary') {
      // Can reveal any non-Jack card from hand
      for (const card of player.hand) {
        if (!isJackCard(card)) {
          result.legionaryOptions.push({ cardUid: card.uid });
        }
      }
    }
  }

  // Legionary demand phase: demandee must give a matching card
  if (phase.type === 'legionary_demand') {
    for (const card of player.hand) {
      if (!isJackCard(card) && getCardDef(card).material === phase.revealedMaterial) {
        result.legionaryGiveOptions.push({ cardUid: card.uid });
      }
    }
  }

  return result;
}
