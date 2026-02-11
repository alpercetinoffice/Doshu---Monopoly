const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

// === GAME DATA ===
let rooms = {};

// Şans kartları (Basitleştirilmiş)
const CHANCE_CARDS = [
    { text: 'Bankadan 200₺ alın!', money: 200 },
    { text: 'Hız cezası! 100₺ ödeyin.', money: -100 },
    { text: 'Başlangıca ilerleyin.', type: 'go' },
    { text: 'Hapse girin!', type: 'jail' }
];

io.on('connection', (socket) => {
    console.log('Bağlantı:', socket.id);

    // ODA LİSTESİ
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length, status: rooms[id].status
        }));
        socket.emit('roomList', list);
    });

    // ODA KURMA
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, turnIndex: 0 }
        };
        joinRoomLogic(socket, roomId, data);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data);
    });

    // OYUNU BAŞLAT
    socket.on('startGame', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId && rooms[roomId].hostId === socket.id) {
            rooms[roomId].status = 'PLAYING';
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                gameState: rooms[roomId].gameState,
                currentTurn: rooms[roomId].players[0].id
            });
        }
    });

    // ZAR ATMA & HAPİSHANE KONTROLÜ
    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const isDouble = die1 === die2;
        
        // HAPİSHANE MANTIĞI
        if (player.jail) {
            if (isDouble) {
                player.jail = false; // Çıktı
                player.jailTurns = 0;
                movePlayer(player, die1 + die2, roomId);
                io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true, msg: "Çift attın ve hapisten çıktın!" });
            } else {
                player.jailTurns = (player.jailTurns || 0) + 1;
                if(player.jailTurns >= 3) {
                    player.money -= 50;
                    player.jail = false;
                    player.jailTurns = 0;
                    movePlayer(player, die1 + die2, roomId);
                    io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true, msg: "3 tur doldu, 50₺ ödendi ve çıktın." });
                } else {
                    io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: false, msg: "Hapistesin, çıkamadın." });
                    nextTurn(roomId);
                    return; // Hareket etme, sıra geç
                }
            }
        } else {
            // NORMAL HAREKET
            movePlayer(player, die1 + die2, roomId);
            io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true });
        }

        if (!isDouble) nextTurn(roomId);
    });

    // HAPİSTEN PARA İLE ÇIKMA
    socket.on('payJail', () => {
        const roomId = getPlayerRoom(socket.id);
        const player = rooms[roomId].players.find(p => p.id === socket.id);
        if(player.money >= 50) {
            player.money -= 50;
            player.jail = false;
            player.jailTurns = 0;
            io.to(roomId).emit('jailPaid', { playerId: socket.id, money: player.money });
        }
    });
    
    // Mülk Satın Alma vs. (Önceki kodların aynısı buraya eklenebilir)
    // ... (Basitlik için kısalttım, önceki satın alma mantığını koruyabilirsin)

    socket.on('disconnect', () => {
        // ... (Kopma mantığı aynı)
    });
});

function movePlayer(player, steps, roomId) {
    player.position = (player.position + steps) % 40;
    // Kodes karesi (Örnek: 10. kare hapis, 30. kare kodese git)
    if (player.position === 30) {
        player.position = 10;
        player.jail = true;
        player.jailTurns = 0;
    }
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.players.length;
    io.to(roomId).emit('turnChange', room.players[room.gameState.turnIndex].id);
}

function joinRoomLogic(socket, roomId, data) {
    if (!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].players.push({
        id: socket.id,
        name: data.nickname,
        avatar: data.avatar, // Artık URL veya ID gelecek
        money: 1500,
        position: 0,
        color: getRandomColor(),
        isHost: rooms[roomId].hostId === socket.id,
        jail: false
    });
    socket.emit('roomJoined', { roomId, isHost: rooms[roomId].hostId === socket.id });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function getPlayerRoom(id) {
    return Object.keys(rooms).find(rid => rooms[rid].players.find(p => p.id === id));
}
function getRandomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server ${PORT}`));
