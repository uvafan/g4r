import { useCallback, useEffect, useRef, useState } from 'react';
import { GameState, GameAction } from './game/types';
import { createInitialState, gameReducer } from './game/engine';
import { SCENARIOS } from './game/scenarios';
import { SetupScreen } from './components/SetupScreen';
import { GameBoard } from './components/GameBoard';

const STORAGE_KEY = 'g4r-game-state';
const HISTORY_KEY = 'g4r-undo-history';

const defaultState: GameState = {
  players: [],
  deck: [],
  pool: [],
  pendingPool: [],
  sites: { Rubble: 0, Wood: 0, Brick: 0, Concrete: 0, Stone: 0, Marble: 0 },
  genericSupply: { Rubble: 0, Wood: 0, Brick: 0, Concrete: 0, Stone: 0, Marble: 0 },
  jackPile: 0,
  nextUid: 0,
  phase: { type: 'setup' },
  handLimit: 5,
  playerCount: 0,
  leadPlayerIdx: 0,
};

function migrateState(state: GameState): GameState {
  const needsMigration = state.players.some(
    p => !('stockpile' in p) || !('vault' in p) || !('clientele' in p)
  );
  if (needsMigration) {
    return {
      ...state,
      players: state.players.map((p: any) => ({
        ...p,
        stockpile: ('stockpile' in p) ? p.stockpile : [],
        vault: ('vault' in p) ? p.vault : [],
        clientele: ('clientele' in p) ? p.clientele : [],
      })) as GameState['players'],
    };
  }
  return state;
}

function loadState(): GameState {
  // Check URL hash for encoded state
  if (window.location.hash.startsWith('#state=')) {
    try {
      const encoded = window.location.hash.slice('#state='.length);
      const json = decodeURIComponent(atob(encoded));
      // Clear the hash so it doesn't reload on refresh
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return migrateState(JSON.parse(json));
    } catch { /* fall through */ }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return migrateState(JSON.parse(saved));
  } catch { /* ignore corrupt data */ }
  return defaultState;
}

function loadHistory(): GameState[] {
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) return (JSON.parse(saved) as GameState[]).map(migrateState);
  } catch { /* ignore corrupt data */ }
  return [];
}

// Extend window for console access
declare global {
  interface Window {
    g4r: {
      loadState: (state: GameState) => void;
      getState: () => GameState;
      exportState: () => string;
      importState: (json: string) => void;
      loadScenario: (nameOrIndex: string | number) => void;
      scenarios: () => void;
    };
  }
}

export default function App() {
  const [state, setState] = useState(loadState);
  const historyRef = useRef<GameState[]>(loadHistory());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyRef.current));
  }, [state]);

  const loadGameState = useCallback((newState: GameState) => {
    historyRef.current = [];
    setState(migrateState(newState));
  }, []);

  // Expose console API
  useEffect(() => {
    window.g4r = {
      loadState: (s: GameState) => loadGameState(s),
      getState: () => state,
      exportState: () => JSON.stringify(state, null, 2),
      importState: (json: string) => loadGameState(JSON.parse(json)),
      loadScenario: (nameOrIndex: string | number) => {
        if (typeof nameOrIndex === 'number') {
          const scenario = SCENARIOS[nameOrIndex];
          if (!scenario) {
            console.error(`No scenario at index ${nameOrIndex}. Use g4r.scenarios() to list.`);
            return;
          }
          loadGameState(scenario.state);
          console.log(`Loaded: ${scenario.name}`);
          return;
        }
        const scenario = SCENARIOS.find(s =>
          s.name.toLowerCase().includes(nameOrIndex.toLowerCase())
        );
        if (!scenario) {
          console.error(`No scenario matching "${nameOrIndex}". Use g4r.scenarios() to list.`);
          return;
        }
        loadGameState(scenario.state);
        console.log(`Loaded: ${scenario.name}`);
      },
      scenarios: () => {
        console.table(SCENARIOS.map((s, i) => ({ index: i, name: s.name, description: s.description })));
      },
    };
  }, [state, loadGameState]);

  const dispatch = useCallback((action: GameAction) => {
    setState(prev => {
      let next: GameState;
      if (action.type === 'START_GAME') {
        next = createInitialState(action.playerCount, action.playerNames);
      } else {
        next = gameReducer(prev, action);
      }
      historyRef.current.push(prev);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev) setState(prev);
  }, []);

  const newGame = useCallback(() => {
    historyRef.current = [];
    setState(defaultState);
  }, []);

  if (state.phase.type === 'setup') {
    return (
      <SetupScreen
        onStart={(count, names) =>
          dispatch({ type: 'START_GAME', playerCount: count, playerNames: names })
        }
        onLoadState={loadGameState}
      />
    );
  }

  return (
    <GameBoard
      state={state}
      dispatch={dispatch}
      onUndo={historyRef.current.length > 0 ? undo : undefined}
      onNewGame={newGame}
      onLoadState={loadGameState}
    />
  );
}
