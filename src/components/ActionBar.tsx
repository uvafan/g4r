import { GameState, GameAction, MaterialType } from '../game/types';
import { getAvailableActions } from '../game/engine';
import { getCardDef, MATERIAL_COLORS, ROLE_TO_MATERIAL } from '../game/cards';

interface ActionBarProps {
  state: GameState;
  selectedCardUid: number | null;
  selectedBuildingIndex: number | null;
  selectedPoolMaterials: MaterialType[];
  onPoolMaterialToggle: (material: MaterialType) => void;
  dispatch: (action: GameAction) => void;
}

export function ActionBar({ state, selectedCardUid, selectedBuildingIndex, selectedPoolMaterials, onPoolMaterialToggle, dispatch }: ActionBarProps) {
  const actions = getAvailableActions(state);
  const { phase } = state;
  const { thinkOptions } = actions;

  const selectedIsLeadable = selectedCardUid !== null &&
    actions.leadOptions.some(o => o.cardUid === selectedCardUid);
  const selectedLeadRoles = selectedCardUid !== null
    ? [...new Set(actions.leadOptions.filter(o => o.cardUid === selectedCardUid).map(o => o.role))]
    : [];

  const selectedIsFollowable = selectedCardUid !== null &&
    actions.followOptions.some(o => o.cardUid === selectedCardUid);

  const selectedIsArchitectValid = selectedCardUid !== null &&
    actions.architectOptions.some(o => o.cardUid === selectedCardUid);

  const selectedIsCraftsmanValid = selectedCardUid !== null && selectedBuildingIndex !== null &&
    actions.craftsmanOptions.some(o => o.cardUid === selectedCardUid && o.buildingIndex === selectedBuildingIndex);

  return (
    <div className="action-bar">
      {actions.canThink && (
        <div className="think-options">
          <span className="think-label">Think:</span>
          {thinkOptions.canRefresh && (
            <button onClick={() => dispatch({ type: 'THINK', option: { kind: 'refresh' } })}>
              Refresh to 5
            </button>
          )}
          {thinkOptions.canDraw1 && (
            <button onClick={() => dispatch({ type: 'THINK', option: { kind: 'draw1' } })}>
              Draw 1
            </button>
          )}
          <button
            className="think-jack-btn"
            disabled={!thinkOptions.canDrawJack}
            onClick={() => dispatch({ type: 'THINK', option: { kind: 'jack' } })}
            title={`Draw Jack (${state.jackPile} left)`}
          >
            Jack ({state.jackPile})
          </button>
          {thinkOptions.genericMaterials.map((mat: MaterialType) => {
            const count = state.genericSupply[mat];
            const available = count > 0;
            return (
              <button
                key={mat}
                className="think-generic-btn"
                disabled={!available}
                style={{
                  backgroundColor: available ? MATERIAL_COLORS[mat] : '#ccc',
                  color: available ? '#000' : '#888',
                }}
                onClick={() => dispatch({ type: 'THINK', option: { kind: 'generic', material: mat } })}
                title={`Draw Generic ${mat} (${count} left)`}
              >
                {mat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {phase.type === 'lead' && (
        selectedIsLeadable && selectedLeadRoles.length > 0
          ? selectedLeadRoles.map(role => (
              <button
                key={role}
                onClick={() => selectedCardUid !== null && dispatch({ type: 'LEAD_ROLE', role, cardUid: selectedCardUid })}
              >
                Lead {role} (with selected card)
              </button>
            ))
          : <button disabled>Lead</button>
      )}

      {phase.type === 'follow' && (
        <>
          {selectedIsFollowable ? (
            <button onClick={() => dispatch({ type: 'FOLLOW_ROLE', cardUid: selectedCardUid! })}>
              Follow {phase.ledRole} (with selected card)
            </button>
          ) : (
            <span className="action-hint">
              {actions.followOptions.length > 0
                ? `Select a ${ROLE_TO_MATERIAL[phase.ledRole]} card to follow`
                : `No matching cards to follow ${phase.ledRole}`}
            </span>
          )}
        </>
      )}

      {phase.type === 'action' && phase.ledRole === 'Architect' && (
        <>
          {selectedIsArchitectValid ? (
            <button onClick={() => dispatch({ type: 'ARCHITECT_START', cardUid: selectedCardUid! })}>
              Start Building: {(() => {
                const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                return card ? getCardDef(card).name : '?';
              })()}
            </button>
          ) : (
            <span className="action-hint">
              {actions.architectOptions.length > 0
                ? 'Select a card from hand to start as a building'
                : 'No valid buildings to start'}
            </span>
          )}
        </>
      )}

      {phase.type === 'action' && phase.ledRole === 'Craftsman' && (
        <>
          {selectedIsCraftsmanValid ? (
            <button onClick={() => dispatch({
              type: 'CRAFTSMAN_ADD',
              buildingIndex: selectedBuildingIndex!,
              cardUid: selectedCardUid!,
            })}>
              Add Material to Building
            </button>
          ) : (
            <span className="action-hint">
              {actions.craftsmanOptions.length > 0
                ? 'Select a card and an in-progress building to add material'
                : 'No valid craftsman actions'}
            </span>
          )}
        </>
      )}

      {phase.type === 'action' && phase.ledRole === 'Merchant' && (
        <>
          {actions.merchantOptions.length > 0 ? (
            <div className="merchant-vault-select">
              <span className="action-label">Move to Vault from Stockpile:</span>
              {actions.merchantOptions.map(mat => (
                <button
                  key={mat}
                  style={{ backgroundColor: MATERIAL_COLORS[mat] }}
                  onClick={() => dispatch({
                    type: 'MERCHANT_STOCKPILE_TO_VAULT',
                    material: mat,
                  })}
                >
                  {mat}
                </button>
              ))}
            </div>
          ) : (
            <span className="action-hint">No materials in stockpile to vault</span>
          )}
        </>
      )}

      {phase.type === 'action' && phase.ledRole === 'Legionary' && (
        <>
          {actions.legionaryOptions.length > 0 ? (
            selectedCardUid !== null && actions.legionaryOptions.some(o => o.cardUid === selectedCardUid) ? (
              <button onClick={() => dispatch({ type: 'LEGIONARY_REVEAL', cardUid: selectedCardUid })}>
                Demand {(() => {
                  const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                  return card ? getCardDef(card).material : '?';
                })()}
              </button>
            ) : (
              <span className="action-hint">Select a card from hand to reveal and demand its material</span>
            )
          ) : (
            <span className="action-hint">No cards to reveal for Legionary</span>
          )}
        </>
      )}

      {phase.type === 'legionary_demand' && (
        <>
          {actions.legionaryGiveOptions.length > 0 ? (
            selectedCardUid !== null && actions.legionaryGiveOptions.some(o => o.cardUid === selectedCardUid) ? (
              <button onClick={() => dispatch({ type: 'LEGIONARY_GIVE', cardUid: selectedCardUid })}>
                Give {(() => {
                  const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                  return card ? getCardDef(card).name : '?';
                })()} to Legionary
              </button>
            ) : (
              <span className="action-hint">
                Select a {phase.revealedMaterial} card to give to the Legionary
              </span>
            )
          ) : (
            <span className="action-hint">No matching cards to give</span>
          )}
        </>
      )}

      {phase.type === 'action' && phase.ledRole === 'Laborer' && (
        <>
          {actions.laborerPoolOptions.length > 0 && (
            <div className="laborer-pool-select">
              <span className="action-label">Take from Pool:</span>
              {actions.laborerPoolOptions.map(mat => {
                const poolCount = state.pool.filter(c => getCardDef(c).material === mat).length;
                const selectedCount = selectedPoolMaterials.filter(m => m === mat).length;
                const canAddMore = selectedPoolMaterials.length < 2 && selectedCount < poolCount;
                return (
                  <button
                    key={mat}
                    className={`pool-select-btn ${selectedCount > 0 ? 'pool-selected' : ''}`}
                    style={{ backgroundColor: MATERIAL_COLORS[mat] }}
                    onClick={() => onPoolMaterialToggle(mat)}
                    disabled={!canAddMore && selectedCount === 0}
                  >
                    {mat} ({poolCount}){selectedCount > 0 ? ` [${selectedCount} sel]` : ''}
                  </button>
                );
              })}
              {selectedPoolMaterials.length > 0 && (
                <button
                  onClick={() => dispatch({
                    type: 'LABORER_POOL_TO_STOCKPILE',
                    materials: selectedPoolMaterials,
                  })}
                >
                  Take {selectedPoolMaterials.length} from Pool
                </button>
              )}
            </div>
          )}
          {selectedBuildingIndex !== null &&
            actions.laborerBuildingOptions.some(o => o.buildingIndex === selectedBuildingIndex) ? (
            <button onClick={() => {
              const opt = actions.laborerBuildingOptions.find(o => o.buildingIndex === selectedBuildingIndex)!;
              dispatch({
                type: 'LABORER_STOCKPILE_TO_BUILDING',
                material: opt.material,
                buildingIndex: selectedBuildingIndex,
              });
            }}>
              Add from Stockpile to Building
            </button>
          ) : actions.laborerBuildingOptions.length > 0 ? (
            <span className="action-hint">Select an in-progress building to add stockpile material</span>
          ) : null}
          {actions.laborerPoolOptions.length === 0 && actions.laborerBuildingOptions.length === 0 && (
            <span className="action-hint">No laborer actions available</span>
          )}
        </>
      )}

      {actions.canSkip && (
        <button onClick={() => dispatch({ type: 'SKIP_ACTION' })}>
          Skip Action
        </button>
      )}
    </div>
  );
}
