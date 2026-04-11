import { useState, useEffect, useMemo } from 'react';
import { GameState, GameAction, MaterialType } from '../game/types';
import { getActivePlayerId, getAvailableActions } from '../game/engine';
import { getCardDef, MATERIAL_COLORS, isJackCard } from '../game/cards';
import { SCENARIOS } from '../game/scenarios';
import { PhaseIndicator } from './PhaseIndicator';
import { PlayerArea } from './PlayerArea';
import { HandView } from './HandView';
import { ActionBar } from './ActionBar';

interface GameBoardProps {
  state: GameState;
  dispatch: (action: GameAction) => void;
  onUndo?: () => void;
  onNewGame: () => void;
  onLoadState: (state: GameState) => void;
}

export function GameBoard({ state, dispatch, onUndo, onNewGame, onLoadState }: GameBoardProps) {
  const [selectedCardUid, setSelectedCardUid] = useState<number | null>(null);
  const [selectedBuildingIndex, setSelectedBuildingIndex] = useState<number | null>(null);
  const [selectedPoolMaterials, setSelectedPoolMaterials] = useState<MaterialType[]>([]);
  const [showDevTools, setShowDevTools] = useState(false);

  const activePlayerId = getActivePlayerId(state);

  // Reset selections on phase/player change
  useEffect(() => {
    setSelectedCardUid(null);
    setSelectedBuildingIndex(null);
    setSelectedPoolMaterials([]);
  }, [state.phase, activePlayerId]);

  // Auto-select building when only one matches the selected card during Craftsman
  useEffect(() => {
    if (selectedCardUid === null) return;
    const { phase } = state;
    if (phase.type !== 'action' || phase.ledRole !== 'Craftsman') return;
    const actions = getAvailableActions(state);
    const matchingBuildings = actions.craftsmanOptions
      .filter(o => o.cardUid === selectedCardUid)
      .map(o => o.buildingIndex);
    const uniqueBuildings = [...new Set(matchingBuildings)];
    if (uniqueBuildings.length === 1) {
      setSelectedBuildingIndex(uniqueBuildings[0]!);
    }
  }, [selectedCardUid, state]);

  // Compute highlighted cards and buildings based on current phase & available actions
  const { highlightedCardUids, highlightedBuildingIndices } = useMemo(() => {
    const cardUids = new Set<number>();
    const buildingIndices = new Set<number>();
    const actions = getAvailableActions(state);
    const { phase } = state;

    if (phase.type === 'follow') {
      for (const o of actions.followOptions) cardUids.add(o.cardUid);
    } else if (phase.type === 'legionary_demand') {
      for (const o of actions.legionaryGiveOptions) cardUids.add(o.cardUid);
    } else if (phase.type === 'action' && phase.ledRole === 'Legionary') {
      for (const o of actions.legionaryOptions) cardUids.add(o.cardUid);
    } else if (phase.type === 'action' && phase.ledRole === 'Architect') {
      for (const o of actions.architectOptions) cardUids.add(o.cardUid);
    } else if (phase.type === 'action' && phase.ledRole === 'Laborer') {
      for (const o of actions.laborerBuildingOptions) buildingIndices.add(o.buildingIndex);
    } else if (phase.type === 'action' && phase.ledRole === 'Craftsman') {
      if (selectedCardUid !== null && selectedBuildingIndex !== null) {
        // Both selected — highlight nothing (action is ready to confirm)
      } else if (selectedCardUid !== null) {
        // Card selected — highlight buildings that accept this card
        for (const o of actions.craftsmanOptions) {
          if (o.cardUid === selectedCardUid) buildingIndices.add(o.buildingIndex);
        }
        cardUids.add(selectedCardUid);
      } else if (selectedBuildingIndex !== null) {
        // Building selected — highlight cards that can go into this building
        for (const o of actions.craftsmanOptions) {
          if (o.buildingIndex === selectedBuildingIndex) cardUids.add(o.cardUid);
        }
        buildingIndices.add(selectedBuildingIndex);
      } else {
        // Nothing selected — highlight all valid cards and buildings
        for (const o of actions.craftsmanOptions) {
          cardUids.add(o.cardUid);
          buildingIndices.add(o.buildingIndex);
        }
      }
    }

    return { highlightedCardUids: cardUids, highlightedBuildingIndices: buildingIndices };
  }, [state, selectedCardUid, selectedBuildingIndex]);

  const handlePoolMaterialToggle = (material: MaterialType) => {
    setSelectedPoolMaterials(prev => {
      const existingCount = prev.filter(m => m === material).length;
      const poolCount = state.pool.filter(c => getCardDef(c).material === material).length;
      // Try to add first
      if (prev.length < 2 && existingCount < poolCount) {
        return [...prev, material];
      }
      // Otherwise remove one instance
      if (existingCount > 0) {
        const idx = prev.indexOf(material);
        return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      }
      return prev;
    });
  };

  const activePlayer = activePlayerId !== null ? state.players[activePlayerId] : null;

  return (
    <div className="game-board">
      <div className="top-bar">
        <PhaseIndicator state={state} />
        <div className="top-bar-buttons">
          {onUndo && <button className="top-btn" onClick={onUndo}>Undo</button>}
          <button className="top-btn" onClick={onNewGame}>New Game</button>
          <button className="top-btn" onClick={() => setShowDevTools(v => !v)}>
            {showDevTools ? 'Hide Dev' : 'Dev'}
          </button>
        </div>
      </div>

      {showDevTools && (
        <div className="dev-tools">
          <button className="top-btn" onClick={() => {
            const json = JSON.stringify(state, null, 2);
            navigator.clipboard.writeText(json);
          }}>
            Copy State
          </button>
          <button className="top-btn" onClick={() => {
            const encoded = btoa(encodeURIComponent(JSON.stringify(state)));
            const url = `${window.location.origin}${window.location.pathname}#state=${encoded}`;
            navigator.clipboard.writeText(url);
          }}>
            Copy URL
          </button>
          <button className="top-btn" onClick={async () => {
            try {
              const json = await navigator.clipboard.readText();
              onLoadState(JSON.parse(json));
            } catch {
              const json = prompt('Paste game state JSON:');
              if (json) onLoadState(JSON.parse(json));
            }
          }}>
            Import State
          </button>
          <select
            className="scenario-select"
            value=""
            onChange={e => {
              const idx = parseInt(e.target.value);
              if (!isNaN(idx)) onLoadState(SCENARIOS[idx]!.state);
            }}
          >
            <option value="" disabled>Load Scenario...</option>
            {SCENARIOS.map((s, i) => (
              <option key={i} value={i}>{s.name} — {s.description}</option>
            ))}
          </select>
        </div>
      )}

      {state.pool.length > 0 && (
        <div className="pool-section">
          <span className="pool-label">Pool ({state.pool.length})</span>
          <div className="pool-cards">
            {(() => {
              const counts: Partial<Record<MaterialType, number>> = {};
              let jackCount = 0;
              for (const card of state.pool) {
                if (isJackCard(card)) {
                  jackCount++;
                } else {
                  const mat = getCardDef(card).material;
                  counts[mat] = (counts[mat] ?? 0) + 1;
                }
              }
              return (
                <>
                  {jackCount > 0 && (
                    <div key="jack" className="pool-chip" style={{ backgroundColor: '#222', color: '#fff' }}>
                      {jackCount} Jack
                    </div>
                  )}
                  {(Object.entries(counts) as [MaterialType, number][]).map(([mat, count]) => (
                    <div key={mat} className="pool-chip" style={{ backgroundColor: MATERIAL_COLORS[mat] }}>
                      {count} {mat}
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      )}

      <div className="generic-supply-section">
        <span className="pool-label">Jack Pile</span>
        <div className="pool-cards">
          <div className="pool-chip" style={{ backgroundColor: '#222', color: '#fff' }}>
            {state.jackPile} Jacks
          </div>
        </div>
        <span className="pool-label" style={{ marginLeft: '1rem' }}>Generic Supply</span>
        <div className="pool-cards">
          {(Object.keys(state.genericSupply) as MaterialType[]).map(mat => (
            <div key={mat} className="pool-chip" style={{ backgroundColor: MATERIAL_COLORS[mat] }}>
              {state.genericSupply[mat]} {mat}
            </div>
          ))}
        </div>
        <span className="pool-label" style={{ marginLeft: '1rem' }}>Sites</span>
        <div className="pool-cards">
          {(Object.keys(state.sites) as MaterialType[]).map(mat => (
            <div key={mat} className="pool-chip" style={{ backgroundColor: MATERIAL_COLORS[mat] }}>
              {state.sites[mat]} {mat}
            </div>
          ))}
        </div>
      </div>

      <div className="players-section">
        {state.players.map(player => {
          const isActive = player.id === activePlayerId;
          return (
            <div key={player.id} className="player-column">
              <PlayerArea
                player={player}
                gameState={state}
                isActive={isActive}
                selectedBuildingIndex={isActive ? selectedBuildingIndex ?? undefined : undefined}
                highlightedBuildingIndices={isActive ? highlightedBuildingIndices : undefined}
                onSelectBuilding={
                  isActive ? (idx) => setSelectedBuildingIndex(idx) : undefined
                }
              />
              <HandView
                cards={player.hand}
                selectedCardUid={isActive ? selectedCardUid : null}
                highlightedCardUids={isActive ? highlightedCardUids : undefined}
                onSelectCard={isActive ? setSelectedCardUid : undefined}
                playerName={player.name}
              />
            </div>
          );
        })}
      </div>

      {activePlayer && (
        <div className="active-section">
          <ActionBar
            state={state}
            selectedCardUid={selectedCardUid}
            selectedBuildingIndex={selectedBuildingIndex}
            selectedPoolMaterials={selectedPoolMaterials}
            onPoolMaterialToggle={handlePoolMaterialToggle}
            dispatch={dispatch}
          />
        </div>
      )}
    </div>
  );
}
