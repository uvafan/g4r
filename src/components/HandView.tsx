import { Card } from '../game/types';
import { CardView } from './CardView';

interface HandViewProps {
  cards: Card[];
  selectedCardUids: number[];
  highlightedCardUids?: Set<number>;
  onSelectCard?: (uid: number, ctrlKey: boolean) => void;
  playerName: string;
}

export function HandView({ cards, selectedCardUids, highlightedCardUids, onSelectCard, playerName }: HandViewProps) {
  return (
    <div className="hand-view">
      <div className="hand-label">{playerName}'s Hand ({cards.length}):</div>
      <div className="hand-cards">
        {cards.map(card => (
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
