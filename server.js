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

// OYUN VERİLERİ
let rooms = {};
const boardData = require('./public/board_data.js'); // Board data sunucuda da olmalı

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
        let roomId;
        do { roomId = Math.random().toString(36).substring(2, 7).toUpperCase(); } 
        while (rooms[roomId]); // Çakışma önleyici

        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, turnIndex: 0, doublesCount: 0 }
        };
        joinRoomLogic(socket, roomId, data);
    });

    // KATILMA
    socket.on('joinRoom', (data) => joinRoomLogic(socket, data.roomId, data));

    // BAŞLATMA
    socket.on('startGame', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId && rooms[roomId].hostId === socket.id) {
            rooms[roomId].status = 'PLAYING';
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                currentTurn: rooms[roomId].players[0].id
            });
        }
    });

    // ZAR ATMA VE HAREKET
    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        // Sıra kontrolü
        if (room.players[room.gameState.turnIndex].id !== socket.id) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        // Hapis Kontrolü
        if (player.jail) {
            if (isDouble) {
                player.jail = false;
                player.jailTurns = 0;
                movePlayer(player, total);
                io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true, msg: "Çift attın ve özgürsün!" });
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.jail = false;
                    movePlayer(player, total);
                    io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true, msg: "3 tur bitti, ceza ödendi." });
                } else {
                    io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: false, msg: "Hapistesin..." });
                    nextTurn(roomId);
                    return;
                }
            }
        } else {
            // Normal Hareket
            if (isDouble) room.gameState.doublesCount++;
            else room.gameState.doublesCount = 0;

            if (room.gameState.doublesCount >= 3) {
                player.position = 10; // Hapse git
                player.jail = true;
                room.gameState.doublesCount = 0;
                io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true, msg: "3 kez çift! Hapse gidiyorsun." });
                nextTurn(roomId);
                return;
            }

            movePlayer(player, total);
            
            // Kare Aksiyonu (Tapu, Vergi vb.)
            setTimeout(() => {
                handleTileAction(roomId, player);
            }, 1000); // Piyon animasyonu için bekleme

            io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true });
        }

        if (!isDouble && !player.jail) nextTurn(roomId);
    });

    // HAPİS CEZASI ÖDEME
    socket.on('payJail', () => {
        const roomId = getPlayerRoom(socket.id);
        const player = rooms[roomId].players.find(p => p.id === socket.id);
        if(player.money >= 50) {
            player.money -= 50;
            player.jail = false;
            player.jailTurns = 0;
            io.to(roomId).emit('updatePlayers', rooms[roomId].players);
            // Oyuncu tekrar zar atabilir veya sırayı salabilir (Basitlik için sıra salıyoruz)
            nextTurn(roomId);
        }
    });

    // SATIN ALMA
    socket.on('buyProperty', (pos) => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[pos];

        if (player.money >= tile.price && !room.gameState.properties[pos]) {
            player.money -= tile.price;
            player.properties.push(pos);
            room.gameState.properties[pos] = socket.id;
            io.to(roomId).emit('propertyBought', { pos, ownerId: socket.id, money: player.money });
        }
    });

    socket.on('disconnect', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId) {
            // Oyuncuyu hemen silme! Reconnect şansı ver (Basit versiyon: sil ama oyun çökmesin)
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) delete rooms[roomId];
            else io.to(roomId).emit('updatePlayers', room.players);
        }
    });
});

function movePlayer(player, steps) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    if (player.position < oldPos) player.money += 200; // Başlangıçtan geçiş
}

function handleTileAction(roomId, player) {
    const room = rooms[roomId];
    const tile = boardData[player.position];
    
    // Satın alınabilir mülk
    if (tile.type === 'property' || tile.type === 'railroad' || tile.type === 'utility') {
        const ownerId = room.gameState.properties[player.position];
        if (ownerId && ownerId !== player.id) {
            // Kira Ödeme
            const owner = room.players.find(p => p.id === ownerId);
            const rent = tile.rent ? tile.rent[0] : 25; // Basit kira
            player.money -= rent;
            owner.money += rent;
            io.to(roomId).emit('rentPaid', { payer: player.name, owner: owner.name, amount: rent });
            io.to(roomId).emit('updatePlayers', room.players);
        } else if (!ownerId) {
            // Satın alma teklifi
            io.to(player.id).emit('offerBuy', { pos: player.position, tile });
        }
    }
    // Vergi
    else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('updatePlayers', room.players);
    }
    // Kodes
    else if (player.position === 30) {
        player.position = 10;
        player.jail = true;
        io.to(roomId).emit('diceResult', { die1: 0, die2: 0, playerId: player.id, move: true, msg: "KODESE GİT!" });
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
        avatar: data.avatar,
        money: 1500,
        position: 0,
        color: getRandomColor(),
        isHost: rooms[roomId].hostId === socket.id,
        properties: [],
        jail: false
    });
    socket.emit('roomJoined', { roomId, isHost: rooms[roomId].hostId === socket.id });
    io.to(roomId).emit('updatePlayers', rooms[roomId].players);
}

function getPlayerRoom(id) { return Object.keys(rooms).find(r => rooms[r].players.find(p => p.id === id)); }
function getRandomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server: ${PORT}`));
