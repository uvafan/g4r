import { useState } from 'react';
import { GameState } from '../game/types';
import { SCENARIOS } from '../game/scenarios';

interface SetupScreenProps {
  onStart: (playerCount: number, names: string[]) => void;
  onLoadState: (state: GameState) => void;
}

export function SetupScreen({ onStart, onLoadState }: SetupScreenProps) {
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);

  return (
    <div className="setup-screen">
      <h1>Glory 4 Rome</h1>
      <div className="setup-field">
        <label>Number of Players:</label>
        <select
          value={playerCount}
          onChange={e => setPlayerCount(Number(e.target.value))}
        >
          {[1, 2, 3, 4].map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      {Array.from({ length: playerCount }).map((_, i) => (
        <div key={i} className="setup-field">
          <label>Player {i + 1}:</label>
          <input
            value={names[i]}
            onChange={e => {
              const newNames = [...names];
              newNames[i] = e.target.value;
              setNames(newNames);
            }}
          />
        </div>
      ))}
      <button onClick={() => onStart(playerCount, names.slice(0, playerCount))}>
        Start Game
      </button>
      <div style={{ marginTop: '24px', borderTop: '1px solid #444', paddingTop: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: '#aaa' }}>
          Load Scenario / Import State
        </label>
        <select
          className="scenario-select"
          value=""
          onChange={e => {
            const idx = parseInt(e.target.value);
            if (!isNaN(idx)) onLoadState(SCENARIOS[idx]!.state);
          }}
          style={{ width: '100%', marginBottom: '8px' }}
        >
          <option value="" disabled>Load Scenario...</option>
          {SCENARIOS.map((s, i) => (
            <option key={i} value={i}>{s.name} — {s.description}</option>
          ))}
        </select>
        <button
          style={{ width: '100%' }}
          onClick={async () => {
            try {
              const json = await navigator.clipboard.readText();
              onLoadState(JSON.parse(json));
            } catch {
              const json = prompt('Paste game state JSON:');
              if (json) onLoadState(JSON.parse(json));
            }
          }}
        >
          Import from Clipboard
        </button>
      </div>
    </div>
  );
}
