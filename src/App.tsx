import { useCallback, useEffect, useRef, useState } from 'react';
import { GameState, GameAction } from './game/types';
import { createInitialState, gameReducer } from './game/engine';
import { SetupScreen } from './components/SetupScreen';
import { GameBoard } from './components/GameBoard';

const STORAGE_KEY = 'g4r-game-state';
const HISTORY_KEY = 'g4r-undo-history';

const defaultState: GameState = {
  players: [],
  deck: [],
  pool: [],
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
  // Add stockpile to players if missing (added with Laborer role)
  const needsMigration = state.players.some(p => !('stockpile' in p));
  if (needsMigration) {
    return {
      ...state,
      players: state.players.map((p: any) => ('stockpile' in p) ? p : { ...p, stockpile: [] }) as GameState['players'],
    };
  }
  return state;
}

function loadState(): GameState {
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

export default function App() {
  const [state, setState] = useState(loadState);
  const historyRef = useRef<GameState[]>(loadHistory());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyRef.current));
  }, [state]);

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
      />
    );
  }

  return (
    <GameBoard
      state={state}
      dispatch={dispatch}
      onUndo={historyRef.current.length > 0 ? undo : undefined}
      onNewGame={newGame}
    />
  );
}
