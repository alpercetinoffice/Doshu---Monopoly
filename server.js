const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Tüm kaynaklara izin ver (InfinityFree için)
        methods: ["GET", "POST"]
    }
});
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// --- ODA YÖNETİMİ ---
let rooms = {}; // { roomCode: { players: [], gameState: {}, settings: {}, started: false } }

io.on('connection', (socket) => {
    // 1. Oda Listesini İste
    socket.on('getRooms', () => {
        const publicRooms = Object.values(rooms)
            .filter(r => !r.started && !r.settings.private)
            .map(r => ({
                code: r.code,
                host: r.players[0].name,
                count: r.players.length,
                max: r.settings.maxPlayers
            }));
        socket.emit('roomList', publicRooms);
    });

    // 2. Oda Oluştur
    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        const player = createPlayer(socket.id, data.playerName, true); // Host

        rooms[roomCode] = {
            code: roomCode,
            players: [player],
            gameState: { properties: {} },
            settings: {
                maxPlayers: parseInt(data.maxPlayers) || 4,
                private: false // Şimdilik herkes görebilsin
            },
            started: false,
            currentPlayerIndex: 0,
            playerIds: [socket.id]
        };

        socket.join(roomCode);
        socket.emit('roomJoined', { roomCode, isHost: true, players: rooms[roomCode].players });
        io.emit('refreshRooms'); // Diğerlerine listeyi güncelle
    });

    // 3. Odaya Katıl
    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomCode];

        if (!room) {
            socket.emit('error', 'Oda bulunamadı!');
            return;
        }
        if (room.started) {
            socket.emit('error', 'Oyun çoktan başladı!');
            return;
        }
        if (room.players.length >= room.settings.maxPlayers) {
            socket.emit('error', 'Oda dolu!');
            return;
        }

        const player = createPlayer(socket.id, data.playerName, false);
        room.players.push(player);
        room.playerIds.push(socket.id);

        socket.join(data.roomCode);
        
        // Odaya girene bilgiyi ver
        socket.emit('roomJoined', { roomCode: data.roomCode, isHost: false, players: room.players });
        
        // Odadakilere yeni oyuncuyu bildir
        io.to(data.roomCode).emit('updateLobbyPlayers', room.players);
        io.emit('refreshRooms'); // Listeyi güncelle
    });

    // 4. Oyunu Başlat (Sadece Host)
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.players[0].id === socket.id) {
            if(room.players.length < 2) {
                // socket.emit('error', 'En az 2 kişi gerekli!'); // Test için kapalı
                // return; 
            }
            room.started = true;
            io.to(roomCode).emit('gameStarted', {
                players: arrayToObject(room.players), // Frontend formatına uygun çevir
                gameState: room.gameState,
                currentTurn: room.playerIds[0]
            });
            io.emit('refreshRooms'); // Oda artık listede görünmemeli
        }
    });

    // Oyun İçi Eventler (Zar, Hareket vs.) - Artık 'to(roomCode)' kullanıyoruz
    socket.on('rollDice', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        // Sıra kontrolü
        if (socket.id !== room.playerIds[room.currentPlayerIndex]) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;
        const player = room.players.find(p => p.id === socket.id);

        // Hareket
        let oldPos = player.position;
        player.position = (player.position + total) % 40;

        if (player.position < oldPos) player.money += 200;

        io.to(roomCode).emit('diceResult', { die1, die2, move: true, playerId: socket.id, newPosition: player.position, money: player.money, isDouble });

        if (!isDouble) {
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.playerIds.length;
            io.to(roomCode).emit('turnChange', room.playerIds[room.currentPlayerIndex]);
        }
    });
    
    // Mülk satın alma, kira vb. fonksiyonları da buraya roomCode parametresiyle eklenmeli...
    // Örnek: Satın Alma
    socket.on('buyProperty', (roomCode, index, price) => {
        const room = rooms[roomCode];
        if(!room) return;
        const player = room.players.find(p => p.id === socket.id);
        
        if (player.money >= price && !room.gameState.properties[index]) {
            player.money -= price;
            room.gameState.properties[index] = { owner: socket.id, level: 0 };
            io.to(roomCode).emit('propertyUpdate', { index, property: room.gameState.properties[index], money: player.money, ownerId: socket.id });
        }
    });

    socket.on('disconnect', () => {
        // Hangi odada olduğunu bul
        let targetRoomCode = null;
        Object.keys(rooms).forEach(code => {
            const room = rooms[code];
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                targetRoomCode = code;
                room.players.splice(pIndex, 1);
                room.playerIds = room.playerIds.filter(id => id !== socket.id);
                
                // Eğer oda boşaldıysa sil
                if (room.players.length === 0) {
                    delete rooms[code];
                } else {
                    // Host çıktıysa yeni host ata
                    if (pIndex === 0) {
                        io.to(code).emit('hostChanged', room.players[0].name);
                    }
                    io.to(code).emit('updateLobbyPlayers', room.players);
                }
            }
        });
        io.emit('refreshRooms');
    });
});

// Yardımcı Fonksiyonlar
function createPlayer(id, name, isHost) {
    return {
        id: id,
        name: name || `Oyuncu`,
        color: getRandomColor(),
        position: 0,
        money: 1500,
        isHost: isHost
    };
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getRandomColor() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function arrayToObject(arr) {
    const obj = {};
    arr.forEach(item => obj[item.id] = item);
    return obj;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda çalışıyor.`); });
