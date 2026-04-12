import { Card, MaterialType } from '../game/types';
import { getCardDef, isJackCard } from '../game/cards';
import { CardView } from './CardView';

const MATERIAL_ORDER: Record<MaterialType, number> = {
  Rubble: 0, Wood: 1, Brick: 2, Concrete: 3, Stone: 4, Marble: 5,
};

function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const aJack = isJackCard(a);
    const bJack = isJackCard(b);
    if (aJack !== bJack) return aJack ? 1 : -1;
    const aDef = getCardDef(a);
    const bDef = getCardDef(b);
    const matCmp = MATERIAL_ORDER[aDef.material] - MATERIAL_ORDER[bDef.material];
    if (matCmp !== 0) return matCmp;
    return aDef.name.localeCompare(bDef.name);
  });
}

interface HandViewProps {
  cards: Card[];
  selectedCardUids: number[];
  highlightedCardUids?: Set<number>;
  onSelectCard?: (uid: number, ctrlKey: boolean) => void;
  playerName: string;
  refreshHandSize: number;
}

export function HandView({ cards, selectedCardUids, highlightedCardUids, onSelectCard, playerName, refreshHandSize }: HandViewProps) {
  const sorted = sortHand(cards);
  return (
    <div className="hand-view">
      <div className="hand-label">{playerName}'s Hand ({cards.length} cards, {refreshHandSize} Refresh Hand Size):</div>
      <div className="hand-cards">
        {sorted.map(card => (
          <CardView
            key={card.uid}
            card={card}
            selected={selectedCardUids.includes(card.uid)}
            highlighted={highlightedCardUids?.has(card.uid)}
            onClick={onSelectCard ? (e) => onSelectCard(card.uid, e.ctrlKey || e.metaKey) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
