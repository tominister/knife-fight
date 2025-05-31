// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling'],
  pingTimeout: 10000,
  pingInterval: 5000
});

// Basic route handler
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Socket.IO server is running' });
});

const players = {};
const knives = new Map();
const spawnSlots = {
  top: { occupied: false, playerId: null },
  bottom: { occupied: false, playerId: null }
};

let gameTimer = null;
let gameInProgress = false;
let gameEndScores = null;

function startGameTimer() {
  console.log('Starting game timer');
  if (gameTimer) {
    console.log('Clearing existing timer');
    clearTimeout(gameTimer);
  }
  
  gameInProgress = true;
  gameEndScores = null;
  
  // Emit initial timer value
  console.log('Emitting initial timer value: 30');
  io.emit('gameTimerUpdate', 30);
  
  let timeLeft = 30;
  gameTimer = setInterval(() => {
    timeLeft--;
    console.log('Emitting timer update:', timeLeft);
    io.emit('gameTimerUpdate', timeLeft);
    
    if (timeLeft <= 0) {
      console.log('Timer reached 0, ending game');
      endGame();
    }
  }, 1000);
}

function endGame() {
  console.log('Ending game');
  if (gameTimer) {
    console.log('Clearing game timer');
    clearTimeout(gameTimer);
    gameTimer = null;
  }
  
  // Store final scores
  gameEndScores = {};
  for (const [id, player] of Object.entries(players)) {
    gameEndScores[id] = player.points;
  }
  console.log('Final scores:', gameEndScores);
  
  // Force despawn all players
  for (const [position, slot] of Object.entries(spawnSlots)) {
    if (slot.occupied) {
      console.log(`Despawning player ${slot.playerId} from ${position}`);
      spawnSlots[position] = { occupied: false, playerId: null };
      delete players[slot.playerId];
    }
  }
  
  // Clear all knives
  console.log('Clearing all knives');
  knives.clear();
  
  gameInProgress = false;
  
  // Notify clients
  console.log('Emitting game end event with scores');
  io.emit('gameEnd', { scores: gameEndScores });
  io.emit('spawnSlotsUpdate', spawnSlots);
  io.emit('playerLeft', Object.keys(players));
  io.emit('knivesUpdate', []);
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Send current game state to new player
  console.log('Sending initial game state to new player');
  socket.emit('spawnSlotsUpdate', spawnSlots);
  if (gameInProgress) {
    console.log('Game in progress, sending current timer value');
    socket.emit('gameTimerUpdate', 30);
  }
  if (gameEndScores) {
    console.log('Sending previous game scores');
    socket.emit('gameEnd', { scores: gameEndScores });
  }

  socket.on('requestSpawn', ({ position }) => {
    console.log(`Player ${socket.id} requesting spawn at ${position}`);
    
    // If game is in progress, don't allow spawn changes
    if (gameInProgress) {
      console.log('Game in progress, rejecting spawn request');
      socket.emit('spawnRejected', { position, reason: 'game_in_progress' });
      return;
    }
    
    // If player is clicking their current slot, despawn them
    if (spawnSlots[position].playerId === socket.id) {
      console.log(`Player ${socket.id} despawned from ${position}`);
      spawnSlots[position] = { occupied: false, playerId: null };
      delete players[socket.id];
      io.emit('spawnSlotsUpdate', spawnSlots);
      io.emit('playerLeft', socket.id);
      return;
    }

    // If player is in the other slot, free it up
    const otherPosition = position === 'top' ? 'bottom' : 'top';
    if (spawnSlots[otherPosition].playerId === socket.id) {
      console.log(`Player ${socket.id} despawned from ${otherPosition}`);
      spawnSlots[otherPosition] = { occupied: false, playerId: null };
    }

    // If slot is occupied by another player, reject
    if (spawnSlots[position].occupied && spawnSlots[position].playerId !== socket.id) {
      console.log(`Slot ${position} already occupied`);
      socket.emit('spawnRejected', { position, reason: 'slot_occupied' });
      return;
    }

    // Calculate spawn position
    const spawnY = position === 'top' ? 200 : 400;
    const spawnX = 400;

    // Occupy the slot
    spawnSlots[position] = { occupied: true, playerId: socket.id };
    
    // Initialize player
    players[socket.id] = {
      x: spawnX,
      y: spawnY,
      id: socket.id,
      points: 0,
      spawnPosition: position
    };

    // Notify all clients
    io.emit('spawnSlotsUpdate', spawnSlots);
    io.emit('players', players);
    socket.broadcast.emit('playerJoined', players[socket.id]);
    io.emit('knivesUpdate', Array.from(knives.entries()));

    // Check if both slots are occupied to start game
    if (spawnSlots.top.occupied && spawnSlots.bottom.occupied && !gameInProgress) {
      console.log('Both slots occupied, starting game');
      startGameTimer();
    }
  });

  socket.on('move', (data) => {
    if (players[socket.id]) {
      console.log(`Player ${socket.id} moved to:`, data);
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      socket.broadcast.emit('playerMoved', { id: socket.id, x: data.x, y: data.y });
    }
  });

  socket.on('knife', (knifeData) => {
    console.log(`Player ${socket.id} fired knife:`, knifeData);
    const knifeId = Date.now() + Math.random().toString(36).substr(2, 9);
    knives.set(knifeId, {
      ...knifeData,
      id: knifeId
    });
    // Broadcast the new knife to all clients
    io.emit('knifeFired', { ...knifeData, id: knifeId });
  });

  socket.on('destroyKnife', ({ knifeId }) => {
    console.log(`Destroying knife: ${knifeId}`);
    // IMMEDIATELY remove the knife from server tracking
    if (knives.has(knifeId)) {
      knives.delete(knifeId);
      io.emit('knifeDestroyed', { knifeId });
    }
  });

  socket.on('knifeHit', (data) => {
    console.log('Knife hit:', data);
    // IMMEDIATELY remove the knife from server tracking
    if (knives.has(data.knifeId)) {
      knives.delete(data.knifeId);
    }
    io.emit('knifeHit', data);
  });

  socket.on('pointsUpdate', (data) => {
    console.log('Points update:', data);
    io.emit('pointsUpdate', data);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Free up spawn slot if player was occupying one
    for (const [position, slot] of Object.entries(spawnSlots)) {
      if (slot.playerId === socket.id) {
        spawnSlots[position] = { occupied: false, playerId: null };
      }
    }
    
    delete players[socket.id];
    io.emit('spawnSlotsUpdate', spawnSlots);
    io.emit('playerLeft', socket.id);

    // If game was in progress and a player left, end the game
    if (gameInProgress) {
      endGame();
    }
  });
});

// Game loop for updating knife positions
setInterval(() => {
  // Update all knives
  for (const [id, knife] of knives.entries()) {
    // Calculate next position
    const nextX = knife.x + knife.dx;
    const nextY = knife.y + knife.dy;
    
    let shouldDestroy = false;

    // Check if knife would be out of bounds
    const dist = Math.hypot(nextX - 400, nextY - 300);
    if (dist > 250) {
      shouldDestroy = true;
    }

    // Check for player collisions BEFORE updating position
    if (!shouldDestroy) {
      for (const [playerId, player] of Object.entries(players)) {
        // Skip if knife would hit its shooter
        if (knife.shooterId === playerId) continue;

        const distToPlayer = Math.hypot(nextX - player.x, nextY - player.y);
        if (distToPlayer <= 25) { // 20 (player radius) + 5 (knife radius)
          console.log(`Knife ${id} hit player ${playerId}`);
          shouldDestroy = true;
          
          // Increment shooter's points
          if (players[knife.shooterId]) {
            players[knife.shooterId].points = (players[knife.shooterId].points || 0) + 1;
            console.log(`Updated points for ${knife.shooterId}: ${players[knife.shooterId].points}`);
          }

          // Notify about the hit
          io.emit('knifeHit', {
            knifeId: id,
            hitPlayerId: playerId,
            shooterId: knife.shooterId
          });

          // Update points for shooter
          io.emit('pointsUpdate', {
            playerId: knife.shooterId,
            points: players[knife.shooterId].points
          });
          break;
        }
      }
    }

    // If knife should be destroyed, remove it
    if (shouldDestroy) {
      knives.delete(id);
      continue;
    }

    // Only update position if knife wasn't destroyed
    knife.x = nextX;
    knife.y = nextY;
  }

  // Broadcast updated knife positions to all clients
  if (knives.size > 0) {
    io.emit('knivesUpdate', Array.from(knives.entries()));
  }
}, 1000 / 60); // 60 updates per second

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on http://localhost:${PORT}`);
  console.log('Current players:', players);
});
