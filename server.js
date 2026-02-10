const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// Static dosyalar için middleware
app.use(express.static(path.join(__dirname, 'public')));

// Ana sayfa route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint (Render.com için)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Oda verilerini tutan obje
let rooms = {};

// Oyuncu renkleri
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

io.on('connection', (socket) => {
    console.log('✅ Yeni bağlantı:', socket.id);

    // ODA KURMA
    socket.on('createRoom', (data) => {
        console.log("📝 Oda kurma isteği:", data);
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            hostName: data.nickname,
            players: [],
            status: 'LOBBY',
            gameState: { 
                properties: {}, 
                houses: {},
                currentTurn: 0,
                turnPlayerId: null
            }
        };

        joinRoomLogic(socket, roomId, data.nickname, data.avatar);
    });

    // ODA LİSTESİ
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id: id,
            name: rooms[id].name,
            count: rooms[id].players.length,
            status: rooms[id].status,
            host: rooms[id].hostName
        }));
        socket.emit('roomList', list);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data.nickname, data.avatar);
    });

    // OYUNU BAŞLAT (Sadece host yapabilir)
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if(!room) {
            socket.emit('error', 'Oda bulunamadı!');
            return;
        }
        if(room.hostId !== socket.id) {
            socket.emit('error', 'Sadece host oyunu başlatabilir!');
            return;
        }
        if(room.players.length < 2) {
            socket.emit('error', 'En az 2 oyuncu gerekli!');
            return;
        }

        console.log(`🎮 Oyun başlatılıyor: ${roomId}`);

        // Oyuncuları hazırla
        room.players.forEach((p, i) => {
            p.position = 0;
            p.money = 1500;
            p.color = PLAYER_COLORS[i];
            p.properties = [];
        });

        room.status = 'PLAYING';
        room.gameState.currentTurn = 0;
        room.gameState.turnPlayerId = room.players[0].id;

        // Tüm oyunculara oyun başladı sinyali gönder
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            currentTurn: room.gameState.turnPlayerId
        });

        console.log(`✅ Oyun başladı: ${roomId}, Oyuncular: ${room.players.length}`);
    });

    // ZAR ATMA
    socket.on('rollDice', () => {
        const roomId = Object.keys(rooms).find(id => 
            rooms[id].players.find(p => p.id === socket.id)
        );
        
        if(!roomId) {
            socket.emit('error', 'Oda bulunamadı!');
            return;
        }
        
        const room = rooms[roomId];
        
        // Sıra kontrolü
        if(room.gameState.turnPlayerId !== socket.id) {
            socket.emit('error', 'Sıra sende değil!');
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if(!player) return;

        // Zar at
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;

        console.log(`🎲 ${player.name} zar attı: ${die1} + ${die2} = ${total}`);

        // Yeni pozisyon
        const oldPos = player.position;
        player.position = (player.position + total) % 40;

        // Başlangıçtan geçtiyse para ekle
        if(player.position < oldPos) {
            player.money += 200;
            console.log(`💰 ${player.name} başlangıçtan geçti! +200₺`);
        }

        // Tüm oyunculara sonucu gönder
        io.to(roomId).emit('diceResult', {
            playerId: socket.id,
            die1: die1,
            die2: die2,
            total: total,
            newPosition: player.position,
            money: player.money
        });

        // Sırayı değiştir (çift gelmediyse)
        if(die1 !== die2) {
            const currentIndex = room.players.findIndex(p => p.id === socket.id);
            const nextIndex = (currentIndex + 1) % room.players.length;
            room.gameState.turnPlayerId = room.players[nextIndex].id;
            
            console.log(`🔄 Sıra değişti: ${room.players[nextIndex].name}`);
            io.to(roomId).emit('turnChange', room.gameState.turnPlayerId);
        } else {
            console.log(`🎲 Çift geldi! ${player.name} tekrar atacak`);
        }
    });

    // ODA AYRILMA / KOPMA
    socket.on('disconnect', () => {
        console.log('❌ Bağlantı koptu:', socket.id);
        
        const roomId = Object.keys(rooms).find(id => 
            rooms[id].players.find(p => p.id === socket.id)
        );
        
        if(roomId) {
            const leavingPlayer = rooms[roomId].players.find(p => p.id === socket.id);
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            
            console.log(`👋 ${leavingPlayer?.name || 'Oyuncu'} odadan ayrıldı: ${roomId}`);
            
            // Host ayrıldıysa yeni host ata
            if(rooms[roomId].hostId === socket.id && rooms[roomId].players.length > 0) {
                rooms[roomId].hostId = rooms[roomId].players[0].id;
                rooms[roomId].players[0].isHost = true;
                console.log(`👑 Yeni host: ${rooms[roomId].players[0].name}`);
            }
            
            if(rooms[roomId].players.length === 0) {
                delete rooms[roomId];
                console.log(`🗑️ Oda silindi: ${roomId}`);
            } else {
                io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
            }
        }
    });
});

function joinRoomLogic(socket, roomId, nickname, avatar) {
    if (!rooms[roomId]) {
        socket.emit('error', 'Oda bulunamadı!');
        console.log(`❌ Oda bulunamadı: ${roomId}`);
        return;
    }
    
    if(rooms[roomId].players.length >= 6) {
        socket.emit('error', 'Oda dolu!');
        console.log(`❌ Oda dolu: ${roomId}`);
        return;
    }
    
    socket.join(roomId);
    const newPlayer = {
        id: socket.id,
        name: nickname,
        avatar: avatar,
        isHost: rooms[roomId].hostId === socket.id
    };
    rooms[roomId].players.push(newPlayer);
    
    socket.emit('roomJoined', { roomId: roomId, isHost: newPlayer.isHost });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
    
    console.log(`✅ ${nickname} odaya katıldı: ${roomId} (${rooms[roomId].players.length}/6)`);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🎮 MONOPOLY SERVER BAŞLATILDI 🎮   ║
╠═══════════════════════════════════════╣
║   Port: ${PORT}                        ║
║   Server: Render.com                  ║
║   Status: ✅ ONLINE                    ║
╚═══════════════════════════════════════╝
    `);
});
