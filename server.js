const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // ID oluşturmak için basit yöntem

const io = require('socket.io')(http, {
    cors: {
        origin: function (origin, callback) {
            const allowedOrigins = [
                "https://doshu.gamer.gd", "http://doshu.gamer.gd",
                "http://localhost:3000", "http://127.0.0.1:5500"
            ];
            if (!origin || allowedOrigins.some(o => origin.startsWith(o))) callback(null, true);
            else callback(new Error('CORS not allowed'));
        },
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// --- ODA YÖNETİMİ ---
// rooms = { 'odaKodu': { players: [], gameState: {}, gameStarted: false, hostId: '...' } }
let rooms = {};
// socketRoomMap = { 'socketId': 'odaKodu' }
let socketRoomMap = {};

io.on('connection', (socket) => {
    console.log('Bağlantı:', socket.id);

    // 1. ODA LİSTESİNİ İSTE
    socket.on('getRooms', () => {
        socket.emit('roomList', getPublicRooms());
    });

    // 2. ODA OLUŞTUR
    socket.on('createRoom', (data) => {
        const { playerName, avatar } = data;
        const roomId = generateRoomId(); // 5 haneli kod
        
        rooms[roomId] = {
            id: roomId,
            players: [],
            gameState: { properties: {} },
            gameStarted: false,
            hostId: socket.id,
            currentPlayerIndex: 0
        };

        joinRoomLogic(socket, roomId, playerName, avatar);
    });

    // 3. ODAYA KATIL
    socket.on('joinRoom', (data) => {
        const { roomId, playerName, avatar } = data;
        
        if (!rooms[roomId]) {
            socket.emit('errorMsg', 'Böyle bir oda bulunamadı!');
            return;
        }
        if (rooms[roomId].players.length >= 6) {
            socket.emit('errorMsg', 'Oda dolu! (Max 6 kişi)');
            return;
        }
        if (rooms[roomId].gameStarted) {
            socket.emit('errorMsg', 'Oyun çoktan başladı!');
            return;
        }

        joinRoomLogic(socket, roomId, playerName, avatar);
    });

    // 4. OYUNU BAŞLAT
    socket.on('startGame', () => {
        const roomId = socketRoomMap[socket.id];
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        if (room.hostId !== socket.id) return; // Sadece host başlatabilir
        if (room.players.length < 2) { // TEST İÇİN 1 YAPABİLİRSİN, NORMALDE 2
            socket.emit('errorMsg', 'Oyunu başlatmak için en az 2 kişi gerekli!');
            return;
        }

        room.gameStarted = true;
        // Oyunculara sıralarını ata
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            gameState: room.gameState,
            currentTurn: room.players[0].id
        });
        
        // Lobi listesini güncelle (Oyun başladı diye)
        io.emit('roomList', getPublicRooms());
    });

    // --- OYUN İÇİ AKSİYONLAR ---
    
    socket.on('rollDice', () => {
        const roomId = socketRoomMap[socket.id];
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        // Sıra kontrolü
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (socket.id !== currentPlayer.id) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        let player = room.players.find(p => p.id === socket.id);
        
        // Hareket
        let oldPos = player.position;
        player.position = (player.position + total) % 40;

        // Başlangıçtan geçme
        if (player.position < oldPos) {
            player.money += 200;
        }

        io.to(roomId).emit('diceResult', { 
            die1, die2, move: true, playerId: socket.id, 
            newPosition: player.position, money: player.money, isDouble 
        });

        if (!isDouble) nextTurn(roomId);
    });

    socket.on('buyProperty', (index, price) => {
        const roomId = socketRoomMap[socket.id];
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);

        if (player && player.money >= price && !room.gameState.properties[index]) {
            player.money -= price;
            room.gameState.properties[index] = { owner: socket.id, level: 0 };
            io.to(roomId).emit('propertyUpdate', { 
                index, property: room.gameState.properties[index], 
                money: player.money, ownerId: socket.id 
            });
        }
    });

    socket.on('payRent', (amount, ownerId) => {
        const roomId = socketRoomMap[socket.id];
        if (!roomId) return;
        const room = rooms[roomId];
        
        const payer = room.players.find(p => p.id === socket.id);
        
        if (ownerId === 'bank') {
            if(payer) payer.money -= amount;
        } else {
            const owner = room.players.find(p => p.id === ownerId);
            if (payer && owner) {
                payer.money -= amount;
                owner.money += amount;
            }
        }
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('disconnect', () => {
        const roomId = socketRoomMap[socket.id];
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);
            
            if (room.players.length === 0) {
                delete rooms[roomId]; // Oda boşaldıysa sil
            } else {
                if (room.hostId === socket.id) {
                    room.hostId = room.players[0].id; // Yeni host ata
                }
                io.to(roomId).emit('updateRoomLobby', {
                    players: room.players,
                    hostId: room.hostId,
                    roomId: roomId
                });
            }
        }
        delete socketRoomMap[socket.id];
        io.emit('roomList', getPublicRooms());
    });
});

// YARDIMCI FONKSİYONLAR
function joinRoomLogic(socket, roomId, name, avatar) {
    const room = rooms[roomId];
    socket.join(roomId);
    socketRoomMap[socket.id] = roomId;

    const newPlayer = {
        id: socket.id,
        name: name || `Oyuncu ${room.players.length + 1}`,
        avatar: avatar || '🦊',
        color: getRandomColor(),
        position: 0,
        money: 1500,
        jail: false
    };

    room.players.push(newPlayer);

    // Odaya girene odayı göster
    socket.emit('roomJoined', { roomId, isHost: room.hostId === socket.id });

    // Odadaki herkese listeyi güncelle
    io.to(roomId).emit('updateRoomLobby', {
        players: room.players,
        hostId: room.hostId,
        roomId: roomId
    });

    // Genel lobiye yeni odayı duyur
    io.emit('roomList', getPublicRooms());
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    io.to(roomId).emit('turnChange', room.players[room.currentPlayerIndex].id);
}

function getPublicRooms() {
    // Sadece oyun başlamamış ve dolu olmayan odaları listele
    return Object.values(rooms)
        .filter(r => !r.gameStarted && r.players.length < 6)
        .map(r => ({
            id: r.id,
            count: r.players.length,
            host: r.players[0]?.name
        }));
}

function generateRoomId() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

function getRandomColor() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
    return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on ${PORT}`); });
