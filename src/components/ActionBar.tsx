import { useState } from 'react';
import { GameState, GameAction, MaterialType, ActiveRole } from '../game/types';
import { getAvailableActions, getActivePlayerId, countRemainingActions, getEffectiveHandLimit, getPendingThinkCardCount } from '../game/engine';
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
  const [cmSelectedMaterials, setCmSelectedMaterials] = useState<MaterialType[]>([]);

  // Check if user has ctrl-selected same-material non-Jack cards (3 = wild, 2 = Circus)
  const multiCardFromSelection = (() => {
    if (selectedCardUids.length < 2 || selectedCardUids.length > 3) return null;
    const playerId = getActivePlayerId(state);
    if (playerId === null) return null;
    const player = state.players[playerId]!;
    const cards = selectedCardUids.map(uid => player.hand.find(c => c.uid === uid));
    if (cards.some(c => !c || isJackCard(c))) return null;
    const materials = cards.map(c => getCardDef(c!).material);
    if (!materials.every(m => m === materials[0])) return null;
    return {
      cardUid: selectedCardUids[0]!,
      extraCardUids: selectedCardUids.slice(1),
      count: selectedCardUids.length,
    };
  })();
  const threeOakFromSelection = multiCardFromSelection?.count === 3 ? multiCardFromSelection : null;
  const hasCircus = (() => {
    const playerId = getActivePlayerId(state);
    if (playerId === null) return false;
    const player = state.players[playerId]!;
    return player.buildings.some(b => b.completed && getCardDef(b.foundationCard).id === 'circus');
  })();
  const circusFromSelection = multiCardFromSelection?.count === 2 && hasCircus ? multiCardFromSelection : null;

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
              Refresh (Draw {(() => {
                const pid = getActivePlayerId(state);
                const limit = pid !== null ? getEffectiveHandLimit(state, pid) : state.handLimit;
                const currentSize = pid !== null ? state.players.find(p => p.id === pid)!.hand.length + getPendingThinkCardCount(state, pid) : 0;
                return Math.max(0, limit - currentSize);
              })()})
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
          {actions.vomitoriumAvailable && (
            <>
              <span className="action-label" style={{ marginLeft: '0.5rem' }}>Vomitorium:</span>
              <button onClick={() => dispatch({ type: 'THINK', option: { kind: 'refresh' }, vomitorium: { keepJacks: true } })}>
                Discard + Refresh (keep Jacks)
              </button>
              <button onClick={() => dispatch({ type: 'THINK', option: { kind: 'refresh' }, vomitorium: { keepJacks: false } })}>
                Discard + Refresh (discard Jacks)
              </button>
            </>
          )}
          {actions.latrineAvailable && selectedCardUid !== null && !isJackCard({ uid: selectedCardUid, defId: '' }) && (
            <>
              <span className="action-label" style={{ marginLeft: '0.5rem' }}>Latrine:</span>
              {thinkOptions.canRefresh && (
                <button onClick={() => dispatch({ type: 'THINK', option: { kind: 'refresh' }, latrineCardUid: selectedCardUid })}>
                  Discard 1 + Refresh
                </button>
              )}
              {thinkOptions.canDraw1 && (
                <button onClick={() => dispatch({ type: 'THINK', option: { kind: 'draw1' }, latrineCardUid: selectedCardUid })}>
                  Discard 1 + Draw 1
                </button>
              )}
            </>
          )}
        </div>
      )}

      {actions.senateDrawsRemaining > 0 && (
        <div className="think-options">
          <span className="think-label">Senate Refresh ({actions.senateDrawsRemaining} left):</span>
          {actions.senateDrawOptions.canDraw1 && (
            <button onClick={() => dispatch({ type: 'SENATE_DRAW', option: { kind: 'draw1' } })}>
              Draw from Deck
            </button>
          )}
          <button
            disabled={!actions.senateDrawOptions.canDrawJack}
            onClick={() => dispatch({ type: 'SENATE_DRAW', option: { kind: 'jack' } })}
          >
            Jack ({state.jackPile})
          </button>
          {actions.senateDrawOptions.genericMaterials.map((mat: MaterialType) => {
            const count = state.genericSupply[mat];
            return count > 0 ? (
              <button
                key={mat}
                style={{ backgroundColor: MATERIAL_COLORS[mat], color: '#000' }}
                onClick={() => dispatch({ type: 'SENATE_DRAW', option: { kind: 'generic', material: mat } })}
              >
                {mat} ({count})
              </button>
            ) : null;
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
          : circusFromSelection
            ? ALL_ROLES.map(role => (
                <button
                  key={`circus-${role}`}
                  onClick={() => dispatch({ type: 'LEAD_ROLE', role, cardUid: circusFromSelection.cardUid, extraCardUids: circusFromSelection.extraCardUids })}
                >
                  Lead {role} (Circus)
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
                    ? 'Select a card to lead (Ctrl+click 2+ same material for wild)'
                    : 'No cards to lead with'}
                </span>
      )}
      {phase.type === 'lead' && actions.palaceLeadOptions.length > 0 && (
        <div className="palace-options">
          {actions.palaceLeadOptions.map((opt, i) => (
            <button key={`palace-lead-${i}`} onClick={() => dispatch({
              type: 'LEAD_ROLE', role: opt.role, cardUid: opt.cardUid, extraCardUids: opt.extraCardUids, palace: true
            })}>
              Palace: Lead {opt.role} ({1 + opt.extraCardUids.length} actions)
            </button>
          ))}
        </div>
      )}

      {phase.type === 'follow' && (
        <>
          {threeOakFromSelection ? (
            <button onClick={() => dispatch({ type: 'FOLLOW_ROLE', cardUid: threeOakFromSelection.cardUid, extraCardUids: threeOakFromSelection.extraCardUids })}>
              Follow {phase.ledRole} (3 of a kind)
            </button>
          ) : circusFromSelection ? (
            <button onClick={() => dispatch({ type: 'FOLLOW_ROLE', cardUid: circusFromSelection.cardUid, extraCardUids: circusFromSelection.extraCardUids })}>
              Follow {phase.ledRole} (Circus)
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
                ? `Select a ${ROLE_TO_MATERIAL[phase.ledRole]} card to follow (Ctrl+click 2+ same material for wild)`
                : `No matching cards to follow ${phase.ledRole}`}
            </span>
          )}
          {actions.palaceFollowOptions.length > 0 && actions.palaceFollowOptions.map((opt, i) => (
            <button key={`palace-follow-${i}`} onClick={() => dispatch({
              type: 'FOLLOW_ROLE', cardUid: opt.cardUid, extraCardUids: opt.extraCardUids, palace: true
            })}>
              Palace: Follow ({1 + opt.extraCardUids.length} actions)
            </button>
          ))}
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
            actions.craftsmanOptions.filter(o => !o.fromPool).length > 0
              ? <span className="action-hint">Select a card and an in-progress building to add material</span>
              : null
          )}
          {selectedBuildingIndex !== null && actions.craftsmanOptions.some(o => o.fromPool && o.buildingIndex === selectedBuildingIndex) && (
            <button onClick={() => dispatch({
              type: 'CRAFTSMAN_ADD',
              buildingIndex: selectedBuildingIndex,
              cardUid: 0,
              fromPool: true,
            })}>
              Scriptorium: Add from Pool to Building
            </button>
          )}
          {actions.fountainAvailable && (
            <button onClick={() => dispatch({ type: 'FOUNTAIN_FLIP' })}>
              Fountain: Flip from Deck
            </button>
          )}
          {actions.stairwayOptions.length > 0 && (
            <button onClick={() => {
              const opt = actions.stairwayOptions[0]!;
              dispatch({ type: 'STAIRWAY_ADD', targetPlayerId: opt.targetPlayerId, buildingIndex: opt.buildingIndex, cardUid: opt.cardUid, fromPool: opt.fromPool, fromStockpile: opt.fromStockpile });
            }}>
              Stairway: Continue opponent building
            </button>
          )}
          {actions.craftsmanOptions.length === 0 && !actions.fountainAvailable && actions.stairwayOptions.length === 0 && (
            <span className="action-hint">No valid craftsman actions</span>
          )}
        </>
      )}

      {phase.type === 'action' && (phase.ledRole === 'Merchant' || actions.pendingAbilityKind === 'bath' && actions.bathRole === 'Merchant') && (
        <>
          {actions.merchantOptions.length > 0 ? (
            <div className="merchant-vault-select">
              <span className="action-label">{actions.pendingAbilityKind === 'bath' ? 'Bath — ' : ''}Move to Vault from Stockpile:</span>
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
          ) : !actions.vaultFull && actions.bazaarOptions.length === 0 && !actions.atriumAvailable ? (
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
          {actions.atriumAvailable && (
            <button onClick={() => dispatch({ type: 'ATRIUM_MERCHANT' })}>
              Atrium: Deck to Vault
            </button>
          )}
        </>
      )}

      {phase.type === 'action' && phase.ledRole === 'Legionary' && (
        <>
          {actions.legionaryOptions.length > 0 ? (
            selectedCardUid !== null && actions.legionaryOptions.some(o => o.cardUid === selectedCardUid) ? (
              <>
                <button onClick={() => dispatch({ type: 'LEGIONARY_REVEAL', cardUid: selectedCardUid })}>
                  Demand {(() => {
                    const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                    return card ? getCardDef(card).material : '?';
                  })()}
                </button>
                {actions.bridgeLegionaryOptions.some(o => o.cardUid === selectedCardUid) && (
                  <button onClick={() => dispatch({ type: 'LEGIONARY_REVEAL', cardUid: selectedCardUid, bridge: true })}>
                    Bridge: Take {(() => {
                      const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                      return card ? getCardDef(card).material : '?';
                    })()} from Stockpiles
                  </button>
                )}
              </>
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

      {phase.type === 'action' && phase.ledRole === 'Patron' && !actions.pendingAbilityKind && (
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
              {actions.circusMaximusAvailable && actions.patronOptions.map(mat =>
                state.genericSupply[mat] > 0 ? (
                  <button
                    key={`cm-${mat}`}
                    style={{ backgroundColor: MATERIAL_COLORS[mat] }}
                    onClick={() => dispatch({
                      type: 'PATRON_HIRE',
                      material: mat,
                      circusMaximus: true,
                    })}
                  >
                    {mat} + CM
                  </button>
                ) : null
              )}
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
            actions.laborerBuildingOptions.some(o => o.buildingIndex === selectedBuildingIndex && !o.fromPool) ? (
            <button onClick={() => {
              const opt = actions.laborerBuildingOptions.find(o => o.buildingIndex === selectedBuildingIndex && !o.fromPool)!;
              dispatch({
                type: 'LABORER_STOCKPILE_TO_BUILDING',
                material: opt.material,
                buildingIndex: selectedBuildingIndex,
              });
            }}>
              Add from Stockpile to Building
            </button>
          ) : actions.laborerBuildingOptions.filter(o => !o.fromPool).length > 0 ? (
            <span className="action-hint">Select an in-progress building to add stockpile material</span>
          ) : null}
          {selectedBuildingIndex !== null &&
            actions.laborerBuildingOptions.some(o => o.buildingIndex === selectedBuildingIndex && o.fromPool) && (
            <button onClick={() => {
              const opt = actions.laborerBuildingOptions.find(o => o.buildingIndex === selectedBuildingIndex && o.fromPool)!;
              dispatch({
                type: 'LABORER_STOCKPILE_TO_BUILDING',
                material: opt.material,
                buildingIndex: selectedBuildingIndex,
                fromPool: true,
              });
            }}>
              Scriptorium: Add from Pool to Building
            </button>
          )}
          {actions.laborerPoolOptions.length === 0 && actions.laborerBuildingOptions.length === 0 && actions.laborerHandOptions.length === 0 && (
            <span className="action-hint">No laborer actions available</span>
          )}
        </>
      )}

      {actions.pendingAbilityKind === 'quarry' && (
        <>
          <span className="action-label">Quarry: Free Craftsman action —</span>
          {selectedCardUid !== null && selectedBuildingIndex !== null &&
            actions.quarryCraftsmanOptions.some(o => o.cardUid === selectedCardUid && o.buildingIndex === selectedBuildingIndex && !o.fromPool) ? (
            <button onClick={() => dispatch({
              type: 'QUARRY_CRAFTSMAN',
              buildingIndex: selectedBuildingIndex,
              cardUid: selectedCardUid,
            })}>
              Quarry: Add Material to Building
            </button>
          ) : (
            actions.quarryCraftsmanOptions.filter(o => !o.fromPool).length > 0
              ? <span className="action-hint">Select a card and a building</span>
              : null
          )}
          {selectedBuildingIndex !== null &&
            actions.quarryCraftsmanOptions.some(o => o.fromPool && o.buildingIndex === selectedBuildingIndex) && (
            <button onClick={() => dispatch({
              type: 'QUARRY_CRAFTSMAN',
              buildingIndex: selectedBuildingIndex,
              cardUid: 0,
              fromPool: true,
            })}>
              Quarry + Scriptorium: Add from Pool
            </button>
          )}
        </>
      )}

      {actions.pendingAbilityKind === 'encampment' && (
        <>
          <span className="action-label">Encampment: Start building of same type —</span>
          {selectedCardUid !== null && actions.encampmentOptions.some(o => o.cardUid === selectedCardUid) ? (
            <button onClick={() => {
              const opt = actions.encampmentOptions.find(o => o.cardUid === selectedCardUid)!;
              dispatch({
                type: 'ENCAMPMENT_START',
                cardUid: selectedCardUid,
                outOfTown: opt.outOfTown,
              });
            }}>
              Encampment: Start {(() => {
                const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                return card ? getCardDef(card).name : '?';
              })()}{actions.encampmentOptions.find(o => o.cardUid === selectedCardUid)?.outOfTown ? ' (Out of Town)' : ''}
            </button>
          ) : (
            <span className="action-hint">Select a card to start as a building</span>
          )}
        </>
      )}

      {actions.canJunkyard && (
        <>
          <span className="action-label">Junkyard: Hand to Stockpile —</span>
          <button onClick={() => dispatch({ type: 'JUNKYARD_ACTIVATE', keepJacks: true })}>
            Move Hand to Stockpile{actions.hasJacksForJunkyard ? ' (keep Jacks)' : ''}
          </button>
          {actions.hasJacksForJunkyard && (
            <button onClick={() => dispatch({ type: 'JUNKYARD_ACTIVATE', keepJacks: false })}>
              Move Hand to Stockpile (discard Jacks)
            </button>
          )}
        </>
      )}

      {actions.canFoundry && (
        <>
          <span className="action-label">Foundry: Move to Stockpile —</span>
          {actions.foundryHasPool && actions.foundryHasHand && (
            <button onClick={() => dispatch({ type: 'FOUNDRY_ACTIVATE', takePool: true, takeHand: true })}>
              Pool + Hand
            </button>
          )}
          {actions.foundryHasPool && (
            <button onClick={() => dispatch({ type: 'FOUNDRY_ACTIVATE', takePool: true, takeHand: false })}>
              Pool only
            </button>
          )}
          {actions.foundryHasHand && (
            <button onClick={() => dispatch({ type: 'FOUNDRY_ACTIVATE', takePool: false, takeHand: true })}>
              Hand only (discard Jacks)
            </button>
          )}
        </>
      )}

      {(actions.pendingAbilityKind === 'school' || actions.pendingAbilityKind === 'stage' || actions.pendingAbilityKind === 'academy') && (
        <>
          <span className="action-label">
            {actions.pendingAbilityKind === 'school' ? `School: Think (${actions.remainingAbilityThinks} left)` : actions.pendingAbilityKind === 'stage' ? 'Stage: Think' : 'Academy: Think'} —
          </span>
          {actions.abilityThinkOptions.canRefresh && (
            <button onClick={() => dispatch({ type: 'ABILITY_THINK', option: { kind: 'refresh' } })}>
              Refresh (Draw {(() => {
                const pid = getActivePlayerId(state);
                const limit = pid !== null ? getEffectiveHandLimit(state, pid) : state.handLimit;
                const currentSize = pid !== null ? state.players.find(p => p.id === pid)!.hand.length + getPendingThinkCardCount(state, pid) : 0;
                return Math.max(0, limit - currentSize);
              })()})
            </button>
          )}
          {actions.abilityThinkOptions.canDraw1 && (
            <button onClick={() => dispatch({ type: 'ABILITY_THINK', option: { kind: 'draw1' } })}>
              Draw 1
            </button>
          )}
          <button
            disabled={!actions.abilityThinkOptions.canDrawJack}
            onClick={() => dispatch({ type: 'ABILITY_THINK', option: { kind: 'jack' } })}
          >
            Jack ({state.jackPile})
          </button>
          {actions.abilityThinkOptions.genericMaterials.map((mat: MaterialType) => {
            const count = state.genericSupply[mat];
            return count > 0 ? (
              <button
                key={mat}
                style={{ backgroundColor: MATERIAL_COLORS[mat], color: '#000' }}
                onClick={() => dispatch({ type: 'ABILITY_THINK', option: { kind: 'generic', material: mat } })}
              >
                {mat} ({count})
              </button>
            ) : null;
          })}
        </>
      )}

      {actions.pendingAbilityKind === 'amphitheatre' && (
        <>
          <span className="action-label">Amphitheatre: Craftsman action ({actions.remainingAbilityCraftsman} left) —</span>
          {selectedCardUid !== null && selectedBuildingIndex !== null &&
            actions.abilityCraftsmanOptions.some(o => o.cardUid === selectedCardUid && o.buildingIndex === selectedBuildingIndex && !o.fromPool) ? (
            <button onClick={() => dispatch({
              type: 'ABILITY_CRAFTSMAN',
              buildingIndex: selectedBuildingIndex,
              cardUid: selectedCardUid,
            })}>
              Add Material to Building
            </button>
          ) : (
            actions.abilityCraftsmanOptions.filter(o => !o.fromPool).length > 0
              ? <span className="action-hint">Select a card and a building</span>
              : null
          )}
          {selectedBuildingIndex !== null &&
            actions.abilityCraftsmanOptions.some(o => o.fromPool && o.buildingIndex === selectedBuildingIndex) && (
            <button onClick={() => dispatch({
              type: 'ABILITY_CRAFTSMAN',
              buildingIndex: selectedBuildingIndex,
              cardUid: 0,
              fromPool: true,
            })}>
              Scriptorium: Add from Pool
            </button>
          )}
        </>
      )}

      {actions.pendingAbilityKind === 'aqueduct' && (
        <>
          <span className="action-label">Aqueduct: Patron action —</span>
          {actions.abilityPatronOptions.length > 0 ? (
            <div className="patron-hire-select">
              <span className="action-label">Hire from Pool:</span>
              {actions.abilityPatronOptions.map(mat => (
                <button
                  key={mat}
                  style={{ backgroundColor: MATERIAL_COLORS[mat] }}
                  onClick={() => dispatch({ type: 'ABILITY_PATRON', material: mat })}
                >
                  {mat}
                </button>
              ))}
              {actions.circusMaximusAvailable && actions.abilityPatronOptions.map(mat =>
                state.genericSupply[mat] > 0 ? (
                  <button
                    key={`cm-${mat}`}
                    style={{ backgroundColor: MATERIAL_COLORS[mat] }}
                    onClick={() => dispatch({ type: 'ABILITY_PATRON', material: mat, circusMaximus: true })}
                  >
                    {mat} + CM
                  </button>
                ) : null
              )}
            </div>
          ) : (
            <span className="action-hint">No patron actions available</span>
          )}
        </>
      )}

      {actions.pendingAbilityKind === 'bar' && !actions.barRevealedCard && (
        <>
          <span className="action-label">Bar —</span>
          {actions.barCanFlip && (
            <button onClick={() => dispatch({ type: 'BAR_FLIP' })}>
              Flip Top Card
            </button>
          )}
        </>
      )}

      {actions.pendingAbilityKind === 'bar' && actions.barRevealedCard && (
        <>
          <span className="action-label">
            Bar: Revealed {getCardDef(actions.barRevealedCard).name} ({getCardDef(actions.barRevealedCard).material}) —
          </span>
          {actions.barCanClientele && (
            <button onClick={() => dispatch({ type: 'BAR_CHOOSE', toClientele: true })}>
              To Clientele
            </button>
          )}
          {actions.barCanClientele && actions.circusMaximusAvailable &&
            state.genericSupply[getCardDef(actions.barRevealedCard).material] > 0 && (
            <button onClick={() => dispatch({ type: 'BAR_CHOOSE', toClientele: true, circusMaximus: true })}>
              To Clientele + CM
            </button>
          )}
          <button onClick={() => dispatch({ type: 'BAR_CHOOSE', toClientele: false })}>
            To Pool
          </button>
        </>
      )}

      {actions.pendingAbilityKind === 'bath' && actions.bathRole && (
        <>
          <span className="action-label">Bath: {actions.bathRole} action —</span>
          {actions.bathRole === 'Architect' && (
            selectedCardUid !== null && actions.architectOptions.some(o => o.cardUid === selectedCardUid) ? (
              <button onClick={() => {
                const opt = actions.architectOptions.find(o => o.cardUid === selectedCardUid)!;
                dispatch({ type: 'ARCHITECT_START', cardUid: selectedCardUid, outOfTown: opt.outOfTown });
              }}>
                Start Building: {(() => {
                  const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                  return card ? getCardDef(card).name : '?';
                })()}
              </button>
            ) : (
              <span className="action-hint">
                {actions.architectOptions.length > 0 ? 'Select a card to start as building' : 'No valid buildings'}
              </span>
            )
          )}
          {actions.bathRole === 'Craftsman' && (
            selectedIsCraftsmanValid ? (
              <button onClick={() => dispatch({
                type: 'CRAFTSMAN_ADD',
                buildingIndex: selectedBuildingIndex!,
                cardUid: selectedCardUid!,
              })}>
                Add Material to Building
              </button>
            ) : (
              <span className="action-hint">
                {actions.craftsmanOptions.length > 0 ? 'Select a card and building' : 'No valid craftsman actions'}
              </span>
            )
          )}
          {actions.bathRole === 'Legionary' && (
            selectedCardUid !== null && actions.legionaryOptions.some(o => o.cardUid === selectedCardUid) ? (
              <button onClick={() => dispatch({ type: 'LEGIONARY_REVEAL', cardUid: selectedCardUid })}>
                Demand {(() => {
                  const card = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid);
                  return card ? getCardDef(card).material : '?';
                })()}
              </button>
            ) : (
              <span className="action-hint">
                {actions.legionaryOptions.length > 0 ? 'Select a card to reveal' : 'No cards for Legionary'}
              </span>
            )
          )}
        </>
      )}

      {actions.pendingAbilityKind === 'sanctuary' && actions.sanctuaryOptions.length > 0 && (
        <>
          <span className="action-label">Sanctuary: Steal a client —</span>
          {actions.sanctuaryOptions.map((opt, i) => (
            <button key={`sanc-${i}`} style={{ backgroundColor: MATERIAL_COLORS[opt.material] }}
              onClick={() => dispatch({ type: 'SANCTUARY_STEAL', targetPlayerId: opt.targetPlayerId, material: opt.material })}>
              Steal {opt.material} from {state.players[opt.targetPlayerId]?.name}
            </button>
          ))}
        </>
      )}

      {actions.pendingAbilityKind === 'prison' && (
        <>
          <span className="action-label">Prison: Move up to {actions.prisonMaxCount} client(s) to Vault —</span>
          {selectedCardUid !== null && actions.prisonOptions.some(o => o.cardUid === selectedCardUid) ? (
            <button onClick={() => dispatch({ type: 'PRISON_MOVE', cardUids: [selectedCardUid] })}>
              Move selected to Vault
            </button>
          ) : <span className="action-hint">Select a client to move</span>}
        </>
      )}

      {actions.pendingAbilityKind === 'basilica' && (
        <>
          <span className="action-label">Basilica: Hand to Vault —</span>
          {selectedCardUid !== null && actions.basilicaOptions.some(o => o.cardUid === selectedCardUid) ? (
            <button onClick={() => dispatch({ type: 'BASILICA_VAULT', cardUid: selectedCardUid })}>
              Vault {(() => { const c = state.players.flatMap(p => p.hand).find(c => c.uid === selectedCardUid); return c ? getCardDef(c).name : '?'; })()}
            </button>
          ) : actions.basilicaOptions.length > 0 ? (
            <span className="action-hint">Select a card from hand</span>
          ) : null}
        </>
      )}

      {actions.pendingAbilityKind === 'fountain' && actions.fountainFlippedCard && (
        <>
          <span className="action-label">Fountain: {getCardDef(actions.fountainFlippedCard).name} ({getCardDef(actions.fountainFlippedCard).material}) —</span>
          {selectedBuildingIndex !== null && actions.fountainBuildingOptions.includes(selectedBuildingIndex) && (
            <button onClick={() => dispatch({ type: 'FOUNTAIN_CHOOSE', buildingIndex: selectedBuildingIndex })}>Add to Building</button>
          )}
          <button onClick={() => dispatch({ type: 'FOUNTAIN_CHOOSE' })}>Add to Hand</button>
        </>
      )}

      {actions.pendingAbilityKind === 'circus_maximus_completion' && (
        <>
          <span className="action-label">Circus Maximus: Duplicate clients ({cmSelectedMaterials.length}/{actions.circusMaximusCompletionSlots} slots) —</span>
          <div className="patron-hire-select">
            {(() => {
              // Group available materials with counts
              const available = actions.circusMaximusCompletionMaterials;
              const slots = actions.circusMaximusCompletionSlots;
              const atCapacity = cmSelectedMaterials.length >= slots;
              const matCounts = new Map<MaterialType, number>();
              for (const m of available) matCounts.set(m, (matCounts.get(m) ?? 0) + 1);
              const selectedCounts = new Map<MaterialType, number>();
              for (const m of cmSelectedMaterials) selectedCounts.set(m, (selectedCounts.get(m) ?? 0) + 1);
              return [...matCounts.entries()].map(([mat, count]) => {
                const selCount = selectedCounts.get(mat) ?? 0;
                const canAdd = selCount < count && !atCapacity;
                return (
                  <button
                    key={mat}
                    className={selCount > 0 ? 'pool-selected' : ''}
                    style={{ backgroundColor: MATERIAL_COLORS[mat] }}
                    onClick={() => {
                      if (canAdd) {
                        setCmSelectedMaterials(prev => [...prev, mat]);
                      } else if (selCount > 0) {
                        setCmSelectedMaterials(prev => {
                          const idx = prev.indexOf(mat);
                          return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
                        });
                      }
                    }}
                  >
                    {mat} ({count}){selCount > 0 ? ` [${selCount} sel]` : ''}
                  </button>
                );
              });
            })()}
            <button onClick={() => {
              dispatch({ type: 'CIRCUS_MAXIMUS_CHOOSE', materials: cmSelectedMaterials });
              setCmSelectedMaterials([]);
            }}>
              Confirm ({cmSelectedMaterials.length})
            </button>
            {cmSelectedMaterials.length > 0 && (
              <button onClick={() => setCmSelectedMaterials([])}>Clear</button>
            )}
          </div>
        </>
      )}

      {actions.canSkip && (
        <button onClick={() => dispatch({ type: 'SKIP_ACTION' })}>
          {actions.pendingAbilityKind ? `Skip ${actions.pendingAbilityKind.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}` : 'Skip Action'}
        </button>
      )}
    </div>
  );
}
