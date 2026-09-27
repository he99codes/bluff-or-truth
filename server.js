const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function roomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(({ id, name }) => ({ id, name })),
    status: room.status,
  };
}

function emitRoom(room) {
  io.to(room.code).emit('room:update', roomState(room));
}

function gameState(room) {
  const round = room.round;
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    players: room.players.map(({ id, name }) => ({ id, name, score: room.scores[id] || 0 })),
    presenterId: room.presenterId,
    presenterName: room.players.find((player) => player.id === room.presenterId)?.name,
    statements: round?.statements || null,
    voteCount: Object.keys(round?.votes || {}).length,
    votersNeeded: Math.max(0, room.players.length - 1),
    reveal: room.status === 'reveal' ? {
      lieIndex: round.lieIndex,
      correctVoterIds: Object.entries(round.votes).filter(([, vote]) => vote === round.lieIndex).map(([id]) => id),
      votes: round.votes,
    } : null,
  };
}

function emitGame(room) {
  io.to(room.code).emit('game:update', gameState(room));
}

function votingComplete(room) {
  return room.status === 'voting' && Object.keys(room.round.votes).length >= room.players.length - 1;
}

function startRound(room) {
  room.presenterId = room.players[room.roundIndex].id;
  room.round = { statements: null, lieIndex: null, votes: {} };
  room.status = 'presenting';
  emitRoom(room);
  emitGame(room);
}

function revealRound(room) {
  const { lieIndex, votes } = room.round;
  for (const [voterId, vote] of Object.entries(votes)) {
    if (vote === lieIndex) room.scores[voterId] += 1;
    else room.scores[room.presenterId] += 1;
  }
  room.status = 'reveal';
  emitRoom(room);
  emitGame(room);

  setTimeout(() => {
    if (!rooms.has(room.code) || room.status !== 'reveal') return;
    room.roundIndex += 1;
    if (room.roundIndex >= room.players.length) {
      room.status = 'gameover';
      emitRoom(room);
      emitGame(room);
    } else startRound(room);
  }, 5500);
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name }, done) => {
    const playerName = String(name || '').trim().slice(0, 20);
    if (!playerName) return done({ error: 'Enter a player name first.' });

    const code = createRoomCode();
    const room = { code, hostId: socket.id, status: 'lobby', players: [{ id: socket.id, name: playerName }] };
    rooms.set(code, room);
    socket.join(code);
    done({ room: roomState(room), playerId: socket.id });
    emitRoom(room);
  });

  socket.on('room:join', ({ code, name }, done) => {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const playerName = String(name || '').trim().slice(0, 20);
    const room = rooms.get(normalizedCode);
    if (!playerName) return done({ error: 'Enter a player name first.' });
    if (!room) return done({ error: 'Room not found. Check the code and try again.' });
    if (room.status !== 'lobby') return done({ error: 'This game has already started.' });
    if (room.players.length >= 4) return done({ error: 'This room is full (maximum 4 players).' });

    room.players.push({ id: socket.id, name: playerName });
    socket.join(normalizedCode);
    done({ room: roomState(room), playerId: socket.id });
    emitRoom(room);
  });

  socket.on('game:start', ({ code }, done) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return done({ error: 'Room no longer exists.' });
    if (room.hostId !== socket.id) return done({ error: 'Only the host can start the game.' });
    if (room.players.length < 2) return done({ error: 'At least 2 players are needed to start.' });

    room.status = 'presenting';
    room.roundIndex = 0;
    room.scores = Object.fromEntries(room.players.map((player) => [player.id, 0]));
    startRound(room);
    done({ ok: true });
  });

  socket.on('round:submit', ({ code, statements, lieIndex }, done) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || room.status !== 'presenting') return done({ error: 'This round is no longer accepting statements.' });
    if (room.presenterId !== socket.id) return done({ error: 'Only the Presenter can submit statements.' });
    if (!Array.isArray(statements) || statements.length !== 2 || !statements.every((item) => String(item).trim())) {
      return done({ error: 'Enter both statements.' });
    }
    if (![0, 1].includes(lieIndex)) return done({ error: 'Choose which statement is the lie.' });
    room.round.statements = statements.map((item) => String(item).trim().slice(0, 180));
    room.round.lieIndex = lieIndex;
    room.status = 'voting';
    emitRoom(room);
    emitGame(room);
    done({ ok: true });
    if (votingComplete(room)) revealRound(room);
  });

  socket.on('round:vote', ({ code, choice }, done) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || room.status !== 'voting') return done({ error: 'Voting is closed.' });
    if (room.presenterId === socket.id) return done({ error: 'The Presenter cannot vote.' });
    if (![0, 1].includes(choice)) return done({ error: 'Pick a statement first.' });
    room.round.votes[socket.id] = choice;
    emitGame(room);
    done({ ok: true });
    if (votingComplete(room)) revealRound(room);
  });

  socket.on('game:restart', ({ code }, done) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return done({ error: 'Room no longer exists.' });
    if (room.hostId !== socket.id) return done({ error: 'Only the host can start a new game.' });
    if (room.status !== 'gameover') return done({ error: 'The current game is still in progress.' });
    room.status = 'lobby';
    room.round = null;
    emitRoom(room);
    done({ ok: true });
  });

  socket.on('disconnect', () => {
    for (const [code, room] of rooms) {
      const playerIndex = room.players.findIndex((player) => player.id === socket.id);
      if (playerIndex === -1) continue;
      room.players.splice(playerIndex, 1);
      if (!room.players.length) rooms.delete(code);
      else {
        if (room.hostId === socket.id) room.hostId = room.players[0].id;
        if (room.status !== 'lobby') {
          delete room.scores?.[socket.id];
          delete room.round?.votes?.[socket.id];
          if (room.presenterId === socket.id) {
            room.presenterId = room.players[room.roundIndex % room.players.length].id;
            room.status = 'presenting';
            room.round = { statements: null, lieIndex: null, votes: {} };
            emitGame(room);
          } else {
            if (playerIndex < room.roundIndex) room.roundIndex -= 1;
            if (votingComplete(room)) revealRound(room);
            else emitGame(room);
          }
        }
        emitRoom(room);
      }
      break;
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Bluff or Truth is running at http://localhost:${port}`));
