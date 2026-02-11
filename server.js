const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Statik dosyaları sun (Senin klasör yapına göre)
app.use(express.static(path.join(__dirname, '.htdocs/Monopoly')));

// BOARD DATA (Sunucu tarafı doğrulama için)
const boardData = require('./.htdocs/Monopoly/board_data.js');

let rooms = {};

io.on('connection', (socket) => {
    console.log('Bağlantı:', socket.id);

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: [],
            status: 'LOBBY',
            gameState: { 
                turnIndex: 0, 
                properties: {}, // { tapuId: ownerId }
                houses: {} 
            }
        };
        joinRoomLogic(socket, roomId, data);
    });

    socket.on('joinRoom', (data) => joinRoomLogic(socket, data.roomId, data));
    socket.on('getRooms', () => socket.emit('roomList', Object.values(rooms).map(r => ({id: r.id, count: r.players.length, status: r.status}))));

    socket.on('startGame', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId && rooms[roomId].players[0].id === socket.id) {
            rooms[roomId].status = 'PLAYING';
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                firstTurn: rooms[roomId].players[0].id
            });
        }
    });

    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        // ZAR ATMA
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        // HAPİS MANTIĞI
        if (player.isJailed) {
            if (isDouble) {
                player.isJailed = false;
                player.jailTurns = 0;
            } else {
                player.jailTurns++;
                if(player.jailTurns >= 3) {
                    player.money -= 50;
                    player.isJailed = false;
                    player.jailTurns = 0;
                } else {
                    io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: false, msg: "Hapisten çıkamadın!" });
                    nextTurn(roomId);
                    return;
                }
            }
        }

        // HAREKET VE YENİ POZİSYON
        const oldPos = player.position;
        player.position = (player.position + total) % 40;
        
        // BAŞLANGIÇTAN GEÇME PARASI
        if (player.position < oldPos) player.money += 200;

        // KODESE GİT KARESİ (30. Kare)
        let jailEvent = false;
        if (player.position === 30) {
            player.position = 10;
            player.isJailed = true;
            jailEvent = true;
        }

        io.to(roomId).emit('diceResult', { 
            die1, die2, 
            playerId: socket.id, 
            move: true, 
            newPosition: player.position,
            money: player.money,
            isJailed: jailEvent
        });

        // EĞER ÇİFT DEĞİLSE SIRA GEÇER (Client animasyonu bitince tetiklenir)
        if (!isDouble) {
            // Client'tan "animasyon bitti" sinyali gelince sıra değişecek, 
            // ama basitlik için timeout ile koruyoruz.
            setTimeout(() => nextTurn(roomId), 4000); 
        }
    });

    // MÜLK SATIN ALMA
    socket.on('buyProperty', (tileId) => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[tileId];

        if (player.money >= tile.price && !room.gameState.properties[tileId]) {
            player.money -= tile.price;
            room.gameState.properties[tileId] = socket.id;
            io.to(roomId).emit('propertyBought', { 
                tileId, ownerId: socket.id, money: player.money, price: tile.price 
            });
        }
    });

    // KİRA ÖDEME (Otomatik)
    socket.on('payRent', (data) => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const payer = room.players.find(p => p.id === socket.id);
        const owner = room.players.find(p => p.id === data.ownerId);
        
        if (payer && owner) {
            payer.money -= data.amount;
            owner.money += data.amount;
            io.to(roomId).emit('rentPaid', { 
                payerId: socket.id, ownerId: data.ownerId, amount: data.amount,
                payerMoney: payer.money, ownerMoney: owner.money
            });
        }
    });
});

function joinRoomLogic(socket, roomId, data) {
    if (!rooms[roomId]) return;
    socket.join(roomId);
    
    rooms[roomId].players.push({
        id: socket.id,
        name: data.nickname,
        avatar: data.avatar,
        money: 1500,
        position: 0,
        color: getRandomColor(),
        isJailed: false,
        jailTurns: 0,
        isHost: rooms[roomId].players.length === 0
    });

    io.to(roomId).emit('updatePlayers', rooms[roomId].players);
}

function nextTurn(roomId) {
    if(!rooms[roomId]) return;
    const room = rooms[roomId];
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.players.length;
    io.to(roomId).emit('turnChange', room.players[room.gameState.turnIndex].id);
}

function getPlayerRoom(socketId) {
    return Object.keys(rooms).find(id => rooms[id].players.find(p => p.id === socketId));
}

function getRandomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));
