const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, turnIndex: 0 }
        };
        joinRoomLogic(socket, roomId, data);
    });

    socket.on('joinRoom', (data) => joinRoomLogic(socket, data.roomId, data));
    
    socket.on('getRooms', () => {
        const list = Object.values(rooms).map(r => ({
            id: r.id, count: r.players.length, status: r.status, host: r.players[0]?.name
        }));
        socket.emit('roomList', list);
    });

    socket.on('startGame', () => {
        const roomId = getPlayerRoom(socket.id);
        if(roomId) {
            rooms[roomId].status = 'PLAYING';
            io.to(roomId).emit('gameStarted', rooms[roomId]);
        }
    });

    // --- OYUN İÇİ AKSİYONLAR ---

    // 1. ZAR ATMA VE HAPİSHANE KONTROLÜ
    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);

        // Sıra kontrolü
        if(room.players[room.gameState.turnIndex].id !== socket.id) return;

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const isDouble = d1 === d2;

        // Hapishane Mantığı
        if (player.isJailed) {
            if (isDouble) {
                player.isJailed = false;
                player.jailTurns = 0;
            } else {
                player.jailTurns++;
                io.to(roomId).emit('diceResult', { d1, d2, playerId: socket.id, move: false, msg: "Çift gelmedi, hapistesin!" });
                if(player.jailTurns >= 3) {
                    // 3 tur olduysa zorla öde ve çıkar (Basit kural)
                    player.money -= 50;
                    player.isJailed = false;
                    io.to(roomId).emit('notification', `${player.name} 3 tur beklediği için 50₺ ödedi ve çıktı.`);
                    movePlayer(room, player, d1 + d2);
                } else {
                    nextTurn(room);
                }
                return;
            }
        }

        // Hareket
        movePlayer(room, player, d1 + d2, d1, d2);
    });

    // 2. KEFALET ÖDE (Hapisten Çık)
    socket.on('payBail', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);

        if(player.money >= 50 && player.isJailed) {
            player.money -= 50;
            player.isJailed = false;
            player.jailTurns = 0;
            io.to(roomId).emit('playerUpdate', player); // Para güncelle
            io.to(roomId).emit('notification', `${player.name} 50₺ kefalet ödedi ve özgür!`);
            // Özgür kaldıktan sonra zar atmasına izin ver (Sıra değişmez)
        }
    });

    socket.on('disconnect', () => {
        const roomId = getPlayerRoom(socket.id);
        if(roomId) {
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            if(rooms[roomId].players.length === 0) delete rooms[roomId];
            else io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
        }
    });
});

function movePlayer(room, player, totalSteps, d1, d2) {
    const oldPos = player.position;
    player.position = (player.position + totalSteps) % 40;

    // Başlangıçtan geçiş parası
    if(player.position < oldPos) {
        player.money += 200;
    }

    // Kodes kontrolü (Kare 30 -> Kare 10'a git)
    if(player.position === 30) {
        player.position = 10;
        player.isJailed = true;
        io.to(room.id).emit('notification', `${player.name} kodese girdi!`);
    }

    io.to(room.id).emit('diceResult', { 
        d1, d2, 
        playerId: player.id, 
        move: true, 
        newPosition: player.position, 
        money: player.money 
    });

    if(d1 !== d2) nextTurn(room);
}

function nextTurn(room) {
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.players.length;
    io.to(room.id).emit('turnChange', room.players[room.gameState.turnIndex].id);
}

function joinRoomLogic(socket, roomId, data) {
    if(!rooms[roomId]) return;
    socket.join(roomId);
    const newPlayer = {
        id: socket.id,
        name: data.nickname,
        avatar: data.avatar, // Animasyonlu karakter asset ID'si
        color: getRandomColor(),
        money: 1500,
        position: 0,
        isJailed: false,
        jailTurns: 0,
        isHost: rooms[roomId].players.length === 0
    };
    rooms[roomId].players.push(newPlayer);
    socket.emit('roomJoined', { roomId, isHost: newPlayer.isHost });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function getPlayerRoom(socketId) {
    return Object.keys(rooms).find(id => rooms[id].players.find(p => p.id === socketId));
}

function getRandomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server: ${PORT}`));
