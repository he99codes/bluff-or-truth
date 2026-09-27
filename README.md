# Bluff or Truth

A real-time multiplayer party game for 2–4 players. Each round, one player presents two statements and secretly marks which one is the lie — everyone else votes to spot it. Spot the lie and you score; fool the room and the Presenter scores.

**Play it live:** https://bluff-or-truth.onrender.com

## How to play

1. One player creates a room and shares the 5-letter code.
2. Friends join from their own devices (2–4 players).
3. The host starts the game. Players take turns as **Presenter**.
4. The Presenter writes two statements and secretly marks which is the lie.
5. Everyone else votes for the statement they think is the lie.
6. **Scoring:** +1 for each voter who spots the lie; +1 to the Presenter for each voter fooled.
7. After the reveal, the next player presents. Once everyone has had a turn, the highest score wins.

You can change your vote until all votes are in. Only the host can start a game or restart after game over.

## Tech

- **Backend:** Node.js, Express, Socket.IO — rooms live in an in-memory `Map` (one process, no database)
- **Frontend:** vanilla HTML/CSS/JS served from `public/`
- Requires a host with persistent WebSocket support (Render, Railway, Fly.io, a VPS — **not** Vercel/Netlify, which are serverless and can't hold socket connections)

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in two browser tabs to simulate two players. `PORT` env var overrides the default port.

## Deploy

The repo includes `render.yaml`, so deployment on [Render](https://render.com) is one click: **New → Web Service → select this repo → Deploy**. The free tier sleeps after ~15 min idle; the first visit after that takes ~30s to wake.

## Project structure

- `server.js` — room management, game state machine, scoring (Socket.IO events)
- `public/index.html` — screens: home, lobby, presenting, voting, reveal, game over
- `public/app.js` — client socket handlers + screen rendering
- `public/styles.css` — styling
