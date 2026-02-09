const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: {
        origin: function (origin, callback) {
            const allowedOrigins = [
                "https://doshu.gamer.gd", "https://doshu.gamer.gd/",
                "http://doshu.gamer.gd", "http://localhost:3000", "http://127.0.0.1:5500"
            ];
            if (!origin || allowedOrigins.some(o => origin.startsWith(o))) callback(null, true);
            else callback(null, true); // Dev modunda esnek bırakalım
        },
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// ODA YÖNETİMİ
let rooms = {}; // { roomId: { players: [], gameState: {}, status: 'LOBBY' | 'PLAYING' } }

io.on('connection', (socket) => {
    // 1. Oda Listesini Gönder
    socket.on('getRooms', () => {
        const roomList = Object.keys(rooms).map(id => ({
            id: id,
            name: rooms[id].name,
            count: rooms[id].players.length,
            status: rooms[id].status,
            host: rooms[id].hostName
        }));
        socket.emit('roomList', roomList);
    });

    // 2. Oda Kur
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Odası`,
            hostId: socket.id,
            hostName: data.nickname,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, houses: {}, chanceCards: [] } // Oyun verileri
        };
        joinRoomLogic(socket, roomId, data.nickname, data.avatar);
    });

    // 3. Odaya Katıl
    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data.nickname, data.avatar);
    });

    // 4. Oyunu Başlat
    socket.on('startGame', () => {
        const roomId = getPlayerRoom(socket.id);
        if(roomId && rooms[roomId].hostId === socket.id) {
            if(rooms[roomId].players.length < 2) return; // En az 2 kişi kuralı
            rooms[roomId].status = 'PLAYING';
            
            // İlk oyuncuya sırayı ver
            const firstPlayerId = rooms[roomId].players[0].id;
            
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                gameState: rooms[roomId].gameState,
                currentTurn: firstPlayerId
            });
        }
    });

    // --- OYUN İÇİ AKSİYONLAR (Zar, Mülk vs.) ---
    // Her eventte "roomId" kontrolü yapılmalı veya socket.room kullanılmalı
    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if(!roomId) return;
        
        const room = rooms[roomId];
        // Basit sıra kontrolü
        // ... (Burada oyun mantığı işleyecek, önceki kodların aynısı ama "room" objesi üzerinden)
        
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true, newPosition: 5, money: 1500 }); // Örnek veri
    });

    socket.on('disconnect', () => {
        const roomId = getPlayerRoom(socket.id);
        if(roomId) {
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            if(rooms[roomId].players.length === 0) {
                delete rooms[roomId]; // Oda boşsa sil
            } else {
                io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
            }
        }
    });
});

function joinRoomLogic(socket, roomId, nickname, avatar) {
    if (!rooms[roomId]) return socket.emit('error', 'Oda bulunamadı!');
    if (rooms[roomId].players.length >= 6) return socket.emit('error', 'Oda dolu!');

    socket.join(roomId);
    
    // Oyuncuyu ekle
    const newPlayer = {
        id: socket.id,
        name: nickname,
        avatar: avatar,
        money: 1500,
        position: 0,
        color: getRandomColor(),
        isHost: rooms[roomId].hostId === socket.id
    };
    rooms[roomId].players.push(newPlayer);

    // Odaya kabul edildiğini bildir
    socket.emit('roomJoined', { roomId: roomId, isHost: newPlayer.isHost });
    
    // Odadaki herkese güncel listeyi at
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function getPlayerRoom(socketId) {
    const rId = Object.keys(rooms).find(id => rooms[id].players.find(p => p.id === socketId));
    return rId;
}

function getRandomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on ${PORT}`); });
