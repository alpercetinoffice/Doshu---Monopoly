const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const boardData = require('./board_data');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let rooms = {};

// Oyun Durumu Yardımcıları
const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 1500,
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false,
    jailTurns: 0,
    isEliminated: false
});

const getNextPlayerId = (room) => {
    let currentIdx = room.players.findIndex(p => p.id === room.turn);
    let nextIdx = (currentIdx + 1) % room.players.length;
    // Elenen oyuncuları atla
    while(room.players[nextIdx].isEliminated) {
        nextIdx = (nextIdx + 1) % room.players.length;
    }
    return room.players[nextIdx].id;
};

io.on('connection', (socket) => {
    console.log('Kullanıcı bağlandı:', socket.id);

    socket.on('createRoom', ({ name, avatar }) => {
        const roomId = Math.random().toString(36).substr(2, 5).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: [createPlayer(socket.id, name, avatar)],
            status: 'LOBBY',
            turn: null,
            boardState: {}, // Mülk sahipliği: { index: ownerId }
            logs: []
        };
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('updateLobby', rooms[roomId]);
    });

    socket.on('joinRoom', ({ roomId, name, avatar }) => {
        const room = rooms[roomId];
        if (room && room.status === 'LOBBY' && room.players.length < 4) {
            room.players.push(createPlayer(socket.id, name, avatar));
            socket.join(roomId);
            io.to(roomId).emit('updateLobby', room);
        } else {
            socket.emit('error', 'Oda dolu veya oyun başlamış.');
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[0].id === socket.id) {
            room.status = 'PLAYING';
            room.turn = room.players[0].id;
            io.to(roomId).emit('gameStarted', room);
        }
    });

    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const player = room.players.find(p => p.id === socket.id);

        io.to(roomId).emit('diceRolled', { die1, die2, playerId: socket.id });

        // Hapis Mantığı
        if (player.inJail) {
            if (die1 === die2) {
                player.inJail = false;
                player.jailTurns = 0;
                movePlayer(roomId, player, total);
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.inJail = false;
                    movePlayer(roomId, player, total);
                } else {
                    io.to(roomId).emit('log', `${player.name} hapiste kaldı.`);
                    endTurn(roomId, false); // Çift atsa bile hapiste olduğu için tekrar atamaz
                }
            }
        } else {
            // Çift atarsa tekrar oynar
            const isDoubles = die1 === die2;
            movePlayer(roomId, player, total, isDoubles);
        }
    });

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
        }
        endTurn(roomId, false); // Satın alınca tur biter
    });

    socket.on('endTurn', (roomId) => {
        endTurn(roomId, false);
    });
});

function movePlayer(roomId, player, steps, isDoubles = false) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;

    // Başlangıçtan geçiş
    if (player.position < oldPos) {
        player.money += 200;
        io.to(roomId).emit('log', `${player.name} Başlangıçtan geçti, 200₺ aldı.`);
    }

    // Hapse Gir
    if (player.position === 30) {
        player.position = 10;
        player.inJail = true;
        isDoubles = false; // Hapse giren tekrar atamaz
        io.to(roomId).emit('log', `${player.name} Hapse girdi!`);
    }

    io.to(roomId).emit('playerMoved', { playerId: player.id, position: player.position, money: player.money });
    
    // Olayı işle (Kira, Vergi vb.)
    handleTileEvent(roomId, player, isDoubles);
}

function handleTileEvent(roomId, player, isDoubles) {
    const tile = boardData[player.position];
    const room = rooms[roomId];
    let canEndTurn = true;

    // 1. Mülk Sahibi Var mı?
    if (['property', 'station', 'utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            // Kira Öde
            const owner = room.players.find(p => p.id === ownerId);
            let rent = tile.rent || 0;
            // İstasyonda sahip olunan sayıya göre kira artar (basitleştirilmiş)
            if(tile.group === 'station') {
                 const stationCount = owner.properties.filter(idx => boardData[idx].group === 'station').length;
                 rent = 25 * Math.pow(2, stationCount - 1);
            }
            
            player.money -= rent;
            owner.money += rent;
            io.to(roomId).emit('rentPaid', { payerId: player.id, receiverId: owner.id, amount: rent });
            io.to(roomId).emit('log', `${player.name}, ${owner.name}'e ${rent}₺ kira ödedi.`);
        } else if (!ownerId) {
            // Satın Alma Seçeneği Sun
            io.to(player.id).emit('offerBuy', tile);
            canEndTurn = false; // Oyuncu karar verene kadar tur bitmez (otomatik değilse)
        }
    }
    
    // 2. Vergi
    if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(roomId).emit('log', `${player.name} vergi ödedi: ${tile.price}₺`);
    }

    // 3. Şans / Kamu Fonu (Basit Rastgele Para)
    if (['chance', 'chest'].includes(tile.type)) {
        const amount = (Math.random() > 0.5 ? 50 : -50);
        player.money += amount;
        io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(roomId).emit('cardEffect', { text: amount > 0 ? "Banka hatası lehinize!" : "Doktor masrafı!", amount });
    }

    if (canEndTurn && !isDoubles) {
        setTimeout(() => endTurn(roomId, false), 1500); // Otomatik tur geçişi
    } else if (isDoubles) {
        io.to(roomId).emit('log', `${player.name} çift attı, tekrar oynuyor!`);
        // İstemciye tekrar atma yetkisi ver
        io.to(roomId).emit('allowReRoll', player.id);
    }
}

function endTurn(roomId, isDoubles) {
    if (isDoubles) return; // Çift atıldıysa tur değişmez
    const room = rooms[roomId];
    if(!room) return;
    
    room.turn = getNextPlayerId(room);
    io.to(roomId).emit('turnChanged', room.turn);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
