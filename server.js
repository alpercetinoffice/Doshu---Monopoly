const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// CORS Ayarları (Senin sitene izin veriyoruz)
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Geliştirme aşamasında * kalabilir, canlıda domainini yazarsın
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// ODA SİSTEMİ VERİTABANI (RAM ÜZERİNDE)
let rooms = {}; 

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    // 1. ODA LİSTESİNİ GÖNDER
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

    // 2. ODA OLUŞTURMA (Burada sorun vardı, düzelttik)
    socket.on('createRoom', (data) => {
        console.log("Oda kurma isteği geldi:", data);
        
        // 5 Haneli Rastgele Kod Üret
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            hostName: data.nickname,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, houses: {} }
        };

        // Odayı kuran kişiyi odaya sok
        joinRoomLogic(socket, roomId, data.nickname, data.avatar);
    });

    // 3. ODAYA KATILMA
    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data.nickname, data.avatar);
    });

    // 4. OYUNU BAŞLAT
    socket.on('startGame', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId && rooms[roomId].hostId === socket.id) {
            rooms[roomId].status = 'PLAYING';
            // Oyunu başlat ve herkese bildir
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                gameState: rooms[roomId].gameState,
                currentTurn: rooms[roomId].players[0].id
            });
        }
    });

    // OYUN İÇİ OLAYLAR (ZAR VB.)
    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if(!roomId) return;
        
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        // Basitçe sonucu odaya yayıyoruz (Detaylı oyun mantığı buraya eklenecek)
        io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move:true, newPosition: 5, money: 1500 });
    });

    socket.on('disconnect', () => {
        const roomId = getPlayerRoom(socket.id);
        if(roomId) {
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            if(rooms[roomId].players.length === 0) {
                delete rooms[roomId]; // Oda boşaldıysa sil
            } else {
                io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
            }
        }
    });
});

// YARDIMCI FONKSİYONLAR
function joinRoomLogic(socket, roomId, nickname, avatar) {
    if (!rooms[roomId]) return socket.emit('error', 'Oda bulunamadı!');
    if (rooms[roomId].players.length >= 6) return socket.emit('error', 'Oda dolu!');

    socket.join(roomId); // Socket.io odasına sok

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
    
    // İstemciye "Başardın" de
    socket.emit('roomJoined', { roomId: roomId, isHost: newPlayer.isHost });
    
    // Odadaki herkese güncel listeyi at
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function getPlayerRoom(socketId) {
    return Object.keys(rooms).find(id => rooms[id].players.find(p => p.id === socketId));
}

function getRandomColor() {
    const colors = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#2ecc71', '#e67e22'];
    return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on ${PORT}`); });
