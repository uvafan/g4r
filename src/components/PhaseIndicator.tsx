import { GameState } from '../game/types';
import { getActivePlayerId } from '../game/engine';

interface PhaseIndicatorProps {
  state: GameState;
}

export function PhaseIndicator({ state }: PhaseIndicatorProps) {
  const { phase } = state;
  const activeId = getActivePlayerId(state);
  const activeName = activeId !== null ? state.players[activeId]?.name : '—';

  let phaseText = '';
  switch (phase.type) {
    case 'lead':
      phaseText = `Lead Phase — ${state.players[phase.leaderId]?.name}'s turn to lead`;
      break;
    case 'follow':
      phaseText = `Follow Phase — Role: ${phase.ledRole} — ${activeName}'s turn`;
      break;
    case 'action':
      phaseText = `Action Phase — ${phase.ledRole} — ${activeName}'s turn`;
      break;
    case 'setup':
      phaseText = 'Setup';
      break;
    case 'gameOver':
      phaseText = 'Game Over';
      break;
  }

  return (
    <div className="phase-indicator">
      <strong>{phaseText}</strong>
      <span className="deck-count">Deck: {state.deck.length} | Pool: {state.pool.length}</span>
    </div>
  );
}
