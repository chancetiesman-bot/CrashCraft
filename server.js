const WebSocket = require('ws');
const uuid = require('uuid');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 8080;

// Create HTTP server to serve HTML file
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'test.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading test.html');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ server });

console.log(`WebSocket server running on port ${PORT}`);
console.log(`Local connection: ws://localhost:${PORT}`);
console.log(`Network connection: ws://192.168.1.24:${PORT}`);
console.log('Make sure Minecraft Bedrock has scripting enabled and connects to this server');
console.log('In Minecraft, type: /connect 192.168.1.24:8080');

// Store connected clients
const clients = new Set();
// Store active spam intervals
const spamIntervals = new Map();
// Store active fast spam intervals (array to support multiple spams)
const fastSpamIntervals = new Map();
// Store chat command intervals (array to support multiple spams)
const chatCommandIntervals = new Map();
// Store player data (names and permissions)
const players = new Map();
// Store access codes for website connection
const accessCodes = new Map();
// Store banned users
const bannedUsers = new Set();
// Death messages enabled/disabled
let deathMessagesEnabled = true;

// Send command to Minecraft client
function sendCommand(cmd, args, socket) {
  const msg = {
    "header": {
      "version": 1,
      "requestId": uuid.v4(),
      "messagePurpose": "commandRequest",
      "messageType": "commandRequest"
    },
    "body": {
      "version": 1,
      "commandLine": `/${cmd} ${args}`,
      "origin": { "type": "player" }
    }
  };
  socket.send(JSON.stringify(msg));
}

// Chat via /me command
function chat(msg, socket) {
  sendCommand("me", msg, socket);
}

// Handle connections
wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);

  // Subscribe to PlayerMessage event to listen for chat
  const subscribeMsg = {
    "body": {
      "eventName": "PlayerMessage"
    },
    "header": {
      "requestId": uuid.v4(),
      "messagePurpose": "subscribe",
      "version": 1,
      "messageType": "commandRequest"
    }
  };
  ws.send(JSON.stringify(subscribeMsg));

  // Subscribe to PlayerTravelled event to track players when they move
  const subscribeTravelMsg = {
    "body": {
      "eventName": "PlayerTravelled"
    },
    "header": {
      "requestId": uuid.v4(),
      "messagePurpose": "subscribe",
      "version": 1,
      "messageType": "commandRequest"
    }
  };
  ws.send(JSON.stringify(subscribeTravelMsg));

  // Subscribe to PlayerLeft event to track when players leave
  const subscribeLeftMsg = {
    "body": {
      "eventName": "PlayerLeft"
    },
    "header": {
      "requestId": uuid.v4(),
      "messagePurpose": "subscribe",
      "version": 1,
      "messageType": "commandRequest"
    }
  };
  ws.send(JSON.stringify(subscribeLeftMsg));

  // Subscribe to PlayerDied event to track death positions
  const subscribeDiedMsg = {
    "body": {
      "eventName": "PlayerDied"
    },
    "header": {
      "requestId": uuid.v4(),
      "messagePurpose": "subscribe",
      "version": 1,
      "messageType": "commandRequest"
    }
  };
  ws.send(JSON.stringify(subscribeDiedMsg));

  // Function to get all online players using /list command
  function updatePlayerList(socket) {
    sendCommand("list", "", socket);
  }

  // Update player list every 10 seconds
  setInterval(() => {
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        updatePlayerList(client);
      }
    });
  }, 10000);

  // Update player list immediately on connection
  updatePlayerList(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Handle command responses from Minecraft
      if (data.header && data.header.messagePurpose === 'commandResponse') {
        // Parse /list command response to get player names
        if (data.body && data.body.statusMessage) {
          const statusMessage = data.body.statusMessage;
          // Format: "There are N players online: player1, player2, player3"
          const match = statusMessage.match(/There are \d+ players online: (.+)/);
          if (match) {
            const playerNames = match[1].split(', ').map(name => name.trim());
            playerNames.forEach(name => {
              if (!players.has(name)) {
                players.set(name, {
                  name: name,
                  permission: 'visitor',
                  lastSeen: new Date()
                });
                console.log('Player detected via /list:', name);
              }
            });
          }
        }
        return;
      }

      // Handle event responses from Minecraft
      if (data.header && data.header.messagePurpose === 'event') {
        console.log('Full event data:', JSON.stringify(data));
        if (data.header.eventName === 'PlayerMessage') {
          const chatMessage = data.body.message;
          const sender = data.body.sender;
          console.log('Chat message:', chatMessage, 'from:', sender);

          // Track player if not already tracked
          if (sender && !players.has(sender)) {
            players.set(sender, {
              name: sender,
              permission: 'visitor', // Default permission
              lastSeen: new Date()
            });
            console.log('New player tracked:', sender);
          }

          // Check for !sm command with custom message (check first to avoid triggering !s)
          if (chatMessage && chatMessage.startsWith('!sm ')) {
            const parts = chatMessage.substring(4).trim().split(' ');
            const customMessage = parts.slice(0, -1).join(' ') || parts[0]; // Get message (everything except last part)
            const count = parseInt(parts[parts.length - 1]) || 1150; // Get count (last part) or default to 1150
            console.log('!sm command detected with message:', customMessage, 'count:', count);
            // Trigger fast spam with custom message
            let sent = 0;
            const interval = setInterval(() => {
              if (sent >= count) {
                clearInterval(interval);
                // Remove from array
                const intervals = chatCommandIntervals.get(ws) || [];
                const index = intervals.indexOf(interval);
                if (index > -1) intervals.splice(index, 1);
                return;
              }
              sent++;
              clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  chat(`${customMessage} X${sent}`, client);
                }
              });
            }, 1);
            // Store interval in array
            if (!chatCommandIntervals.has(ws)) {
              chatCommandIntervals.set(ws, []);
            }
            chatCommandIntervals.get(ws).push(interval);
          }

          // Check for !s command (only if not !sm)
          if (chatMessage && chatMessage === '!s') {
            console.log('!s command detected, triggering spam');
            // Trigger fast spam with default message
            let sent = 0;
            const count = 1150;
            const interval = setInterval(() => {
              if (sent >= count) {
                clearInterval(interval);
                // Remove from array
                const intervals = chatCommandIntervals.get(ws) || [];
                const index = intervals.indexOf(interval);
                if (index > -1) intervals.splice(index, 1);
                return;
              }
              sent++;
              clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  chat(`X${sent}`, client);
                }
              });
            }, 1);
            // Store interval in array
            if (!chatCommandIntervals.has(ws)) {
              chatCommandIntervals.set(ws, []);
            }
            chatCommandIntervals.get(ws).push(interval);
          }

          // Check for !ss command to stop all spam
          if (chatMessage && chatMessage.startsWith('!ss')) {
            console.log('!ss command detected, stopping all spam');
            // Clear all chat command intervals
            const intervals = chatCommandIntervals.get(ws) || [];
            intervals.forEach(interval => clearInterval(interval));
            chatCommandIntervals.delete(ws);
            // Also clear fast spam intervals
            const fastIntervals = fastSpamIntervals.get(ws) || [];
            fastIntervals.forEach(interval => clearInterval(interval));
            fastSpamIntervals.delete(ws);
          }

          // Check for !help command
          if (chatMessage && chatMessage === '!help') {
            console.log('!help command detected, showing commands');
            chat('Commands: !s, !sm <msg> <count>, !ss, !link (get website access code), !death on/off', ws);
          }

          // Check for !death command to toggle death messages
          if (chatMessage && chatMessage.startsWith('!death')) {
            console.log('!death command detected');
            if (chatMessage === '!death on') {
              deathMessagesEnabled = true;
              chat('Death messages enabled', ws);
            } else if (chatMessage === '!death off') {
              deathMessagesEnabled = false;
              chat('Death messages disabled', ws);
            } else {
              chat('Usage: !death on or !death off', ws);
            }
          }

          // Check for !link command to generate access code
          if (chatMessage && chatMessage === '!link') {
            console.log('!link command detected, generating access code');
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            accessCodes.set(code, {
              playerName: sender,
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
            });
            chat(`Your access code: ${code} (valid for 5 minutes)`, ws);
            console.log('Generated access code:', code, 'for player:', sender);
          }
        } else if (data.header.eventName === 'PlayerTravelled') {
          const playerName = data.body.properties?.playerName || data.body.playerName;
          const position = data.body.player?.position;
          if (playerName && !players.has(playerName)) {
            players.set(playerName, {
              name: playerName,
              permission: 'visitor',
              lastSeen: new Date(),
              lastPosition: position
            });
            console.log('Player detected via movement:', playerName);
          } else if (playerName && players.has(playerName)) {
            // Update last position
            players.get(playerName).lastPosition = position;
            players.get(playerName).lastSeen = new Date();
          }
        } else if (data.header.eventName === 'PlayerDied') {
          console.log('PlayerDied event received:', JSON.stringify(data));
          const playerName = data.body.properties?.playerName || data.body.playerName || data.body.player?.name;
          console.log('PlayerDied - playerName:', playerName);
          let deathPos = null;

          if (playerName && players.has(playerName)) {
            const lastPos = players.get(playerName).lastPosition;
            console.log('PlayerDied - lastPos:', lastPos);
            if (lastPos && lastPos.x !== undefined && lastPos.y !== undefined && lastPos.z !== undefined) {
              deathPos = lastPos;
            }
          }

          // If no valid last position, try to get from death event
          if (!deathPos) {
            deathPos = data.body.player?.position || data.body.position;
            console.log('PlayerDied - deathPos from event:', deathPos);
          }

          // If still no valid position, use last saved position from any player
          if (!deathPos || deathPos.x === undefined || deathPos.y === undefined || deathPos.z === undefined) {
            console.log('PlayerDied - no valid position, searching for last saved position');
            for (const [name, player] of players) {
              if (player.lastPosition && player.lastPosition.x !== undefined) {
                deathPos = player.lastPosition;
                console.log('PlayerDied - using last saved position from:', name);
                break;
              }
            }
          }

          if (deathPos && deathPos.x !== undefined && deathPos.y !== undefined && deathPos.z !== undefined && playerName) {
            if (deathMessagesEnabled) {
              const deathMsg = `${playerName} died at X:${Math.floor(deathPos.x)} Y:${Math.floor(deathPos.y)} Z:${Math.floor(deathPos.z)}`;
              chat(deathMsg, ws);
              console.log('Death position:', deathMsg);
            } else {
              console.log('Death messages disabled, skipping death message for:', playerName);
            }
          } else {
            console.log('Could not determine death position');
          }
        } else if (data.header.eventName === 'PlayerLeft') {
          const playerName = data.body.properties?.playerName || data.body.playerName;
          if (playerName && players.has(playerName)) {
            players.delete(playerName);
            console.log('Player left:', playerName);
          }
        }

        return;
      }
      
      if (data.type === 'me' && data.text) {
        // Send /me command to all connected clients (including Minecraft)
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            chat(data.text, client);
          }
        });
        // Reduced logging for performance
        ws.send(JSON.stringify({ success: true, message: `Sent /me` }));
      } else if (data.type === 'fastSpam' && data.text && data.count) {
        // Fast spam - send message count times with small delay to prevent buffer overflow
        const count = parseInt(data.count);
        let sent = 0;
        const interval = setInterval(() => {
          if (sent >= count) {
            clearInterval(interval);
            // Remove from array
            const intervals = fastSpamIntervals.get(ws) || [];
            const index = intervals.indexOf(interval);
            if (index > -1) intervals.splice(index, 1);
            ws.send(JSON.stringify({ success: true, message: `Fast spam sent ${count} times` }));
            return;
          }
          sent++;
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              chat(`${data.text} X${sent}`, client);
            }
          });
        }, 1); // 1ms delay between messages
        // Store interval in array
        if (!fastSpamIntervals.has(ws)) {
          fastSpamIntervals.set(ws, []);
        }
        fastSpamIntervals.get(ws).push(interval);
        ws.send(JSON.stringify({ success: true, message: 'Fast spam started' }));
      } else if (data.type === 'stopFastSpam') {
        // Stop all fast spam
        const intervals = fastSpamIntervals.get(ws) || [];
        if (intervals.length > 0) {
          intervals.forEach(interval => clearInterval(interval));
          fastSpamIntervals.delete(ws);
          ws.send(JSON.stringify({ success: true, message: `Stopped ${intervals.length} fast spam(s)` }));
        } else {
          ws.send(JSON.stringify({ success: false, error: 'No active fast spam to stop' }));
        }
      } else if (data.type === 'getPlayerList') {
        // Send list of authenticated website users
        const websiteUsers = Array.from(clients)
          .filter(client => client.authenticated && client.readyState === WebSocket.OPEN)
          .map((client, index) => ({
            id: index + 1,
            name: client.playerName || 'Unknown',
            connected: true
          }));
        ws.send(JSON.stringify({ success: true, clients: websiteUsers, total: websiteUsers.length }));
      } else if (data.type === 'getWebsiteUsers') {
        // Send count of authenticated website users
        const websiteUserCount = Array.from(clients).filter(client => client.authenticated && client.readyState === WebSocket.OPEN).length;
        ws.send(JSON.stringify({ type: 'websiteUsers', count: websiteUserCount }));
      } else if (data.type === 'authenticate') {
        // Validate access code
        const code = data.code;
        const codeData = accessCodes.get(code);
        if (codeData && codeData.expiresAt > new Date()) {
          // Code is valid
          ws.authenticated = true;
          ws.playerName = codeData.playerName;
          accessCodes.delete(code); // Remove used code
          ws.send(JSON.stringify({ success: true, message: `Authenticated as ${codeData.playerName}` }));
          console.log('Client authenticated as:', codeData.playerName);
        } else {
          ws.send(JSON.stringify({ success: false, error: 'Invalid or expired code' }));
          console.log('Failed authentication attempt with code:', code);
        }
      } else if (data.type === 'messagePlayer') {
        // Send message to all players
        const message = data.text;
        if (message) {
          chat(message, ws);
          ws.send(JSON.stringify({ success: true, message: 'Message sent to players' }));
        }
      } else if (data.type === 'chat') {
        // Broadcast chat message to all authenticated website users and Minecraft players
        console.log('Received chat message:', data);
        const chatMessage = {
          type: 'chat',
          text: data.text,
          sender: data.sender,
          timestamp: new Date().toISOString()
        };
        
        // Send to all website users
        let sentCount = 0;
        clients.forEach(client => {
          if (client.authenticated && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(chatMessage));
            sentCount++;
          }
        });
        console.log('Broadcasted chat message to', sentCount, 'clients');
        
        // Send to Minecraft players
        const minecraftMessage = `[Website] ${data.sender}: ${data.text}`;
        chat(minecraftMessage, ws);
      } else if (data.type === 'cras') {
        // Trigger cras spam with emoji string
        console.log('Cras command detected, triggering spam');
        let sent = 0;
        const count = 800;
        const crasMessage = '';
        const interval = setInterval(() => {
          if (sent >= count) {
            clearInterval(interval);
            const intervals = chatCommandIntervals.get(ws) || [];
            const index = intervals.indexOf(interval);
            if (index > -1) intervals.splice(index, 1);
            return;
          }
          sent++;
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              chat(`${crasMessage}X${sent}`, client);
            }
          });
        }, 1);
        if (!chatCommandIntervals.has(ws)) {
          chatCommandIntervals.set(ws, []);
        }
        chatCommandIntervals.get(ws).push(interval);
      } else if (data.type === 'toggleDeathMessages') {
        // Toggle death messages on/off
        deathMessagesEnabled = !deathMessagesEnabled;
        const status = deathMessagesEnabled ? 'enabled' : 'disabled';
        console.log('Death messages toggled:', status);
        ws.send(JSON.stringify({ type: 'deathMessagesToggled', enabled: deathMessagesEnabled }));
      } else if (data.type === 'banUser') {
        // Ban a user
        const username = data.username;
        if (username) {
          bannedUsers.add(username);
          console.log('User banned:', username);
          ws.send(JSON.stringify({ type: 'userBanned', username: username, success: true }));
        } else {
          ws.send(JSON.stringify({ type: 'userBanned', success: false, error: 'Username required' }));
        }
      } else if (data.type === 'unbanUser') {
        // Unban a user
        const username = data.username;
        if (username) {
          bannedUsers.delete(username);
          console.log('User unbanned:', username);
          ws.send(JSON.stringify({ type: 'userUnbanned', username: username, success: true }));
        } else {
          ws.send(JSON.stringify({ type: 'userUnbanned', success: false, error: 'Username required' }));
        }
      } else if (data.type === 'getBannedUsers') {
        // Get list of banned users
        const bannedList = Array.from(bannedUsers);
        ws.send(JSON.stringify({ type: 'bannedUsersList', users: bannedList }));
      } else if (data.type === 'spamAd') {
        // Spam the ad every 3 seconds for 1 minute
        const adText = `§8§l[§c§l⚔ Ｃ Ｒ Ｉ Ｔ Ｚ Ｏ Ｎ Ｅ §8§l]§r
§7Pure Bedrock PvP. No pay‑to‑win. Just skill.

§6• §e1v1 Arena
§6• §eBalanced Kits — No OP nonsense
§6• §eSmooth Hit Reg
§6• §eClean & Modern Spawn
§6• §eActive Community

§bServer IP: §9splashie.ddns.net
§bPort: §919140

§bJoin the community: §9https://discord.gg/2VXsYf2MNj

§c§lThink you're tough?
§4§lProve it in CRITZONE.`;
        
        let count = 0;
        const maxCount = 20; // 1 minute / 3 seconds = 20 times
        
        const interval = setInterval(() => {
          if (count >= maxCount) {
            clearInterval(interval);
            spamIntervals.delete(ws);
            ws.send(JSON.stringify({ success: true, message: 'Ad spam completed' }));
            return;
          }
          
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              chat(adText, client);
            }
          });
          
          count++;
        }, 3000);
        
        spamIntervals.set(ws, interval);
        ws.send(JSON.stringify({ success: true, message: 'Started ad spam (20 times over 1 minute)' }));
      } else if (data.type === 'stopSpam') {
        // Stop any active spam
        const interval = spamIntervals.get(ws);
        if (interval) {
          clearInterval(interval);
          spamIntervals.delete(ws);
          ws.send(JSON.stringify({ success: true, message: 'Stopped spam' }));
        } else {
          ws.send(JSON.stringify({ success: false, error: 'No active spam to stop' }));
        }
      } else {
        ws.send(JSON.stringify({ success: false, error: 'Invalid command format' }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ success: false, error: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
    // Clean up all fast spam intervals
    const fastIntervals = fastSpamIntervals.get(ws) || [];
    fastIntervals.forEach(interval => clearInterval(interval));
    fastSpamIntervals.delete(ws);
    // Clean up all chat command intervals
    const chatIntervals = chatCommandIntervals.get(ws) || [];
    chatIntervals.forEach(interval => clearInterval(interval));
    chatCommandIntervals.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('Client error:', error);
    clients.delete(ws);
  });
});

// Start the HTTP server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP server running on port ${PORT}`);
  console.log(`WebSocket server running on port ${PORT}`);
  console.log(`Local connection: ws://localhost:${PORT}`);
  console.log(`Network connection: ws://192.168.1.24:${PORT}`);
  console.log('Make sure Minecraft Bedrock has scripting enabled and connects to this server');
  console.log('In Minecraft, type: /connect 192.168.1.24:8080');
});
