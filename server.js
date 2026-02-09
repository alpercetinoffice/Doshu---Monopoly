const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// --- ÖNEMLİ: CORS AYARI (HERKESE AÇIK) ---
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Tüm sitelere izin ver (InfinityFree dahil)
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// ODA VERİTABANI
let rooms = {}; 

io.on('connection', (socket) => {
    console.log('✅ Bir kullanıcı bağlandı. ID:', socket.id);

    // 1. ODA LİSTESİ İSTEĞİ
    socket.on('getRooms', () => {
        // Odaları listele
        const roomList = Object.keys(rooms).map(id => ({
            id: id,
            name: rooms[id].name,
            count: rooms[id].players.length,
            status: rooms[id].status,
            host: rooms[id].hostName
        }));
        // İstemciye geri yolla
        socket.emit('roomList', roomList);
    });

    // 2. ODA KURMA İSTEĞİ
    socket.on('createRoom', (data) => {
        console.log("🛠 Oda kurma isteği geldi:", data);
        
        try {
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

            console.log(`✅ Oda kuruldu: ${roomId}`);
            joinRoomLogic(socket, roomId, data.nickname, data.avatar);
            
        } catch (error) {
            console.error("❌ Oda kurarken hata:", error);
            socket.emit('error', 'Oda kurulurken sunucu hatası oluştu.');
        }
    });

    // 3. ODAYA KATILMA
    socket.on('joinRoom', (data) => {
        console.log(`➡ Odaya katılma isteği: ${data.roomId} - ${data.nickname}`);
        joinRoomLogic(socket, data.roomId, data.nickname, data.avatar);
    });

    // 4. OYUN BAŞLATMA
    socket.on('startGame', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId && rooms[roomId].hostId === socket.id) {
            rooms[roomId].status = 'PLAYING';
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                gameState: rooms[roomId].gameState,
                currentTurn: rooms[roomId].players[0].id
            });
            console.log(`🚀 Oyun başladı: ${roomId}`);
        }
    });

    // BAĞLANTI KOPMASI
    socket.on('disconnect', () => {
        console.log('❌ Kullanıcı ayrıldı:', socket.id);
        const roomId = getPlayerRoom(socket.id);
        if(roomId) {
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            if(rooms[roomId].players.length === 0) {
                delete rooms[roomId]; // Oda boşsa sil
                console.log(`🗑 Oda silindi: ${roomId}`);
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

    socket.join(roomId);

    const newPlayer = {
        id: socket.id,
        name: nickname,
        avatar: avatar,
        money: 1500,
        isHost: rooms[roomId].hostId === socket.id
    };

    rooms[roomId].players.push(newPlayer);
    
    // İstemciye "Başardın" mesajı
    socket.emit('roomJoined', { roomId: roomId, isHost: newPlayer.isHost });
    
    // Odadakilere güncelleme
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
    
    // Genel lobiye oda listesini güncelle (sayı değiştiği için)
    socket.broadcast.emit('roomList', Object.keys(rooms).map(id => ({
        id: id, name: rooms[id].name, count: rooms[id].players.length, status: rooms[id].status, host: rooms[id].hostName
    })));
}

function getPlayerRoom(socketId) {
    return Object.keys(rooms).find(id => rooms[id].players.find(p => p.id === socketId));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on ${PORT}`); });
