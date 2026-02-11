const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

// === OYUN VERİLERİ ===
let rooms = {};

io.on('connection', (socket) => {
    console.log('Yeni Bağlantı:', socket.id);

    // ODA OLUŞTURMA
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            players: [],
            gameState: { 
                turnIndex: 0, 
                properties: {}, // { tileIndex: playerId }
                houses: {} 
            },
            status: 'LOBBY'
        };
        joinRoomLogic(socket, roomId, data);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data);
    });

    // ODA LİSTESİ
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length, status: rooms[id].status
        }));
        socket.emit('roomList', list);
    });

    // OYUNU BAŞLAT
    socket.on('startGame', () => {
        const roomId = getRoomId(socket.id);
        if(roomId && rooms[roomId].hostId === socket.id) {
            rooms[roomId].status = 'PLAYING';
            // İlk oyuncunun sırası
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                turnPlayerId: rooms[roomId].players[0].id
            });
        }
    });

    // ZAR ATMA VE HAREKET
    socket.on('rollDice', () => {
        const roomId = getRoomId(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        // Sıra kontrolü
        if (room.players[room.gameState.turnIndex].id !== socket.id) return;

        const die1 = Math.ceil(Math.random() * 6);
        const die2 = Math.ceil(Math.random() * 6);
        const total = die1 + die2;
        const isDouble = die1 === die2;

        // HAPİS MANTIĞI
        if (player.jail) {
            if (isDouble) {
                player.jail = false;
                player.jailTurns = 0;
                movePlayer(roomId, player, total);
                io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, msg: "Çift attın, özgürsün!" });
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.jail = false;
                    movePlayer(roomId, player, total);
                    io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, msg: "Cezanı ödedin ve çıktın." });
                } else {
                    io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: false, msg: "Hapistesin..." });
                    nextTurn(roomId);
                }
            }
        } else {
            // NORMAL HAREKET
            io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true });
            
            // Animasyon süresi kadar bekle sonra hareketi işle
            setTimeout(() => {
                movePlayer(roomId, player, total);
                
                // Çift atmazsa sıra geçer
                if (!isDouble) nextTurn(roomId);
            }, 3000); // Zar animasyon payı
        }
    });

    // MÜLK SATIN ALMA
    socket.on('buyProperty', (tileIndex) => {
        const roomId = getRoomId(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        // Fiyat kontrolü (Basitlik için sabit 200₺ veya client'tan gelen veriyle eşleşmeli. 
        // Güvenlik için normalde boardData sunucuda olmalı ama şimdilik esnek bırakıyorum)
        const price = 200; // Örnek fiyat, boardData ile senkronize olmalı
        
        if(player.money >= price) {
            player.money -= price;
            room.gameState.properties[tileIndex] = socket.id;
            io.to(roomId).emit('propertyBought', { 
                tileIndex, playerId: socket.id, money: player.money 
            });
        }
    });

    socket.on('disconnect', () => {
        const roomId = getRoomId(socket.id);
        if(roomId) {
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            if(rooms[roomId].players.length === 0) delete rooms[roomId];
            else io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        }
    });
});

function movePlayer(roomId, player, steps) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    
    // Başlangıçtan geçti mi?
    if(player.position < oldPos) {
        player.money += 200;
    }

    // Kodes (30 -> 10)
    if(player.position === 30) {
        player.position = 10;
        player.jail = true;
        player.jailTurns = 0;
    }

    io.to(roomId).emit('playerMoved', { 
        playerId: player.id, 
        position: player.position, 
        money: player.money,
        isJail: player.jail 
    });
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.players.length;
    io.to(roomId).emit('turnChange', room.players[room.gameState.turnIndex].id);
}

function joinRoomLogic(socket, roomId, data) {
    if(!rooms[roomId]) return;
    socket.join(roomId);
    
    const newPlayer = {
        id: socket.id,
        name: data.nickname,
        avatar: data.avatar,
        money: 1500,
        position: 0,
        jail: false,
        jailTurns: 0,
        color: getRandomColor(),
        isHost: rooms[roomId].hostId === socket.id
    };
    
    rooms[roomId].players.push(newPlayer);
    socket.emit('roomJoined', { roomId, isHost: newPlayer.isHost });
    io.to(roomId).emit('updatePlayers', rooms[roomId].players);
}

function getRoomId(socketId) {
    return Object.keys(rooms).find(id => rooms[id].players.find(p => p.id === socketId));
}

function getRandomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Sunucu Hazır: ' + PORT));
