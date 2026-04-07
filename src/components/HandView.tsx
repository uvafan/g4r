import { Card } from '../game/types';
import { CardView } from './CardView';

interface HandViewProps {
  cards: Card[];
  selectedCardUid: number | null;
  highlightedCardUids?: Set<number>;
  onSelectCard?: (uid: number) => void;
  playerName: string;
}

export function HandView({ cards, selectedCardUid, highlightedCardUids, onSelectCard, playerName }: HandViewProps) {
  return (
    <div className="hand-view">
      <div className="hand-label">{playerName}'s Hand ({cards.length}):</div>
      <div className="hand-cards">
        {cards.map(card => (
          <CardView
            key={card.uid}
            card={card}
            selected={card.uid === selectedCardUid}
            highlighted={highlightedCardUids?.has(card.uid)}
            onClick={onSelectCard ? () => onSelectCard(card.uid) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
