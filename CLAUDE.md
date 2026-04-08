# Glory 4 Rome

A web implementation of Glory to Rome with modifications (Glory 4 Rome / G4R).

## Tech Stack
- React + TypeScript (Vite)
- Hot-seat local multiplayer initially

## Game Rules
- Original rules: https://www.glory-to-rome.com/Glory_to_Rome_rules.html
- Modifications: https://docs.google.com/document/d/1F8PkozBXOsRGOEB1rD_SbB8cYdCmRA3Wmy9emnflM2s/edit?tab=t.0

## Game Design Notes
- **Materials lose identity**: Once a card is placed as material in a building or is in the pool, only its material type matters — the building name on that card is irrelevant. The UI should reflect this by showing material counts, not individual card names.

## Development Practices
- **Regression tests on corrections**: Whenever the user requests a correction to the game implementation, create a test that verifies the corrected behavior stays correct.
- **No Claude for Chrome**: Do not use Claude for Chrome browser automation tools in this project.
