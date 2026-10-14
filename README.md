# Flip 7 (Angular, client-side only)

Pass-and-play Flip 7 for 2-10 players on a single screen. All game logic lives in the browser
(`src/app/game/engine.ts`); there is no backend. The game autosaves to `localStorage`, so a refresh
resumes where you left off.

```bash
npm install
npm start        # http://localhost:4200
npm run build
```

## Online multiplayer

One browser hosts. It runs the engine and is the only source of truth; guests send intents
(`hit`, `stay`, `choose`) over WebRTC (PeerJS) and receive the full state after every action. The
host rejects any action from a device that is not the player whose turn it is.

1. Host: "Host online" tab, then "Create room", then share the 5-letter code.
2. Guests: "Join online" tab, then enter the code and a name.
3. Host starts the game once 2-10 players are in the lobby.

Notes: the host tab must stay open (refreshing it ends the room). A guest who drops can press
"Reconnect" and gets the same seat back. If a guest stays offline, the host can act for them.
PeerJS's free public server is used only for the initial handshake.

## Layout

- `src/app/game/models.ts` - card, player and game-state types
- `src/app/game/engine.ts` - deck, scoring, turn flow, action cards (framework-free)
- `src/app/game/game.service.ts` - signal-based state holder, host-authoritative action handling, autosave
- `src/app/game/network.service.ts` - PeerJS transport (rooms, connections, send)
- `src/app/game/protocol.ts` - messages exchanged between host and guests
- `src/app/lobby.component.ts` - waiting room with the room code
- `src/app/setup.component.ts` - player count and names
- `src/app/game.component.ts` - board, turn controls, target picker, round results
- `src/app/card.component.ts` - card visual
