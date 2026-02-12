const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const boardData = require('./public/board_data'); // Veriyi import et

// Render ve diğer domainlerden gelen isteklere izin ver (CORS)
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Güvenlik için * yaptık, her yerden erişilebilir
        methods: ["GET", "POST"]
    }
});

// Statik dosyaları (HTML, CSS, JS) sun
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === OYUN SİSTEMİ ===
let rooms = {};

const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 1500,
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false,
    jailTurns: 0
});

const getNextTurn = (room) => {
    const currentIdx = room.players.findIndex(p => p.id === room.turn);
    const nextIdx = (currentIdx + 1) % room.players.length;
    return room.players[nextIdx].id;
};

io.on('connection', (socket) => {
    console.log('🔗 Yeni bağlantı:', socket.id);

    // ODA OLUŞTURMA
    socket.on('createRoom', ({ name, avatar }) => {
        const roomId = Math.random().toString(36).substr(2, 5).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: [createPlayer(socket.id, name, avatar)],
            status: 'LOBBY',
            turn: null,
            boardState: {}, // Mülk sahipliği
            logs: []
        };
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('updateLobby', rooms[roomId]);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', ({ roomId, name, avatar }) => {
        const room = rooms[roomId];
        if (room && room.status === 'LOBBY' && room.players.length < 4) {
            room.players.push(createPlayer(socket.id, name, avatar));
            socket.join(roomId);
            io.to(roomId).emit('updateLobby', room);
        } else {
            socket.emit('error', 'Oda bulunamadı, dolu veya oyun başlamış.');
        }
    });

    // OYUNU BAŞLATMA
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[0].id === socket.id) {
            room.status = 'PLAYING';
            room.turn = room.players[0].id;
            io.to(roomId).emit('gameStarted', room);
            io.to(roomId).emit('log', 'Oyun Başladı! Bol şans.');
        }
    });

    // ZAR ATMA VE HAREKET
    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const player = room.players.find(p => p.id === socket.id);

        io.to(roomId).emit('diceRolled', { die1, die2, playerId: socket.id });

        // Hapis Kontrolü
        if (player.inJail) {
            if (die1 === die2) {
                player.inJail = false;
                player.jailTurns = 0;
                movePlayer(roomId, player, total);
                io.to(roomId).emit('log', `${player.name} çift atarak hapisten çıktı!`);
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.inJail = false;
                    movePlayer(roomId, player, total);
                    io.to(roomId).emit('log', `${player.name} cezasını ödeyip hapisten çıktı.`);
                } else {
                    io.to(roomId).emit('log', `${player.name} hapiste kaldı.`);
                    endTurn(roomId);
                }
            }
        } else {
            movePlayer(roomId, player, total);
            // Çift atarsa tekrar oynama hakkı (basitleştirildi)
            if (die1 !== die2) {
                setTimeout(() => endTurn(roomId), 1500); // Otomatik tur geçişi (beklemeli)
            } else {
                io.to(roomId).emit('log', `${player.name} çift attı, tekrar oynuyor!`);
                io.to(roomId).emit('allowReRoll'); // İstemciye tekrar zar atma izni ver
            }
        }
    });

    // SATIN ALMA
    socket.on('buyProperty', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;
        
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[player.position];
        
        if (tile.price && player.money >= tile.price && !room.boardState[player.position]) {
            player.money -= tile.price;
            player.properties.push(player.position);
            room.boardState[player.position] = player.id;
            
            io.to(roomId).emit('propertyBought', { playerId: player.id, tileIndex: player.position, money: player.money });
            io.to(roomId).emit('log', `${player.name}, ${tile.name} mülkünü satın aldı.`);
            endTurn(roomId);
        }
    });

    // PAS GEÇME
    socket.on('endTurn', (roomId) => {
        endTurn(roomId);
    });

    socket.on('disconnect', () => {
        // Oda temizliği eklenebilir
    });
});

function movePlayer(roomId, player, steps) {
    const room = rooms[roomId];
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;

    // Başlangıçtan geçiş
    if (player.position < oldPos) {
        player.money += 200;
        io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(roomId).emit('log', `${player.name} Başlangıçtan geçti, 200₺ aldı.`);
    }

    // Hapse Girme
    if (player.position === 30) {
        player.position = 10;
        player.inJail = true;
        io.to(roomId).emit('log', `${player.name} Hapse girdi!`);
        io.to(roomId).emit('playerMoved', { playerId: player.id, position: 10 });
        endTurn(roomId);
        return;
    }

    io.to(roomId).emit('playerMoved', { playerId: player.id, position: player.position });
    checkTile(roomId, player);
}

function checkTile(roomId, player) {
    const room = rooms[roomId];
    const tile = boardData[player.position];

    // Mülk Kontrolü
    if (['property', 'station', 'utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            // Kira Öde
            const owner = room.players.find(p => p.id === ownerId);
            const rent = tile.rent || 10; 
            player.money -= rent;
            owner.money += rent;
            io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
            io.to(roomId).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
            io.to(roomId).emit('log', `${player.name}, ${owner.name}'e ${rent}₺ kira ödedi.`);
        } else if (!ownerId) {
            // Satın Alma Teklifi
            io.to(player.id).emit('offerBuy', tile);
        }
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(roomId).emit('log', `${player.name} ${tile.price}₺ vergi ödedi.`);
    } else if (tile.type === 'chance' || tile.type === 'chest') {
        const luck = Math.random() > 0.5 ? 50 : -50;
        player.money += luck;
        io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(roomId).emit('log', luck > 0 ? `${player.name} 50₺ buldu!` : `${player.name} 50₺ kaybetti.`);
    }
}

function endTurn(roomId) {
    const room = rooms[roomId];
    if(room) {
        room.turn = getNextTurn(room);
        io.to(roomId).emit('turnChanged', room.turn);
    }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
