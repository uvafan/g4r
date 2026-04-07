import { Card } from '../game/types';
import { getCardDef, MATERIAL_COLORS, isGenericCard, isJackCard } from '../game/cards';

interface CardViewProps {
  card: Card;
  faceUp?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

export function CardView({ card, faceUp = true, selected, highlighted, onClick, compact }: CardViewProps) {
  const jack = isJackCard(card);
  const def = getCardDef(card);
  const bg = jack ? '#222' : (MATERIAL_COLORS[def.material] ?? '#ccc');
  const generic = isGenericCard(card);

  if (!faceUp) {
    return (
      <div
        className={`card card-back ${selected ? 'card-selected' : ''}`}
        onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : undefined }}
      >
        ?
      </div>
    );
  }

  if (jack) {
    return (
      <div
        className={`card card-jack ${selected ? 'card-selected' : ''} ${highlighted ? 'card-highlighted' : ''} ${compact ? 'card-compact' : ''}`}
        style={{ backgroundColor: bg, color: '#fff', cursor: onClick ? 'pointer' : undefined }}
        onClick={onClick}
      >
        <div className="card-name">Jack</div>
        {!compact && <div className="card-material">Wild</div>}
      </div>
    );
  }

  return (
    <div
      className={`card ${selected ? 'card-selected' : ''} ${highlighted ? 'card-highlighted' : ''} ${compact ? 'card-compact' : ''} ${generic ? 'card-generic' : ''}`}
      style={{ backgroundColor: bg, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
    >
      <div className="card-name">{generic ? 'Generic' : def.name}</div>
      {!compact && (
        <>
          <div className="card-material">{def.material}</div>
          {!generic && <div className="card-cost">Cost: {def.cost}</div>}
        </>
      )}
    </div>
  );
}
