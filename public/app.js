const socket = io();
let currentRoom = null;
let playerId = null;
let myVote = null;
let lastPresenterId = null;

const homeScreen = document.querySelector('#home-screen');
const lobbyScreen = document.querySelector('#lobby-screen');
const presentingScreen = document.querySelector('#presenting-screen');
const votingScreen = document.querySelector('#voting-screen');
const revealScreen = document.querySelector('#reveal-screen');
const gameoverScreen = document.querySelector('#gameover-screen');
const nameInput = document.querySelector('#name-input');
const codeInput = document.querySelector('#room-code-input');
const homeError = document.querySelector('#home-error');
const lobbyMessage = document.querySelector('#lobby-message');

function showScreen(screen) {
  [homeScreen, lobbyScreen, presentingScreen, votingScreen, revealScreen, gameoverScreen].forEach((item) => item.classList.toggle('hidden', item !== screen));
}

function submit(event, data) {
  homeError.textContent = '';
  socket.emit(event, data, (result) => {
    if (result.error) return (homeError.textContent = result.error);
    currentRoom = result.room;
    playerId = result.playerId;
    renderRoom();
  });
}

document.querySelector('#create-room').addEventListener('click', () => submit('room:create', { name: nameInput.value }));
document.querySelector('#join-room').addEventListener('click', () => submit('room:join', { name: nameInput.value, code: codeInput.value }));
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

document.querySelector('#start-game').addEventListener('click', () => {
  socket.emit('game:start', { code: currentRoom.code }, (result) => {
    if (result.error) lobbyMessage.textContent = result.error;
  });
});

socket.on('room:update', (room) => {
  if (room.status !== 'lobby') return;
  currentRoom = room;
  renderRoom();
});

socket.on('game:update', (game) => {
  currentRoom = game;
  renderGame();
});

document.querySelector('#submit-statements').addEventListener('click', () => {
  const lieIndex = Number(document.querySelector('input[name="lie"]:checked').value);
  socket.emit('round:submit', {
    code: currentRoom.code,
    statements: [document.querySelector('#statement-one').value, document.querySelector('#statement-two').value],
    lieIndex,
  }, (result) => {
    document.querySelector('#presenter-error').textContent = result.error || '';
    if (!result.error) {
      document.querySelector('#statement-one').value = '';
      document.querySelector('#statement-two').value = '';
      document.querySelector('input[name="lie"][value="0"]').checked = true;
    }
  });
});

document.querySelector('#play-again').addEventListener('click', () => {
  socket.emit('game:restart', { code: currentRoom.code }, (result) => {
    if (result.error) document.querySelector('#gameover-note').textContent = result.error;
  });
});

function renderRoom() {
  if (!currentRoom) return;
  if (currentRoom.status !== 'lobby') return showScreen(presentingScreen);
  showScreen(lobbyScreen);
  document.querySelector('#room-code-display').textContent = currentRoom.code;
  document.querySelector('#player-count').textContent = `(${currentRoom.players.length}/4)`;
  document.querySelector('#player-list').replaceChildren(...currentRoom.players.map((player) => {
    const item = document.createElement('li');
    item.textContent = player.name + (player.id === currentRoom.hostId ? ' — Host' : '');
    return item;
  }));
  const isHost = currentRoom.hostId === playerId;
  const startButton = document.querySelector('#start-game');
  startButton.classList.toggle('hidden', !isHost);
  lobbyMessage.textContent = isHost && currentRoom.players.length < 2 ? 'Waiting for at least one more player…' : '';
}

function renderGame() {
  if (!currentRoom || currentRoom.status === 'lobby') return renderRoom();
  if (currentRoom.status === 'presenting') {
    showScreen(presentingScreen);
    const amPresenter = currentRoom.presenterId === playerId;
    if (currentRoom.presenterId !== lastPresenterId) {
      lastPresenterId = currentRoom.presenterId;
      myVote = null;
      document.querySelector('#statement-one').value = '';
      document.querySelector('#statement-two').value = '';
      document.querySelector('#presenter-error').textContent = '';
      document.querySelector('input[name="lie"][value="0"]').checked = true;
    }
    document.querySelector('#presenting-title').textContent = amPresenter ? 'Your turn to present' : `${currentRoom.presenterName} is presenting`;
    document.querySelector('#presenter-form').classList.toggle('hidden', !amPresenter);
    document.querySelector('#presenting-waiting').classList.toggle('hidden', amPresenter);
    return;
  }
  if (currentRoom.status === 'voting') return renderVoting();
  if (currentRoom.status === 'reveal') return renderReveal();
  if (currentRoom.status === 'gameover') {
    showScreen(gameoverScreen);
    document.querySelector('#final-scoreboard').replaceChildren(scoreboard(currentRoom.players));
    const isHost = currentRoom.hostId === playerId;
    document.querySelector('#play-again').classList.toggle('hidden', !isHost);
    document.querySelector('#gameover-note').textContent = isHost ? '' : 'Waiting for the host to start a new game…';
  }
}

function renderVoting() {
  showScreen(votingScreen);
  const amPresenter = currentRoom.presenterId === playerId;
  document.querySelector('#voting-title').textContent = amPresenter ? 'Everyone is voting…' : 'Which statement is the lie?';
  const options = document.querySelector('#statement-options');
  options.replaceChildren(...currentRoom.statements.map((statement, index) => {
    const button = document.createElement('button');
    button.className = `statement${index === myVote ? ' selected' : ''}`;
    button.textContent = statement;
    button.disabled = amPresenter;
    button.addEventListener('click', () => {
      socket.emit('round:vote', { code: currentRoom.code, choice: index }, (result) => {
        if (result.error) document.querySelector('#vote-status').textContent = result.error;
        else { myVote = index; renderVoting(); }
      });
    });
    return button;
  }));
  const count = currentRoom.voteCount;
  document.querySelector('#vote-status').textContent = amPresenter
    ? `${count} of ${currentRoom.votersNeeded} votes are in…`
    : myVote === null
      ? `${count} of ${currentRoom.votersNeeded} votes are in. Pick the lie.`
      : `You picked statement ${myVote + 1} — tap the other to change it. ${count} of ${currentRoom.votersNeeded} votes are in.`;
}

function renderReveal() {
  showScreen(revealScreen);
  document.querySelector('#reveal-title').textContent = `${currentRoom.presenterName}'s reveal`;
  document.querySelector('#reveal-statements').replaceChildren(...currentRoom.statements.map((statement, index) => {
    const item = document.createElement('p');
    item.className = `reveal-statement ${index === currentRoom.reveal.lieIndex ? 'lie' : 'truth'}`;
    item.textContent = `${index === currentRoom.reveal.lieIndex ? 'THE LIE: ' : 'TRUE: '}${statement}`;
    return item;
  }));
  const correct = currentRoom.players.filter((player) => currentRoom.reveal.correctVoterIds.includes(player.id)).map((player) => player.name);
  document.querySelector('#correct-voters').textContent = correct.length ? `Correct guesses: ${correct.join(', ')}` : 'Nobody spotted the lie!';
  document.querySelector('#scoreboard').replaceChildren(scoreboard(currentRoom.players));
}

function scoreboard(players) {
  const list = document.createElement('ol');
  list.className = 'score-list';
  [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).forEach((player) => {
    const item = document.createElement('li');
    item.textContent = `${player.name}: ${player.score}`;
    list.append(item);
  });
  return list;
}
