import { CardDef, Card, MaterialType, Role } from './types';

export const MATERIAL_TO_ROLE: Record<MaterialType, Role> = {
  Rubble: 'Patron',
  Wood: 'Craftsman',
  Brick: 'Legionary',
  Concrete: 'Architect',
  Stone: 'Merchant',
  Marble: 'Legionary',
};

export const MATERIAL_VALUE: Record<MaterialType, number> = {
  Rubble: 1,
  Wood: 1,
  Brick: 2,
  Concrete: 2,
  Stone: 3,
  Marble: 3,
};

export const ROLE_TO_MATERIAL: Record<Role, MaterialType> = {
  Patron: 'Rubble',
  Craftsman: 'Wood',
  Laborer: 'Rubble',
  Architect: 'Concrete',
  Legionary: 'Brick',
  Merchant: 'Stone',
};

export const MATERIAL_COLORS: Record<MaterialType, string> = {
  Rubble: '#f0c040',
  Wood: '#4caf50',
  Brick: '#e53935',
  Concrete: '#9e9e9e',
  Stone: '#42a5f5',
  Marble: '#ab47bc',
};

// All 48 active G4R buildings from the card spreadsheet
export const CARD_DEFS: CardDef[] = [
  // Rubble (cost 1, Patron)
  { id: 'barracks', name: 'Barracks', material: 'Rubble', cost: 1, role: 'Patron', power: 'When demanding a type of material with a Legionary action, you obtain all available materials of that type, not just one.' },
  { id: 'quarry', name: 'Quarry', material: 'Rubble', cost: 1, role: 'Patron', power: 'After finishing a structure, you may take an additional Craftsman action.' },
  { id: 'bridge', name: 'Bridge', material: 'Rubble', cost: 1, role: 'Patron', power: "During a Legionary action, you may instead take materials from opponents' Stockpiles." },
  { id: 'junkyard', name: 'Junkyard', material: 'Rubble', cost: 1, role: 'Patron', power: 'Upon completion, you may put your entire Hand into your stockpile, optionally keeping your Jacks.' },
  { id: 'fortress', name: 'Fortress', material: 'Rubble', cost: 1, role: 'Patron', power: 'Every pair of 2 clients of the same type in your Clientele also counts as a Legionary client.' },
  { id: 'vat', name: 'Vat', material: 'Rubble', cost: 1, role: 'Patron', power: 'Concrete buildings require only one material for you to complete them.' },
  { id: 'encampment', name: 'Encampment', material: 'Rubble', cost: 1, role: 'Patron', power: 'After finishing a building, you may immediately start a building of the same type (including on an out of town site).' },
  { id: 'scriptorium', name: 'Scriptorium', material: 'Rubble', cost: 1, role: 'Patron', power: 'When performing a Craftsman or Laborer action, you may draw materials from the Pool as though they came from your Hand or Stockpile.' },

  // Wood (cost 1, Laborer)
  { id: 'crane', name: 'Crane', material: 'Wood', cost: 1, role: 'Craftsman', power: 'As an Architect action, you may start two buildings from your hand.' },
  { id: 'dock', name: 'Dock', material: 'Wood', cost: 1, role: 'Craftsman', power: 'Whenever you take a Laborer action, you may put a single card into your Stockpile from your Hand, instead of 2 from the Pool.' },
  { id: 'palisade', name: 'Palisade', material: 'Wood', cost: 1, role: 'Craftsman', power: 'Block 1st, 3rd, 5th, ... Legionary actions from each player each turn.' },
  { id: 'market', name: 'Market', material: 'Wood', cost: 1, role: 'Craftsman', power: 'Upon completion, you may take 1 material of each type from the Generic Supply, if available.' },
  { id: 'archway', name: 'Archway', material: 'Wood', cost: 1, role: 'Craftsman', power: 'Your incomplete Marble buildings still provide their function (maximum one at a time).' },
  { id: 'bazaar', name: 'Bazaar', material: 'Wood', cost: 1, role: 'Craftsman', power: 'As a Merchant action, you may move a material from the Pool to your Vault.' },
  { id: 'cross', name: 'Cross', material: 'Wood', cost: 1, role: 'Craftsman', power: '+1 Refresh Hand Size' },
  { id: 'statue', name: 'Statue', material: 'Wood', cost: 1, role: 'Craftsman', power: '+3 VP' },

  // Brick (cost 2, Legionary)
  { id: 'foundry', name: 'Foundry', material: 'Brick', cost: 2, role: 'Legionary', power: 'Upon completion, you may put the entire Pool and/or your entire Hand (discarding Jacks) into your Stockpile.' },
  { id: 'school', name: 'School', material: 'Brick', cost: 2, role: 'Legionary', power: 'Upon completion, you may Think once per influence you have.' },
  { id: 'shrine', name: 'Shrine', material: 'Brick', cost: 2, role: 'Legionary', power: '+2 Refresh Hand Size' },
  { id: 'stage', name: 'Stage', material: 'Brick', cost: 2, role: 'Legionary', power: 'After taking a Patron action, you may think.' },
  { id: 'bath', name: 'Bath', material: 'Brick', cost: 2, role: 'Legionary', power: 'After you perform a Patron action, the client you hired may perform its action once, unless it is a Patron client.' },
  { id: 'atrium', name: 'Atrium', material: 'Brick', cost: 2, role: 'Legionary', power: 'When you perform a Merchant action, you may instead put one material face down from your Deck into your Vault.' },
  { id: 'academy', name: 'Academy', material: 'Brick', cost: 2, role: 'Legionary', power: 'After any turn in which you performed at least one Craftsman action, you may think.' },
  { id: 'circus_maximus', name: 'Circus Maximus', material: 'Brick', cost: 2, role: 'Legionary', power: 'You may take an additional client of the same type from the Generic Supply for each current client, as well as one additional when you gain a client in the future.' },

  // Concrete (cost 2, Architect)
  { id: 'road', name: 'Road', material: 'Concrete', cost: 2, role: 'Architect', power: 'You may use any material to build Stone buildings.' },
  { id: 'vomitorium', name: 'Vomitorium', material: 'Concrete', cost: 2, role: 'Architect', power: 'Before you Think, you may discard your entire Hand to the Pool, optionally keeping any subset of your Jacks.' },
  { id: 'tower', name: 'Tower', material: 'Concrete', cost: 2, role: 'Architect', power: 'You may use Rubble in any structure. You may start structures on out of town sites at no extra cost.' },
  { id: 'amphitheatre', name: 'Amphitheatre', material: 'Concrete', cost: 2, role: 'Architect', power: 'Upon completion, you may perform a Craftsman action once per influence you have.' },
  { id: 'wall', name: 'Wall', material: 'Concrete', cost: 2, role: 'Architect', power: 'Block 1st, 3rd, 5th, ... Legionary actions from each player each turn. 1 VP for every 3 materials in Stockpile.' },
  { id: 'circus', name: 'Circus', material: 'Concrete', cost: 2, role: 'Architect', power: 'You may play two cards of the same color to lead or follow any role.' },
  { id: 'aqueduct', name: 'Aqueduct', material: 'Concrete', cost: 2, role: 'Architect', power: 'Upon completion, you may perform a Patron action once per influence you have.' },
  { id: 'bar', name: 'Bar', material: 'Concrete', cost: 2, role: 'Architect', power: 'After you take a Patron action, you may reveal the top card of the deck. Then, put it into your Clientele or the Pool.' },

  // Stone (cost 3, Legionary)
  { id: 'sanctuary', name: 'Sanctuary', material: 'Stone', cost: 3, role: 'Legionary', power: 'Upon completion, you may steal a client from any player.' },
  { id: 'library', name: 'Library', material: 'Stone', cost: 3, role: 'Legionary', power: 'After you Think, you may draw a card from the Deck.' },
  { id: 'villa', name: 'Villa', material: 'Stone', cost: 3, role: 'Legionary', power: '+3 influence' },
  { id: 'sewer', name: 'Sewer', material: 'Stone', cost: 3, role: 'Legionary', power: 'You may put any subset of the cards you use to lead or follow into your Stockpile when the turn is over, instead of the Pool.' },
  { id: 'garden', name: 'Garden', material: 'Stone', cost: 3, role: 'Legionary', power: 'Your Clientele Capacity is doubled.' },
  { id: 'keep', name: 'Keep', material: 'Stone', cost: 3, role: 'Legionary', power: 'Upon completion, you are the leader for the next 3 turns.' },
  { id: 'colosseum', name: 'Colosseum', material: 'Stone', cost: 3, role: 'Legionary', power: '+1 VP for every card in your hand' },
  { id: 'prison', name: 'Prison', material: 'Stone', cost: 3, role: 'Legionary', power: 'Upon completion, move up to half of your clients into your Vault, rounded down.' },

  // Marble (cost 3, Merchant)
  { id: 'latrine', name: 'Latrine', material: 'Marble', cost: 3, role: 'Merchant', power: 'Before you Think, you may discard one card from your hand to the Pool.' },
  { id: 'fountain', name: 'Fountain', material: 'Marble', cost: 3, role: 'Merchant', power: 'As a Craftsman action, you may flip a card from the Deck, and then either use it to continue a structure, or put it in your Hand.' },
  { id: 'stairway', name: 'Stairway', material: 'Marble', cost: 3, role: 'Merchant', power: "As a Craftsman or Laborer action, you may continue another player's completed structure. This makes that structure's function available to all players." },
  { id: 'ludus_magnus', name: 'Ludus Magnus', material: 'Marble', cost: 3, role: 'Merchant', power: 'Every 2 Merchant clients in your Clientele also count as 1 client of every role.' },
  { id: 'basilica', name: 'Basilica', material: 'Marble', cost: 3, role: 'Merchant', power: 'On any turn in which you perform a Merchant action, you may put a material from your Hand into your Vault.' },
  { id: 'palace', name: 'Palace', material: 'Marble', cost: 3, role: 'Merchant', power: 'You may lead or follow with multiple cards of the same role, and take an extra action for each additional card.' },
  { id: 'temple', name: 'Temple', material: 'Marble', cost: 3, role: 'Merchant', power: '+3 Refresh Hand Size' },
  { id: 'senate', name: 'Senate', material: 'Marble', cost: 3, role: 'Merchant', power: 'When refreshing your hand, you may draw freely from the Jacks and the Generic Supply.' },
];

// Jack card definition — wild for leading/following, cannot be used as building or material
export const JACK_CARD_DEF: CardDef = {
  id: 'jack',
  name: 'Jack',
  material: 'Rubble', // placeholder — Jacks bypass material checks
  cost: 0,
  role: 'Patron', // placeholder — Jacks are wild
  power: 'Wild: can lead or follow any role',
};

// Generic card definitions — one per material type, no power when completed
export const GENERIC_CARD_DEFS: CardDef[] = [
  { id: 'generic_rubble', name: 'Generic', material: 'Rubble', cost: 1, role: 'Patron', power: '' },
  { id: 'generic_wood', name: 'Generic', material: 'Wood', cost: 1, role: 'Craftsman', power: '' },
  { id: 'generic_brick', name: 'Generic', material: 'Brick', cost: 2, role: 'Legionary', power: '' },
  { id: 'generic_concrete', name: 'Generic', material: 'Concrete', cost: 2, role: 'Architect', power: '' },
  { id: 'generic_stone', name: 'Generic', material: 'Stone', cost: 3, role: 'Legionary', power: '' },
  { id: 'generic_marble', name: 'Generic', material: 'Marble', cost: 3, role: 'Merchant', power: '' },
];

export const ALL_CARD_DEFS = [...CARD_DEFS, ...GENERIC_CARD_DEFS, JACK_CARD_DEF];

export const CARD_DEF_MAP: Record<string, CardDef> = Object.fromEntries(
  ALL_CARD_DEFS.map(def => [def.id, def])
);

export function getCardDef(card: Card): CardDef {
  const def = CARD_DEF_MAP[card.defId];
  if (!def) throw new Error(`Unknown card def: ${card.defId}`);
  return def;
}

export function isGenericCard(card: Card): boolean {
  return card.defId.startsWith('generic_');
}

export function isJackCard(card: Card): boolean {
  return card.defId === 'jack';
}

export function genericDefIdForMaterial(material: MaterialType): string {
  return `generic_${material.toLowerCase()}`;
}

export type RNG = () => number;

export function shuffleArray<T>(arr: T[], rng: RNG = Math.random): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i]!, result[j]!] = [result[j]!, result[i]!];
  }
  return result;
}

export function createDeck(playerCount: number, rng?: RNG): Card[] {
  const copiesPerCard = playerCount <= 4 ? 3 : 4;
  const cards: Card[] = [];
  let uid = 0;

  for (const def of CARD_DEFS) {
    for (let i = 0; i < copiesPerCard; i++) {
      cards.push({ uid: uid++, defId: def.id });
    }
  }

  return shuffleArray(cards, rng);
}
