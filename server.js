const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// CORS: Her yerden erişime izin ver
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === OYUN VERİSİ (Sunucu içine gömüldü - Hata riskini sıfırlar) ===
const BOARD_DATA = [
    { index: 0, type: 'corner', name: 'BAŞLANGIÇ', price: 0 },
    { index: 1, type: 'property', name: 'KASIMPAŞA', group: 'brown', price: 60, rent: 2 },
    { index: 2, type: 'chest', name: 'KAMU FONU', price: 0 },
    { index: 3, type: 'property', name: 'DOLAPDERE', group: 'brown', price: 60, rent: 4 },
    { index: 4, type: 'tax', name: 'GELİR VERGİSİ', price: 200 },
    { index: 5, type: 'station', name: 'HAYDARPAŞA', group: 'station', price: 200, rent: 25 },
    { index: 6, type: 'property', name: 'SULTANAHMET', group: 'lightblue', price: 100, rent: 6 },
    { index: 7, type: 'chance', name: 'ŞANS', price: 0 },
    { index: 8, type: 'property', name: 'KARAKÖY', group: 'lightblue', price: 100, rent: 6 },
    { index: 9, type: 'property', name: 'SİRKECİ', group: 'lightblue', price: 120, rent: 8 },
    { index: 10, type: 'corner', name: 'ZİYARET / HAPİS', price: 0 },
    { index: 11, type: 'property', name: 'BEŞİKTAŞ', group: 'pink', price: 140, rent: 10 },
    { index: 12, type: 'utility', name: 'ELEKTRİK', group: 'utility', price: 150, rent: 0 },
    { index: 13, type: 'property', name: 'HARBİYE', group: 'pink', price: 140, rent: 10 },
    { index: 14, type: 'property', name: 'MAÇKA', group: 'pink', price: 160, rent: 12 },
    { index: 15, type: 'station', name: 'SİRKECİ GARI', group: 'station', price: 200, rent: 25 },
    { index: 16, type: 'property', name: 'ŞİŞLİ', group: 'orange', price: 180, rent: 14 },
    { index: 17, type: 'chest', name: 'KAMU FONU', price: 0 },
    { index: 18, type: 'property', name: 'MECİDİYEKÖY', group: 'orange', price: 180, rent: 14 },
    { index: 19, type: 'property', name: 'GAYRETTEPE', group: 'orange', price: 200, rent: 16 },
    { index: 20, type: 'corner', name: 'OTOPARK', price: 0 },
    { index: 21, type: 'property', name: 'CADDEBOSTAN', group: 'red', price: 220, rent: 18 },
    { index: 22, type: 'chance', name: 'ŞANS', price: 0 },
    { index: 23, type: 'property', name: 'ERENKÖY', group: 'red', price: 220, rent: 18 },
    { index: 24, type: 'property', name: 'SUADİYE', group: 'red', price: 240, rent: 20 },
    { index: 25, type: 'station', name: 'SÖĞÜTLÜÇEŞME', group: 'station', price: 200, rent: 25 },
    { index: 26, type: 'property', name: 'ATAŞEHİR', group: 'yellow', price: 260, rent: 22 },
    { index: 27, type: 'property', name: 'BEYKOZ', group: 'yellow', price: 260, rent: 22 },
    { index: 28, type: 'utility', name: 'SU İDARESİ', group: 'utility', price: 150, rent: 0 },
    { index: 29, type: 'property', name: 'SARIYER', group: 'yellow', price: 280, rent: 24 },
    { index: 30, type: 'corner', name: 'HAPSE GİR', price: 0 },
    { index: 31, type: 'property', name: 'LEVENT', group: 'green', price: 300, rent: 26 },
    { index: 32, type: 'property', name: 'ETİLER', group: 'green', price: 300, rent: 26 },
    { index: 33, type: 'chest', name: 'KAMU FONU', price: 0 },
    { index: 34, type: 'property', name: 'BEBEK', group: 'green', price: 320, rent: 28 },
    { index: 35, type: 'station', name: 'HALKALI', group: 'station', price: 200, rent: 25 },
    { index: 36, type: 'chance', name: 'ŞANS', price: 0 },
    { index: 37, type: 'property', name: 'TARABYA', group: 'darkblue', price: 350, rent: 35 },
    { index: 38, type: 'tax', name: 'LÜKS VERGİSİ', price: 100 },
    { index: 39, type: 'property', name: 'YENİKÖY', group: 'darkblue', price: 400, rent: 50 }
];

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

const getRoomList = () => {
    try {
        // Hata koruması: Boş veya hatalı odaları filtrele
        return Object.values(rooms)
            .filter(r => r && r.id && r.players && r.players.length > 0)
            .map(r => ({
                id: r.id,
                name: r.players[0].name + "'in Odası",
                count: r.players.length,
                status: r.status
            }));
    } catch (e) {
        console.error("Liste Hatası:", e);
        return [];
    }
};

const getNextTurn = (room) => {
    if (!room.players || room.players.length === 0) return null;
    const currentIdx = room.players.findIndex(p => p.id === room.turn);
    const nextIdx = (currentIdx + 1) % room.players.length;
    return room.players[nextIdx].id;
};

io.on('connection', (socket) => {
    console.log('✅ Bağlantı:', socket.id);

    // İlk bağlantıda listeyi gönder
    socket.emit('roomList', getRoomList());

    socket.on('getRooms', () => {
        socket.emit('roomList', getRoomList());
    });

    socket.on('createRoom', ({ nickname, avatar }) => {
        try {
            const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
            
            rooms[roomId] = {
                id: roomId,
                players: [createPlayer(socket.id, nickname, avatar)],
                status: 'LOBBY',
                turn: null,
                boardState: {}, 
                logs: []
            };

            socket.join(roomId);
            console.log(`🏠 Oda Kuruldu: ${roomId} (${nickname})`);
            
            // Client'a başarılı olduğunu bildir
            socket.emit('roomJoined', { roomId: roomId, isHost: true });
            
            // HERKESE yeni listeyi duyur
            io.emit('roomList', getRoomList());

        } catch (error) {
            console.error("Oda kurma hatası:", error);
            socket.emit('error', 'Oda kurulurken sunucu hatası oluştu.');
        }
    });

    socket.on('joinRoom', ({ roomId, nickname, avatar }) => {
        // Büyük/Küçük harf duyarsızlığı için ID'yi düzelt
        const safeRoomId = roomId ? roomId.toUpperCase() : null;
        const room = rooms[safeRoomId];

        if (room && room.status === 'LOBBY' && room.players.length < 4) {
            room.players.push(createPlayer(socket.id, nickname, avatar));
            socket.join(safeRoomId);
            
            socket.emit('roomJoined', { roomId: safeRoomId, isHost: false });
            io.to(safeRoomId).emit('updateLobby', room);
            
            // Listeyi güncelle (sayı arttı)
            io.emit('roomList', getRoomList());
        } else {
            console.log(`❌ Giriş başarısız: ${safeRoomId}`);
            socket.emit('error', 'Oda bulunamadı, dolu veya oyun başlamış.');
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
        const tile = BOARD_DATA[player.position];
        
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
        // Oyuncu çıkınca odayı temizle (Basit versiyon)
        console.log('Kullanıcı çıktı:', socket.id);
        // Gelişmiş versiyonda burada odadan oyuncu silinir, oda boşsa silinir
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
    const tile = BOARD_DATA[player.position];

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
