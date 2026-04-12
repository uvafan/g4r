import {
  GameState, GameAction, Player, Phase, Sites, Building,
  Card, MaterialType, ActiveRole, GenericSupply, ThinkOption, PendingAbility, PlayerRoundStatus,
} from './types';
import { createDeck, getCardDef, CARD_DEF_MAP, MATERIAL_VALUE, MATERIAL_TO_ROLE, RNG, ROLE_TO_MATERIAL, genericDefIdForMaterial, isJackCard } from './cards';

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
  if (hasCompletedBuilding(player, 'shrine')) limit += 2;
  if (hasActiveBuildingPower(player, 'temple')) limit += 3;
  return limit;
}

/** Get clientele capacity for a player, accounting for Garden (doubled) */
export function getClienteleCapacity(player: Player): number {
  const base = player.influence;
  if (hasCompletedBuilding(player, 'garden')) return base * 2;
  return base;
}

/** Check if a material card can be used to build a building of a given material type,
 *  accounting for Road (any material → Stone) and Tower (Rubble → any) */
export function canUseMaterialForBuilding(player: Player, cardMaterial: MaterialType, buildingMaterial: MaterialType): boolean {
  if (cardMaterial === buildingMaterial) return true;
  if (hasCompletedBuilding(player, 'tower') && cardMaterial === 'Rubble') return true;
  if (hasCompletedBuilding(player, 'road') && buildingMaterial === 'Stone') return true;
  return false;
}

function addCardsToPlayer(state: GameState, playerId: number, cards: Card[], deferred: boolean): GameState {
  if (deferred) {
    const existing = state.pendingThinkCards?.[playerId] ?? [];
    return {
      ...state,
      pendingThinkCards: {
        ...state.pendingThinkCards,
        [playerId]: [...existing, ...cards],
      },
    };
  }
  return {
    ...state,
    players: state.players.map(p =>
      p.id === playerId ? { ...p, hand: [...p.hand, ...cards] } : p
    ),
  };
}

function applyThinkOption(state: GameState, playerId: number, option: ThinkOption, deferred: boolean = false): GameState {
  switch (option.kind) {
    case 'refresh': {
      // Draw from deck up to hand limit (minimum 1 if already at/above limit)
      const player = state.players[playerId]!;
      const handLimit = getEffectiveHandLimit(state, playerId);
      const count = player.hand.length < handLimit
        ? handLimit - player.hand.length
        : 1;
      const actualCount = Math.min(count, state.deck.length);
      const drawn = state.deck.slice(0, actualCount);
      const remaining = state.deck.slice(actualCount);
      return addCardsToPlayer({ ...state, deck: remaining }, playerId, drawn, deferred);
    }
    case 'draw1': {
      // Draw exactly 1 from deck
      if (state.deck.length === 0) return state;
      const drawn = state.deck[0]!;
      return addCardsToPlayer({ ...state, deck: state.deck.slice(1) }, playerId, [drawn], deferred);
    }
    case 'generic': {
      // Draw 1 from generic supply of chosen material
      const { material } = option;
      if (state.genericSupply[material] <= 0) return state;
      const newCard: Card = {
        uid: state.nextUid,
        defId: genericDefIdForMaterial(material),
      };
      return addCardsToPlayer({
        ...state,
        nextUid: state.nextUid + 1,
        genericSupply: {
          ...state.genericSupply,
          [material]: state.genericSupply[material] - 1,
        },
      }, playerId, [newCard], deferred);
    }
    case 'jack': {
      if (state.jackPile <= 0) return state;
      const newCard: Card = {
        uid: state.nextUid,
        defId: 'jack',
      };
      return addCardsToPlayer({
        ...state,
        nextUid: state.nextUid + 1,
        jackPile: state.jackPile - 1,
      }, playerId, [newCard], deferred);
    }
  }
}

function setRoundStatus(state: GameState, playerId: number, status: PlayerRoundStatus): GameState {
  return {
    ...state,
    playerRoundStatus: {
      ...state.playerRoundStatus,
      [playerId]: status,
    },
  };
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

  // Ludus Magnus: every 2 Merchant (Stone) clients also count as 1 client of every role
  if (hasActiveBuildingPower(player, 'ludus_magnus')) {
    const merchantCount = player.clientele.filter(c => getCardDef(c).material === 'Stone').length;
    count += Math.floor(merchantCount / 2);
  }

  return count;
}

function buildActorsWithClients(
  state: GameState,
  ledRole: ActiveRole,
  leaderId: number,
  cardActorIds: number[],
): number[] {
  // Count card actions per player (allows duplicates for Palace)
  const cardActionCounts = new Map<number, number>();
  for (const id of cardActorIds) {
    cardActionCounts.set(id, (cardActionCounts.get(id) ?? 0) + 1);
  }
  const actors: number[] = [];

  // Iterate in seat order starting from leader
  for (let i = 0; i < state.playerCount; i++) {
    const playerId = (leaderId + i) % state.playerCount;
    const player = state.players[playerId]!;
    const clientActions = getClientCountForRole(player, ledRole);
    const cardAction = cardActionCounts.get(playerId) ?? 0;
    const totalActions = cardAction + clientActions;

    for (let j = 0; j < totalActions; j++) {
      actors.push(playerId);
    }
  }

  return actors;
}

function distributePendingThinkCards(state: GameState): GameState {
  if (!state.pendingThinkCards) return state;
  let result = state;
  for (const [playerIdStr, cards] of Object.entries(state.pendingThinkCards)) {
    const playerId = Number(playerIdStr);
    result = {
      ...result,
      players: result.players.map(p =>
        p.id === playerId ? { ...p, hand: [...p.hand, ...cards] } : p
      ),
    };
  }
  return { ...result, pendingThinkCards: undefined };
}

function advanceLeader(state: GameState): GameState {
  let withThink = distributePendingThinkCards(state);

  // Sewer: move lead/follow cards to stockpile for Sewer players
  let pendingPool = [...withThink.pendingPool];
  const sewerTracking = withThink.roundLeadFollowCards ?? {};
  for (const [playerIdStr, cards] of Object.entries(sewerTracking)) {
    const playerId = Number(playerIdStr);
    const player = withThink.players[playerId]!;
    if (hasCompletedBuilding(player, 'sewer')) {
      const cardUids = new Set(cards.map(c => c.uid));
      const sewerCards = pendingPool.filter(c => cardUids.has(c.uid));
      pendingPool = pendingPool.filter(c => !cardUids.has(c.uid));
      withThink = updatePlayer(withThink, playerId, {
        stockpile: [...withThink.players[playerId]!.stockpile, ...sewerCards],
      });
    }
  }

  const merged = {
    ...withThink,
    pool: [...withThink.pool, ...pendingPool],
    pendingPool: [],
    playerRoundStatus: undefined,
    legionaryDemandCounts: undefined,
    roundLeadFollowCards: undefined,
  };
  if (merged.deck.length === 0 || merged.gameEndTriggered) {
    return { ...merged, phase: { type: 'gameOver' } };
  }

  // Keep: override leader for next N turns
  if (merged.keepTurnsRemaining && merged.keepTurnsRemaining > 0 && merged.keepLeaderId !== undefined) {
    const nextLeader = merged.keepLeaderId;
    return {
      ...merged,
      leadPlayerIdx: nextLeader,
      keepTurnsRemaining: merged.keepTurnsRemaining - 1,
      keepLeaderId: merged.keepTurnsRemaining - 1 > 0 ? merged.keepLeaderId : undefined,
      phase: { type: 'lead', leaderId: nextLeader },
    };
  }

  const nextLeader = (state.leadPlayerIdx + 1) % state.playerCount;
  return {
    ...merged,
    leadPlayerIdx: nextLeader,
    phase: { type: 'lead', leaderId: nextLeader },
  };
}

/** Helper to advance phase after a think action (extracted for Senate reuse) */
function advanceAfterThink(state: GameState, phase: Phase, _playerId: number): GameState {
  if (phase.type === 'lead') {
    const followers = getFollowerIds(state, (phase as Phase & { type: 'lead' }).leaderId);
    if (followers.length === 0) return advanceLeader(state);
    return { ...state, phase: { type: 'thinkRound', leaderId: (phase as Phase & { type: 'lead' }).leaderId, followers, currentFollowerIndex: 0 } };
  }
  if (phase.type === 'thinkRound') {
    const p = phase as Phase & { type: 'thinkRound' };
    const nextIdx = p.currentFollowerIndex + 1;
    if (nextIdx >= p.followers.length) return advanceLeader(state);
    return { ...state, phase: { ...p, currentFollowerIndex: nextIdx } };
  }
  if (phase.type === 'follow') {
    return advanceFollower(state, phase as Phase & { type: 'follow' });
  }
  return state;
}

function advanceFollower(state: GameState, phase: Phase & { type: 'follow' }): GameState {
  const nextIdx = phase.currentFollowerIndex + 1;
  if (nextIdx >= phase.followers.length) {
    // All followers done, move to action phase
    // Expand actors to include client-produced actions (Palace: leader may have extra card actions)
    const leaderActions = Array(phase.leaderCardCount ?? 1).fill(phase.leaderId) as number[];
    const cardActors = [...leaderActions, ...phase.actors];
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

/** For counted abilities (school, amphitheatre, aqueduct): decrement or resolve */
function resolveCountedAbility(state: GameState, kind: string, remaining: number): GameState {
  if (state.phase.type !== 'action') return state;
  const phase = state.phase;
  const newRemaining = remaining - 1;
  if (newRemaining > 0) {
    // Replace the ability with decremented count
    const pending = phase.pendingAbilities ?? [];
    const idx = pending.findIndex(a => a.kind === kind);
    if (idx === -1) return resolvePendingAbility(state, kind);
    const old = pending[idx]!;
    const updated: PendingAbility = old.kind === 'school'
      ? { ...old, remainingThinks: newRemaining }
      : old.kind === 'amphitheatre'
        ? { ...old, remainingActions: newRemaining }
        : old.kind === 'aqueduct'
          ? { ...old, remainingActions: newRemaining }
          : old;
    const newPending = [...pending.slice(0, idx), updated, ...pending.slice(idx + 1)];
    return { ...state, phase: { ...phase, pendingAbilities: newPending } };
  }
  return resolvePendingAbility(state, kind);
}

/** Circus Maximus: when gaining a client, also gain one of same type from Generic Supply */
function applyCircusMaximusGain(state: GameState, playerId: number, material: MaterialType): GameState {
  const player = state.players[playerId]!;
  if (!hasCompletedBuilding(player, 'circus_maximus')) return state;
  if (player.clientele.length >= getClienteleCapacity(player)) return state;
  if (state.genericSupply[material] <= 0) return state;

  const newCard: Card = { uid: state.nextUid, defId: genericDefIdForMaterial(material) };
  return {
    ...updatePlayer(state, playerId, {
      clientele: [...state.players[playerId]!.clientele, newCard],
    }),
    nextUid: state.nextUid + 1,
    genericSupply: { ...state.genericSupply, [material]: state.genericSupply[material] - 1 },
  };
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
  const cleanedPhase = { ...phase, pendingAbilities: undefined };
  return advanceActor({ ...state, phase: cleanedPhase }, cleanedPhase);
}

function advanceActor(state: GameState, phase: Phase & { type: 'action' }, skip: number = 1): GameState {
  const nextIdx = phase.currentActorIndex + skip;

  // Merge tracking fields from state.phase in case trackCraftsman/trackMerchant updated them
  // after the caller captured `phase` (can't just use state.phase entirely because callers like
  // LEGIONARY_GIVE pass a reconstructed action phase while state.phase is still legionary_demand)
  const sp = state.phase.type === 'action' ? state.phase : phase;

  // Academy: triggers at player transition (not end of all actors) so the think happens
  // before the next player acts. Cards are deferred to pendingThinkCards like lead/follow thinks.
  const currentPlayerId = phase.actors[phase.currentActorIndex]!;
  const nextPlayerId = nextIdx < phase.actors.length ? phase.actors[nextIdx] : undefined;
  if (currentPlayerId !== nextPlayerId) {
    const craftsmen = sp.craftsmanPerformed ?? [];
    if (craftsmen.includes(currentPlayerId) && hasCompletedBuilding(state.players[currentPlayerId]!, 'academy')) {
      // Insert academy slot at nextIdx so it runs before the next player
      const newActors = [...phase.actors.slice(0, nextIdx), currentPlayerId, ...phase.actors.slice(nextIdx)];
      return {
        ...state,
        phase: {
          ...phase, actors: newActors, currentActorIndex: nextIdx,
          pendingAbilities: [{ kind: 'academy' }],
          craftsmanPerformed: craftsmen.filter(id => id !== currentPlayerId),
          merchantPerformed: sp.merchantPerformed,
        },
      };
    }
  }

  if (nextIdx >= phase.actors.length) {
    // Basilica: after any turn with Merchant actions, players with Basilica may vault from hand
    const merchants = sp.merchantPerformed ?? (sp.ledRole === 'Merchant' ? [...new Set(phase.actors)] : []);
    for (const playerId of merchants) {
      const p = state.players[playerId]!;
      if (hasActiveBuildingPower(p, 'basilica') && p.hand.some(c => !isJackCard(c)) && p.vault.length < p.influence) {
        const newActors = [...phase.actors, playerId];
        return {
          ...state,
          phase: {
            ...phase, actors: newActors, currentActorIndex: phase.actors.length,
            pendingAbilities: [{ kind: 'basilica' }], merchantPerformed: [],
          },
        };
      }
    }

    return advanceLeader(state);
  }
  return {
    ...state,
    phase: { ...phase, currentActorIndex: nextIdx, craftsmanPerformed: sp.craftsmanPerformed, merchantPerformed: sp.merchantPerformed },
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

/** Track that a player performed a Craftsman action (for Academy) */
function trackCraftsman(state: GameState, playerId: number): GameState {
  if (state.phase.type !== 'action') return state;
  const phase = state.phase;
  const existing = phase.craftsmanPerformed ?? [];
  if (existing.includes(playerId)) return state;
  return { ...state, phase: { ...phase, craftsmanPerformed: [...existing, playerId] } };
}

/** Track that a player performed a Merchant action (for Basilica) */
function trackMerchant(state: GameState, playerId: number): GameState {
  if (state.phase.type !== 'action') return state;
  const phase = state.phase;
  const existing = phase.merchantPerformed ?? [];
  if (existing.includes(playerId)) return state;
  return { ...state, phase: { ...phase, merchantPerformed: [...existing, playerId] } };
}

/** Track cards used to lead/follow for Sewer */
function trackLeadFollowCards(state: GameState, playerId: number, cards: Card[]): GameState {
  const existing = state.roundLeadFollowCards ?? {};
  const playerCards = existing[playerId] ?? [];
  return { ...state, roundLeadFollowCards: { ...existing, [playerId]: [...playerCards, ...cards] } };
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

  // Villa: +3 extra influence on top of cost-based influence
  const extraInfluenceBonus = def.id === 'villa' ? 3 : 0;

  let newState = updatePlayer(state, playerId, {
    buildings: newBuildings,
    influence: player.influence + def.cost + extraInfluenceBonus,
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
  const pendingAbilities: PendingAbility[] = [];

  const updatedPlayer = newState.players[playerId]!;

  // Circus Maximus: upon completion, choose which existing clients to duplicate
  if (def.id === 'circus_maximus' && updatedPlayer.clientele.length > 0) {
    const clientMaterials = updatedPlayer.clientele.map(c => getCardDef(c).material);
    const hasAnySupply = clientMaterials.some(mat => newState.genericSupply[mat] > 0);
    if (hasAnySupply && updatedPlayer.clientele.length < getClienteleCapacity(updatedPlayer)) {
      pendingAbilities.push({ kind: 'circus_maximus_completion', clientMaterials });
    }
  }

  // Junkyard: upon completion of Junkyard itself
  if (def.id === 'junkyard' && updatedPlayer.hand.length > 0) {
    pendingAbilities.push({ kind: 'junkyard' });
  }

  // Foundry: upon completion, pool and/or hand to stockpile
  if (def.id === 'foundry') {
    const hasPool = newState.pool.length > 0;
    const hasHand = updatedPlayer.hand.some(c => !isJackCard(c));
    if (hasPool || hasHand) {
      pendingAbilities.push({ kind: 'foundry' });
    }
  }

  // School: upon completion, Think once per influence
  if (def.id === 'school' && updatedPlayer.influence > 0) {
    pendingAbilities.push({ kind: 'school', remainingThinks: updatedPlayer.influence });
  }

  // Amphitheatre: upon completion, Craftsman action once per influence
  if (def.id === 'amphitheatre' && updatedPlayer.influence > 0) {
    // Only trigger if there are incomplete buildings with matching materials
    const hasCraftsmanTarget = updatedPlayer.buildings.some(b => {
      if (b.completed) return false;
      const bMat = getCardDef(b.foundationCard).material;
      return updatedPlayer.hand.some(c => !isJackCard(c) && canUseMaterialForBuilding(updatedPlayer, getCardDef(c).material, bMat)) ||
             (hasCompletedBuilding(updatedPlayer, 'scriptorium') &&
              newState.pool.some(c => canUseMaterialForBuilding(updatedPlayer, getCardDef(c).material, bMat)));
    });
    if (hasCraftsmanTarget) {
      pendingAbilities.push({ kind: 'amphitheatre', remainingActions: updatedPlayer.influence });
    }
  }

  // Aqueduct: upon completion, Patron action once per influence
  if (def.id === 'aqueduct' && updatedPlayer.influence > 0) {
    if (updatedPlayer.clientele.length < getClienteleCapacity(updatedPlayer) && newState.pool.length > 0) {
      pendingAbilities.push({ kind: 'aqueduct', remainingActions: updatedPlayer.influence });
    }
  }

  // Quarry: after finishing any structure, may take a Craftsman action
  if (hasCompletedBuilding(updatedPlayer, 'quarry')) {
    const canCraftsman = updatedPlayer.buildings.some(b => {
      if (b.completed) return false;
      const bMat = getCardDef(b.foundationCard).material;
      return updatedPlayer.hand.some(c => !isJackCard(c) && canUseMaterialForBuilding(updatedPlayer, getCardDef(c).material, bMat)) ||
             (hasCompletedBuilding(updatedPlayer, 'scriptorium') &&
              newState.pool.some(c => canUseMaterialForBuilding(updatedPlayer, getCardDef(c).material, bMat)));
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

  // Sanctuary: upon completion, steal a client from any player
  if (def.id === 'sanctuary') {
    const hasStealTarget = newState.players.some(p =>
      p.id !== playerId && p.clientele.length > 0
    ) && updatedPlayer.clientele.length < getClienteleCapacity(updatedPlayer);
    if (hasStealTarget) {
      pendingAbilities.push({ kind: 'sanctuary' });
    }
  }

  // Prison: upon completion, move up to half clients to vault
  if (def.id === 'prison') {
    const maxCount = Math.floor(updatedPlayer.clientele.length / 2);
    if (maxCount > 0 && updatedPlayer.vault.length < updatedPlayer.influence) {
      pendingAbilities.push({ kind: 'prison', maxCount });
    }
  }

  // Keep: upon completion, become leader for next 3 turns
  if (def.id === 'keep') {
    newState = { ...newState, keepTurnsRemaining: 3, keepLeaderId: playerId };
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

      // Latrine: before thinking, optionally discard 1 card to pool
      let preThinkState = state;
      if (action.latrineCardUid !== undefined) {
        const activeId = getActivePlayerId(state);
        if (activeId !== null) {
          const p = state.players[activeId]!;
          if (hasActiveBuildingPower(p, 'latrine')) {
            const cardIdx = p.hand.findIndex(c => c.uid === action.latrineCardUid);
            if (cardIdx !== -1) {
              const card = p.hand[cardIdx]!;
              const newHand = [...p.hand.slice(0, cardIdx), ...p.hand.slice(cardIdx + 1)];
              preThinkState = updatePlayer(state, activeId, { hand: newHand });
              preThinkState = { ...preThinkState, pool: [...preThinkState.pool, card] };
            }
          }
        }
      }

      // Vomitorium: before thinking, optionally discard hand to pool (keep jacks or not)
      let vomState = preThinkState;
      if (action.vomitorium) {
        const activeId = getActivePlayerId(preThinkState);
        if (activeId !== null) {
          const p = preThinkState.players[activeId]!;
          if (hasCompletedBuilding(p, 'vomitorium')) {
            const nonJacks = p.hand.filter(c => !isJackCard(c));
            const jacks = p.hand.filter(c => isJackCard(c));
            if (action.vomitorium.keepJacks) {
              vomState = updatePlayer(preThinkState, activeId, { hand: jacks });
              vomState = { ...vomState, pool: [...vomState.pool, ...nonJacks] };
            } else {
              vomState = updatePlayer(preThinkState, activeId, { hand: [] });
              vomState = { ...vomState, pool: [...vomState.pool, ...nonJacks], jackPile: vomState.jackPile + jacks.length };
            }
          }
        }
      }

      if (phase.type === 'lead') {
        const playerId = phase.leaderId;

        // Senate: multi-step refresh
        if (option.kind === 'refresh' && hasActiveBuildingPower(vomState.players[playerId]!, 'senate')) {
          const p = vomState.players[playerId]!;
          const handLimit = getEffectiveHandLimit(vomState, playerId);
          const count = p.hand.length < handLimit ? handLimit - p.hand.length : 1;
          let newState = setRoundStatus(vomState, playerId, { declaration: 'think', thinkOption: option });
          return { ...newState, senateDrawsRemaining: count, senateDrawPlayerId: playerId, senateDeferred: true };
        }

        // Leader thinks with chosen option, then each follower picks their think option
        let newState = applyThinkOption(vomState, playerId, option, true);
        // Library: after thinking, draw an extra card from deck
        if (hasCompletedBuilding(newState.players[playerId]!, 'library') && newState.deck.length > 0) {
          newState = applyThinkOption(newState, playerId, { kind: 'draw1' }, true);
        }
        newState = setRoundStatus(newState, playerId, { declaration: 'think', thinkOption: option });
        return advanceAfterThink(newState, phase, playerId);
      }

      if (phase.type === 'thinkRound') {
        const followerId = phase.followers[phase.currentFollowerIndex]!;

        // Senate: multi-step refresh
        if (option.kind === 'refresh' && hasActiveBuildingPower(vomState.players[followerId]!, 'senate')) {
          const p = vomState.players[followerId]!;
          const handLimit = getEffectiveHandLimit(vomState, followerId);
          const count = p.hand.length < handLimit ? handLimit - p.hand.length : 1;
          let newState = setRoundStatus(vomState, followerId, { declaration: 'think', thinkOption: option });
          return { ...newState, senateDrawsRemaining: count, senateDrawPlayerId: followerId, senateDeferred: true };
        }

        let newState = applyThinkOption(vomState, followerId, option, true);
        if (hasCompletedBuilding(newState.players[followerId]!, 'library') && newState.deck.length > 0) {
          newState = applyThinkOption(newState, followerId, { kind: 'draw1' }, true);
        }
        newState = setRoundStatus(newState, followerId, { declaration: 'think', thinkOption: option });
        return advanceAfterThink(newState, phase, followerId);
      }

      if (phase.type === 'follow') {
        const followerId = phase.followers[phase.currentFollowerIndex]!;

        // Senate: multi-step refresh
        if (option.kind === 'refresh' && hasActiveBuildingPower(vomState.players[followerId]!, 'senate')) {
          const p = vomState.players[followerId]!;
          const handLimit = getEffectiveHandLimit(vomState, followerId);
          const count = p.hand.length < handLimit ? handLimit - p.hand.length : 1;
          let newState = setRoundStatus(vomState, followerId, { declaration: 'think', thinkOption: option });
          return { ...newState, senateDrawsRemaining: count, senateDrawPlayerId: followerId, senateDeferred: true };
        }

        let newState = applyThinkOption(vomState, followerId, option, true);
        if (hasCompletedBuilding(newState.players[followerId]!, 'library') && newState.deck.length > 0) {
          newState = applyThinkOption(newState, followerId, { kind: 'draw1' }, true);
        }
        newState = setRoundStatus(newState, followerId, { declaration: 'think', thinkOption: option });
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

      // Multi-card lead: 3-of-a-kind (3 same material = wild) or Circus (2 same material = wild)
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
        if (action.palace) {
          // Palace: multiple same-role cards, extra actions per card
          if (!hasActiveBuildingPower(leader, 'palace')) return state;
          if (cardDef.material !== ROLE_TO_MATERIAL[action.role]) return state;
        } else {
          // 3-of-a-kind needs exactly 2 extras; Circus needs exactly 1 extra
          if (extraCards.length === 1 && !hasCompletedBuilding(leader, 'circus')) return state;
          if (extraCards.length !== 1 && extraCards.length !== 2) return state;
        }

        const allCards = [card, ...extraCards];
        let newState = updatePlayer(state, phase.leaderId, { hand });
        newState = { ...newState, pendingPool: [...newState.pendingPool, ...allCards] };
        newState = trackLeadFollowCards(newState, phase.leaderId, allCards);
        newState = setRoundStatus(newState, phase.leaderId, { declaration: 'lead', role: action.role });

        const palaceCount = action.palace ? 1 + extraCards.length : undefined;
        const followers = getFollowerIds(state, phase.leaderId);
        if (followers.length === 0) {
          const la = Array(palaceCount ?? 1).fill(phase.leaderId) as number[];
          const actors = buildActorsWithClients(newState, action.role, phase.leaderId, la);
          return { ...newState, phase: { type: 'action', ledRole: action.role, actors, currentActorIndex: 0 } };
        }
        return {
          ...newState,
          phase: { type: 'follow', leaderId: phase.leaderId, ledRole: action.role,
            currentFollowerIndex: 0, followers, actors: [], leaderCardCount: palaceCount },
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
        newState = trackLeadFollowCards(newState, phase.leaderId, [card]);
      }
      newState = setRoundStatus(newState, phase.leaderId, { declaration: 'lead', role: action.role });

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

      // Multi-card follow: 3-of-a-kind, Circus, or Palace
      if (action.extraCardUids && action.extraCardUids.length > 0) {
        const cardDef = getCardDef(card);
        let hand = newHand;
        const extraCards: Card[] = [];
        for (const uid of action.extraCardUids) {
          const result = removeCardFromHand({ ...follower, hand } as Player, uid);
          extraCards.push(result.card);
          hand = result.newHand;
        }
        if (isJackCard(card)) return state;
        for (const ec of extraCards) {
          if (isJackCard(ec) || getCardDef(ec).material !== cardDef.material) return state;
        }
        if (action.palace) {
          if (!hasActiveBuildingPower(follower, 'palace')) return state;
          if (cardDef.material !== ROLE_TO_MATERIAL[phase.ledRole]) return state;
        } else {
          if (extraCards.length === 1 && !hasCompletedBuilding(follower, 'circus')) return state;
          if (extraCards.length !== 1 && extraCards.length !== 2) return state;
        }

        const allCards = [card, ...extraCards];
        let newState = updatePlayer(state, followerId, { hand });
        newState = { ...newState, pendingPool: [...newState.pendingPool, ...allCards] };
        newState = trackLeadFollowCards(newState, followerId, allCards);
        newState = setRoundStatus(newState, followerId, { declaration: 'follow', role: phase.ledRole });
        // Palace: add follower multiple times for extra actions
        const numEntries = action.palace ? 1 + extraCards.length : 1;
        const newActors = [...phase.actors, ...Array(numEntries).fill(followerId)];
        const newPhase = { ...phase, actors: newActors };
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
        newState = trackLeadFollowCards(newState, followerId, [card]);
      }
      newState = setRoundStatus(newState, followerId, { declaration: 'follow', role: phase.ledRole });

      const newPhase = { ...phase, actors: [...phase.actors, followerId] };
      return advanceFollower(newState, newPhase);
    }

    case 'ARCHITECT_START': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBathArchitect = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Architect');
      if (phase.ledRole !== 'Architect' && !isBathArchitect) return state;

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

      // Tower: out-of-town is free (costs 1 action like normal)
      const towerFreeOOT = hasCompletedBuilding(player, 'tower');
      // Out-of-town requires 2 actions — validate the player has enough remaining (unless Tower)
      if (isOutOfTown && !towerFreeOOT) {
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

      // Out-of-town costs 2 actions, normal costs 1 (Tower makes OOT free)
      const ootCost = (isOutOfTown && !towerFreeOOT) ? 2 : 1;
      if (isBathArchitect) return resolvePendingAbility(newState, 'bath');
      if (hasPendingAbilities(newState)) return newState;
      return advanceActor(newState, phase, ootCost);
    }

    case 'CRAFTSMAN_ADD': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBath = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Craftsman');
      if (phase.ledRole !== 'Craftsman' && !isBath) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const building = player.buildings[action.buildingIndex];
      if (!building || building.completed) return state;

      const buildingDef = getCardDef(building.foundationCard);

      // Scriptorium: take matching material from pool instead of hand
      if (action.fromPool) {
        if (!hasCompletedBuilding(player, 'scriptorium')) return state;
        const poolIdx = state.pool.findIndex(c =>
          canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material)
        );
        if (poolIdx === -1) return state;
        const poolCard = state.pool[poolIdx]!;
        const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];
        const newBuildings = player.buildings.map((b, i) =>
          i === action.buildingIndex ? { ...b, materials: [...b.materials, poolCard] } : b
        );
        let newState = { ...updatePlayer(state, actorId, { buildings: newBuildings }), pool: newPool };
        newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
        newState = trackCraftsman(newState, actorId);
        if (isBath) return resolvePendingAbility(newState, 'bath');
        if (hasPendingAbilities(newState)) return newState;
        return advanceActor(newState, phase);
      }

      const { card, newHand } = removeCardFromHand(player, action.cardUid);
      const cardDef = getCardDef(card);

      // Validate: material must match (Road/Tower accounted for)
      if (!canUseMaterialForBuilding(player, cardDef.material, buildingDef.material)) return state;

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
      newState = trackCraftsman(newState, actorId);
      if (isBath) return resolvePendingAbility(newState, 'bath');
      if (hasPendingAbilities(newState)) return newState;
      return advanceActor(newState, phase);
    }

    case 'LABORER_POOL_TO_STOCKPILE': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBathLabPool = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Laborer');
      if (phase.ledRole !== 'Laborer' && !isBathLabPool) return state;
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

      if (isBathLabPool) return resolvePendingAbility(newState, 'bath');
      return advanceActor(newState, phase);
    }

    case 'LABORER_HAND_TO_STOCKPILE': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBathLabHand = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Laborer');
      if (phase.ledRole !== 'Laborer' && !isBathLabHand) return state;

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

      if (isBathLabHand) return resolvePendingAbility(newState, 'bath');
      return advanceActor(newState, phase);
    }

    case 'LABORER_STOCKPILE_TO_BUILDING': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBathLaborer = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Laborer');
      if (phase.ledRole !== 'Laborer' && !isBathLaborer) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const building = player.buildings[action.buildingIndex];
      if (!building || building.completed) return state;

      const buildingDef = getCardDef(building.foundationCard);
      if (!canUseMaterialForBuilding(player, action.material, buildingDef.material)) return state;

      // Scriptorium: take matching material from pool instead of stockpile
      if (action.fromPool) {
        if (!hasCompletedBuilding(player, 'scriptorium')) return state;
        const poolIdx = state.pool.findIndex(c =>
          canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material)
        );
        if (poolIdx === -1) return state;
        const poolCard = state.pool[poolIdx]!;
        const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];
        const newBuildings = player.buildings.map((b, i) =>
          i === action.buildingIndex ? { ...b, materials: [...b.materials, poolCard] } : b
        );
        let newState = { ...updatePlayer(state, actorId, { buildings: newBuildings }), pool: newPool };
        newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
        if (isBathLaborer) return resolvePendingAbility(newState, 'bath');
        if (hasPendingAbilities(newState)) return newState;
        return advanceActor(newState, phase);
      }

      const stockpileIdx = player.stockpile.findIndex(
        c => canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material)
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
      if (isBathLaborer) return resolvePendingAbility(newState, 'bath');
      if (hasPendingAbilities(newState)) return newState;
      return advanceActor(newState, phase);
    }

    case 'MERCHANT_STOCKPILE_TO_VAULT': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBathMerchant = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Merchant');
      if (phase.ledRole !== 'Merchant' && !isBathMerchant) return state;

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
        let newState = {
          ...updatePlayer(state, actorId, {
            vault: [...player.vault, poolCard],
          }),
          pool: newPool,
        };
        newState = trackMerchant(newState, actorId);
        if (isBathMerchant) return resolvePendingAbility(newState, 'bath');
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

      let newState = updatePlayer(state, actorId, {
        stockpile: newStockpile,
        vault: [...player.vault, card],
      });
      newState = trackMerchant(newState, actorId);

      if (isBathMerchant) return resolvePendingAbility(newState, 'bath');
      return advanceActor(newState, phase);
    }

    case 'ATRIUM_MERCHANT': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBathMerchant = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Merchant');
      if (phase.ledRole !== 'Merchant' && !isBathMerchant) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      if (!hasCompletedBuilding(player, 'atrium')) return state;
      if (player.vault.length >= player.influence) return state;
      if (state.deck.length === 0) return state;

      // Take top card from deck, put face-down into vault
      const topCard = state.deck[0]!;
      const faceDownCard = { ...topCard, faceDown: true as const };
      let newState = {
        ...updatePlayer(state, actorId, {
          vault: [...player.vault, faceDownCard],
        }),
        deck: state.deck.slice(1),
      };
      newState = trackMerchant(newState, actorId);

      if (isBathMerchant) return resolvePendingAbility(newState, 'bath');
      return advanceActor(newState, phase);
    }

    case 'LEGIONARY_REVEAL': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBathLegionary = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Legionary');
      if (phase.ledRole !== 'Legionary' && !isBathLegionary) return state;

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

        if (isBathLegionary) return resolvePendingAbility(newState, 'bath');
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
        if (isBathLegionary) return resolvePendingAbility(newState, 'bath');
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
        if (isBathLegionary) return resolvePendingAbility(newState, 'bath');
        return advanceActor(newState, phase);
      }

      // Enter legionary_demand phase — preserve pending abilities for return
      return {
        ...newState,
        phase: {
          type: 'legionary_demand',
          revealedMaterial,
          demandees,
          currentDemandeeIndex: 0,
          actionActors: phase.actors,
          actionCurrentActorIndex: phase.currentActorIndex,
          actionPendingAbilities: phase.pendingAbilities,
          actionCraftsmanPerformed: phase.craftsmanPerformed,
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
        // Return to action phase — restore pending abilities
        const actionPhase: Phase & { type: 'action' } = {
          type: 'action',
          ledRole: phase.actionPendingAbilities?.some(a => a.kind === 'bath') ? 'Patron' as ActiveRole : 'Legionary',
          actors: phase.actionActors,
          currentActorIndex: phase.actionCurrentActorIndex,
          pendingAbilities: phase.actionPendingAbilities,
          craftsmanPerformed: phase.actionCraftsmanPerformed,
        };
        // If returning from bath-legionary, resolve the bath ability
        if (phase.actionPendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Legionary')) {
          return resolvePendingAbility({ ...newState, phase: actionPhase }, 'bath');
        }
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
      if (player.clientele.length >= getClienteleCapacity(player)) return state;

      const poolIdx = state.pool.findIndex(c => getCardDef(c).material === action.material);
      if (poolIdx === -1) return state;

      const card = state.pool[poolIdx]!;
      const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];

      let newState = {
        ...updatePlayer(state, actorId, {
          clientele: [...player.clientele, card],
        }),
        pool: newPool,
      };

      // Circus Maximus: gain extra client from Generic Supply (opt-in)
      if (action.circusMaximus) {
        newState = applyCircusMaximusGain(newState, actorId, action.material);
      }

      // Post-Patron triggers
      const postPatronAbilities: PendingAbility[] = [];
      const updatedPlayer = newState.players[actorId]!;

      // Stage: after Patron, may Think
      if (hasCompletedBuilding(updatedPlayer, 'stage')) {
        postPatronAbilities.push({ kind: 'stage' });
      }

      // Bar: after Patron, may flip top of deck → clientele or pool
      if (hasCompletedBuilding(updatedPlayer, 'bar') && newState.deck.length > 0) {
        postPatronAbilities.push({ kind: 'bar', revealedCard: null });
      }

      // Bath: after Patron, hired client acts (unless Patron)
      if (hasCompletedBuilding(updatedPlayer, 'bath')) {
        const hiredRole = MATERIAL_TO_ROLE[action.material] as ActiveRole;
        if (hiredRole !== 'Patron') {
          postPatronAbilities.push({ kind: 'bath', role: hiredRole });
        }
      }

      if (postPatronAbilities.length > 0) {
        const existing = phase.pendingAbilities ?? [];
        return {
          ...newState,
          phase: { ...phase, pendingAbilities: [...existing, ...postPatronAbilities] },
        };
      }

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
        const poolIdx = state.pool.findIndex(c =>
          canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material)
        );
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
      if (!canUseMaterialForBuilding(player, cardDef.material, buildingDef.material)) return state;

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

    case 'FOUNDRY_ACTIVATE': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      if (!phase.pendingAbilities?.some(a => a.kind === 'foundry')) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      let newState: GameState = state;

      if (action.takePool) {
        // Move entire pool to stockpile
        newState = updatePlayer(newState, actorId, {
          stockpile: [...newState.players[actorId]!.stockpile, ...newState.pool],
        });
        newState = { ...newState, pool: [] };
      }

      if (action.takeHand) {
        const p = newState.players[actorId]!;
        const nonJacks = p.hand.filter(c => !isJackCard(c));
        const jacks = p.hand.filter(c => isJackCard(c));
        // Non-jacks to stockpile, Jacks returned to jack pile
        newState = updatePlayer(newState, actorId, {
          hand: [],
          stockpile: [...newState.players[actorId]!.stockpile, ...nonJacks],
        });
        newState = { ...newState, jackPile: newState.jackPile + jacks.length };
      }

      return resolvePendingAbility(newState, 'foundry');
    }

    case 'ABILITY_THINK': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const pending = phase.pendingAbilities?.[0];
      if (!pending) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;

      if (pending.kind === 'school') {
        let newState = applyThinkOption(state, actorId, action.option);
        const remaining = pending.remainingThinks - 1;
        if (remaining > 0) {
          // Replace the school ability with decremented count
          const newPending = [{ kind: 'school' as const, remainingThinks: remaining }, ...(phase.pendingAbilities?.slice(1) ?? [])];
          return { ...newState, phase: { ...phase, pendingAbilities: newPending } };
        }
        return resolvePendingAbility(newState, 'school');
      }

      if (pending.kind === 'stage') {
        const newState = applyThinkOption(state, actorId, action.option);
        return resolvePendingAbility(newState, 'stage');
      }

      if (pending.kind === 'academy') {
        // Deferred: cards go to pendingThinkCards until advanceLeader distributes them
        const newState = applyThinkOption(state, actorId, action.option, true);
        return resolvePendingAbility(newState, 'academy');
      }

      return state;
    }

    case 'ABILITY_CRAFTSMAN': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const pending = phase.pendingAbilities?.[0];
      if (!pending || pending.kind !== 'amphitheatre') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const building = player.buildings[action.buildingIndex];
      if (!building || building.completed) return state;

      const buildingDef = getCardDef(building.foundationCard);

      // Scriptorium: pool material
      if (action.fromPool) {
        if (!hasCompletedBuilding(player, 'scriptorium')) return state;
        const poolIdx = state.pool.findIndex(c =>
          canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material)
        );
        if (poolIdx === -1) return state;
        const poolCard = state.pool[poolIdx]!;
        const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];
        const newBuildings = player.buildings.map((b, i) =>
          i === action.buildingIndex ? { ...b, materials: [...b.materials, poolCard] } : b
        );
        let newState = { ...updatePlayer(state, actorId, { buildings: newBuildings }), pool: newPool };
        newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
        newState = trackCraftsman(newState, actorId);
        return resolveCountedAbility(newState, 'amphitheatre', pending.remainingActions);
      }

      const { card, newHand } = removeCardFromHand(player, action.cardUid);
      if (!canUseMaterialForBuilding(player, getCardDef(card).material, buildingDef.material)) return state;

      const newBuildings = player.buildings.map((b, i) =>
        i === action.buildingIndex ? { ...b, materials: [...b.materials, card] } : b
      );
      let newState = updatePlayer(state, actorId, { hand: newHand, buildings: newBuildings });
      newState = completeBuildingIfReady(newState, actorId, action.buildingIndex);
      newState = trackCraftsman(newState, actorId);
      return resolveCountedAbility(newState, 'amphitheatre', pending.remainingActions);
    }

    case 'ABILITY_PATRON': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const pending = phase.pendingAbilities?.[0];
      if (!pending || pending.kind !== 'aqueduct') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;

      if (player.clientele.length >= getClienteleCapacity(player)) return state;
      const poolIdx = state.pool.findIndex(c => getCardDef(c).material === action.material);
      if (poolIdx === -1) return state;

      const card = state.pool[poolIdx]!;
      const newPool = [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)];

      let newState = {
        ...updatePlayer(state, actorId, {
          clientele: [...player.clientele, card],
        }),
        pool: newPool,
      };

      // Circus Maximus: gain extra client from generic supply (opt-in)
      if (action.circusMaximus) {
        newState = applyCircusMaximusGain(newState, actorId, getCardDef(card).material);
      }

      return resolveCountedAbility(newState, 'aqueduct', pending.remainingActions);
    }

    case 'BAR_FLIP': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const pending = phase.pendingAbilities?.[0];
      if (!pending || pending.kind !== 'bar' || pending.revealedCard !== null) return state;
      if (state.deck.length === 0) return state;

      const revealedCard = state.deck[0]!;
      const newPending = [{ kind: 'bar' as const, revealedCard }, ...(phase.pendingAbilities?.slice(1) ?? [])];
      return { ...state, phase: { ...phase, pendingAbilities: newPending } };
    }

    case 'BAR_CHOOSE': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const pending = phase.pendingAbilities?.[0];
      if (!pending || pending.kind !== 'bar' || !pending.revealedCard) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const revealedCard = pending.revealedCard;

      let newState: GameState;
      if (action.toClientele && player.clientele.length < getClienteleCapacity(player)) {
        // Put into clientele
        newState = {
          ...updatePlayer(state, actorId, {
            clientele: [...player.clientele, revealedCard],
          }),
          deck: state.deck.slice(1),
        };
        // Circus Maximus for bar-gained client (opt-in)
        if (action.circusMaximus) {
          newState = applyCircusMaximusGain(newState, actorId, getCardDef(revealedCard).material);
        }
      } else {
        // Put into pool
        newState = {
          ...state,
          pool: [...state.pool, revealedCard],
          deck: state.deck.slice(1),
        };
      }

      return resolvePendingAbility(newState, 'bar');
    }

    case 'CIRCUS_MAXIMUS_CHOOSE': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const pending = phase.pendingAbilities?.[0];
      if (!pending || pending.kind !== 'circus_maximus_completion') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      let newState = state;

      // Validate: each chosen material must be available in the pending list and generic supply
      const remainingMaterials = [...pending.clientMaterials];
      const supplyCopy = { ...newState.genericSupply };
      let player = newState.players[actorId]!;

      for (const mat of action.materials) {
        const idx = remainingMaterials.indexOf(mat);
        if (idx === -1) return state; // invalid choice
        if (supplyCopy[mat] <= 0) return state;
        if (player.clientele.length >= getClienteleCapacity(player)) break;
        remainingMaterials.splice(idx, 1);
        supplyCopy[mat]--;

        const newCard: Card = { uid: newState.nextUid, defId: genericDefIdForMaterial(mat) };
        newState = {
          ...updatePlayer(newState, actorId, {
            clientele: [...newState.players[actorId]!.clientele, newCard],
          }),
          nextUid: newState.nextUid + 1,
          genericSupply: { ...supplyCopy },
        };
        player = newState.players[actorId]!;
      }

      return resolvePendingAbility(newState, 'circus_maximus_completion');
    }

    case 'SANCTUARY_STEAL': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      if (!phase.pendingAbilities?.some(a => a.kind === 'sanctuary')) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      if (player.clientele.length >= getClienteleCapacity(player)) return state;

      const target = state.players[action.targetPlayerId];
      if (!target || action.targetPlayerId === actorId) return state;
      const clientIdx = target.clientele.findIndex(c => getCardDef(c).material === action.material);
      if (clientIdx === -1) return state;

      const stolenCard = target.clientele[clientIdx]!;
      let newState = updatePlayer(state, action.targetPlayerId, {
        clientele: [...target.clientele.slice(0, clientIdx), ...target.clientele.slice(clientIdx + 1)],
      });
      newState = updatePlayer(newState, actorId, {
        clientele: [...newState.players[actorId]!.clientele, stolenCard],
      });
      return resolvePendingAbility(newState, 'sanctuary');
    }

    case 'PRISON_MOVE': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const pending = phase.pendingAbilities?.find(a => a.kind === 'prison');
      if (!pending || pending.kind !== 'prison') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      if (action.cardUids.length > pending.maxCount) return state;

      // Vault capacity check
      const availableVault = player.influence - player.vault.length;
      if (action.cardUids.length > availableVault) return state;

      const uidSet = new Set(action.cardUids);
      const toVault = player.clientele.filter(c => uidSet.has(c.uid));
      if (toVault.length !== action.cardUids.length) return state;

      const newState = updatePlayer(state, actorId, {
        clientele: player.clientele.filter(c => !uidSet.has(c.uid)),
        vault: [...player.vault, ...toVault],
      });
      return resolvePendingAbility(newState, 'prison');
    }

    case 'BASILICA_VAULT': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      if (!phase.pendingAbilities?.some(a => a.kind === 'basilica')) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      if (player.vault.length >= player.influence) return state;

      const { card, newHand } = removeCardFromHand(player, action.cardUid);
      if (isJackCard(card)) return state;

      const newState = updatePlayer(state, actorId, {
        hand: newHand,
        vault: [...player.vault, card],
      });
      return resolvePendingAbility(newState, 'basilica');
    }

    case 'FOUNTAIN_FLIP': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isBathCraftsman = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Craftsman');
      if (phase.ledRole !== 'Craftsman' && !isBathCraftsman) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      if (!hasActiveBuildingPower(player, 'fountain')) return state;
      if (state.deck.length === 0) return state;

      const flippedCard = state.deck[0]!;
      const newDeck = state.deck.slice(1);
      const existing = phase.pendingAbilities ?? [];
      return {
        ...state,
        deck: newDeck,
        phase: { ...phase, pendingAbilities: [...existing, { kind: 'fountain', flippedCard }] },
      };
    }

    case 'FOUNTAIN_CHOOSE': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const pending = phase.pendingAbilities?.find(a => a.kind === 'fountain');
      if (!pending || pending.kind !== 'fountain') return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      const flippedCard = pending.flippedCard;

      if (action.buildingIndex !== undefined) {
        // Use as material for a building
        const building = player.buildings[action.buildingIndex];
        if (!building || building.completed) return state;
        const buildingDef = getCardDef(building.foundationCard);
        if (!canUseMaterialForBuilding(player, getCardDef(flippedCard).material, buildingDef.material)) return state;

        const newBuildings = player.buildings.map((b, i) =>
          i === action.buildingIndex ? { ...b, materials: [...b.materials, flippedCard] } : b
        );
        let newState = updatePlayer(state, actorId, { buildings: newBuildings });
        newState = completeBuildingIfReady(newState, actorId, action.buildingIndex!);
        newState = trackCraftsman(newState, actorId);
        return resolvePendingAbility(newState, 'fountain');
      } else {
        // Put into hand
        const newState = updatePlayer(state, actorId, {
          hand: [...player.hand, flippedCard],
        });
        newState.phase = { ...phase }; // keep phase
        return resolvePendingAbility(newState, 'fountain');
      }
    }

    case 'STAIRWAY_ADD': {
      const { phase } = state;
      if (phase.type !== 'action') return state;
      const isLaborer = phase.ledRole === 'Laborer';
      const isCraftsman = phase.ledRole === 'Craftsman';
      const isBathCraftsman = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Craftsman');
      const isBathLaborer = phase.pendingAbilities?.some(a => a.kind === 'bath' && a.role === 'Laborer');
      if (!isCraftsman && !isLaborer && !isBathCraftsman && !isBathLaborer) return state;

      const actorId = phase.actors[phase.currentActorIndex]!;
      const player = state.players[actorId]!;
      if (!hasActiveBuildingPower(player, 'stairway')) return state;

      const target = state.players[action.targetPlayerId];
      if (!target || action.targetPlayerId === actorId) return state;
      const building = target.buildings[action.buildingIndex];
      if (!building || !building.completed) return state;

      const buildingDef = getCardDef(building.foundationCard);

      // Get the material card
      let materialCard: Card;
      let newState: GameState = state;

      if (action.fromPool) {
        if (!hasCompletedBuilding(player, 'scriptorium')) return state;
        const poolIdx = state.pool.findIndex(c => canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material));
        if (poolIdx === -1) return state;
        materialCard = state.pool[poolIdx]!;
        newState = { ...state, pool: [...state.pool.slice(0, poolIdx), ...state.pool.slice(poolIdx + 1)] };
      } else if (action.fromStockpile) {
        const stockIdx = player.stockpile.findIndex(c => canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material));
        if (stockIdx === -1) return state;
        materialCard = player.stockpile[stockIdx]!;
        newState = updatePlayer(state, actorId, {
          stockpile: [...player.stockpile.slice(0, stockIdx), ...player.stockpile.slice(stockIdx + 1)],
        });
      } else {
        const result = removeCardFromHand(player, action.cardUid);
        materialCard = result.card;
        if (!canUseMaterialForBuilding(player, getCardDef(materialCard).material, buildingDef.material)) return state;
        newState = updatePlayer(state, actorId, { hand: result.newHand });
      }

      // Add material to target's building and mark as shared
      const newBuildings = target.buildings.map((b, i) =>
        i === action.buildingIndex ? { ...b, materials: [...b.materials, materialCard], shared: true } : b
      );
      newState = updatePlayer(newState, action.targetPlayerId, { buildings: newBuildings });

      if (isCraftsman) newState = trackCraftsman(newState, actorId);
      if (isBathCraftsman || isBathLaborer) return resolvePendingAbility(newState, 'bath');
      return advanceActor(newState, phase);
    }

    case 'SENATE_DRAW': {
      if (!state.senateDrawsRemaining || state.senateDrawsRemaining <= 0 || state.senateDrawPlayerId === undefined) return state;

      const playerId = state.senateDrawPlayerId;
      const deferred = state.senateDeferred ?? true;

      // Apply the chosen draw (draw1, jack, or generic)
      let newState = applyThinkOption(state, playerId, action.option, deferred);

      // Library: after each senate draw... no, Library triggers once per think, not per draw
      const remaining = state.senateDrawsRemaining - 1;
      if (remaining <= 0) {
        // Senate draws complete — apply Library bonus and advance
        if (hasCompletedBuilding(newState.players[playerId]!, 'library') && newState.deck.length > 0) {
          newState = applyThinkOption(newState, playerId, { kind: 'draw1' }, deferred);
        }
        newState = { ...newState, senateDrawsRemaining: undefined, senateDrawPlayerId: undefined, senateDeferred: undefined };
        return advanceAfterThink(newState, state.phase, playerId);
      }

      return { ...newState, senateDrawsRemaining: remaining };
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

      // Patron skip: still trigger post-Patron abilities (Bar, Stage)
      if (phase.ledRole === 'Patron') {
        const actorId = phase.actors[phase.currentActorIndex]!;
        const player = state.players[actorId]!;
        const postPatronAbilities: PendingAbility[] = [];

        if (hasCompletedBuilding(player, 'stage')) {
          postPatronAbilities.push({ kind: 'stage' });
        }
        if (hasCompletedBuilding(player, 'bar') && state.deck.length > 0) {
          postPatronAbilities.push({ kind: 'bar', revealedCard: null });
        }

        if (postPatronAbilities.length > 0) {
          return {
            ...state,
            phase: { ...phase, pendingAbilities: postPatronAbilities },
          };
        }
      }

      return advanceActor(state, phase);
    }

    default:
      return state;
  }
}

// Returns the player whose turn it is to act
export function getActivePlayerId(state: GameState): number | null {
  // Senate: during multi-step refresh, the senate drawer is active
  if (state.senateDrawsRemaining && state.senateDrawsRemaining > 0 && state.senateDrawPlayerId !== undefined) {
    return state.senateDrawPlayerId;
  }
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

/** Get the led role for the current round, if known */
export function getLedRole(state: GameState): ActiveRole | null {
  const { phase } = state;
  if (phase.type === 'follow') return phase.ledRole;
  if (phase.type === 'action') return phase.ledRole;
  if (phase.type === 'legionary_demand') {
    // The led role is Legionary during demand phase
    return 'Legionary';
  }
  return null;
}

/** Get the expected action count for a player this round (null if not yet determinable) */
export function getPlayerActionCount(state: GameState, playerId: number): number | null {
  const ledRole = getLedRole(state);
  if (!ledRole) return null;
  const status = state.playerRoundStatus?.[playerId];
  if (!status) return null;
  const player = state.players[playerId]!;
  const clientActions = getClientCountForRole(player, ledRole);
  const cardAction = status.declaration === 'think' ? 0 : 1;
  return cardAction + clientActions;
}

/** Get the number of pending think cards for a player */
export function getPendingThinkCardCount(state: GameState, playerId: number): number {
  return state.pendingThinkCards?.[playerId]?.length ?? 0;
}

export function getPendingThinkCards(state: GameState, playerId: number): Card[] {
  return state.pendingThinkCards?.[playerId] ?? [];
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
  vomitoriumAvailable: boolean;
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
  atriumAvailable: boolean;
  vaultFull: boolean;
  patronOptions: MaterialType[];
  legionaryOptions: { cardUid: number }[];
  bridgeLegionaryOptions: { cardUid: number }[];
  legionaryGiveOptions: { cardUid: number }[];
  quarryCraftsmanOptions: { buildingIndex: number; cardUid: number; fromPool?: boolean }[];
  encampmentOptions: { cardUid: number; outOfTown?: boolean }[];
  canJunkyard: boolean;
  hasJacksForJunkyard: boolean;
  // On-completion and post-action pending abilities
  canFoundry: boolean;
  foundryHasPool: boolean;
  foundryHasHand: boolean;
  abilityThinkOptions: ThinkOptions;
  remainingAbilityThinks: number | null;
  abilityCraftsmanOptions: { buildingIndex: number; cardUid: number; fromPool?: boolean }[];
  abilityPatronOptions: MaterialType[];
  barCanFlip: boolean;
  barRevealedCard: Card | null;
  barCanClientele: boolean;
  bathRole: ActiveRole | null;
  pendingAbilityKind: string | null;
  canSkip: boolean;
  latrineAvailable: boolean;
  sanctuaryOptions: { targetPlayerId: number; material: MaterialType }[];
  prisonMaxCount: number;
  prisonOptions: { cardUid: number }[];
  basilicaOptions: { cardUid: number }[];
  fountainAvailable: boolean;
  fountainFlippedCard: Card | null;
  fountainBuildingOptions: number[];
  stairwayOptions: { targetPlayerId: number; buildingIndex: number; cardUid: number; fromPool?: boolean; fromStockpile?: boolean }[];
  palaceLeadOptions: { role: ActiveRole; cardUid: number; extraCardUids: number[] }[];
  palaceFollowOptions: { cardUid: number; extraCardUids: number[] }[];
  senateDrawsRemaining: number;
  senateDrawOptions: ThinkOptions;
  circusMaximusAvailable: boolean;
  circusMaximusCompletionMaterials: MaterialType[];
  circusMaximusCompletionSlots: number;
}

/** Populate craftsman options for a player — reused by normal Craftsman, Quarry, Amphitheatre, Bath */
function populateCraftsmanOptions(
  player: Player,
  state: GameState,
  options: { buildingIndex: number; cardUid: number; fromPool?: boolean }[],
) {
  for (let bi = 0; bi < player.buildings.length; bi++) {
    const building = player.buildings[bi]!;
    if (building.completed) continue;
    const buildingDef = getCardDef(building.foundationCard);
    for (const card of player.hand) {
      if (isJackCard(card)) continue;
      const def = getCardDef(card);
      if (canUseMaterialForBuilding(player, def.material, buildingDef.material)) {
        options.push({ buildingIndex: bi, cardUid: card.uid });
      }
    }
    // Scriptorium: pool cards as craftsman materials
    if (hasCompletedBuilding(player, 'scriptorium')) {
      if (state.pool.some(c => canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material))) {
        options.push({ buildingIndex: bi, cardUid: 0, fromPool: true });
      }
    }
  }
}

/** Populate laborer building options (stockpile/pool to building) — reused by Laborer and Bath */
function populateLaborerBuildingOptions(
  player: Player,
  state: GameState,
  options: { material: MaterialType; buildingIndex: number; fromPool?: boolean }[],
) {
  const stockpileMaterialSet = new Set<MaterialType>();
  for (const card of player.stockpile) {
    stockpileMaterialSet.add(getCardDef(card).material);
  }
  for (let bi = 0; bi < player.buildings.length; bi++) {
    const building = player.buildings[bi]!;
    if (building.completed) continue;
    const buildingDef = getCardDef(building.foundationCard);
    for (const mat of stockpileMaterialSet) {
      if (canUseMaterialForBuilding(player, mat, buildingDef.material)) {
        options.push({ material: mat, buildingIndex: bi });
      }
    }
    // Scriptorium: pool cards as laborer building materials
    if (hasCompletedBuilding(player, 'scriptorium')) {
      if (state.pool.some(c => canUseMaterialForBuilding(player, getCardDef(c).material, buildingDef.material))) {
        options.push({ material: buildingDef.material, buildingIndex: bi, fromPool: true });
      }
    }
  }
}

/** Populate stairway options: continue another player's completed building */
function populateStairwayOptions(
  player: Player,
  playerId: number,
  state: GameState,
  options: { targetPlayerId: number; buildingIndex: number; cardUid: number; fromPool?: boolean; fromStockpile?: boolean }[],
  mode: 'craftsman' | 'laborer',
) {
  for (const p of state.players) {
    if (p.id === playerId) continue;
    for (let bi = 0; bi < p.buildings.length; bi++) {
      const b = p.buildings[bi]!;
      if (!b.completed) continue;
      const bDef = getCardDef(b.foundationCard);
      if (mode === 'craftsman') {
        for (const card of player.hand) {
          if (isJackCard(card)) continue;
          if (canUseMaterialForBuilding(player, getCardDef(card).material, bDef.material)) {
            options.push({ targetPlayerId: p.id, buildingIndex: bi, cardUid: card.uid });
          }
        }
        if (hasCompletedBuilding(player, 'scriptorium') &&
            state.pool.some(c => canUseMaterialForBuilding(player, getCardDef(c).material, bDef.material))) {
          options.push({ targetPlayerId: p.id, buildingIndex: bi, cardUid: 0, fromPool: true });
        }
      } else {
        // Laborer mode: use stockpile materials
        const stockpileMats = new Set<MaterialType>();
        for (const c of player.stockpile) stockpileMats.add(getCardDef(c).material);
        for (const mat of stockpileMats) {
          if (canUseMaterialForBuilding(player, mat, bDef.material)) {
            const stockCard = player.stockpile.find(c => getCardDef(c).material === mat)!;
            options.push({ targetPlayerId: p.id, buildingIndex: bi, cardUid: stockCard.uid, fromStockpile: true });
          }
        }
        if (hasCompletedBuilding(player, 'scriptorium') &&
            state.pool.some(c => canUseMaterialForBuilding(player, getCardDef(c).material, bDef.material))) {
          options.push({ targetPlayerId: p.id, buildingIndex: bi, cardUid: 0, fromPool: true });
        }
      }
    }
  }
}

export function getAvailableActions(state: GameState): AvailableActions {
  const noThink: ThinkOptions = { canRefresh: false, canDraw1: false, genericMaterials: [], canDrawJack: false };
  const result: AvailableActions = {
    canThink: false,
    thinkOptions: noThink,
    vomitoriumAvailable: false,
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
    atriumAvailable: false,
    vaultFull: false,
    patronOptions: [],
    legionaryOptions: [],
    bridgeLegionaryOptions: [],
    legionaryGiveOptions: [],
    quarryCraftsmanOptions: [],
    encampmentOptions: [],
    canJunkyard: false,
    hasJacksForJunkyard: false,
    canFoundry: false,
    foundryHasPool: false,
    foundryHasHand: false,
    abilityThinkOptions: noThink,
    remainingAbilityThinks: null,
    abilityCraftsmanOptions: [],
    abilityPatronOptions: [],
    barCanFlip: false,
    barRevealedCard: null,
    barCanClientele: false,
    bathRole: null,
    pendingAbilityKind: null,
    canSkip: false,
    latrineAvailable: false,
    sanctuaryOptions: [],
    prisonMaxCount: 0,
    prisonOptions: [],
    basilicaOptions: [],
    fountainAvailable: false,
    fountainFlippedCard: null,
    fountainBuildingOptions: [],
    stairwayOptions: [],
    palaceLeadOptions: [],
    palaceFollowOptions: [],
    senateDrawsRemaining: 0,
    senateDrawOptions: noThink,
    circusMaximusAvailable: false,
    circusMaximusCompletionMaterials: [],
    circusMaximusCompletionSlots: 0,
  };

  const activeId = getActivePlayerId(state);
  if (activeId === null) return result;

  const player = state.players[activeId]!;
  const { phase } = state;

  // Senate: multi-step refresh in progress
  if (state.senateDrawsRemaining && state.senateDrawsRemaining > 0) {
    result.senateDrawsRemaining = state.senateDrawsRemaining;
    const genericMaterials = Object.keys(state.genericSupply) as MaterialType[];
    result.senateDrawOptions = {
      canRefresh: false,
      canDraw1: state.deck.length > 0,
      genericMaterials,
      canDrawJack: state.jackPile > 0,
    };
    return result;
  }

  // Handle pending triggered abilities
  if (phase.type === 'action' && phase.pendingAbilities && phase.pendingAbilities.length > 0) {
    const ability = phase.pendingAbilities[0]!;
    // Bar: skippable before flip (decline to use), not skippable after flip (must choose clientele/pool)
    result.canSkip = ability.kind !== 'bar' || ability.revealedCard === null;
    result.pendingAbilityKind = ability.kind;

    if (ability.kind === 'quarry') {
      populateCraftsmanOptions(player, state, result.quarryCraftsmanOptions);
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

    if (ability.kind === 'foundry') {
      result.canFoundry = true;
      result.foundryHasPool = state.pool.length > 0;
      result.foundryHasHand = player.hand.some(c => !isJackCard(c)) || player.hand.some(c => isJackCard(c));
    }

    if (ability.kind === 'school' || ability.kind === 'stage' || ability.kind === 'academy') {
      const effectiveHandLimit = getEffectiveHandLimit(state, activeId);
      const genericMaterials = Object.keys(state.genericSupply) as MaterialType[];
      result.abilityThinkOptions = {
        canRefresh: player.hand.length < effectiveHandLimit && state.deck.length > 0,
        canDraw1: state.deck.length > 0,
        genericMaterials,
        canDrawJack: state.jackPile > 0,
      };
      if (ability.kind === 'school') {
        result.remainingAbilityThinks = ability.remainingThinks;
      }
    }

    if (ability.kind === 'amphitheatre') {
      populateCraftsmanOptions(player, state, result.abilityCraftsmanOptions);
    }

    if (ability.kind === 'aqueduct') {
      if (player.clientele.length < getClienteleCapacity(player)) {
        const poolMaterialSet = new Set<MaterialType>();
        for (const card of state.pool) {
          poolMaterialSet.add(getCardDef(card).material);
        }
        result.abilityPatronOptions = [...poolMaterialSet];
        if (hasCompletedBuilding(player, 'circus_maximus') &&
            player.clientele.length + 1 < getClienteleCapacity(player)) {
          result.circusMaximusAvailable = true;
        }
      }
    }

    if (ability.kind === 'bar') {
      if (ability.revealedCard === null) {
        result.barCanFlip = state.deck.length > 0;
      } else {
        result.barRevealedCard = ability.revealedCard;
        result.barCanClientele = player.clientele.length < getClienteleCapacity(player);
        if (hasCompletedBuilding(player, 'circus_maximus') &&
            player.clientele.length + 1 < getClienteleCapacity(player)) {
          result.circusMaximusAvailable = true;
        }
      }
    }

    if (ability.kind === 'circus_maximus_completion') {
      const cap = getClienteleCapacity(player);
      const remaining = cap - player.clientele.length;
      result.circusMaximusCompletionSlots = remaining;
      if (remaining > 0) {
        // Show materials that have generic supply available
        const materialCounts = new Map<MaterialType, number>();
        for (const mat of ability.clientMaterials) {
          materialCounts.set(mat, (materialCounts.get(mat) ?? 0) + 1);
        }
        const available: MaterialType[] = [];
        for (const [mat, count] of materialCounts) {
          const supplyAvailable = Math.min(count, state.genericSupply[mat]);
          for (let i = 0; i < supplyAvailable; i++) available.push(mat);
        }
        result.circusMaximusCompletionMaterials = available;
      }
    }

    if (ability.kind === 'bath') {
      result.bathRole = ability.role;
      // Populate options for the bath role
      if (ability.role === 'Architect') {
        for (const card of player.hand) {
          if (isJackCard(card)) continue;
          const def = getCardDef(card);
          if (!canStartBuildingOfMaterial(player, def.material, state.sites, state.outOfTownSites)) continue;
          const outOfTown = requiresOutOfTownSite(def.material, state.sites);
          result.architectOptions.push({ cardUid: card.uid, outOfTown: outOfTown || undefined });
        }
      }
      if (ability.role === 'Craftsman') {
        populateCraftsmanOptions(player, state, result.craftsmanOptions);
      }
      if (ability.role === 'Laborer') {
        const poolMaterialSet = new Set<MaterialType>();
        for (const card of state.pool) poolMaterialSet.add(getCardDef(card).material);
        result.laborerPoolOptions = [...poolMaterialSet];
        if (hasCompletedBuilding(player, 'dock')) {
          for (const card of player.hand) {
            if (!isJackCard(card)) result.laborerHandOptions.push({ cardUid: card.uid });
          }
        }
        populateLaborerBuildingOptions(player, state, result.laborerBuildingOptions);
      }
      if (ability.role === 'Merchant') {
        if (player.vault.length >= player.influence) {
          result.vaultFull = true;
        } else {
          const stockpileMaterialSet = new Set<MaterialType>();
          for (const card of player.stockpile) stockpileMaterialSet.add(getCardDef(card).material);
          result.merchantOptions = [...stockpileMaterialSet];
          if (hasCompletedBuilding(player, 'bazaar')) {
            const poolMaterialSet = new Set<MaterialType>();
            for (const card of state.pool) poolMaterialSet.add(getCardDef(card).material);
            result.bazaarOptions = [...poolMaterialSet];
          }
          if (hasCompletedBuilding(player, 'atrium') && state.deck.length > 0) {
            result.atriumAvailable = true;
          }
        }
      }
      if (ability.role === 'Legionary') {
        for (const card of player.hand) {
          if (!isJackCard(card)) result.legionaryOptions.push({ cardUid: card.uid });
        }
        if (hasCompletedBuilding(player, 'bridge')) {
          for (const card of player.hand) {
            if (!isJackCard(card)) result.bridgeLegionaryOptions.push({ cardUid: card.uid });
          }
        }
      }
    }

    if (ability.kind === 'sanctuary') {
      for (const p of state.players) {
        if (p.id === activeId) continue;
        const mats = new Set<MaterialType>();
        for (const c of p.clientele) mats.add(getCardDef(c).material);
        for (const mat of mats) {
          result.sanctuaryOptions.push({ targetPlayerId: p.id, material: mat });
        }
      }
    }

    if (ability.kind === 'prison') {
      result.prisonMaxCount = ability.maxCount;
      for (const c of player.clientele) {
        result.prisonOptions.push({ cardUid: c.uid });
      }
    }

    if (ability.kind === 'basilica') {
      for (const c of player.hand) {
        if (!isJackCard(c)) result.basilicaOptions.push({ cardUid: c.uid });
      }
    }

    if (ability.kind === 'fountain') {
      result.fountainFlippedCard = ability.flippedCard;
      for (let bi = 0; bi < player.buildings.length; bi++) {
        const b = player.buildings[bi]!;
        if (b.completed) continue;
        const bDef = getCardDef(b.foundationCard);
        if (canUseMaterialForBuilding(player, getCardDef(ability.flippedCard).material, bDef.material)) {
          result.fountainBuildingOptions.push(bi);
        }
      }
    }

    return result;
  }

  if (phase.type === 'lead' || phase.type === 'follow' || phase.type === 'thinkRound') {
    result.canThink = true;
    const effectiveHandLimit = getEffectiveHandLimit(state, activeId);
    const genericMaterials = Object.keys(state.genericSupply) as MaterialType[];
    // Latrine: may discard 1 card before thinking
    result.latrineAvailable = hasActiveBuildingPower(player, 'latrine') && player.hand.length > 0;
    // Senate refresh check (to show special Refresh button label)
    result.thinkOptions = {
      canRefresh: (player.hand.length < effectiveHandLimit && state.deck.length > 0) || hasActiveBuildingPower(player, 'senate'),
      canDraw1: state.deck.length > 0,
      genericMaterials,
      canDrawJack: state.jackPile > 0,
    };
    result.vomitoriumAvailable = hasCompletedBuilding(player, 'vomitorium') && player.hand.length > 0;
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

    // Circus: 2 cards of the same material can lead any role
    if (hasCompletedBuilding(player, 'circus')) {
      for (const cards of Object.values(materialGroups)) {
        if (!cards || cards.length < 2) continue;
        for (let i = 0; i < cards.length; i++) {
          for (let j = i + 1; j < cards.length; j++) {
            for (const role of ALL_ROLES) {
              result.leadOptions.push({ role, cardUid: cards[i]!.uid, extraCardUids: [cards[j]!.uid] });
            }
          }
        }
      }
    }

    // Palace: lead with multiple cards of same role for extra actions
    if (hasActiveBuildingPower(player, 'palace')) {
      for (const [mat, cards] of Object.entries(materialGroups)) {
        if (!cards || cards.length < 2) continue;
        const role = MATERIAL_TO_ROLE[mat as MaterialType] as ActiveRole;
        // Generate options for 2, 3, ... N cards
        for (let n = 2; n <= cards.length; n++) {
          const primary = cards[0]!;
          const extras = cards.slice(1, n);
          result.palaceLeadOptions.push({ role, cardUid: primary.uid, extraCardUids: extras.map(c => c.uid) });
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

    // Circus: 2 cards of the same material can follow any role
    if (hasCompletedBuilding(player, 'circus')) {
      for (const cards of Object.values(materialGroups)) {
        if (!cards || cards.length < 2) continue;
        for (let i = 0; i < cards.length; i++) {
          for (let j = i + 1; j < cards.length; j++) {
            result.followOptions.push({ cardUid: cards[i]!.uid, extraCardUids: [cards[j]!.uid] });
          }
        }
      }
    }

    // Palace: follow with multiple cards of same role for extra actions
    if (hasActiveBuildingPower(player, 'palace')) {
      const requiredMaterial = ROLE_TO_MATERIAL[phase.ledRole];
      const matchingCards = (materialGroups[requiredMaterial] ?? []);
      if (matchingCards.length >= 2) {
        for (let n = 2; n <= matchingCards.length; n++) {
          const primary = matchingCards[0]!;
          const extras = matchingCards.slice(1, n);
          result.palaceFollowOptions.push({ cardUid: primary.uid, extraCardUids: extras.map(c => c.uid) });
        }
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
        // Out-of-town requires 2 remaining actions (Tower makes it free)
        const towerFreeOOT = hasCompletedBuilding(player, 'tower');
        if (outOfTown && !towerFreeOOT && remaining < 2) continue;
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
      populateCraftsmanOptions(player, state, result.craftsmanOptions);
      // Fountain: flip from deck
      if (hasActiveBuildingPower(player, 'fountain') && state.deck.length > 0) {
        result.fountainAvailable = true;
      }
      // Stairway: continue another player's completed building
      if (hasActiveBuildingPower(player, 'stairway')) {
        populateStairwayOptions(player, activeId, state, result.stairwayOptions, 'craftsman');
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

      // Stockpile/pool to building options
      populateLaborerBuildingOptions(player, state, result.laborerBuildingOptions);
      // Stairway: continue another player's completed building (from stockpile)
      if (hasActiveBuildingPower(player, 'stairway')) {
        populateStairwayOptions(player, activeId, state, result.stairwayOptions, 'laborer');
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

        // Atrium: deck to vault
        if (hasCompletedBuilding(player, 'atrium') && state.deck.length > 0) {
          result.atriumAvailable = true;
        }
      }
    }

    if (phase.ledRole === 'Patron') {
      // Clientele capacity is limited by influence
      if (player.clientele.length < getClienteleCapacity(player)) {
        const poolMaterialSet = new Set<MaterialType>();
        for (const card of state.pool) {
          poolMaterialSet.add(getCardDef(card).material);
        }
        result.patronOptions = [...poolMaterialSet];
        // Circus Maximus: player can opt into extra generic client
        if (hasCompletedBuilding(player, 'circus_maximus') &&
            player.clientele.length + 1 < getClienteleCapacity(player)) {
          result.circusMaximusAvailable = true;
        }
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
  /** Number of face-down (Atrium) cards in vault — material hidden until game end */
  vaultFaceDownCount: number;
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
  const isGameOver = state.phase.type === 'gameOver';

  // 1. Influence = 1 VP per influence point
  const influence = player.influence;

  // 2. Vault = sum of material values, and 3. Merchant bonus per category
  // Face-down (Atrium) cards are hidden during the game; only revealed at game end
  const vaultCounts: Partial<Record<MaterialType, number>> = {};
  let vaultFaceDownCount = 0;
  for (const card of player.vault) {
    if (card.faceDown && !isGameOver) {
      vaultFaceDownCount++;
    } else {
      const mat = getCardDef(card).material;
      vaultCounts[mat] = (vaultCounts[mat] ?? 0) + 1;
    }
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
      // For merchant bonus comparison, other players' face-down cards are also hidden
      const otherCount = other.vault.filter(c => {
        if (c.faceDown && !isGameOver) return false;
        return getCardDef(c).material === mat;
      }).length;
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
    vaultFaceDownCount,
    merchantBonus,
    merchantBonusCategories,
    buildingBonus,
    total: influence + vault + merchantBonus + buildingBonus,
  };
}
