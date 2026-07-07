import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Game constants
const TICK_RATE = 20;
const TICK_INTERVAL = 1000 / TICK_RATE;
const PLAYER_SPEED = 200;
const ARENA_WIDTH = 800;
const ARENA_HEIGHT = 600;
const PLAYER_SIZE = 30;

// Track all connected players
const players = new Map();
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
let nextId = 1;
let bullets = [];



const WALLS = [
  { x: 150, y: 150, width: 50, height: 300 }, // Left pillar
  { x: 600, y: 150, width: 50, height: 300 }, // Right pillar
  { x: 300, y: 280, width: 200, height: 40 }  // Center barrier
];




const server = createServer((req, res) => {
  // Extract pathname to ignore query parameters like ?lag=200
  const pathname = req.url.split('?')[0];

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(join(__dirname, 'public', 'index.html')));
  } else {
    res.writeHead(404);
    res.end();
  }
});


// Attach WebSocket server to the HTTP server
const wss = new WebSocketServer({ server });



wss.on('connection', (ws) => {
  // Assign a unique ID and color to the new player
  const id = `player-${nextId}`;
  const color = COLORS[(nextId - 1) % COLORS.length];
  nextId++;

  // Create the player object with a random spawn position
  const player = {
    id,
    x: Math.random() * (ARENA_WIDTH - PLAYER_SIZE),
    y: Math.random() * (ARENA_HEIGHT - PLAYER_SIZE),
    color,
    inputQueue: [],
    lastProcessedSeq: 0,
    health: 100,
    isDead: false,
    angle: 0,
  };

  players.set(id, player);

  // Send the new player their ID and the current game state
  ws.send(JSON.stringify({
    type: 'welcome',
    id,
    players: Array.from(players.values()).map(p => ({
      id: p.id, x: p.x, y: p.y, color: p.color,
    })),
  }));

  // Notify all other players that someone joined
  wss.clients.forEach((client) => {
    if (client !== ws && client.readyState === 1) {
      client.send(JSON.stringify({
        type: 'playerJoined',
        id,
        x: player.x,
        y: player.y,
        color: player.color,
      }));
    }
  });
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'input') {
      if (player.isDead) return;
      player.inputQueue.push({ 
        seq: msg.seq, 
        keys: msg.keys, 
        angle: msg.angle, 
        shoot: msg.shoot 
      });
    }
  });


  // Handle disconnection
  ws.on('close', () => {
    players.delete(id);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'playerLeft', id }));
      }
    });
  });
});



//function applyInput(player, keys, dt) {
  // Move the player based on WASD keys
 // if (keys.w) player.y -= PLAYER_SPEED * dt;
  //if (keys.s) player.y += PLAYER_SPEED * dt;
  //if (keys.a) player.x -= PLAYER_SPEED * dt;
  //if (keys.d) player.x += PLAYER_SPEED * dt;

  // Clamp position to arena bounds
  //player.x = Math.max(0, Math.min(ARENA_WIDTH - PLAYER_SIZE, player.x));
  //player.y = Math.max(0, Math.min(ARENA_HEIGHT - PLAYER_SIZE, player.y));
//}


function checkCollision(x, y, size) {
  // Check arena bounds
  if (x < 0 || x + size > ARENA_WIDTH || y < 0 || y + size > ARENA_HEIGHT) {
    return true;
  }
  // Check map walls
  for (const wall of WALLS) {
    if (
      x < wall.x + wall.width &&
      x + size > wall.x &&
      y < wall.y + wall.height &&
      y + size > wall.y
    ) {
      return true;
    }
  }
  return false;
}

function applyInput(player, inputKeys, dt) {
  if (player.isDead) return;

  // Move horizontally and check collision
  let nextX = player.x;
  if (inputKeys.a) nextX -= PLAYER_SPEED * dt;
  if (inputKeys.d) nextX += PLAYER_SPEED * dt;
  
  if (!checkCollision(nextX, player.y, PLAYER_SIZE)) {
    player.x = nextX;
  }

  // Move vertically and check collision
  let nextY = player.y;
  if (inputKeys.w) nextY -= PLAYER_SPEED * dt;
  if (inputKeys.s) nextY += PLAYER_SPEED * dt;

  if (!checkCollision(player.x, nextY, PLAYER_SIZE)) {
    player.y = nextY;
  }
}




function tick() {
  const dt = TICK_INTERVAL / 1000;
  const BULLET_SPEED = 600;

  // 1. Process Player Inputs
  for (const player of players.values()) {
    if (player.isDead) continue;

    while (player.inputQueue.length > 0) {
      const input = player.inputQueue.shift();
      applyInput(player, input.keys, dt);
      player.angle = input.angle;
      player.lastProcessedSeq = input.seq;

      // Spawn bullet if they fired
      if (input.shoot) {
        bullets.push({
          ownerId: player.id,
          x: player.x + PLAYER_SIZE / 2,
          y: player.y + PLAYER_SIZE / 2,
          dx: Math.cos(player.angle) * BULLET_SPEED,
          dy: Math.sin(player.angle) * BULLET_SPEED,
          life: 2.0 // Bullet expires after 2 seconds
        });
      }
    }
  }

  // 2. Update Bullets & Hit Detection
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.dx * dt;
    b.y += b.dy * dt;
    b.life -= dt;

    // Check Wall Collision for bullets
    let hitWall = false;
    for (const wall of WALLS) {
      if (b.x > wall.x && b.x < wall.x + wall.width && b.y > wall.y && b.y < wall.y + wall.height) {
        hitWall = true;
        break;
      }
    }

    // Check Player Collision
    let hitPlayer = false;
    if (!hitWall) {
      for (const target of players.values()) {
        if (target.id === b.ownerId || target.isDead) continue;
        
        // Is bullet inside target rectangle?
        if (b.x > target.x && b.x < target.x + PLAYER_SIZE && b.y > target.y && b.y < target.y + PLAYER_SIZE) {
          target.health -= 25; // Deduct 25hp per hit
          if (target.health <= 0) {
            target.health = 0;
            target.isDead = true;
            // Respawn after 3 seconds
            setTimeout(() => {
              target.isDead = false;
              target.health = 100;
              target.x = Math.random() * (ARENA_WIDTH - PLAYER_SIZE);
              target.y = Math.random() * (ARENA_HEIGHT - PLAYER_SIZE);
            }, 3000);
          }
          hitPlayer = true;
          break;
        }
      }
    }

    if (b.life <= 0 || hitWall || hitPlayer) {
      bullets.splice(i, 1); // Delete bullet
    }
  }

  // 3. Broadcast State (including Bullets and Player Health)
  const state = JSON.stringify({
    type: 'state',
    players: Array.from(players.values()).map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      angle: p.angle,
      health: p.health,
      isDead: p.isDead,
      lastProcessedSeq: p.lastProcessedSeq,
    })),
    bullets: bullets.map(b => ({ x: b.x, y: b.y }))
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(state);
    }
  });
}


// Run the game loop at 20 ticks per second
setInterval(tick, TICK_INTERVAL);

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

