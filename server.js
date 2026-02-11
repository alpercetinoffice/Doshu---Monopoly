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
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const boardData = require('./public/board_data.js'); // Dosyanın var olduğundan emin ol

io.on('connection', (socket) => {
    console.log('✅ Yeni Bağlantı:', socket.id);

    // ODA OLUŞTURMA
    socket.on('createRoom', (data) => {
        let roomId;
        do { roomId = Math.random().toString(36).substring(2, 7).toUpperCase(); } 
        while (rooms[roomId]); // Benzersiz kod garantisi

        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            hostName: data.nickname,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, turnIndex: 0, turnPlayerId: null }
        };

        joinRoomLogic(socket, roomId, data);
    });

    // ODA LİSTESİ
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length,
            status: rooms[id].status, host: rooms[id].hostName
        }));
        socket.emit('roomList', list);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', (data) => joinRoomLogic(socket, data.roomId, data));

    // OYUNU BAŞLAT
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id || room.players.length < 2) return;

        room.status = 'PLAYING';
        room.players.forEach((p, i) => {
            p.money = 1500;
            p.position = 0;
            p.color = PLAYER_COLORS[i % PLAYER_COLORS.length];
            p.properties = [];
            p.inJail = false;
            p.isBankrupt = false;
        });

        room.gameState.turnPlayerId = room.players[0].id;
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            currentTurn: room.gameState.turnPlayerId
        });
    });

    // ZAR ATMA
    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        
        if (room.gameState.turnPlayerId !== socket.id) return;

        const player = room.players.find(p => p.id === socket.id);
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        // HAPİSHANE MANTIĞI
        if (player.inJail) {
            if (isDouble) {
                player.inJail = false;
                io.to(roomId).emit('notification', { msg: `${player.name} çift attı ve hapisten çıktı!`, type: 'success' });
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.inJail = false;
                    io.to(roomId).emit('notification', { msg: `${player.name} 50₺ ödedi ve çıktı.`, type: 'info' });
                } else {
                    io.to(roomId).emit('diceResult', { playerId: socket.id, die1, die2, move: false });
                    setTimeout(() => nextTurn(roomId), 2000);
                    return;
                }
            }
        }

        // HAREKET
        const oldPos = player.position;
        player.position = (player.position + total) % 40;
        
        // Başlangıçtan geçiş
        if (player.position < oldPos) {
            player.money += 200;
            io.to(roomId).emit('notification', { msg: `${player.name} başlangıçtan geçti +200₺`, type: 'money' });
        }

        // Kodes'e Git Karesi (30. Kare)
        if (player.position === 30) {
            player.position = 10;
            player.inJail = true;
            player.jailTurns = 0;
            io.to(roomId).emit('diceResult', { playerId: socket.id, die1, die2, newPosition: 10, money: player.money, move: true });
            io.to(roomId).emit('notification', { msg: `${player.name} kodese girdi!`, type: 'bad' });
            setTimeout(() => nextTurn(roomId), 2500);
            return;
        }

        io.to(roomId).emit('diceResult', { 
            playerId: socket.id, die1, die2, newPosition: player.position, money: player.money, move: true 
        });

        // KARE AKSİYONU (Satın alma / Kira)
        setTimeout(() => {
            handleTileAction(roomId, player, player.position);
            if (!isDouble) setTimeout(() => nextTurn(roomId), 2000);
        }, 1500); // Piyonun gitmesini bekle
    });

    // MÜLK SATIN ALMA
    socket.on('buyProperty', (data) => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[data.position];

        if (player.money >= tile.price) {
            player.money -= tile.price;
            player.properties.push(data.position);
            room.gameState.properties[data.position] = socket.id;
            io.to(roomId).emit('propertyPurchased', { playerId: socket.id, position: data.position, money: player.money });
        }
    });

    socket.on('disconnect', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId) {
            const room = rooms[roomId];
            // Oyuncu oyundaysa silme, "connected: false" yap (Reconnect için - İleri seviye)
            // Şimdilik basitçe siliyoruz ama host değişimi yapıyoruz.
            room.players = room.players.filter(p => p.id !== socket.id);
            if(room.players.length === 0) delete rooms[roomId];
            else {
                if(room.hostId === socket.id) {
                    room.hostId = room.players[0].id;
                    room.players[0].isHost = true;
                }
                io.to(roomId).emit('updateRoomPlayers', room.players);
                checkWinCondition(roomId);
            }
        }
    });
});

function handleTileAction(roomId, player, pos) {
    const room = rooms[roomId];
    const tile = boardData[pos];
    const ownerId = room.gameState.properties[pos];

    if (tile.type === 'property' || tile.type === 'railroad' || tile.type === 'utility') {
        if (!ownerId) {
            // Sahibi yok, satın alabilir
            io.to(player.id).emit('offerProperty', { position: pos });
        } else if (ownerId !== player.id) {
            // Kira öde
            const owner = room.players.find(p => p.id === ownerId);
            const rent = tile.rent ? tile.rent[0] : 20; // Basit kira
            
            player.money -= rent;
            owner.money += rent;
            
            io.to(roomId).emit('rentPaid', { 
                payer: player.id, receiver: owner.id, amount: rent, 
                payerMoney: player.money, receiverMoney: owner.money 
            });
            
            checkBankruptcy(roomId, player);
        }
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('notification', { msg: `${player.name} ${tile.price}₺ vergi ödedi.`, type: 'bad' });
        io.to(roomId).emit('updateMoney', { playerId: player.id, money: player.money });
        checkBankruptcy(roomId, player);
    }
}

function checkBankruptcy(roomId, player) {
    if (player.money < 0) {
        player.isBankrupt = true;
        io.to(roomId).emit('playerBankrupt', { playerId: player.id, name: player.name });
        // Mülkleri serbest bırak vs. (İleri seviye)
        checkWinCondition(roomId);
    }
}

function checkWinCondition(roomId) {
    const room = rooms[roomId];
    if (room.status !== 'PLAYING') return;
    
    const activePlayers = room.players.filter(p => !p.isBankrupt);
    if (activePlayers.length === 1) {
        io.to(roomId).emit('gameOver', { winner: activePlayers[0] });
        room.status = 'FINISHED';
    }
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    let idx = room.players.findIndex(p => p.id === room.gameState.turnPlayerId);
    let nextIdx = (idx + 1) % room.players.length;
    
    // İflas edenleri atla
    while (room.players[nextIdx].isBankrupt) {
        nextIdx = (nextIdx + 1) % room.players.length;
    }
    
    room.gameState.turnPlayerId = room.players[nextIdx].id;
    io.to(roomId).emit('turnChange', room.gameState.turnPlayerId);
}

function joinRoomLogic(socket, roomId, data) {
    if (!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].players.push({
        id: socket.id,
        name: data.nickname,
        character: data.character, // Avatar URL veya ID
        isHost: rooms[roomId].hostId === socket.id
    });
    socket.emit('roomJoined', { roomId });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function getPlayerRoom(id) {
    return Object.keys(rooms).find(rid => rooms[rid].players.find(p => p.id === id));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));
