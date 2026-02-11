const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

// === BOARD DATA (TEK GERÇEK KAYNAK) ===
// Bu veriyi sunucuda tutuyoruz ki herkes aynı oyunu görsün.
const BOARD_DATA = [
    { type: 'corner', name: 'BAŞLANGIÇ', id: 0 },
    { type: 'property', name: 'Kadiköy', price: 60, rent: [2, 10, 30, 90, 160, 250], group: 'brown', id: 1 },
    { type: 'chest', name: 'Kamu Fonu', id: 2 },
    { type: 'property', name: 'Moda', price: 60, rent: [4, 20, 60, 180, 320, 450], group: 'brown', id: 3 },
    { type: 'tax', name: 'Gelir Vergisi', price: 200, id: 4 },
    { type: 'railroad', name: 'Haydarpaşa', price: 200, rent: [25, 50, 100, 200], id: 5 },
    { type: 'property', name: 'Beşiktaş', price: 100, rent: [6, 30, 90, 270, 400, 550], group: 'lightblue', id: 6 },
    { type: 'chance', name: 'Şans', id: 7 },
    { type: 'property', name: 'Ortaköy', price: 100, rent: [6, 30, 90, 270, 400, 550], group: 'lightblue', id: 8 },
    { type: 'property', name: 'Bebek', price: 120, rent: [8, 40, 100, 300, 450, 600], group: 'lightblue', id: 9 },
    { type: 'corner', name: 'ZİYARETÇİ', id: 10 },
    { type: 'property', name: 'Şişli', price: 140, rent: [10, 50, 150, 450, 625, 750], group: 'pink', id: 11 },
    { type: 'utility', name: 'Elektrik', price: 150, id: 12 },
    { type: 'property', name: 'Mecidiyeköy', price: 140, rent: [10, 50, 150, 450, 625, 750], group: 'pink', id: 13 },
    { type: 'property', name: 'Gayrettepe', price: 160, rent: [12, 60, 180, 500, 700, 900], group: 'pink', id: 14 },
    { type: 'railroad', name: 'Sirkeci', price: 200, rent: [25, 50, 100, 200], id: 15 },
    { type: 'property', name: 'Fatih', price: 180, rent: [14, 70, 200, 550, 750, 950], group: 'orange', id: 16 },
    { type: 'chest', name: 'Kamu Fonu', id: 17 },
    { type: 'property', name: 'Aksaray', price: 180, rent: [14, 70, 200, 550, 750, 950], group: 'orange', id: 18 },
    { type: 'property', name: 'Eminönü', price: 200, rent: [16, 80, 220, 600, 800, 1000], group: 'orange', id: 19 },
    { type: 'corner', name: 'OTOPARK', id: 20 },
    { type: 'property', name: 'Taksim', price: 220, rent: [18, 90, 250, 700, 875, 1050], group: 'red', id: 21 },
    { type: 'chance', name: 'Şans', id: 22 },
    { type: 'property', name: 'İstiklal', price: 220, rent: [18, 90, 250, 700, 875, 1050], group: 'red', id: 23 },
    { type: 'property', name: 'Beyoğlu', price: 240, rent: [20, 100, 300, 750, 925, 1100], group: 'red', id: 24 },
    { type: 'railroad', name: 'Karaköy', price: 200, rent: [25, 50, 100, 200], id: 25 },
    { type: 'property', name: 'Sarıyer', price: 260, rent: [22, 110, 330, 800, 975, 1150], group: 'yellow', id: 26 },
    { type: 'property', name: 'Tarabya', price: 260, rent: [22, 110, 330, 800, 975, 1150], group: 'yellow', id: 27 },
    { type: 'utility', name: 'Su İdaresi', price: 150, id: 28 },
    { type: 'property', name: 'Yeniköy', price: 280, rent: [24, 120, 360, 850, 1025, 1200], group: 'yellow', id: 29 },
    { type: 'corner', name: 'KODESE GİT', id: 30 },
    { type: 'property', name: 'Etiler', price: 300, rent: [26, 130, 390, 900, 1100, 1275], group: 'green', id: 31 },
    { type: 'property', name: 'Levent', price: 300, rent: [26, 130, 390, 900, 1100, 1275], group: 'green', id: 32 },
    { type: 'chest', name: 'Kamu Fonu', id: 33 },
    { type: 'property', name: 'Maslak', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], group: 'green', id: 34 },
    { type: 'railroad', name: 'Halkalı', price: 200, rent: [25, 50, 100, 200], id: 35 },
    { type: 'chance', name: 'Şans', id: 36 },
    { type: 'property', name: 'Nişantaşı', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], group: 'darkblue', id: 37 },
    { type: 'tax', name: 'Lüks Vergisi', price: 100, id: 38 },
    { type: 'property', name: 'Maçka', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], group: 'darkblue', id: 39 }
];

let rooms = {};

// === SOCKET HANDLERS ===
io.on('connection', (socket) => {
    console.log('Bağlantı:', socket.id);

    // Board verisini istemciye gönder (Senkronizasyon için kritik)
    socket.emit('initBoard', BOARD_DATA);

    // ODA KURMA
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname} Odası`,
            hostId: socket.id,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, houses: {}, turnIndex: 0 }
        };
        joinRoomLogic(socket, roomId, data);
    });

    // ODA LİSTESİ
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length, status: rooms[id].status
        }));
        socket.emit('roomList', list);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data);
    });

    // OYUNU BAŞLAT
    socket.on('startGame', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId && rooms[roomId].hostId === socket.id) {
            rooms[roomId].status = 'PLAYING';
            // İlk oyuncunun sırası
            io.to(roomId).emit('gameStarted', {
                players: rooms[roomId].players,
                currentTurn: rooms[roomId].players[0].id
            });
        }
    });

    // ZAR ATMA (Oyunun Kalbi)
    socket.on('rollDice', (data) => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        // Sıra kontrolü
        if (room.players[room.gameState.turnIndex].id !== socket.id) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;
        let jailEscape = false;

        // --- HAPİSHANE MANTIĞI ---
        if (player.jail) {
            if (isDouble || (data && data.tryJailEscape)) {
                if (isDouble) {
                    player.jail = false;
                    player.jailTurns = 0;
                    jailEscape = true;
                } else {
                    player.jailTurns++;
                    if (player.jailTurns >= 3) {
                        player.money -= 50; // Zorla çıkış
                        player.jail = false;
                        player.jailTurns = 0;
                        jailEscape = true;
                    } else {
                        // Çıkamadı, sıra geçer
                        io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: false, msg: "Hapisten çıkamadın!" });
                        nextTurn(roomId);
                        return;
                    }
                }
            } else {
                 io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: false, msg: "Çift atman lazım!" });
                 nextTurn(roomId);
                 return;
            }
        }

        // --- HAREKET MANTIĞI ---
        const oldPos = player.position;
        player.position = (player.position + total) % 40;

        // Başlangıçtan geçiş parası
        if (player.position < oldPos) {
            player.money += 200;
        }

        // Kodese Git karesi
        if (player.position === 30) {
            player.position = 10;
            player.jail = true;
            player.jailTurns = 0;
            io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id, move: true, newPosition: 10, money: player.money });
            io.to(roomId).emit('jailEntered', { playerId: socket.id });
            nextTurn(roomId);
            return;
        }

        // Sonuçları Gönder
        io.to(roomId).emit('diceResult', { 
            die1, die2, playerId: socket.id, 
            move: true, newPosition: player.position, money: player.money 
        });

        // Hareketi bitirince aksiyon al (1sn gecikmeli ki piyon gitsin)
        setTimeout(() => {
            handleTileAction(roomId, player);
            if (!isDouble || player.jail) {
                setTimeout(() => nextTurn(roomId), 1500); // Aksiyon bittikten sonra sıra devret
            }
        }, 1000);
    });

    // MÜLK SATIN ALMA
    socket.on('buyProperty', (data) => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = BOARD_DATA[data.position];

        if (player.money >= tile.price && !room.gameState.properties[data.position]) {
            player.money -= tile.price;
            player.properties.push(data.position);
            room.gameState.properties[data.position] = socket.id;

            io.to(roomId).emit('propertyPurchased', {
                playerId: socket.id,
                position: data.position,
                money: player.money,
                color: player.color
            });
        }
    });

    // KEFALET ÖDEME
    socket.on('payBail', () => {
        const roomId = getPlayerRoom(socket.id);
        const player = rooms[roomId].players.find(p => p.id === socket.id);
        if (player.money >= 50) {
            player.money -= 50;
            player.jail = false;
            player.jailTurns = 0;
            io.to(roomId).emit('jailReleased', { playerId: socket.id });
            // Hemen zar atamaz, sırasını bekler (veya hemen atar - kurala göre değişir, burada basit tutalım)
        }
    });
    
    // KOPMA YÖNETİMİ
    socket.on('disconnect', () => {
        const roomId = getPlayerRoom(socket.id);
        if(roomId) {
            const room = rooms[roomId];
            // Oyuncuyu hemen silmiyoruz, belki F5 attı. 
            // Basitlik için şu anlık siliyoruz ama "Oyun Bitti" dedirtmeyelim.
            room.players = room.players.filter(p => p.id !== socket.id);
            if(room.players.length === 0) delete rooms[roomId];
            else io.to(roomId).emit('updateRoomPlayers', room.players);
        }
    });

});

// YARDIMCI FONKSİYONLAR
function joinRoomLogic(socket, roomId, data) {
    if (!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].players.push({
        id: socket.id,
        name: data.nickname,
        avatar: data.avatar,
        color: getRandomColor(),
        money: 1500,
        position: 0,
        properties: [],
        jail: false,
        isHost: rooms[roomId].hostId === socket.id
    });
    socket.emit('roomJoined', { roomId, isHost: rooms[roomId].hostId === socket.id });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.players.length;
    io.to(roomId).emit('turnChange', room.players[room.gameState.turnIndex].id);
}

function handleTileAction(roomId, player) {
    const tile = BOARD_DATA[player.position];
    const room = rooms[roomId];
    
    if (tile.type === 'property' || tile.type === 'railroad' || tile.type === 'utility') {
        const ownerId = room.gameState.properties[tile.id];
        
        if (!ownerId) {
            // Sahibi yok, satın alabilir
            io.to(player.id).emit('propertyLanded', { position: tile.id });
        } else if (ownerId !== player.id) {
            // Sahibi var, kira öde
            const owner = room.players.find(p => p.id === ownerId);
            if(owner) {
                // Basit kira mantığı (daha karmaşık versiyon eklenebilir)
                let rent = Array.isArray(tile.rent) ? tile.rent[0] : (tile.price * 0.1);
                
                player.money -= rent;
                owner.money += rent;
                
                io.to(roomId).emit('rentPaid', { 
                    payerId: player.id, 
                    receiverId: owner.id, 
                    amount: rent,
                    payerMoney: player.money,
                    receiverMoney: owner.money
                });
            }
        }
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('updateMoney', { playerId: player.id, money: player.money });
    }
    // Şans kartları vs. burada genişletilebilir
}

function getPlayerRoom(id) {
    return Object.keys(rooms).find(rid => rooms[rid].players.find(p => p.id === id));
}
function getRandomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));
