import { Player, MaterialType, Role } from '../game/types';
import { getCardDef, MATERIAL_COLORS, MATERIAL_TO_ROLE, ROLE_TO_MATERIAL } from '../game/cards';
import { CardView } from './CardView';

interface PlayerAreaProps {
  player: Player;
  isActive: boolean;
  selectedBuildingIndex?: number;
  highlightedBuildingIndices?: Set<number>;
  onSelectBuilding?: (index: number) => void;
}

export function PlayerArea({ player, isActive, selectedBuildingIndex, highlightedBuildingIndices, onSelectBuilding }: PlayerAreaProps) {
  return (
    <div className={`player-area ${isActive ? 'player-active' : ''}`}>
      <div className="player-header">
        <strong>{player.name}</strong>
        <span>Influence: {player.influence} | Hand: {player.hand.length}</span>
      </div>
      {(player.vault.length > 0 || player.influence > 0) && (
        <div className="stockpile-row">
          <span className="stockpile-label">Vault ({player.vault.length}/{player.influence}):</span>
          {(() => {
            const counts: Partial<Record<MaterialType, number>> = {};
            for (const card of player.vault) {
              const mat = getCardDef(card).material;
              counts[mat] = (counts[mat] ?? 0) + 1;
            }
            return (Object.entries(counts) as [MaterialType, number][]).map(([mat, count]) => (
              <div key={mat} className="pool-chip" style={{ backgroundColor: MATERIAL_COLORS[mat] }}>
                {count} {mat}
              </div>
            ));
          })()}
        </div>
      )}
      {(player.clientele.length > 0 || player.influence > 0) && (
        <div className="stockpile-row">
          <span className="stockpile-label">Clientele ({player.clientele.length}/{player.influence}):</span>
          {(() => {
            const counts: Partial<Record<Role, number>> = {};
            for (const card of player.clientele) {
              const role = MATERIAL_TO_ROLE[getCardDef(card).material];
              counts[role] = (counts[role] ?? 0) + 1;
            }
            return (Object.entries(counts) as [Role, number][]).map(([role, count]) => (
              <div key={role} className="pool-chip" style={{ backgroundColor: MATERIAL_COLORS[ROLE_TO_MATERIAL[role]] }}>
                {count} {role}
              </div>
            ));
          })()}
        </div>
      )}
      {player.stockpile.length > 0 && (
        <div className="stockpile-row">
          <span className="stockpile-label">Stockpile:</span>
          {(() => {
            const counts: Partial<Record<MaterialType, number>> = {};
            for (const card of player.stockpile) {
              const mat = getCardDef(card).material;
              counts[mat] = (counts[mat] ?? 0) + 1;
            }
            return (Object.entries(counts) as [MaterialType, number][]).map(([mat, count]) => (
              <div key={mat} className="pool-chip" style={{ backgroundColor: MATERIAL_COLORS[mat] }}>
                {count} {mat}
              </div>
            ));
          })()}
        </div>
      )}
      <div className="buildings-row">
        {player.buildings.length === 0 && <span className="no-buildings">No buildings</span>}
        {player.buildings.map((building, idx) => {
          const def = getCardDef(building.foundationCard);
          const materialsNeeded = def.cost;
          const isSelected = selectedBuildingIndex === idx;
          return (
            <div
              key={building.foundationCard.uid}
              className={`building ${building.completed ? 'building-complete' : 'building-progress'} ${isSelected ? 'building-selected' : ''} ${highlightedBuildingIndices?.has(idx) ? 'building-highlighted' : ''}`}
              onClick={() => !building.completed && onSelectBuilding?.(idx)}
              style={{ cursor: !building.completed && onSelectBuilding ? 'pointer' : undefined }}
            >
              <CardView card={building.foundationCard} compact />
              <div className="building-materials-count">
                {building.materials.length}/{materialsNeeded} materials
              </div>
              {building.completed && <div className="building-badge">Complete</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
