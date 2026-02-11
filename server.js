const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// === OYUN VERİLERİ (BOARD DATA) ===
const BOARD = [
    { type: 'corner', name: 'BAŞLANGIÇ', price: 0 },
    { type: 'property', name: 'Kadiköy', price: 60, group: 'brown', rent: [2, 10, 30, 90, 160, 250] },
    { type: 'chest', name: 'Kamu Fonu', price: 0 },
    { type: 'property', name: 'Moda', price: 60, group: 'brown', rent: [4, 20, 60, 180, 320, 450] },
    { type: 'tax', name: 'Gelir Vergisi', price: 200 },
    { type: 'railroad', name: 'Haydarpaşa', price: 200, group: 'rail' },
    { type: 'property', name: 'Beşiktaş', price: 100, group: 'lightblue', rent: [6, 30, 90, 270, 400, 550] },
    { type: 'chance', name: 'Şans', price: 0 },
    { type: 'property', name: 'Ortaköy', price: 100, group: 'lightblue', rent: [6, 30, 90, 270, 400, 550] },
    { type: 'property', name: 'Bebek', price: 120, group: 'lightblue', rent: [8, 40, 100, 300, 450, 600] },
    { type: 'corner', name: 'HAPİSHANE', price: 0 },
    { type: 'property', name: 'Şişli', price: 140, group: 'pink', rent: [10, 50, 150, 450, 625, 750] },
    { type: 'utility', name: 'Elektrik', price: 150, group: 'util' },
    { type: 'property', name: 'Mecidiyeköy', price: 140, group: 'pink', rent: [10, 50, 150, 450, 625, 750] },
    { type: 'property', name: 'Gayrettepe', price: 160, group: 'pink', rent: [12, 60, 180, 500, 700, 900] },
    { type: 'railroad', name: 'Sirkeci', price: 200, group: 'rail' },
    { type: 'property', name: 'Fatih', price: 180, group: 'orange', rent: [14, 70, 200, 550, 750, 950] },
    { type: 'chest', name: 'Kamu Fonu', price: 0 },
    { type: 'property', name: 'Aksaray', price: 180, group: 'orange', rent: [14, 70, 200, 550, 750, 950] },
    { type: 'property', name: 'Eminönü', price: 200, group: 'orange', rent: [16, 80, 220, 600, 800, 1000] },
    { type: 'corner', name: 'OTOPARK', price: 0 },
    { type: 'property', name: 'Taksim', price: 220, group: 'red', rent: [18, 90, 250, 700, 875, 1050] },
    { type: 'chance', name: 'Şans', price: 0 },
    { type: 'property', name: 'İstiklal', price: 220, group: 'red', rent: [18, 90, 250, 700, 875, 1050] },
    { type: 'property', name: 'Beyoğlu', price: 240, group: 'red', rent: [20, 100, 300, 750, 925, 1100] },
    { type: 'railroad', name: 'Karaköy', price: 200, group: 'rail' },
    { type: 'property', name: 'Sarıyer', price: 260, group: 'yellow', rent: [22, 110, 330, 800, 975, 1150] },
    { type: 'property', name: 'Tarabya', price: 260, group: 'yellow', rent: [22, 110, 330, 800, 975, 1150] },
    { type: 'utility', name: 'Su İdaresi', price: 150, group: 'util' },
    { type: 'property', name: 'Yeniköy', price: 280, group: 'yellow', rent: [24, 120, 360, 850, 1025, 1200] },
    { type: 'corner', name: 'KODESE GİT', price: 0 },
    { type: 'property', name: 'Etiler', price: 300, group: 'green', rent: [26, 130, 390, 900, 1100, 1275] },
    { type: 'property', name: 'Levent', price: 300, group: 'green', rent: [26, 130, 390, 900, 1100, 1275] },
    { type: 'chest', name: 'Kamu Fonu', price: 0 },
    { type: 'property', name: 'Maslak', price: 320, group: 'green', rent: [28, 150, 450, 1000, 1200, 1400] },
    { type: 'railroad', name: 'Halkalı', price: 200, group: 'rail' },
    { type: 'chance', name: 'Şans', price: 0 },
    { type: 'property', name: 'Nişantaşı', price: 350, group: 'darkblue', rent: [35, 175, 500, 1100, 1300, 1500] },
    { type: 'tax', name: 'Lüks Vergisi', price: 100 },
    { type: 'property', name: 'Maçka', price: 400, group: 'darkblue', rent: [50, 200, 600, 1400, 1700, 2000] }
];

let rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // ODA LİSTESİ
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length, status: rooms[id].status
        }));
        socket.emit('roomList', list);
    });

    // ODA OLUŞTUR
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            players: [],
            status: 'LOBBY',
            turnIndex: 0,
            properties: {} // { tileIndex: playerId }
        };
        joinRoomLogic(socket, roomId, data);
    });

    // ODAYA KATIL
    socket.on('joinRoom', (data) => joinRoomLogic(socket, data.roomId, data));

    // OYUNU BAŞLAT
    socket.on('startGame', () => {
        const roomId = findRoomId(socket.id);
        if (roomId && rooms[roomId].hostId === socket.id) {
            rooms[roomId].status = 'PLAYING';
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                board: BOARD, // Board verisini istemciye gönderiyoruz
                turnPlayerId: rooms[roomId].players[0].id
            });
        }
    });

    // ZAR ATMA & OYNANIŞ
    socket.on('rollDice', () => {
        const roomId = findRoomId(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);

        // Sıra kontrolü
        if (room.players[room.turnIndex].id !== socket.id) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        // Hapis Mantığı
        if (player.inJail) {
            if (isDouble) {
                player.inJail = false;
                movePlayer(player, total);
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.inJail = false;
                    movePlayer(player, total);
                }
            }
        } else {
            movePlayer(player, total);
        }

        // Sonucu Gönder (Ses için playSound flag'i ekledim)
        io.to(roomId).emit('diceResult', {
            die1, die2, playerId: socket.id,
            newPosition: player.position,
            money: player.money,
            playSound: true
        });

        // Olay Kontrolü (Satın alma, kira vb.)
        setTimeout(() => {
            checkTileAction(room, player, socket);
            if (!isDouble) nextTurn(room);
        }, 2000); // Zar animasyonu süresi kadar bekle
    });

    // MÜLK SATIN ALMA
    socket.on('buyProperty', () => {
        const roomId = findRoomId(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = BOARD[player.position];

        if (tile.price && player.money >= tile.price && !room.properties[player.position]) {
            player.money -= tile.price;
            room.properties[player.position] = socket.id;
            io.to(roomId).emit('propertyBought', {
                tileIndex: player.position,
                playerId: socket.id,
                money: player.money
            });
        }
    });
    
    // HAPİS ÖDEME
    socket.on('payJail', () => {
        const roomId = findRoomId(socket.id);
        const player = rooms[roomId].players.find(p => p.id === socket.id);
        if(player.money >= 50) {
            player.money -= 50;
            player.inJail = false;
            player.jailTurns = 0;
            io.to(roomId).emit('jailPaid', { playerId: socket.id, money: player.money });
        }
    });

    socket.on('disconnect', () => {
        // Kopma durumunda hemen silmiyoruz, basit tutuyoruz şimdilik
        // Gerçek uygulamada reconnection logic gerekir
    });
});

function movePlayer(player, steps) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    
    // Başlangıçtan geçiş
    if (player.position < oldPos) {
        player.money += 200;
    }

    // Kodese Git karesi (30. index)
    if (player.position === 30) {
        player.position = 10;
        player.inJail = true;
        player.jailTurns = 0;
    }
}

function checkTileAction(room, player, socket) {
    const tile = BOARD[player.position];
    const ownerId = room.properties[player.position];

    // Tapusu alınmışsa kira öde
    if (ownerId && ownerId !== player.id) {
        const rent = tile.rent ? tile.rent[0] : 20; // Basit kira
        player.money -= rent;
        const owner = room.players.find(p => p.id === ownerId);
        if (owner) owner.money += rent;
        
        io.to(room.id).emit('rentPaid', {
            payer: player.id, receiver: ownerId, amount: rent,
            payerMoney: player.money, receiverMoney: owner ? owner.money : 0
        });
    } 
    // Tapusu yoksa ve satın alınabilirse
    else if (!ownerId && tile.type === 'property' || tile.type === 'railroad' || tile.type === 'utility') {
        socket.emit('offerBuy', { tile });
    }
}

function nextTurn(room) {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    io.to(room.id).emit('turnChange', room.players[room.turnIndex].id);
}

function joinRoomLogic(socket, roomId, data) {
    if (!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].players.push({
        id: socket.id,
        name: data.nickname,
        avatar: data.avatar,
        money: 1500,
        position: 0,
        inJail: false,
        jailTurns: 0,
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
    });
    io.to(roomId).emit('updatePlayers', rooms[roomId].players);
    socket.emit('roomJoined', { roomId, isHost: rooms[roomId].hostId === socket.id });
}

function findRoomId(socketId) {
    return Object.keys(rooms).find(id => rooms[id].players.find(p => p.id === socketId));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
