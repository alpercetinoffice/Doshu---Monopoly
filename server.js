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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// === GAME DATA ===
let rooms = {};
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

// Şans kartları
const CHANCE_CARDS = [
    { text: 'Bankadan 200₺ alın!', money: 200 },
    { text: 'Doğum gününüz! Her oyuncudan 50₺ alın!', type: 'birthday' },
    { text: 'Hızlı hareket ettiğiniz için 100₺ ceza!', money: -100 },
    { text: 'Başlangıca gidin ve 200₺ alın!', type: 'go' },
    { text: 'Vergi iadesi! 150₺ alın!', money: 150 },
    { text: 'Hapse gidin!', type: 'jail' },
    { text: 'Her eviniz için 50₺ bakım ücreti ödeyin!', type: 'maintenance' },
    { text: '3 adım geri gidin!', type: 'back3' }
];

const CHEST_CARDS = [
    { text: 'Banka hatası sizin lehinize! 200₺ alın!', money: 200 },
    { text: 'Doktor masrafları! 100₺ ödeyin!', money: -100 },
    { text: 'Yarışmayı kazandınız! 100₺ alın!', money: 100 },
    { text: 'Okuldan 50₺ alın!', money: 50 },
    { text: 'Tatil çeki! 100₺ alın!', money: 100 },
    { text: 'Hapse gidin!', type: 'jail' },
    { text: 'Miras kaldı! 100₺ alın!', money: 100 },
    { text: 'Sigortanız bitti! 50₺ ödeyin!', money: -50 }
];

const boardData = [
    { type: 'corner', name: 'BAŞLANGIÇ', id: 0 },
    { type: 'property', name: 'Kadıköy', price: 60, group: 'brown', housePrice: 50, rent: [2, 10, 30, 90, 160, 250], id: 1 },
    { type: 'chest', name: 'Kamu Fonu', id: 2 },
    { type: 'property', name: 'Moda', price: 60, group: 'brown', housePrice: 50, rent: [4, 20, 60, 180, 320, 450], id: 3 },
    { type: 'tax', name: 'Gelir Vergisi', price: 200, id: 4 },
    { type: 'railroad', name: 'Haydarpaşa', price: 200, rent: [25, 50, 100, 200], id: 5 },
    { type: 'property', name: 'Beşiktaş', price: 100, group: 'lightblue', housePrice: 50, rent: [6, 30, 90, 270, 400, 550], id: 6 },
    { type: 'chance', name: 'Şans', id: 7 },
    { type: 'property', name: 'Ortaköy', price: 100, group: 'lightblue', housePrice: 50, rent: [6, 30, 90, 270, 400, 550], id: 8 },
    { type: 'property', name: 'Bebek', price: 120, group: 'lightblue', housePrice: 50, rent: [8, 40, 100, 300, 450, 600], id: 9 },
    { type: 'corner', name: 'HAPİSHANE', id: 10 },
    { type: 'property', name: 'Şişli', price: 140, group: 'pink', housePrice: 100, rent: [10, 50, 150, 450, 625, 750], id: 11 },
    { type: 'utility', name: 'Elektrik', price: 150, id: 12 },
    { type: 'property', name: 'Mecidiyeköy', price: 140, group: 'pink', housePrice: 100, rent: [10, 50, 150, 450, 625, 750], id: 13 },
    { type: 'property', name: 'Gayrettepe', price: 160, group: 'pink', housePrice: 100, rent: [12, 60, 180, 500, 700, 900], id: 14 },
    { type: 'railroad', name: 'Sirkeci', price: 200, rent: [25, 50, 100, 200], id: 15 },
    { type: 'property', name: 'Fatih', price: 180, group: 'orange', housePrice: 100, rent: [14, 70, 200, 550, 750, 950], id: 16 },
    { type: 'chest', name: 'Kamu Fonu', id: 17 },
    { type: 'property', name: 'Aksaray', price: 180, group: 'orange', housePrice: 100, rent: [14, 70, 200, 550, 750, 950], id: 18 },
    { type: 'property', name: 'Eminönü', price: 200, group: 'orange', housePrice: 100, rent: [16, 80, 220, 600, 800, 1000], id: 19 },
    { type: 'corner', name: 'ÜCRETSİZ OTOPARK', id: 20 },
    { type: 'property', name: 'Taksim', price: 220, group: 'red', housePrice: 150, rent: [18, 90, 250, 700, 875, 1050], id: 21 },
    { type: 'chance', name: 'Şans', id: 22 },
    { type: 'property', name: 'İstiklal', price: 220, group: 'red', housePrice: 150, rent: [18, 90, 250, 700, 875, 1050], id: 23 },
    { type: 'property', name: 'Beyoğlu', price: 240, group: 'red', housePrice: 150, rent: [20, 100, 300, 750, 925, 1100], id: 24 },
    { type: 'railroad', name: 'Karaköy', price: 200, rent: [25, 50, 100, 200], id: 25 },
    { type: 'property', name: 'Sarıyer', price: 260, group: 'yellow', housePrice: 150, rent: [22, 110, 330, 800, 975, 1150], id: 26 },
    { type: 'property', name: 'Tarabya', price: 260, group: 'yellow', housePrice: 150, rent: [22, 110, 330, 800, 975, 1150], id: 27 },
    { type: 'utility', name: 'Su İdaresi', price: 150, id: 28 },
    { type: 'property', name: 'Yeniköy', price: 280, group: 'yellow', housePrice: 150, rent: [24, 120, 360, 850, 1025, 1200], id: 29 },
    { type: 'corner', name: 'KODESE GİT', id: 30 },
    { type: 'property', name: 'Etiler', price: 300, group: 'green', housePrice: 200, rent: [26, 130, 390, 900, 1100, 1275], id: 31 },
    { type: 'property', name: 'Levent', price: 300, group: 'green', housePrice: 200, rent: [26, 130, 390, 900, 1100, 1275], id: 32 },
    { type: 'chest', name: 'Kamu Fonu', id: 33 },
    { type: 'property', name: 'Maslak', price: 320, group: 'green', housePrice: 200, rent: [28, 150, 450, 1000, 1200, 1400], id: 34 },
    { type: 'railroad', name: 'Halkalı', price: 200, rent: [25, 50, 100, 200], id: 35 },
    { type: 'chance', name: 'Şans', id: 36 },
    { type: 'property', name: 'Nişantaşı', price: 350, group: 'darkblue', housePrice: 200, rent: [35, 175, 500, 1100, 1300, 1500], id: 37 },
    { type: 'tax', name: 'Lüks Vergisi', price: 100, id: 38 },
    { type: 'property', name: 'Maçka', price: 400, group: 'darkblue', housePrice: 200, rent: [50, 200, 600, 1400, 1700, 2000], id: 39 }
];

// === SOCKET HANDLERS ===
io.on('connection', (socket) => {
    console.log('✅ Yeni bağlantı:', socket.id);

    socket.on('createRoom', (data) => {
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
                currentTurn: 0,
                turnPlayerId: null
            }
        };

        joinRoomLogic(socket, roomId, data.nickname, data.avatar);
    });

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

    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data.nickname, data.avatar);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if(!room || room.hostId !== socket.id || room.players.length < 2) {
            return socket.emit('error', 'Oyun başlatılamıyor!');
        }

        room.players.forEach((p, i) => {
            p.position = 0;
            p.money = 1500;
            p.color = PLAYER_COLORS[i];
            p.properties = [];
            p.houses = {};
        });

        room.status = 'PLAYING';
        room.gameState.turnPlayerId = room.players[0].id;

        io.to(roomId).emit('gameStarted', {
            players: room.players,
            currentTurn: room.gameState.turnPlayerId
        });

        console.log(`🎮 Oyun başladı: ${roomId}`);
    });

    socket.on('rollDice', () => {
        const roomId = findPlayerRoom(socket.id);
        if(!roomId) return;

        const room = rooms[roomId];
        if(room.gameState.turnPlayerId !== socket.id) {
            return socket.emit('error', 'Sıra sende değil!');
        }

        const player = room.players.find(p => p.id === socket.id);
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;

        const oldPos = player.position;
        player.position = (player.position + total) % 40;

        if(player.position < oldPos) {
            player.money += 200;
        }

        io.to(roomId).emit('diceResult', {
            playerId: socket.id,
            die1, die2, total,
            newPosition: player.position,
            money: player.money
        });

        setTimeout(() => {
            handleTileAction(roomId, socket.id, player.position);
        }, 1000);

        if(die1 !== die2) {
            setTimeout(() => {
                changeTurn(roomId);
            }, 3000);
        }
    });

    socket.on('buyProperty', (data) => {
        const roomId = findPlayerRoom(socket.id);
        if(!roomId) return;

        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[data.position];

        if(player.money >= tile.price) {
            player.money -= tile.price;
            player.properties.push(data.position);
            room.gameState.properties[data.position] = socket.id;

            io.to(roomId).emit('propertyPurchased', {
                playerId: socket.id,
                position: data.position,
                money: player.money
            });

            console.log(`🏠 ${player.name} ${tile.name} satın aldı`);
        }
    });

    socket.on('disconnect', () => {
        const roomId = findPlayerRoom(socket.id);
        if(roomId) {
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);

            if(room.hostId === socket.id && room.players.length > 0) {
                room.hostId = room.players[0].id;
                room.players[0].isHost = true;
            }

            if(room.players.length === 0) {
                delete rooms[roomId];
            } else {
                io.to(roomId).emit('updateRoomPlayers', room.players);
            }
        }
    });
});

// === HELPER FUNCTIONS ===
function joinRoomLogic(socket, roomId, nickname, avatar) {
    if(!rooms[roomId]) {
        return socket.emit('error', 'Oda bulunamadı!');
    }

    if(rooms[roomId].players.length >= 6) {
        return socket.emit('error', 'Oda dolu!');
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
}

function findPlayerRoom(playerId) {
    return Object.keys(rooms).find(id =>
        rooms[id].players.find(p => p.id === playerId)
    );
}

function handleTileAction(roomId, playerId, position) {
    const room = rooms[roomId];
    const tile = boardData[position];
    const player = room.players.find(p => p.id === playerId);

    if(tile.type === 'property') {
        const owner = room.gameState.properties[position];
        
        if(!owner) {
            io.to(playerId).emit('propertyLanded', { position });
        } else if(owner !== playerId) {
            const ownerPlayer = room.players.find(p => p.id === owner);
            const rent = tile.rent[0];

            player.money -= rent;
            ownerPlayer.money += rent;

            io.to(roomId).emit('rentPaid', {
                payerId: playerId,
                receiverId: owner,
                amount: rent,
                payerMoney: player.money,
                receiverMoney: ownerPlayer.money
            });

            console.log(`💰 ${player.name} → ${ownerPlayer.name}: ${rent}₺ kira`);
        }
    } else if(tile.type === 'chance') {
        const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
        handleCard(roomId, playerId, card, 'chance');
    } else if(tile.type === 'chest') {
        const card = CHEST_CARDS[Math.floor(Math.random() * CHEST_CARDS.length)];
        handleCard(roomId, playerId, card, 'chest');
    } else if(tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('taxPaid', {
            playerId: playerId,
            amount: tile.price,
            money: player.money
        });
    }
}

function handleCard(roomId, playerId, card, type) {
    const room = rooms[roomId];
    const player = room.players.find(p => p.id === playerId);

    if(card.money) {
        player.money += card.money;
    } else if(card.type === 'jail') {
        player.position = 10;
    } else if(card.type === 'go') {
        player.position = 0;
        player.money += 200;
    } else if(card.type === 'birthday') {
        room.players.forEach(p => {
            if(p.id !== playerId) {
                p.money -= 50;
                player.money += 50;
            }
        });
    }

    io.to(roomId).emit('cardDrawn', {
        playerId: playerId,
        type: type,
        text: card.text
    });
}

function changeTurn(roomId) {
    const room = rooms[roomId];
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.turnPlayerId);
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.gameState.turnPlayerId = room.players[nextIndex].id;

    io.to(roomId).emit('turnChange', room.gameState.turnPlayerId);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🎮 MONOPOLY GOLD EDITION 🎮         ║
╠═══════════════════════════════════════╣
║   Port: ${PORT}                        ║
║   Status: ✅ ONLINE                    ║
║   Features: ✨ Premium                ║
╚═══════════════════════════════════════╝
    `);
});
