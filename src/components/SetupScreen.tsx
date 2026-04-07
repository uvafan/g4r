import { useState } from 'react';

interface SetupScreenProps {
  onStart: (playerCount: number, names: string[]) => void;
}

export function SetupScreen({ onStart }: SetupScreenProps) {
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
    </div>
  );
}
