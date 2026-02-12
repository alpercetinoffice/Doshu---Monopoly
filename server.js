const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // TÜM SİTELERDEN GELEN BAĞLANTILARI KABUL ET (ÖNEMLİ)
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const boardData = require('./public/board_data');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === OYUN SİSTEMİ ===
let rooms = {};

// Oda listesini formatla
const getRoomList = () => {
    return Object.values(rooms).map(r => ({
        id: r.id,
        name: r.players[0] ? r.players[0].name + "'in Odası" : "Boş Oda",
        count: r.players.length,
        status: r.status
    }));
};

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
    if(!room.players.length) return null;
    const currentIdx = room.players.findIndex(p => p.id === room.turn);
    const nextIdx = (currentIdx + 1) % room.players.length;
    return room.players[nextIdx].id;
};

io.on('connection', (socket) => {
    console.log('🔗 Yeni Bağlantı:', socket.id);

    // Bağlanır bağlanmaz oda listesini gönder
    socket.emit('roomList', getRoomList());

    socket.on('getRooms', () => {
        socket.emit('roomList', getRoomList());
    });

    socket.on('createRoom', ({ nickname, avatar }) => {
        const roomId = Math.random().toString(36).substr(2, 5).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: [createPlayer(socket.id, nickname, avatar)],
            status: 'LOBBY',
            turn: null,
            boardState: {}, 
            logs: []
        };
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, isHost: true });
        // Tüm herkese güncel listeyi at
        io.emit('roomList', getRoomList());
    });

    socket.on('joinRoom', ({ roomId, nickname, avatar }) => {
        const room = rooms[roomId];
        if (room && room.status === 'LOBBY' && room.players.length < 4) {
            room.players.push(createPlayer(socket.id, nickname, avatar));
            socket.join(roomId);
            socket.emit('roomJoined', { roomId, isHost: false });
            io.to(roomId).emit('updateLobby', room);
            io.emit('roomList', getRoomList());
        } else {
            socket.emit('error', 'Oda bulunamadı veya dolu.');
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[0].id === socket.id) {
            room.status = 'PLAYING';
            room.turn = room.players[0].id;
            io.to(roomId).emit('gameStarted', room);
            io.emit('roomList', getRoomList());
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
            if (die1 !== die2) {
                setTimeout(() => endTurn(roomId), 1500);
            } else {
                io.to(roomId).emit('log', `${player.name} çift attı, tekrar oynuyor!`);
                io.to(roomId).emit('allowReRoll');
            }
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
            endTurn(roomId);
        }
    });

    socket.on('endTurn', (roomId) => { endTurn(roomId); });
    
    socket.on('disconnect', () => {
        // Kopan oyuncuları temizleme mantığı eklenebilir
        console.log('Kullanıcı ayrıldı:', socket.id);
    });
});

function movePlayer(roomId, player, steps) {
    const room = rooms[roomId];
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;

    if (player.position < oldPos) {
        player.money += 200;
        io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(roomId).emit('log', `${player.name} Başlangıçtan geçti, 200₺ aldı.`);
    }

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

    if (['property', 'station', 'utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            const owner = room.players.find(p => p.id === ownerId);
            const rent = tile.rent || 10; 
            player.money -= rent;
            owner.money += rent;
            io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
            io.to(roomId).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
            io.to(roomId).emit('log', `${player.name}, ${owner.name}'e ${rent}₺ kira ödedi.`);
        } else if (!ownerId) {
            io.to(player.id).emit('offerBuy', tile);
        }
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(roomId).emit('log', `${player.name} ${tile.price}₺ vergi ödedi.`);
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
