import {
  GameState, GameAction, Player, Phase, Sites, Building,
  Card, MaterialType, ActiveRole, GenericSupply, ThinkOption,
} from './types';
import { createDeck, getCardDef, CARD_DEF_MAP, MATERIAL_VALUE, RNG, ROLE_TO_MATERIAL, genericDefIdForMaterial, isJackCard } from './cards';

const DEFAULT_HAND_LIMIT = 5;
const SITES_PER_PLAYER = 1; // +1 is added below
const OUT_OF_TOWN_SITES_PER_TYPE = 2;
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

  const sitesPerType = playerCount * SITES_PER_PLAYER + 1;
  const sites: Sites = {
    Rubble: sitesPerType,
    Wood: sitesPerType,
    Brick: sitesPerType,
    Concrete: sitesPerType,
    Stone: sitesPerType,
    Marble: sitesPerType,
  };

  const outOfTownSites: Sites = {
    Rubble: OUT_OF_TOWN_SITES_PER_TYPE,
    Wood: OUT_OF_TOWN_SITES_PER_TYPE,
    Brick: OUT_OF_TOWN_SITES_PER_TYPE,
    Concrete: OUT_OF_TOWN_SITES_PER_TYPE,
    Stone: OUT_OF_TOWN_SITES_PER_TYPE,
    Marble: OUT_OF_TOWN_SITES_PER_TYPE,
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
    outOfTownSites,
    genericSupply,
    jackPile: playerCount === 3 ? 6 : playerCount + 2,
    nextUid,
    phase: { type: 'lead', leaderId: 0 },
    handLimit: DEFAULT_HAND_LIMIT,
    playerCount,
    leadPlayerIdx: 0,
  };
}

/** Get required materials for a building, accounting for Vat */
export function getRequiredMaterials(player: Player, building: Building): number {
  const def = getCardDef(building.foundationCard);
  if (def.material === 'Concrete' && hasCompletedBuilding(player, 'vat')) {
    return 1;
  }
  return def.cost;
}

export function getEffectiveHandLimit(state: GameState, playerId: number): number {
  let limit = state.handLimit;
  const player = state.players[playerId]!;
  if (hasCompletedBuilding(player, 'cross')) limit += 1;
  return limit;
}

function drawCards(state: GameState, playerId: number): GameState {
  const player = state.players[playerId]!;
  const handLimit = getEffectiveHandLimit(state, playerId);
  const count = player.hand.length < handLimit
    ? handLimit - player.hand.length
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

export function getClientCountForRole(player: Player, role: ActiveRole): number {
  const material = ROLE_TO_MATERIAL[role];
  let count = player.clientele.filter(c => getCardDef(c).material === material).length;

  // Fortress: every pair of 2 clients of the same type also counts as a Legionary client
  if (role === 'Legionary' && hasCompletedBuilding(player, 'fortress')) {
    const materialCounts: Partial<Record<MaterialType, number>> = {};
    for (const c of player.clientele) {
      const mat = getCardDef(c).material;
      materialCounts[mat] = (materialCounts[mat] ?? 0) + 1;
    }
    for (const mat of Object.keys(materialCounts) as MaterialType[]) {
      if (mat === 'Brick') continue; // Already counted as Legionary
      count += Math.floor(materialCounts[mat]! / 2);
    }
  }

  return count;
}

function buildActorsWithClients(
  state: GameState,
  ledRole: ActiveRole,
  leaderId: number,
  cardActorIds: number[],
): number[] {
  const cardActorSet = new Set(cardActorIds);
  const actors: number[] = [];

  // Iterate in seat order starting from leader
  for (let i = 0; i < state.playerCount; i++) {
    const playerId = (leaderId + i) % state.playerCount;
    const player = state.players[playerId]!;
    const clientActions = getClientCountForRole(player, ledRole);
    const cardAction = cardActorSet.has(playerId) ? 1 : 0;
    const totalActions = cardAction + clientActions;

    for (let j = 0; j < totalActions; j++) {
      actors.push(playerId);
    }
  }

  return actors;
}

function advanceLeader(state: GameState): GameState {
  const merged = {
    ...state,
    pool: [...state.pool, ...state.pendingPool],
    pendingPool: [],
    legionaryDemandCounts: undefined, // Reset per-round legionary tracking
  };
  if (merged.deck.length === 0 || merged.gameEndTriggered) {
    return { ...merged, phase: { type: 'gameOver' } };
  }
  const nextLeader = (state.leadPlayerIdx + 1) % state.playerCount;
  return {
    ...merged,
    leadPlayerIdx: nextLeader,
    phase: { type: 'lead', leaderId: nextLeader },
  };
}

function advanceFollower(state: GameState, phase: Phase & { type: 'follow' }): GameState {
  const nextIdx = phase.currentFollowerIndex + 1;
  if (nextIdx >= phase.followers.length) {
    // All followers done, move to action phase
    // Expand actors to include client-produced actions
    const cardActors = [phase.leaderId, ...phase.actors];
    const actors = buildActorsWithClients(state, phase.ledRole, phase.leaderId, cardActors);
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

/** Check if the action phase has pending abilities — if so, don't advance */
function hasPendingAbilities(state: GameState): boolean {
  if (state.phase.type !== 'action') return false;
  const p = state.phase.pendingAbilities;
  return !!p && p.length > 0;
}

/** Remove the first pending ability of the given kind; advance actor if none remain */
function resolvePendingAbility(state: GameState, resolvedKind: string): GameState {
  if (state.phase.type !== 'action') return state;
  const phase = state.phase;
  const pending = phase.pendingAbilities ?? [];
  const idx = pending.findIndex(a => a.kind === resolvedKind);
  const newPending = idx >= 0 ? [...pending.slice(0, idx), ...pending.slice(idx + 1)] : pending;

  if (newPending.length > 0) {
    return { ...state, phase: { ...phase, pendingAbilities: newPending } };
  }
  return advanceActor({ ...state, phase: { ...phase, pendingAbilities: undefined } }, phase);
}

function advanceActor(state: GameState, phase: Phase & { type: 'action' }, skip: number = 1): GameState {
  const nextIdx = phase.currentActorIndex + skip;
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

/** Count how many legionary-blocking buildings (Palisade, Wall) a player has completed */
function countLegionaryBlockers(player: Player): number {
  let count = 0;
  if (hasCompletedBuilding(player, 'palisade')) count++;
  if (hasCompletedBuilding(player, 'wall')) count++;
  return count;
}

/** Check if a legionary demand is blocked by Palisade/Wall.
 *  With N blockers, only every 2^N-th demand from a given attacker gets through. */
function isLegionaryDemandBlocked(demandCount: number, blockers: number): boolean {
  if (blockers === 0) return false;
  const interval = 1 << blockers; // 2^N
  return (demandCount % interval) !== 0;
}

function hasAnySiteForMaterial(material: MaterialType, sites: Sites, outOfTownSites: Sites): boolean {
  return sites[material] > 0 || outOfTownSites[material] > 0;
}

function requiresOutOfTownSite(material: MaterialType, sites: Sites): boolean {
  return sites[material] <= 0;
}

function canStartBuildingOfMaterial(player: Player, material: MaterialType, sites: Sites, outOfTownSites: Sites): boolean {
  // Must have an available site (normal or out-of-town)
  if (!hasAnySiteForMaterial(material, sites, outOfTownSites)) return false;
  // Can't have an uncompleted building of the same material type
  const hasUncompleted = player.buildings.some(
    b => !b.completed && getCardDef(b.foundationCard).material === material
  );
  return !hasUncompleted;
}

/** Count how many remaining actions this player has from currentActorIndex onward */
export function countRemainingActions(playerId: number, actors: number[], currentActorIndex: number): number {
  let count = 0;
  for (let i = currentActorIndex; i < actors.length; i++) {
    if (actors[i] === playerId) count++;
  }
  return count;
}

/** Check if a player has 2+ completed buildings of the same material at each cost tier (1, 2, 3) */
function checkBuildingDiversityEnd(player: Player): boolean {
  // Count completed buildings per material type
  const materialCounts = new Map<MaterialType, number>();
  for (const b of player.buildings) {
    if (!b.completed) continue;
    const mat = getCardDef(b.foundationCard).material;
    materialCounts.set(mat, (materialCounts.get(mat) ?? 0) + 1);
  }
  // Need at least one material with 2+ completed buildings at each cost tier
  let hasCost1 = false, hasCost2 = false, hasCost3 = false;
  for (const [mat, count] of materialCounts) {
    if (count < 2) continue;
    const cost = MATERIAL_VALUE[mat];
    if (cost === 1) hasCost1 = true;
    if (cost === 2) hasCost2 = true;
    if (cost === 3) hasCost3 = true;
  }
  return hasCost1 && hasCost2 && hasCost3;
}

function completeBuildingIfReady(state: GameState, playerId: number, buildingIndex: number): GameState {
  const player = state.players[playerId]!;
  const building = player.buildings[buildingIndex]!;

  if (building.completed) return state;

  const def = getCardDef(building.foundationCard);

  // Vat: Concrete buildings need only 1 material
  let requiredMaterials = def.cost;
  if (def.material === 'Concrete' && hasCompletedBuilding(player, 'vat')) {
    requiredMaterials = 1;
  }

  if (building.materials.length < requiredMaterials) return state;

  const newBuildings = player.buildings.map((b, i) =>
    i === buildingIndex ? { ...b, completed: true } : b
  );

  let newState = updatePlayer(state, playerId, {
    buildings: newBuildings,
    influence: player.influence + def.cost,
  });

  // Market: on completion, take 1 of each material type from Generic Supply into hand
  if (def.id === 'market') {
    newState = applyMarketCompletion(newState, playerId);
  }

  // Vat: upon completion, retroactively complete any Concrete buildings with 1+ material
  if (def.id === 'vat') {
    const p = newState.players[playerId]!;
    let extraInfluence = 0;
    const retroBuildings = p.buildings.map(b => {
      if (b.completed) return b;
      const bDef = getCardDef(b.foundationCard);
      if (bDef.material === 'Concrete' && b.materials.length >= 1) {
        extraInfluence += bDef.cost;
        return { ...b, completed: true };
      }
      return b;
    });
    if (extraInfluence > 0) {
      newState = updatePlayer(newState, playerId, {
        buildings: retroBuildings,
        influence: p.influence + extraInfluence,
      });
    }
  }

  // Check building diversity game end condition
  if (checkBuildingDiversityEnd(newState.players[playerId]!)) {
    newState = { ...newState, gameEndTriggered: true };
  }

  // Collect triggered abilities
  const pendingAbilities: Array<
    | { kind: 'quarry' }
    | { kind: 'encampment'; material: MaterialType }
    | { kind: 'junkyard' }
  > = [];

  const updatedPlayer = newState.players[playerId]!;

  // Junkyard: upon completion of Junkyard itself
  if (def.id === 'junkyard' && updatedPlayer.hand.length > 0) {
    pendingAbilities.push({ kind: 'junkyard' });
  }

  // Quarry: after finishing any structure, may take a Craftsman action
  if (hasCompletedBuilding(updatedPlayer, 'quarry')) {
    const canCraftsman = updatedPlayer.buildings.some(b => {
      if (b.completed) return false;
      const bMat = getCardDef(b.foundationCard).material;
      return updatedPlayer.hand.some(c => !isJackCard(c) && getCardDef(c).material === bMat) ||
             (hasCompletedBuilding(updatedPlayer, 'scriptorium') &&
              newState.pool.some(c => getCardDef(c).material === bMat));
    });
    if (canCraftsman) {
      pendingAbilities.push({ kind: 'quarry' });
    }
  }

  // Encampment: after finishing a building, may start one of the same type
  if (hasCompletedBuilding(updatedPlayer, 'encampment')) {
    const canStart =
      canStartBuildingOfMaterial(updatedPlayer, def.material, newState.sites, newState.outOfTownSites) &&
      updatedPlayer.hand.some(c => !isJackCard(c) && getCardDef(c).material === def.material);
    if (canStart) {
      pendingAbilities.push({ kind: 'encampment', material: def.material });
    }
  }

  if (pendingAbilities.length > 0 && newState.phase.type === 'action') {
    const existing = (newState.phase as Phase & { type: 'action' }).pendingAbilities ?? [];
    newState = {
      ...newState,
      phase: {
        ...newState.phase,
        pendingAbilities: [...existing, ...pendingAbilities],
      },
    };
  }

  return newState;
}

function applyMarketCompletion(state: GameState, playerId: number): GameState {
  const ALL_MATS: MaterialType[] = ['Rubble', 'Wood', 'Brick', 'Concrete', 'Stone', 'Marble'];
  const newCards: Card[] = [];
  let newSupply = { ...state.genericSupply };
  let nextUid = state.nextUid;

  for (const mat of ALL_MATS) {
    if (newSupply[mat] > 0) {
      newCards.push({ uid: nextUid++, defId: genericDefIdForMaterial(mat) });
      newSupply[mat] = newSupply[mat] - 1;
    }
  }

  const player = state.players[playerId]!;
  return {
    ...updatePlayer(state, playerId, {
      hand: [...player.hand, ...newCards],
    }),
    genericSupply: newSupply,
    nextUid,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME':
      return createInitialState(action.playerCount, action.playerNames);

    case 'THINK': {
      const { phase } = state;
      const { option } = action;

      if (phase.type === 'lead') {
        // Leader thinks with chosen option, then each follower picks their think option
        const newState = applyThinkOption(state, phase.leaderId, option);
        const followers = getFollowerIds(newState, phase.leaderId);
        if (followers.length === 0) {
          return advanceLeader(newState);
        }
        return {
          ...newState,
          phase: { type: 'thinkRound', leaderId: phase.leaderId, followers, currentFollowerIndex: 0 },
        };
      }

      if (phase.type === 'thinkRound') {
        const followerId = phase.followers[phase.currentFollowerIndex]!;
        const newState = applyThinkOption(state, followerId, option);
        const nextIdx = phase.currentFollowerIndex + 1;
        if (nextIdx >= phase.followers.length) {
          return advanceLeader(newState);
        }
        return {
          ...newState,
          phase: { ...phase, currentFollowerIndex: nextIdx },
        };
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

      // 3-of-a-kind: playing 3 cards of the same material as a wild
      if (action.extraCardUids && action.extraCardUids.length > 0) {
        const cardDef = getCardDef(card);
        let hand = newHand;
        const extraCards: Card[] = [];
        for (const uid of action.extraCardUids) {
          const result = removeCardFromHand({ ...leader, hand } as Player, uid);
          extraCards.push(result.card);
          hand = result.newHand;
        }
        // Validate all cards are the same material (and non-jack)
        if (isJackCard(card)) return state;
        for (const ec of extraCards) {
          if (isJackCard(ec) || getCardDef(ec).material !== cardDef.material) return state;
        }
        let newState = updatePlayer(state, phase.leaderId, { hand });
        newState = { ...newState, pendingPool: [...newState.pendingPool, card, ...extraCards] };

        const followers = getFollowerIds(state, phase.leaderId);
        if (followers.length === 0) {
          const actors = buildActorsWithClients(newState, action.role, phase.leaderId, [phase.leaderId]);
          return {
            ...newState,
            phase: {
              type: 'action',
              ledRole: action.role,
              actors,
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
        const actors = buildActorsWithClients(newState, action.role, phase.leaderId, [phase.leaderId]);
        return {
          ...newState,
          phase: {
            type: 'action',
            ledRole: action.role,
            actors,
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

      // 3-of-a-kind: playing 3 cards of the same material as a wild
      if (action.extraCardUids && action.extraCardUids.length > 0) {
        const cardDef = getCardDef(card);
        let hand = newHand;
        const extraCards: Card[] = [];
        for (const uid of action.extraCardUids) {
          const result = removeCardFromHand({ ...follower, hand } as Player, uid);
          extraCards.push(result.card);
          hand = result.newHand;
        }
        // Validate all cards are the same material (and non-jack)
        if (isJackCard(card)) return state;
        for (const ec of extraCards) {
          if (isJackCard(ec) || getCardDef(ec).material !== cardDef.material) return state;
        }
        let newState = updatePlayer(state, followerId, { hand });
        newState = { ...newState, pendingPool: [...newState.pendingPool, card, ...extraCards] };
        const newPhase = { ...phase, actors: [...phase.actors, followerId] };
        return advanceFollower(newState, newPhase);
      }

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
      if (!canStartBuildingOfMaterial(player, cardDef.material, state.sites, state.outOfTownSites)) return state;

      // Determine if this must use an out-of-town site
      const isOutOfTown = requiresOutOfTownSite(cardDef.material, state.sites);

      // Crane cannot be used with out-of-town buildings
      if (isOutOfTown && action.craneCardUid !== undefined) return state;

      // Out-of-town requires 2 actions — validate the player has enough remaining
      if (isOutOfTown) {
        const remaining = countRemainingActions(actorId, phase.actors, phase.currentActorIndex);
        if (remaining < 2) return state;
      }

      const newBuilding: Building = {
        foundationCard: card,
        materials: [],
        completed: false,
        outOfTown: isOutOfTown || undefined,
      };

      let newState = updatePlayer(state, actorId, {
        hand: newHand,
        buildings: [...player.buildings, newBuilding],
      });

      // Decrement appropriate site
      if (isOutOfTown) {
        newState = {
          ...newState,
          outOfTownSites: {
            ...newState.outOfTownSites,
            [cardDef.material]: newState.outOfTownSites[cardDef.material] - 1,
          },
        };
      } else {
        newState = {
          ...newState,
          sites: {
            ...newState.sites,
            [cardDef.material]: newState.sites[cardDef.material] - 1,
          },
        };
      }

      // Check auto-complete for cost-1 buildings
      const buildingIdx = newState.players[actorId]!.buildings.length - 1;
      newState = completeBuildingIfReady(newState, actorId, buildingIdx);

      // Crane: start a second building from hand as part of the same action (normal sites only)
      if (action.craneCardUid !== undefined) {
        const cranePlayer = newState.players[actorId]!;
        if (!hasCompletedBuilding(cranePlayer, 'crane')) return state;
        const { card: craneCard, newHand: craneHand } = removeCardFromHand(cranePlayer, action.craneCardUid);
        const craneDef = getCardDef(craneCard);
        // Crane only allows normal sites, not out-of-town
        if (newState.sites[craneDef.material] <= 0) return state;
        if (!canStartBuildingOfMaterial(cranePlayer, craneDef.material, newState.sites, newState.outOfTownSites)) return state;
        const craneBuilding: Building = {
          foundationCard: craneCard,
          materials: [],
          completed: false,
        };
        newState = updatePlayer(newState, actorId, {
          hand: craneHand,
          buildings: [...newState.players[actorId]!.buildings, craneBuilding],
        });
        newState = { ...newState, sites: { ...newState.sites, [craneDef.material]: newState.sites[craneDef.material] - 1 } };
        const craneBuildingIdx = newState.players[actorId]!.buildings.length - 1;
        newState = completeBuildingIfReady(newState, actorId, craneBuildingIdx);
      }

      // Out-of-town costs 2 actions, normal costs 1
      if (hasPendingAbilities(newState)) return newState;
      return advanceActor(newState, phase, isOutOfTown ? 2 : 1);
    }

    case 'CRAFTSMAN_ADD': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Craftsman') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const building = player.buildings[action.buildingIndex];
      if (!building || building.completed) return state;

      // Scriptorium: take matching material from pool instead of hand
      if (action.fromPool) {
        if (!hasCompletedBuilding(player, 'scriptorium')) return state;
        const buildingDef = getCardDef(building.foundationCard);
        const poolIdx = state.pool.findIndex(c => getCardDef(c).material === buildingDef.material);
        if (poolIdx === -1) return state;
        const poolCard = state.pool[poolIdx]!;
        const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];
        const newBuildings = player.buildings.map((b, i) =>
          i === action.buildingIndex ? { ...b, materials: [...b.materials, poolCard] } : b
        );
        let newState = { ...updatePlayer(state, actorId, { buildings: newBuildings }), pool: newPool };
        newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
        if (hasPendingAbilities(newState)) return newState;
        return advanceActor(newState, phase);
      }

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
      if (hasPendingAbilities(newState)) return newState;
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

    case 'LABORER_HAND_TO_STOCKPILE': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Laborer') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;

      // Requires completed Dock
      if (!hasCompletedBuilding(player, 'dock')) return state;

      const { card, newHand } = removeCardFromHand(player, action.cardUid);
      if (isJackCard(card)) return state; // Jacks can't be used as materials

      const newState = updatePlayer(state, actorId, {
        hand: newHand,
        stockpile: [...player.stockpile, card],
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

      // Scriptorium: take matching material from pool instead of stockpile
      if (action.fromPool) {
        if (!hasCompletedBuilding(player, 'scriptorium')) return state;
        const poolIdx = state.pool.findIndex(c => getCardDef(c).material === action.material);
        if (poolIdx === -1) return state;
        const poolCard = state.pool[poolIdx]!;
        const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];
        const newBuildings = player.buildings.map((b, i) =>
          i === action.buildingIndex ? { ...b, materials: [...b.materials, poolCard] } : b
        );
        let newState = { ...updatePlayer(state, actorId, { buildings: newBuildings }), pool: newPool };
        newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
        if (hasPendingAbilities(newState)) return newState;
        return advanceActor(newState, phase);
      }

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
      if (hasPendingAbilities(newState)) return newState;
      return advanceActor(newState, phase);
    }

    case 'MERCHANT_STOCKPILE_TO_VAULT': {
      const { phase } = state;
      if (phase.type !== 'action' || phase.ledRole !== 'Merchant') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;

      // Vault capacity is limited by influence
      if (player.vault.length >= player.influence) return state;

      // Bazaar: move from pool to vault
      if (action.fromPool) {
        if (!hasCompletedBuilding(player, 'bazaar')) return state;
        const poolIdx = state.pool.findIndex(c => getCardDef(c).material === action.material);
        if (poolIdx === -1) return state;
        const poolCard = state.pool[poolIdx]!;
        const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];
        const newState = {
          ...updatePlayer(state, actorId, {
            vault: [...player.vault, poolCard],
          }),
          pool: newPool,
        };
        return advanceActor(newState, phase);
      }

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
      const hasBarracks = hasCompletedBuilding(player, 'barracks');

      // Bridge: take from all opponents' stockpiles instead of pool + demand
      if (action.bridge) {
        if (!hasCompletedBuilding(player, 'bridge')) return state;
        let newState = { ...state };
        const stolenCards: Card[] = [];

        for (let i = 0; i < newState.playerCount; i++) {
          if (i === actorId) continue;
          const opponent = newState.players[i]!;
          const matching = opponent.stockpile.filter(c => getCardDef(c).material === revealedMaterial);
          if (matching.length === 0) continue;

          if (hasBarracks) {
            stolenCards.push(...matching);
            newState = updatePlayer(newState, i, {
              stockpile: opponent.stockpile.filter(c => getCardDef(c).material !== revealedMaterial),
            });
          } else {
            stolenCards.push(matching[0]!);
            newState = updatePlayer(newState, i, {
              stockpile: opponent.stockpile.filter(c => c.uid !== matching[0]!.uid),
            });
          }
        }

        newState = updatePlayer(newState, actorId, {
          stockpile: [...newState.players[actorId]!.stockpile, ...stolenCards],
        });

        return advanceActor(newState, phase);
      }

      // Take matching cards from pool to stockpile
      let newState = { ...state };
      if (hasBarracks) {
        // Barracks: take ALL matching from pool
        const matchingPool = newState.pool.filter(c => getCardDef(c).material === revealedMaterial);
        if (matchingPool.length > 0) {
          newState = {
            ...newState,
            pool: newState.pool.filter(c => getCardDef(c).material !== revealedMaterial),
          };
          newState = updatePlayer(newState, actorId, {
            stockpile: [...newState.players[actorId]!.stockpile, ...matchingPool],
          });
        }
      } else {
        // Normal: take one matching from pool
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
      }

      // Find neighbors who have matching material in hand, filtering out blocked demands
      const neighbors = getNeighborIds(actorId, state.playerCount);
      const counts = { ...(newState.legionaryDemandCounts ?? {}) };
      const demandees: number[] = [];

      for (const nId of neighbors) {
        const neighbor = newState.players[nId]!;
        const hasMatching = neighbor.hand.some(c => !isJackCard(c) && getCardDef(c).material === revealedMaterial);
        if (!hasMatching) continue;

        // Track demand count and check Palisade/Wall blocking
        const key = `${actorId}-${nId}`;
        counts[key] = (counts[key] ?? 0) + 1;
        const blockers = countLegionaryBlockers(neighbor);
        if (isLegionaryDemandBlocked(counts[key]!, blockers)) continue;

        demandees.push(nId);
      }

      newState = { ...newState, legionaryDemandCounts: counts };

      if (demandees.length === 0) {
        // No neighbors to demand from (or all blocked), advance actor
        return advanceActor(newState, phase);
      }

      // Barracks: auto-take all matching cards from all demandees (no choice)
      if (hasBarracks) {
        for (const nId of demandees) {
          const neighbor = newState.players[nId]!;
          const matching = neighbor.hand.filter(c => !isJackCard(c) && getCardDef(c).material === revealedMaterial);
          const remaining = neighbor.hand.filter(c => isJackCard(c) || getCardDef(c).material !== revealedMaterial);
          newState = updatePlayer(newState, nId, { hand: remaining });
          newState = updatePlayer(newState, actorId, {
            stockpile: [...newState.players[actorId]!.stockpile, ...matching],
          });
        }
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

    case 'QUARRY_CRAFTSMAN': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      if (!phase.pendingAbilities?.some(a => a.kind === 'quarry')) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const building = player.buildings[action.buildingIndex];
      if (!building || building.completed) return state;

      const buildingDef = getCardDef(building.foundationCard);

      // Scriptorium: take matching material from pool
      if (action.fromPool) {
        if (!hasCompletedBuilding(player, 'scriptorium')) return state;
        const poolIdx = state.pool.findIndex(c => getCardDef(c).material === buildingDef.material);
        if (poolIdx === -1) return state;
        const poolCard = state.pool[poolIdx]!;
        const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];
        const newBuildings = player.buildings.map((b, i) =>
          i === action.buildingIndex ? { ...b, materials: [...b.materials, poolCard] } : b
        );
        let newState = { ...updatePlayer(state, actorId, { buildings: newBuildings }), pool: newPool };
        newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
        return resolvePendingAbility(newState, 'quarry');
      }

      const { card, newHand } = removeCardFromHand(player, action.cardUid);
      const cardDef = getCardDef(card);
      if (cardDef.material !== buildingDef.material) return state;

      const newBuildings = player.buildings.map((b, i) =>
        i === action.buildingIndex ? { ...b, materials: [...b.materials, card] } : b
      );

      let newState = updatePlayer(state, actorId, { hand: newHand, buildings: newBuildings });
      newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
      return resolvePendingAbility(newState, 'quarry');
    }

    case 'ENCAMPMENT_START': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const encampment = phase.pendingAbilities?.find(a => a.kind === 'encampment');
      if (!encampment || encampment.kind !== 'encampment') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const { card, newHand } = removeCardFromHand(player, action.cardUid);
      const cardDef = getCardDef(card);

      // Must match the encampment's material type
      if (cardDef.material !== encampment.material) return state;
      if (!canStartBuildingOfMaterial(player, cardDef.material, state.sites, state.outOfTownSites)) return state;

      const isOutOfTown = action.outOfTown || requiresOutOfTownSite(cardDef.material, state.sites);

      const newBuilding: Building = {
        foundationCard: card,
        materials: [],
        completed: false,
        outOfTown: isOutOfTown || undefined,
      };

      let newState = updatePlayer(state, actorId, {
        hand: newHand,
        buildings: [...player.buildings, newBuilding],
      });

      if (isOutOfTown) {
        newState = {
          ...newState,
          outOfTownSites: {
            ...newState.outOfTownSites,
            [cardDef.material]: newState.outOfTownSites[cardDef.material] - 1,
          },
        };
      } else {
        newState = {
          ...newState,
          sites: {
            ...newState.sites,
            [cardDef.material]: newState.sites[cardDef.material] - 1,
          },
        };
      }

      const buildingIdx = newState.players[actorId]!.buildings.length - 1;
      newState = completeBuildingIfReady(newState, actorId, buildingIdx);
      return resolvePendingAbility(newState, 'encampment');
    }

    case 'JUNKYARD_ACTIVATE': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      if (!phase.pendingAbilities?.some(a => a.kind === 'junkyard')) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;

      const nonJacks = player.hand.filter(c => !isJackCard(c));
      const jacks = player.hand.filter(c => isJackCard(c));

      let newState: GameState;
      if (action.keepJacks) {
        // Non-jacks to stockpile, keep jacks in hand
        newState = updatePlayer(state, actorId, {
          hand: jacks,
          stockpile: [...player.stockpile, ...nonJacks],
        });
      } else {
        // Non-jacks to stockpile, jacks back to jack pile
        newState = {
          ...updatePlayer(state, actorId, {
            hand: [],
            stockpile: [...player.stockpile, ...nonJacks],
          }),
          jackPile: state.jackPile + jacks.length,
        };
      }

      return resolvePendingAbility(newState, 'junkyard');
    }

    case 'SKIP_ACTION': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      // If pending abilities, skip the current one
      if (phase.pendingAbilities && phase.pendingAbilities.length > 0) {
        const remaining = phase.pendingAbilities.slice(1);
        if (remaining.length > 0) {
          return { ...state, phase: { ...phase, pendingAbilities: remaining } };
        }
        return advanceActor(
          { ...state, phase: { ...phase, pendingAbilities: undefined } },
          phase,
        );
      }
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
    case 'thinkRound':
      return phase.followers[phase.currentFollowerIndex] ?? null;
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
  leadOptions: { role: ActiveRole; cardUid: number; extraCardUids?: number[] }[];
  followOptions: { cardUid: number; extraCardUids?: number[] }[];
  architectOptions: { cardUid: number; outOfTown?: boolean }[];
  architectCraneOptions: { cardUid: number; craneCardUid: number }[];
  craftsmanOptions: { buildingIndex: number; cardUid: number; fromPool?: boolean }[];
  laborerPoolOptions: MaterialType[];
  laborerHandOptions: { cardUid: number }[];
  laborerBuildingOptions: { material: MaterialType; buildingIndex: number; fromPool?: boolean }[];
  merchantOptions: MaterialType[];
  bazaarOptions: MaterialType[];
  vaultFull: boolean;
  patronOptions: MaterialType[];
  legionaryOptions: { cardUid: number }[];
  bridgeLegionaryOptions: { cardUid: number }[];
  legionaryGiveOptions: { cardUid: number }[];
  quarryCraftsmanOptions: { buildingIndex: number; cardUid: number; fromPool?: boolean }[];
  encampmentOptions: { cardUid: number; outOfTown?: boolean }[];
  canJunkyard: boolean;
  hasJacksForJunkyard: boolean;
  pendingAbilityKind: string | null;
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
    architectCraneOptions: [],
    craftsmanOptions: [],
    laborerPoolOptions: [],
    laborerHandOptions: [],
    laborerBuildingOptions: [],
    merchantOptions: [],
    bazaarOptions: [],
    vaultFull: false,
    patronOptions: [],
    legionaryOptions: [],
    bridgeLegionaryOptions: [],
    legionaryGiveOptions: [],
    quarryCraftsmanOptions: [],
    encampmentOptions: [],
    canJunkyard: false,
    hasJacksForJunkyard: false,
    pendingAbilityKind: null,
    canSkip: false,
  };

  const activeId = getActivePlayerId(state);
  if (activeId === null) return result;

  const player = state.players[activeId]!;
  const { phase } = state;

  // Handle pending triggered abilities
  if (phase.type === 'action' && phase.pendingAbilities && phase.pendingAbilities.length > 0) {
    const ability = phase.pendingAbilities[0]!;
    result.canSkip = true;
    result.pendingAbilityKind = ability.kind;

    if (ability.kind === 'quarry') {
      for (let bi = 0; bi < player.buildings.length; bi++) {
        const building = player.buildings[bi]!;
        if (building.completed) continue;
        const buildingDef = getCardDef(building.foundationCard);
        for (const card of player.hand) {
          if (isJackCard(card)) continue;
          if (getCardDef(card).material === buildingDef.material) {
            result.quarryCraftsmanOptions.push({ buildingIndex: bi, cardUid: card.uid });
          }
        }
        // Scriptorium: pool cards
        if (hasCompletedBuilding(player, 'scriptorium')) {
          if (state.pool.some(c => getCardDef(c).material === buildingDef.material)) {
            result.quarryCraftsmanOptions.push({ buildingIndex: bi, cardUid: 0, fromPool: true });
          }
        }
      }
    }

    if (ability.kind === 'encampment') {
      const material = ability.material;
      if (canStartBuildingOfMaterial(player, material, state.sites, state.outOfTownSites)) {
        for (const card of player.hand) {
          if (isJackCard(card)) continue;
          if (getCardDef(card).material === material) {
            const outOfTown = requiresOutOfTownSite(material, state.sites);
            result.encampmentOptions.push({ cardUid: card.uid, outOfTown: outOfTown || undefined });
          }
        }
      }
    }

    if (ability.kind === 'junkyard') {
      result.canJunkyard = true;
      result.hasJacksForJunkyard = player.hand.some(c => isJackCard(c));
    }

    return result;
  }

  if (phase.type === 'lead' || phase.type === 'follow' || phase.type === 'thinkRound') {
    result.canThink = true;
    const effectiveHandLimit = getEffectiveHandLimit(state, activeId);
    const genericMaterials = Object.keys(state.genericSupply) as MaterialType[];
    result.thinkOptions = {
      canRefresh: player.hand.length < effectiveHandLimit && state.deck.length > 0,
      canDraw1: state.deck.length > 0,
      genericMaterials,
      canDrawJack: state.jackPile > 0,
    };
  }

  // Group non-jack cards by material for 3-of-a-kind detection
  const materialGroups: Partial<Record<MaterialType, Card[]>> = {};
  for (const card of player.hand) {
    if (isJackCard(card)) continue;
    const def = getCardDef(card);
    if (!materialGroups[def.material]) materialGroups[def.material] = [];
    materialGroups[def.material]!.push(card);
  }

  const ALL_ROLES: ActiveRole[] = ['Architect', 'Craftsman', 'Laborer', 'Legionary', 'Merchant', 'Patron'];

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

    // 3-of-a-kind: 3 cards of the same material can lead any role
    for (const cards of Object.values(materialGroups)) {
      if (!cards || cards.length < 3) continue;
      for (const card of cards) {
        const others = cards.filter(c => c.uid !== card.uid).slice(0, 2);
        const extraCardUids = others.map(c => c.uid);
        for (const role of ALL_ROLES) {
          result.leadOptions.push({ role, cardUid: card.uid, extraCardUids });
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

    // 3-of-a-kind: 3 cards of the same material can follow any role
    for (const cards of Object.values(materialGroups)) {
      if (!cards || cards.length < 3) continue;
      for (const card of cards) {
        const others = cards.filter(c => c.uid !== card.uid).slice(0, 2);
        const extraCardUids = others.map(c => c.uid);
        result.followOptions.push({ cardUid: card.uid, extraCardUids });
      }
    }
  }

  if (phase.type === 'action') {
    result.canSkip = true;

    if (phase.ledRole === 'Architect') {
      const remaining = countRemainingActions(activeId, phase.actors, phase.currentActorIndex);
      const hasCrane = hasCompletedBuilding(player, 'crane');
      for (const card of player.hand) {
        if (isJackCard(card)) continue; // Jacks can't be used as buildings
        const def = getCardDef(card);
        if (!canStartBuildingOfMaterial(player, def.material, state.sites, state.outOfTownSites)) continue;
        const outOfTown = requiresOutOfTownSite(def.material, state.sites);
        // Out-of-town requires 2 remaining actions
        if (outOfTown && remaining < 2) continue;
        result.architectOptions.push({ cardUid: card.uid, outOfTown: outOfTown || undefined });
      }

      // Crane: start 2 normal (non-out-of-town) buildings as one action
      if (hasCrane) {
        const normalOptions = result.architectOptions.filter(o => !o.outOfTown);
        for (let i = 0; i < normalOptions.length; i++) {
          for (let j = i + 1; j < normalOptions.length; j++) {
            const a = normalOptions[i]!;
            const b = normalOptions[j]!;
            // Can't start 2 buildings of same material (second would be blocked)
            const aDef = getCardDef(player.hand.find(c => c.uid === a.cardUid)!);
            const bDef = getCardDef(player.hand.find(c => c.uid === b.cardUid)!);
            if (aDef.material === bDef.material) continue;
            result.architectCraneOptions.push({
              cardUid: a.cardUid,
              craneCardUid: b.cardUid,
            });
            result.architectCraneOptions.push({
              cardUid: b.cardUid,
              craneCardUid: a.cardUid,
            });
          }
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
        // Scriptorium: pool cards as craftsman materials
        if (hasCompletedBuilding(player, 'scriptorium')) {
          if (state.pool.some(c => getCardDef(c).material === buildingDef.material)) {
            result.craftsmanOptions.push({ buildingIndex: bi, cardUid: 0, fromPool: true });
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

      // Dock: hand to stockpile option
      if (hasCompletedBuilding(player, 'dock')) {
        for (const card of player.hand) {
          if (!isJackCard(card)) {
            result.laborerHandOptions.push({ cardUid: card.uid });
          }
        }
      }

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
        // Scriptorium: pool cards as laborer building materials
        if (hasCompletedBuilding(player, 'scriptorium')) {
          if (state.pool.some(c => getCardDef(c).material === buildingDef.material)) {
            result.laborerBuildingOptions.push({
              material: buildingDef.material,
              buildingIndex: bi,
              fromPool: true,
            });
          }
        }
      }
    }

    if (phase.ledRole === 'Merchant') {
      // Vault capacity is limited by influence
      if (player.vault.length >= player.influence) {
        result.vaultFull = true;
      } else {
        const stockpileMaterialSet = new Set<MaterialType>();
        for (const card of player.stockpile) {
          stockpileMaterialSet.add(getCardDef(card).material);
        }
        result.merchantOptions = [...stockpileMaterialSet];

        // Bazaar: pool to vault
        if (hasCompletedBuilding(player, 'bazaar')) {
          const poolMaterialSet = new Set<MaterialType>();
          for (const card of state.pool) {
            poolMaterialSet.add(getCardDef(card).material);
          }
          result.bazaarOptions = [...poolMaterialSet];
        }
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
      // Bridge: alternative legionary mode — take from opponents' stockpiles
      if (hasCompletedBuilding(player, 'bridge')) {
        for (const card of player.hand) {
          if (!isJackCard(card)) {
            result.bridgeLegionaryOptions.push({ cardUid: card.uid });
          }
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

// --- Victory Point Scoring ---

const ALL_MATERIALS: MaterialType[] = ['Rubble', 'Wood', 'Brick', 'Concrete', 'Stone', 'Marble'];

export interface VaultMaterialVP {
  count: number;
  baseValue: number;      // count * material value
  merchantBonus: number;  // 3 if winning this category, 0 otherwise
}

export interface VPBreakdown {
  influence: number;
  vault: number;
  vaultByMaterial: Partial<Record<MaterialType, VaultMaterialVP>>;
  merchantBonus: number;
  merchantBonusCategories: MaterialType[];
  buildingBonus: number;
  total: number;
}

function hasCompletedBuilding(player: Player, buildingId: string): boolean {
  return player.buildings.some(
    b => b.completed && getCardDef(b.foundationCard).id === buildingId
  );
}

/**
 * Check if a building power is active for a player, accounting for Archway.
 * Archway makes the first incomplete Marble building provide its function.
 * For non-Marble buildings, this is the same as hasCompletedBuilding.
 */
export function hasActiveBuildingPower(player: Player, buildingId: string): boolean {
  if (hasCompletedBuilding(player, buildingId)) return true;

  // Check Archway: does this building definition have Marble material?
  const def = CARD_DEF_MAP[buildingId];
  if (!def || def.material !== 'Marble') return false;

  // Player needs a completed Archway
  if (!hasCompletedBuilding(player, 'archway')) return false;

  // Find the first incomplete Marble building — that's the one Archway activates
  const firstIncompleteMarble = player.buildings.find(
    b => !b.completed && getCardDef(b.foundationCard).material === 'Marble'
  );
  if (!firstIncompleteMarble) return false;

  return getCardDef(firstIncompleteMarble.foundationCard).id === buildingId;
}

export function calculateVP(state: GameState, playerId: number): VPBreakdown {
  const player = state.players[playerId]!;

  // 1. Influence = 1 VP per influence point
  const influence = player.influence;

  // 2. Vault = sum of material values, and 3. Merchant bonus per category
  const vaultCounts: Partial<Record<MaterialType, number>> = {};
  for (const card of player.vault) {
    const mat = getCardDef(card).material;
    vaultCounts[mat] = (vaultCounts[mat] ?? 0) + 1;
  }

  let vault = 0;
  const merchantBonusCategories: MaterialType[] = [];
  const vaultByMaterial: Partial<Record<MaterialType, VaultMaterialVP>> = {};

  for (const mat of ALL_MATERIALS) {
    const myCount = vaultCounts[mat] ?? 0;
    if (myCount === 0) continue;

    const baseValue = myCount * MATERIAL_VALUE[mat];
    vault += baseValue;

    let isBest = true;
    for (const other of state.players) {
      if (other.id === playerId) continue;
      const otherCount = other.vault.filter(c => getCardDef(c).material === mat).length;
      if (otherCount >= myCount) {
        isBest = false;
        break;
      }
    }

    const bonus = isBest ? 3 : 0;
    if (isBest) merchantBonusCategories.push(mat);

    vaultByMaterial[mat] = { count: myCount, baseValue, merchantBonus: bonus };
  }

  const merchantBonus = merchantBonusCategories.length * 3;

  // 4. Building bonuses
  let buildingBonus = 0;
  if (hasCompletedBuilding(player, 'statue')) buildingBonus += 3;
  if (hasCompletedBuilding(player, 'wall')) {
    buildingBonus += Math.floor(player.stockpile.length / 3);
  }
  if (hasCompletedBuilding(player, 'colosseum')) {
    buildingBonus += player.hand.length;
  }

  return {
    influence,
    vault,
    vaultByMaterial,
    merchantBonus,
    merchantBonusCategories,
    buildingBonus,
    total: influence + vault + merchantBonus + buildingBonus,
  };
}
