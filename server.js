const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.status(200).send('OK'));

// === GAME DATA ===
let rooms = {};
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

const CHANCE_CARDS = [
    { text: 'Bank pays you 200₺!', money: 200 },
    { text: 'Your birthday! Collect 50₺ from each player!', type: 'birthday' },
    { text: 'Speeding fine! Pay 100₺', money: -100 },
    { text: 'Advance to GO and collect 200₺!', type: 'go' },
    { text: 'Tax refund! Collect 150₺', money: 150 },
    { text: 'Go to jail! Go directly to jail!', type: 'jail' },
    { text: 'Pay 50₺ for each house you own!', type: 'maintenance' },
    { text: 'Go back 3 spaces!', type: 'back3' }
];

const CHEST_CARDS = [
    { text: 'Bank error in your favor! Collect 200₺', money: 200 },
    { text: 'Doctor fees! Pay 100₺', money: -100 },
    { text: 'You win a contest! Collect 100₺', money: 100 },
    { text: 'School fees refund! Collect 50₺', money: 50 },
    { text: 'Holiday fund! Collect 100₺', money: 100 },
    { text: 'Go to jail! Directly to jail!', type: 'jail' },
    { text: 'You inherit 100₺!', money: 100 },
    { text: 'Insurance expired! Pay 50₺', money: -50 }
];

const boardData = require('./public/board_data.js');

// === SOCKET HANDLERS ===
io.on('connection', (socket) => {
    console.log('✅ New connection:', socket.id);

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'s Room`,
            hostId: socket.id,
            hostName: data.nickname,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, currentTurn: 0, turnPlayerId: null }
        };

        joinRoomLogic(socket, roomId, data.nickname, data.character);
    });

    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length,
            status: rooms[id].status, host: rooms[id].hostName
        }));
        socket.emit('roomList', list);
    });

    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data.nickname, data.character);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id || room.players.length < 2) {
            return socket.emit('error', 'Cannot start game!');
        }

        room.players.forEach((p, i) => {
            p.position = 0;
            p.money = 1500;
            p.color = PLAYER_COLORS[i];
            p.properties = [];
            p.houses = {};
            p.inJail = false;
            p.jailTurns = 0;
        });

        room.status = 'PLAYING';
        room.gameState.turnPlayerId = room.players[0].id;

        io.to(roomId).emit('gameStarted', {
            players: room.players,
            currentTurn: room.gameState.turnPlayerId
        });

        console.log(`🎮 Game started: ${roomId}`);
    });

    socket.on('rollDice', (data) => {
        const roomId = findPlayerRoom(socket.id);
        if (!roomId) return;

        const room = rooms[roomId];
        if (room.gameState.turnPlayerId !== socket.id) {
            return socket.emit('error', 'Not your turn!');
        }

        const player = room.players.find(p => p.id === socket.id);
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDoubles = die1 === die2;

        // Jail handling
        if (player.inJail) {
            if (isDoubles) {
                player.inJail = false;
                player.jailTurns = 0;
                io.to(roomId).emit('jailReleased', { playerId: socket.id });
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.inJail = false;
                    player.jailTurns = 0;
                    io.to(roomId).emit('jailReleased', { playerId: socket.id });
                } else {
                    io.to(roomId).emit('diceResult', {
                        playerId: socket.id, die1, die2, total,
                        newPosition: player.position, money: player.money,
                        wasInJail: true
                    });
                    if (!isDoubles) {
                        setTimeout(() => changeTurn(roomId), 2000);
                    }
                    return;
                }
            }
        }

        const oldPos = player.position;
        player.position = (player.position + total) % 40;

        if (player.position < oldPos) {
            player.money += 200;
        }

        // Check if landed on GO TO JAIL
        if (player.position === 30) {
            player.position = 10;
            player.inJail = true;
            player.jailTurns = 0;
            io.to(roomId).emit('jailEntered', { playerId: socket.id, turns: 0 });
        }

        io.to(roomId).emit('diceResult', {
            playerId: socket.id, die1, die2, total,
            newPosition: player.position, money: player.money,
            wasInJail: false
        });

        setTimeout(() => {
            if (!player.inJail) {
                handleTileAction(roomId, socket.id, player.position);
            }
        }, 1000);

        if (!isDoubles && !player.inJail) {
            setTimeout(() => changeTurn(roomId), 3000);
        }
    });

    socket.on('payBail', () => {
        const roomId = findPlayerRoom(socket.id);
        if (!roomId) return;

        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);

        if (player.inJail && player.money >= 50) {
            player.money -= 50;
            player.inJail = false;
            player.jailTurns = 0;
            io.to(roomId).emit('jailReleased', { playerId: socket.id });
        }
    });

    socket.on('buyProperty', (data) => {
        const roomId = findPlayerRoom(socket.id);
        if (!roomId) return;

        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[data.position];

        if (player.money >= tile.price) {
            player.money -= tile.price;
            player.properties.push(data.position);
            room.gameState.properties[data.position] = socket.id;

            io.to(roomId).emit('propertyPurchased', {
                playerId: socket.id,
                position: data.position,
                money: player.money
            });
        }
    });

    socket.on('disconnect', () => {
        const roomId = findPlayerRoom(socket.id);
        if (roomId) {
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.hostId === socket.id && room.players.length > 0) {
                room.hostId = room.players[0].id;
                room.players[0].isHost = true;
            }

            if (room.players.length === 0) {
                delete rooms[roomId];
            } else {
                io.to(roomId).emit('updateRoomPlayers', room.players);
            }
        }
    });
});

function joinRoomLogic(socket, roomId, nickname, character) {
    if (!rooms[roomId]) return socket.emit('error', 'Room not found!');
    if (rooms[roomId].players.length >= 6) return socket.emit('error', 'Room full!');

    socket.join(roomId);
    const newPlayer = {
        id: socket.id, name: nickname, character: character,
        isHost: rooms[roomId].hostId === socket.id
    };
    rooms[roomId].players.push(newPlayer);

    socket.emit('roomJoined', { roomId, isHost: newPlayer.isHost });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function findPlayerRoom(playerId) {
    return Object.keys(rooms).find(id => rooms[id].players.find(p => p.id === playerId));
}

function handleTileAction(roomId, playerId, position) {
    const room = rooms[roomId];
    const tile = boardData[position];
    const player = room.players.find(p => p.id === playerId);

    if (tile.type === 'property') {
        const owner = room.gameState.properties[position];
        
        if (!owner) {
            io.to(playerId).emit('propertyLanded', { position });
        } else if (owner !== playerId) {
            const ownerPlayer = room.players.find(p => p.id === owner);
            const rent = tile.rent[0];

            player.money -= rent;
            ownerPlayer.money += rent;

            io.to(roomId).emit('rentPaid', {
                payerId: playerId, receiverId: owner, amount: rent,
                payerMoney: player.money, receiverMoney: ownerPlayer.money
            });
        }
    } else if (tile.type === 'chance') {
        const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
        handleCard(roomId, playerId, card, 'chance');
    } else if (tile.type === 'chest') {
        const card = CHEST_CARDS[Math.floor(Math.random() * CHEST_CARDS.length)];
        handleCard(roomId, playerId, card, 'chest');
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
    }
}

function handleCard(roomId, playerId, card, type) {
    const room = rooms[roomId];
    const player = room.players.find(p => p.id === playerId);

    if (card.money) {
        player.money += card.money;
    } else if (card.type === 'jail') {
        player.position = 10;
        player.inJail = true;
        player.jailTurns = 0;
        io.to(roomId).emit('jailEntered', { playerId, turns: 0 });
    } else if (card.type === 'go') {
        player.position = 0;
        player.money += 200;
    } else if (card.type === 'birthday') {
        room.players.forEach(p => {
            if (p.id !== playerId) {
                p.money -= 50;
                player.money += 50;
            }
        });
    }

    io.to(roomId).emit('cardDrawn', { playerId, type, text: card.text });
}

function changeTurn(roomId) {
    const room = rooms[roomId];
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.turnPlayerId);
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.gameState.turnPlayerId = room.players[nextIndex].id;

    io.to(roomId).emit('turnChange', room.gameState.turnPlayerId);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🎮 MONOPOLY GOLD EDITION 🎮         ║
╠═══════════════════════════════════════╣
║   Port: ${PORT}                       ║
║   Status: ✅ ONLINE                   ║
║   Features: ✨ Full Premium           ║
╚═══════════════════════════════════════╝
    `);
});
