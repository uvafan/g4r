import { GameState, GameAction, MaterialType, ActiveRole } from '../game/types';
import { getAvailableActions, getActivePlayerId, countRemainingActions, getEffectiveHandLimit } from '../game/engine';
import { getCardDef, MATERIAL_COLORS, ROLE_TO_MATERIAL, isJackCard } from '../game/cards';

interface ActionBarProps {
  state: GameState;
  selectedCardUid: number | null;
  selectedCardUids: number[];
  selectedBuildingIndex: number | null;
  selectedPoolMaterials: MaterialType[];
  onPoolMaterialToggle: (material: MaterialType) => void;
  craneFirstCardUid: number | null;
  onCraneFirstCard: (uid: number) => void;
  onCraneCancel: () => void;
  dispatch: (action: GameAction) => void;
}

const ALL_ROLES: ActiveRole[] = ['Architect', 'Craftsman', 'Laborer', 'Legionary', 'Merchant', 'Patron'];

export function ActionBar({ state, selectedCardUid, selectedCardUids, selectedBuildingIndex, selectedPoolMaterials, onPoolMaterialToggle, craneFirstCardUid, onCraneFirstCard, onCraneCancel, dispatch }: ActionBarProps) {
  const actions = getAvailableActions(state);
  const { phase } = state;
  const { thinkOptions } = actions;

  // Check if user has ctrl-selected exactly 3 same-material non-Jack cards
  const threeOakFromSelection = (() => {
    if (selectedCardUids.length !== 3) return null;
    const playerId = getActivePlayerId(state);
    if (playerId === null) return null;
    const player = state.players[playerId]!;
    const cards = selectedCardUids.map(uid => player.hand.find(c => c.uid === uid));
    if (cards.some(c => !c || isJackCard(c))) return null;
    const materials = cards.map(c => getCardDef(c!).material);
    if (materials[0] !== materials[1] || materials[1] !== materials[2]) return null;
    return {
      cardUid: selectedCardUids[0]!,
      extraCardUids: [selectedCardUids[1]!, selectedCardUids[2]!],
    };
  })();

  const selectedIsLeadable = selectedCardUid !== null &&
    actions.leadOptions.some(o => o.cardUid === selectedCardUid);
  const normalLeadOptions = selectedCardUid !== null
    ? actions.leadOptions.filter(o => o.cardUid === selectedCardUid && !o.extraCardUids)
    : [];
  const normalLeadRoles = [...new Set(normalLeadOptions.map(o => o.role))];

  const selectedIsFollowable = selectedCardUid !== null &&
    actions.followOptions.some(o => o.cardUid === selectedCardUid);
  const normalFollowOption = selectedCardUid !== null
    ? actions.followOptions.find(o => o.cardUid === selectedCardUid && !o.extraCardUids)
    : undefined;

  const selectedArchitectOption = selectedCardUid !== null
    ? actions.architectOptions.find(o => o.cardUid === selectedCardUid)
    : undefined;
  const selectedIsArchitectValid = !!selectedArchitectOption;

  const selectedIsCraftsmanValid = selectedCardUid !== null && selectedBuildingIndex !== null &&
    actions.craftsmanOptions.some(o => o.cardUid === selectedCardUid && o.buildingIndex === selectedBuildingIndex);

  const remainingActions = phase.type === 'action'
    ? (() => {
        const playerId = getActivePlayerId(state);
        if (playerId === null) return null;
        return countRemainingActions(playerId, phase.actors, phase.currentActorIndex);
      })()
    : null;

  return (
    <div className="action-bar">
      {remainingActions !== null && (
        <span className="actions-remaining">
          {remainingActions} {phase.type === 'action' ? phase.ledRole : ''} action{remainingActions !== 1 ? 's' : ''} remaining
        </span>
      )}

      {actions.canThink && (
        <div className="think-options">
          <span className="think-label">Think:</span>
          {thinkOptions.canRefresh && (
            <button onClick={() => dispatch({ type: 'THINK', option: { kind: 'refresh' } })}>
              Refresh to {(() => {
                const pid = getActivePlayerId(state);
                return pid !== null ? getEffectiveHandLimit(state, pid) : state.handLimit;
              })()}
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
        threeOakFromSelection
          ? ALL_ROLES.map(role => (
              <button
                key={`3oak-${role}`}
                onClick={() => dispatch({ type: 'LEAD_ROLE', role, cardUid: threeOakFromSelection.cardUid, extraCardUids: threeOakFromSelection.extraCardUids })}
              >
                Lead {role} (3 of a kind)
              </button>
            ))
          : selectedIsLeadable
            ? normalLeadRoles.map(role => (
                <button
                  key={role}
                  onClick={() => selectedCardUid !== null && dispatch({ type: 'LEAD_ROLE', role, cardUid: selectedCardUid })}
                >
                  Lead {role}
                </button>
              ))
            : <span className="action-hint">
                {actions.leadOptions.length > 0
                  ? 'Select a card to lead (Ctrl+click 3 of same material for wild)'
                  : 'No cards to lead with'}
              </span>
      )}

      {phase.type === 'follow' && (
        <>
          {threeOakFromSelection ? (
            <button onClick={() => dispatch({ type: 'FOLLOW_ROLE', cardUid: threeOakFromSelection.cardUid, extraCardUids: threeOakFromSelection.extraCardUids })}>
              Follow {phase.ledRole} (3 of a kind)
            </button>
          ) : selectedIsFollowable ? (
            normalFollowOption && (
              <button onClick={() => dispatch({ type: 'FOLLOW_ROLE', cardUid: selectedCardUid! })}>
                Follow {phase.ledRole}
              </button>
            )
          ) : (
            <span className="action-hint">
              {actions.followOptions.length > 0
                ? `Select a ${ROLE_TO_MATERIAL[phase.ledRole]} card to follow (Ctrl+click 3 of same material for wild)`
                : `No matching cards to follow ${phase.ledRole}`}
            </span>
          )}
        </>
      )}

      {phase.type === 'action' && phase.ledRole === 'Architect' && (
        <>
          {craneFirstCardUid !== null ? (() => {
            // Crane step 2: first card locked in, waiting for second
            const firstName = (() => { const c = state.players.flatMap(p => p.hand).find(c => c.uid === craneFirstCardUid); return c ? getCardDef(c).name : '?'; })();
            // Check if selectedCardUid is a valid second crane card
            const craneOption = selectedCardUid !== null
              ? actions.architectCraneOptions.find(o =>
                  o.cardUid === craneFirstCardUid && o.craneCardUid === selectedCardUid)
                ?? actions.architectCraneOptions.find(o =>
                  o.craneCardUid === craneFirstCardUid && o.cardUid === selectedCardUid)
              : null;
            return (
              <>
                {craneOption ? (
                  <button onClick={() => {
                    dispatch({
                      type: 'ARCHITECT_START',
                      cardUid: craneOption.cardUid,
                      craneCardUid: craneOption.craneCardUid,
                    });
                    onCraneCancel();
                  }}>
                    Crane: Start {firstName} + {(() => {
                      const secondUid = craneOption.cardUid === craneFirstCardUid ? craneOption.craneCardUid : craneOption.cardUid;
                      const c = state.players.flatMap(p => p.hand).find(c => c.uid === secondUid);
                      return c ? getCardDef(c).name : '?';
                    })()}
                  </button>
                ) : (
                  <span className="action-hint">
                    Crane: {firstName} + ? — Select second card
                  </span>
                )}
                {(() => {
                  const firstArchOpt = actions.architectOptions.find(o => o.cardUid === craneFirstCardUid);
                  return firstArchOpt ? (
                    <button onClick={() => {
                      dispatch({ type: 'ARCHITECT_START', cardUid: craneFirstCardUid!, outOfTown: firstArchOpt.outOfTown });
                      onCraneCancel();
                    }}>
                      Start only {firstName}
                    </button>
                  ) : null;
                })()}
                <button onClick={onCraneCancel}>Cancel</button>
              </>
            );
          })() : (() => {
            const isCraneCandidate = selectedCardUid !== null && actions.architectCraneOptions.some(o =>
              o.cardUid === selectedCardUid || o.craneCardUid === selectedCardUid
            );
            return (
              <>
                {isCraneCandidate ? (
                  <button onClick={() => onCraneFirstCard(selectedCardUid!)}>
                    Start Building: {(() => {
                      const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                      return card ? getCardDef(card).name : '?';
                    })()} (Crane — select 2nd next)
                  </button>
                ) : selectedIsArchitectValid ? (
                  <button onClick={() => dispatch({ type: 'ARCHITECT_START', cardUid: selectedCardUid!, outOfTown: selectedArchitectOption!.outOfTown })}>
                    Start Building{selectedArchitectOption!.outOfTown ? ' (Out of Town)' : ''}: {(() => {
                      const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                      return card ? getCardDef(card).name : '?';
                    })()}
                  </button>
                ) : (
                  <span className="action-hint">
                    {actions.architectOptions.length > 0 || actions.architectCraneOptions.length > 0
                      ? 'Select a card from hand to start as a building'
                      : 'No valid buildings to start'}
                  </span>
                )}
              </>
            );
          })()}
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
          ) : !actions.vaultFull && actions.bazaarOptions.length === 0 ? (
            <span className="action-hint">No materials in stockpile to vault</span>
          ) : actions.vaultFull ? (
            <span className="action-hint">Vault is full (limited by influence)</span>
          ) : null}
          {actions.bazaarOptions.length > 0 && (
            <div className="merchant-vault-select">
              <span className="action-label">Bazaar — Move to Vault from Pool:</span>
              {actions.bazaarOptions.map(mat => (
                <button
                  key={`bazaar-${mat}`}
                  style={{ backgroundColor: MATERIAL_COLORS[mat] }}
                  onClick={() => dispatch({
                    type: 'MERCHANT_STOCKPILE_TO_VAULT',
                    material: mat,
                    fromPool: true,
                  })}
                >
                  {mat}
                </button>
              ))}
            </div>
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

      {phase.type === 'action' && phase.ledRole === 'Patron' && (
        <>
          {actions.patronOptions.length > 0 ? (
            <div className="patron-hire-select">
              <span className="action-label">Hire from Pool:</span>
              {actions.patronOptions.map(mat => (
                <button
                  key={mat}
                  style={{ backgroundColor: MATERIAL_COLORS[mat] }}
                  onClick={() => dispatch({
                    type: 'PATRON_HIRE',
                    material: mat,
                  })}
                >
                  {mat}
                </button>
              ))}
            </div>
          ) : (
            <span className="action-hint">No patron actions available</span>
          )}
        </>
      )}

      {phase.type === 'action' && phase.ledRole === 'Laborer' && (
        <>
          {actions.laborerHandOptions.length > 0 && (
            selectedCardUid !== null && actions.laborerHandOptions.some(o => o.cardUid === selectedCardUid) ? (
              <button onClick={() => dispatch({ type: 'LABORER_HAND_TO_STOCKPILE', cardUid: selectedCardUid })}>
                Dock: Hand to Stockpile ({(() => {
                  const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                  return card ? getCardDef(card).name : '?';
                })()})
              </button>
            ) : (
              <span className="action-hint">Dock: Select a card from hand to move to stockpile</span>
            )
          )}
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
          {actions.laborerPoolOptions.length === 0 && actions.laborerBuildingOptions.length === 0 && actions.laborerHandOptions.length === 0 && (
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
