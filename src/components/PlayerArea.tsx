import { Player, MaterialType, Role, GameState, ThinkOption } from '../game/types';
import { getCardDef, MATERIAL_COLORS, MATERIAL_TO_ROLE, ROLE_TO_MATERIAL } from '../game/cards';
import { calculateVP, getRequiredMaterials, getPlayerActionCount, getPendingThinkCards, getLedRole } from '../game/engine';
import { isJackCard, isGenericCard } from '../game/cards';
import { CardView } from './CardView';

function formatThinkOption(opt: ThinkOption): string {
  switch (opt.kind) {
    case 'refresh': return 'Refresh';
    case 'draw1': return 'Draw 1';
    case 'generic': return `Generic ${opt.material}`;
    case 'jack': return 'Jack';
  }
}

interface PlayerAreaProps {
  player: Player;
  gameState: GameState;
  isActive: boolean;
  isLeader: boolean;
  selectedBuildingIndex?: number;
  highlightedBuildingIndices?: Set<number>;
  onSelectBuilding?: (index: number) => void;
}

export function PlayerArea({ player, gameState, isActive, isLeader, selectedBuildingIndex, highlightedBuildingIndices, onSelectBuilding }: PlayerAreaProps) {
  const vp = calculateVP(gameState, player.id);

  return (
    <div className={`player-area ${isActive ? 'player-active' : ''}`}>
      <div className="player-header">
        <strong>{player.name}{isLeader && <span className="leader-badge">Leader</span>}</strong>
        <span className="vp-total-wrapper">
          <span className="vp-total">{vp.total} VP <span className="vp-info-icon">ⓘ</span></span>
          <div className="vp-tooltip">
            <div className="vp-tooltip-row"><span>Influence</span><span>{vp.influence}</span></div>
            <div className="vp-tooltip-row"><span>Vault{vp.vaultFaceDownCount > 0 ? ` (+${vp.vaultFaceDownCount} hidden)` : ''}</span><span>{vp.vault}{vp.vaultFaceDownCount > 0 ? '+?' : ''}</span></div>
            {vp.merchantBonus > 0 && (
              <div className="vp-tooltip-row"><span>Merchant Bonus ({vp.merchantBonusCategories.join(', ')})</span><span>{vp.merchantBonus}</span></div>
            )}
            {vp.buildingBonus > 0 && (
              <div className="vp-tooltip-row"><span>Building Bonus</span><span>{vp.buildingBonus}</span></div>
            )}
            <div className="vp-tooltip-row vp-tooltip-total"><span>Total</span><span>{vp.total}</span></div>
          </div>
        </span>
        <span>Influence: {player.influence} | Hand: {player.hand.length}</span>
      </div>
      {(() => {
        const status = gameState.playerRoundStatus?.[player.id];
        if (!status) return null;
        const actionCount = getPlayerActionCount(gameState, player.id);
        const pendingCards = getPendingThinkCards(gameState, player.id);
        const ledRole = getLedRole(gameState);

        let declText = '';
        if (status.declaration === 'lead') {
          declText = `Led ${status.role}`;
        } else if (status.declaration === 'follow') {
          declText = `Followed ${status.role}`;
        } else {
          const opt = status.thinkOption;
          declText = opt ? `Thought (${formatThinkOption(opt)})` : 'Thought';
        }

        const parts: string[] = [declText];
        if (actionCount !== null) {
          if (actionCount > 0) {
            parts.push(`${actionCount} ${ledRole} action${actionCount !== 1 ? 's' : ''}`);
          } else {
            parts.push('no actions');
          }
        }
        if (pendingCards.length > 0) {
          const descriptions = pendingCards.map(c => {
            if (isJackCard(c)) return 'Jack';
            if (isGenericCard(c)) return `Generic ${getCardDef(c).material}`;
            return 'card';
          });
          parts.push(`+${descriptions.join(', +')} at round end`);
        }

        return (
          <div className="round-status">
            {parts.join(' \u2014 ')}
          </div>
        );
      })()}
      {(player.vault.length > 0 || player.influence > 0) && (
        <div className="stockpile-row">
          <span className="stockpile-label">Vault ({player.vault.length}/{player.influence}):</span>
          {(Object.entries(vp.vaultByMaterial) as [MaterialType, { count: number; baseValue: number; merchantBonus: number }][]).map(([mat, info]) => (
            <div key={mat} className="vault-chip" style={{ backgroundColor: MATERIAL_COLORS[mat] }}>
              <span>{info.count} {mat}</span>
              <span className="vault-vp">
                {info.baseValue}vp{info.merchantBonus > 0 && <span className="vault-bonus">+{info.merchantBonus}</span>}
              </span>
            </div>
          ))}
          {vp.vaultFaceDownCount > 0 && (
            <div className="vault-chip" style={{ backgroundColor: '#666' }}>
              <span>{vp.vaultFaceDownCount} ???</span>
              <span className="vault-vp">?vp</span>
            </div>
          )}
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
          const materialsNeeded = getRequiredMaterials(player, building);
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
              {building.outOfTown && <div className="building-badge building-oot">Out of Town</div>}
              {building.completed && def.power && (
                <div className="building-power">{def.power}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
