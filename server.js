const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const cors = require('cors');

const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// === OYUN VERİLERİ (Board Data Sunucuda Tutulur) ===
const BOARD_DATA = [
    { type: 'corner', name: 'BAŞLANGIÇ', id: 0 },
    { type: 'property', name: 'Kadiköy', price: 60, group: 'brown', rent: [2, 10, 30, 90, 160, 250], id: 1 },
    { type: 'chest', name: 'Kamu Fonu', id: 2 },
    { type: 'property', name: 'Moda', price: 60, group: 'brown', rent: [4, 20, 60, 180, 320, 450], id: 3 },
    { type: 'tax', name: 'Gelir Vergisi', price: 200, id: 4 },
    { type: 'railroad', name: 'Haydarpaşa', price: 200, rent: [25, 50, 100, 200], id: 5 },
    { type: 'property', name: 'Beşiktaş', price: 100, group: 'lightblue', rent: [6, 30, 90, 270, 400, 550], id: 6 },
    { type: 'chance', name: 'Şans', id: 7 },
    { type: 'property', name: 'Ortaköy', price: 100, group: 'lightblue', rent: [6, 30, 90, 270, 400, 550], id: 8 },
    { type: 'property', name: 'Bebek', price: 120, group: 'lightblue', rent: [8, 40, 100, 300, 450, 600], id: 9 },
    { type: 'corner', name: 'ZİYARETÇİ', id: 10 }, // Hapishane (Sadece ziyaret)
    { type: 'property', name: 'Şişli', price: 140, group: 'pink', rent: [10, 50, 150, 450, 625, 750], id: 11 },
    { type: 'utility', name: 'Elektrik', price: 150, id: 12 },
    { type: 'property', name: 'Mecidiyeköy', price: 140, group: 'pink', rent: [10, 50, 150, 450, 625, 750], id: 13 },
    { type: 'property', name: 'Gayrettepe', price: 160, group: 'pink', rent: [12, 60, 180, 500, 700, 900], id: 14 },
    { type: 'railroad', name: 'Sirkeci', price: 200, rent: [25, 50, 100, 200], id: 15 },
    { type: 'property', name: 'Fatih', price: 180, group: 'orange', rent: [14, 70, 200, 550, 750, 950], id: 16 },
    { type: 'chest', name: 'Kamu Fonu', id: 17 },
    { type: 'property', name: 'Aksaray', price: 180, group: 'orange', rent: [14, 70, 200, 550, 750, 950], id: 18 },
    { type: 'property', name: 'Eminönü', price: 200, group: 'orange', rent: [16, 80, 220, 600, 800, 1000], id: 19 },
    { type: 'corner', name: 'OTOPARK', id: 20 },
    { type: 'property', name: 'Taksim', price: 220, group: 'red', rent: [18, 90, 250, 700, 875, 1050], id: 21 },
    { type: 'chance', name: 'Şans', id: 22 },
    { type: 'property', name: 'İstiklal', price: 220, group: 'red', rent: [18, 90, 250, 700, 875, 1050], id: 23 },
    { type: 'property', name: 'Beyoğlu', price: 240, group: 'red', rent: [20, 100, 300, 750, 925, 1100], id: 24 },
    { type: 'railroad', name: 'Karaköy', price: 200, rent: [25, 50, 100, 200], id: 25 },
    { type: 'property', name: 'Sarıyer', price: 260, group: 'yellow', rent: [22, 110, 330, 800, 975, 1150], id: 26 },
    { type: 'property', name: 'Tarabya', price: 260, group: 'yellow', rent: [22, 110, 330, 800, 975, 1150], id: 27 },
    { type: 'utility', name: 'Su İdaresi', price: 150, id: 28 },
    { type: 'property', name: 'Yeniköy', price: 280, group: 'yellow', rent: [24, 120, 360, 850, 1025, 1200], id: 29 },
    { type: 'corner', name: 'KODESE GİT', id: 30 },
    { type: 'property', name: 'Etiler', price: 300, group: 'green', rent: [26, 130, 390, 900, 1100, 1275], id: 31 },
    { type: 'property', name: 'Levent', price: 300, group: 'green', rent: [26, 130, 390, 900, 1100, 1275], id: 32 },
    { type: 'chest', name: 'Kamu Fonu', id: 33 },
    { type: 'property', name: 'Maslak', price: 320, group: 'green', rent: [28, 150, 450, 1000, 1200, 1400], id: 34 },
    { type: 'railroad', name: 'Halkalı', price: 200, rent: [25, 50, 100, 200], id: 35 },
    { type: 'chance', name: 'Şans', id: 36 },
    { type: 'property', name: 'Nişantaşı', price: 350, group: 'darkblue', rent: [35, 175, 500, 1100, 1300, 1500], id: 37 },
    { type: 'tax', name: 'Lüks Vergisi', price: 100, id: 38 },
    { type: 'property', name: 'Maçka', price: 400, group: 'darkblue', rent: [50, 200, 600, 1400, 1700, 2000], id: 39 }
];

let rooms = {};
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const TURN_TIMEOUT = 30000; // 30 saniye AFK süresi

io.on('connection', (socket) => {
    console.log('🔗 Yeni Bağlantı:', socket.id);

    // Board Verisini İstemciye Gönder
    socket.emit('initBoard', BOARD_DATA);

    socket.on('createRoom', (data) => {
        let roomId;
        do {
            roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        } while (rooms[roomId]);

        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname} Masası`,
            hostId: socket.id,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, houses: {}, turnIndex: 0, lastDice: [0,0] },
            timers: {}
        };
        joinRoomLogic(socket, roomId, data.nickname, data.character);
    });

    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length, status: rooms[id].status
        }));
        socket.emit('roomList', list);
    });

    socket.on('joinRoom', (data) => joinRoomLogic(socket, data.roomId, data.nickname, data.character));

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.hostId === socket.id && room.players.length >= 2) {
            room.status = 'PLAYING';
            io.to(roomId).emit('gameStarted', {
                players: room.players,
                gameState: room.gameState,
                currentTurn: room.players[0].id
            });
            startTurnTimer(roomId);
        }
    });

    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        
        // Sıra kontrolü
        const currentPlayer = room.players[room.gameState.turnIndex];
        if(currentPlayer.id !== socket.id) return;

        clearTimeout(room.timers.turn); // Timer'ı durdur

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        io.to(roomId).emit('diceRolled', { die1, die2, playerId: socket.id });

        // Animasyon süresi kadar bekle sonra mantığı işlet
        setTimeout(() => {
            handleMoveLogic(room, currentPlayer, total, isDouble, die1, die2);
        }, 1500);
    });

    socket.on('buyProperty', () => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = BOARD_DATA[player.position];

        if(player.money >= tile.price && !room.gameState.properties[player.position]) {
            player.money -= tile.price;
            room.gameState.properties[player.position] = { owner: socket.id, level: 0 };
            player.properties.push(player.position);
            
            io.to(roomId).emit('propertyBought', { 
                playerId: socket.id, 
                position: player.position, 
                money: player.money,
                color: player.color
            });
        }
    });

    socket.on('endTurn', () => {
         const roomId = getPlayerRoom(socket.id);
         if(roomId) nextTurn(rooms[roomId]);
    });

    socket.on('disconnect', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId) {
            const room = rooms[roomId];
            const player = room.players.find(p => p.id === socket.id);
            player.online = false;
            
            // 60 sn bekle, gelmezse sil
            setTimeout(() => {
                if(!player.online && rooms[roomId]) {
                    room.players = room.players.filter(p => p.id !== player.id);
                    io.to(roomId).emit('playerLeft', player.id);
                    if(room.players.length === 0) delete rooms[roomId];
                    else if(room.status === 'PLAYING' && room.players.length < 2) {
                        io.to(roomId).emit('gameOver', { winner: room.players[0] });
                    }
                }
            }, 60000);
        }
    });
});

function handleMoveLogic(room, player, steps, isDouble, d1, d2) {
    // Hapishane Mantığı
    if (player.jail) {
        if (isDouble) {
            player.jail = false;
            player.jailTurns = 0;
            io.to(room.id).emit('notification', { msg: `${player.name} çift attı ve çıktı!` });
        } else {
            player.jailTurns++;
            if (player.jailTurns >= 3) {
                player.money -= 50;
                player.jail = false;
                player.jailTurns = 0;
                io.to(room.id).emit('notification', { msg: `${player.name} cezasını ödedi ve çıktı.` });
            } else {
                io.to(room.id).emit('turnResult', { canBuy: false });
                nextTurn(room);
                return;
            }
        }
    }

    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    
    // Başlangıçtan geçme
    if(player.position < oldPos) {
        player.money += 200;
        io.to(room.id).emit('notification', { msg: `${player.name} Başlangıçtan geçti (+200₺)` });
    }

    // Kodese Git Karesi
    if (player.position === 30) {
        player.position = 10;
        player.jail = true;
        player.jailTurns = 0;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10, direct: true });
        io.to(room.id).emit('notification', { msg: `${player.name} KODESE GİRDİ!` });
        nextTurn(room);
        return;
    }

    // Normal Hareket
    io.to(room.id).emit('playerMoved', { playerId: player.id, position: player.position, direct: false });

    // Kare Aksiyonu
    setTimeout(() => {
        const tile = BOARD_DATA[player.position];
        let canBuy = false;

        if (tile.type === 'property' || tile.type === 'railroad' || tile.type === 'utility') {
            const prop = room.gameState.properties[player.position];
            if (!prop) {
                if (player.money >= tile.price) canBuy = true;
            } else if (prop.owner !== player.id) {
                // Kira Ödeme
                let rent = tile.rent ? tile.rent[prop.level] : 20; // Basit kira
                player.money -= rent;
                const owner = room.players.find(p => p.id === prop.owner);
                if (owner) owner.money += rent;
                io.to(room.id).emit('rentPaid', { payer: player.id, receiver: owner.id, amount: rent });
            }
        } else if (['tax'].includes(tile.type)) {
            player.money -= tile.price;
            io.to(room.id).emit('notification', { msg: `${player.name} vergi ödedi: ${tile.price}₺` });
        }

        // İflas Kontrolü
        if(player.money < 0) {
             io.to(room.id).emit('playerBankrupt', { playerId: player.id });
             // Oyuncuyu oyundan çıkar... (Basitleştirildi)
        }

        if (isDouble && !player.jail) {
             io.to(room.id).emit('notification', { msg: `${player.name} çift attı, tekrar oynuyor!` });
             io.to(room.id).emit('turnResult', { canBuy, isDouble: true });
             startTurnTimer(room.id); // Tekrar süre ver
        } else {
             io.to(room.id).emit('turnResult', { canBuy, isDouble: false });
             if(!canBuy) nextTurn(room); // Satın alamazsa sırayı geçir
        }

        io.to(room.id).emit('updateStats', room.players); // Paraları güncelle
    }, 1000); // Piyon animasyonu bitince
}

function nextTurn(room) {
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.players.length;
    const nextPlayer = room.players[room.gameState.turnIndex];
    io.to(room.id).emit('turnChange', nextPlayer.id);
    startTurnTimer(room.id);
}

function startTurnTimer(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    clearTimeout(room.timers.turn);
    room.timers.turn = setTimeout(() => {
        // AFK BOT: Otomatik zar at
        io.to(roomId).emit('notification', { msg: "Süre doldu, otomatik oynanıyor..." });
        // Zar atma mantığını tetikle... (Basitlik için direkt sırayı geçiriyoruz)
        nextTurn(room);
    }, TURN_TIMEOUT);
}

function joinRoomLogic(socket, roomId, nickname, character) {
    if (!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].players.push({
        id: socket.id,
        name: nickname,
        avatar: character.emoji,
        money: 1500,
        position: 0,
        color: PLAYER_COLORS[rooms[roomId].players.length % PLAYER_COLORS.length],
        properties: [],
        jail: false,
        online: true
    });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
    socket.emit('roomJoined', { roomId, isHost: rooms[roomId].hostId === socket.id });
}

function getPlayerRoom(id) {
    return Object.keys(rooms).find(rid => rooms[rid].players.find(p => p.id === id));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
