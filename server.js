const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let rooms = {};
const TURN_TIME_LIMIT = 30; // 30 Saniye Kuralı

// --- EKONOMİK AYARLAR (BOARD VERİSİ) ---
// Fiyatlar ve Kiralar 1.5M Başlangıç parasına göre dengelendi.
const boardData = [
    { index: 0, type: 'corner', name: 'BAŞLANGIÇ', price: 0 },
    { index: 1, type: 'property', name: 'KASIMPAŞA', group: 'brown', price: 100000, houseCost: 50000, rents: [10000, 30000, 90000, 270000, 400000, 550000] },
    { index: 2, type: 'chest', name: 'KAMU FONU', price: 0 },
    { index: 3, type: 'property', name: 'DOLAPDERE', group: 'brown', price: 100000, houseCost: 50000, rents: [12000, 36000, 100000, 300000, 450000, 600000] },
    { index: 4, type: 'tax', name: 'GELİR VERGİSİ', price: 200000 },
    { index: 5, type: 'station', name: 'METRO', group: 'station', price: 200000, rent: 50000 },
    { index: 6, type: 'property', name: 'SULTANAHMET', group: 'lightblue', price: 150000, houseCost: 50000, rents: [15000, 45000, 135000, 400000, 550000, 750000] },
    { index: 7, type: 'chance', name: 'ŞANS', price: 0 },
    { index: 8, type: 'property', name: 'KARAKÖY', group: 'lightblue', price: 150000, houseCost: 50000, rents: [15000, 45000, 135000, 400000, 550000, 750000] },
    { index: 9, type: 'property', name: 'EMİNÖNÜ', group: 'lightblue', price: 180000, houseCost: 50000, rents: [20000, 60000, 180000, 500000, 700000, 900000] },
    { index: 10, type: 'corner', name: 'ZİYARET / HAPİS', price: 0 },
    { index: 11, type: 'property', name: 'BEŞİKTAŞ', group: 'pink', price: 220000, houseCost: 100000, rents: [25000, 75000, 225000, 600000, 800000, 1000000] },
    { index: 12, type: 'utility', name: 'ELEKTRİK', group: 'utility', price: 250000, rent: 0 },
    { index: 13, type: 'property', name: 'HARBİYE', group: 'pink', price: 220000, houseCost: 100000, rents: [25000, 75000, 225000, 600000, 800000, 1000000] },
    { index: 14, type: 'property', name: 'MAÇKA', group: 'pink', price: 250000, houseCost: 100000, rents: [30000, 90000, 270000, 700000, 900000, 1100000] },
    { index: 15, type: 'station', name: 'MARMARAY', group: 'station', price: 200000, rent: 50000 },
    { index: 16, type: 'property', name: 'ŞİŞLİ', group: 'orange', price: 300000, houseCost: 100000, rents: [35000, 100000, 300000, 800000, 1000000, 1200000] },
    { index: 17, type: 'chest', name: 'KAMU FONU', price: 0 },
    { index: 18, type: 'property', name: 'MECİDİYEKÖY', group: 'orange', price: 300000, houseCost: 100000, rents: [35000, 100000, 300000, 800000, 1000000, 1200000] },
    { index: 19, type: 'property', name: 'GAYRETTEPE', group: 'orange', price: 320000, houseCost: 100000, rents: [40000, 120000, 360000, 900000, 1100000, 1400000] },
    { index: 20, type: 'corner', name: 'ÜCRETSİZ OTOPARK', price: 0 },
    { index: 21, type: 'property', name: 'CADDEBOSTAN', group: 'red', price: 350000, houseCost: 150000, rents: [45000, 135000, 400000, 1000000, 1300000, 1500000] },
    { index: 22, type: 'chance', name: 'ŞANS', price: 0 },
    { index: 23, type: 'property', name: 'ERENKÖY', group: 'red', price: 350000, houseCost: 150000, rents: [45000, 135000, 400000, 1000000, 1300000, 1500000] },
    { index: 24, type: 'property', name: 'SUADİYE', group: 'red', price: 380000, houseCost: 150000, rents: [50000, 150000, 450000, 1100000, 1400000, 1700000] },
    { index: 25, type: 'station', name: 'SÖĞÜTLÜÇEŞME', group: 'station', price: 200000, rent: 50000 },
    { index: 26, type: 'property', name: 'ATAŞEHİR', group: 'yellow', price: 400000, houseCost: 150000, rents: [55000, 165000, 500000, 1200000, 1500000, 1800000] },
    { index: 27, type: 'property', name: 'BEYKOZ', group: 'yellow', price: 400000, houseCost: 150000, rents: [55000, 165000, 500000, 1200000, 1500000, 1800000] },
    { index: 28, type: 'utility', name: 'SU İDARESİ', group: 'utility', price: 250000, rent: 0 },
    { index: 29, type: 'property', name: 'SARIYER', group: 'yellow', price: 420000, houseCost: 150000, rents: [60000, 180000, 550000, 1300000, 1600000, 2000000] },
    { index: 30, type: 'corner', name: 'HAPSE GİR', price: 0 },
    { index: 31, type: 'property', name: 'LEVENT', group: 'green', price: 450000, houseCost: 200000, rents: [65000, 200000, 600000, 1400000, 1700000, 2100000] },
    { index: 32, type: 'property', name: 'ETİLER', group: 'green', price: 450000, houseCost: 200000, rents: [65000, 200000, 600000, 1400000, 1700000, 2100000] },
    { index: 33, type: 'chest', name: 'KAMU FONU', price: 0 },
    { index: 34, type: 'property', name: 'BEBEK', group: 'green', price: 480000, houseCost: 200000, rents: [70000, 220000, 660000, 1500000, 1850000, 2300000] },
    { index: 35, type: 'station', name: 'HALKALI', group: 'station', price: 200000, rent: 50000 },
    { index: 36, type: 'chance', name: 'ŞANS', price: 0 },
    { index: 37, type: 'property', name: 'TARABYA', group: 'darkblue', price: 600000, houseCost: 200000, rents: [80000, 300000, 900000, 2000000, 2500000, 3000000] },
    { index: 38, type: 'tax', name: 'LÜKS VERGİSİ', price: 100000 },
    { index: 39, type: 'property', name: 'YENİKÖY', group: 'darkblue', price: 700000, houseCost: 200000, rents: [100000, 400000, 1200000, 2500000, 3000000, 4000000] }
];

// --- KARTLAR ---
const CHANCE_CARDS = [
    { text: "Bankadan 100.000₺ temettü aldın.", action: 'money', amount: 100000 },
    { text: "Aşırı hız cezası! 30.000₺ öde.", action: 'money', amount: -30000 },
    { text: "Başlangıç noktasına git.", action: 'move', target: 0 },
    { text: "Doğrudan Hapse Git!", action: 'jail' },
    { text: "Yeniköy'e git.", action: 'move', target: 39 }
];
const CHEST_CARDS = [
    { text: "Doktor masrafı: 50.000₺ öde.", action: 'money', amount: -50000 },
    { text: "Miras kaldı! 200.000₺", action: 'money', amount: 200000 },
    { text: "Hapisten Ücretsiz Çıkış Kartı!", action: 'money', amount: 50000 },
    { text: "Doğrudan Hapse Git!", action: 'jail' }
];

const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 1500000, // 1.5 Milyon Başlangıç
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false, jailTurns: 0, isBankrupt: false
});

const calcRent = (room, tileIndex, diceTotal) => {
    const tile = boardData[tileIndex];
    const houses = (room.houseState && room.houseState[tileIndex]) || 0;
    
    // İstasyon
    if(tile.type === 'station') {
        const ownerId = room.boardState[tileIndex];
        const owner = room.players.find(p => p.id === ownerId);
        if(!owner) return 50000;
        const count = owner.properties.filter(idx => boardData[idx].type === 'station').length;
        return 50000 * count; // 50k, 100k, 150k, 200k
    }
    // Fatura (Zar x 10.000)
    if(tile.type === 'utility') return (diceTotal || 7) * 10000;
    // Normal Kira
    if (houses > 0 && houses <= 5) return tile.rents[houses];
    return tile.rents ? tile.rents[0] : 0;
};

// --- OYUN DÖNGÜSÜ ---
const startTurnTimer = (roomId) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'PLAYING') return;
    if (room.timer) clearInterval(room.timer);
    room.timeLeft = TURN_TIME_LIMIT;
    io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, turnId: room.turn });

    room.timer = setInterval(() => {
        room.timeLeft--;
        if(room.timeLeft % 5 === 0 || room.timeLeft <= 10) io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, turnId: room.turn });
        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            const p = room.players.find(x => x.id === room.turn);
            if(p) io.to(roomId).emit('log', `⏳ ${p.name} süre aşımı. Pas geçiliyor.`);
            endTurn(roomId);
        }
    }, 1000);
};

io.on('connection', (socket) => {
    // Oda Listesi
    socket.emit('roomList', Object.values(rooms).map(r => ({ id: r.id, name: r.players[0]?.name, count: r.players.length, status: r.status })));

    socket.on('createRoom', ({ nickname, avatar }) => {
        const id = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[id] = { id, players: [createPlayer(socket.id, nickname, avatar)], status: 'LOBBY', turn: null, boardState: {}, houseState: {}, logs: [], timeLeft: TURN_TIME_LIMIT };
        socket.join(id);
        socket.emit('roomJoined', { roomId: id, isHost: true });
    });

    socket.on('joinRoom', ({ roomId, nickname, avatar }) => {
        const room = rooms[roomId];
        if (room && room.status === 'LOBBY' && room.players.length < 4) {
            room.players.push(createPlayer(socket.id, nickname, avatar));
            socket.join(roomId);
            socket.emit('roomJoined', { roomId, isHost: false });
            io.to(roomId).emit('updateLobby', room);
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            room.status = 'PLAYING';
            room.turn = room.players[0].id;
            io.to(roomId).emit('gameStarted', room);
            startTurnTimer(roomId);
        }
    });

    socket.on('payBail', (roomId) => {
        const room = rooms[roomId];
        const p = room.players.find(x => x.id === socket.id);
        if(p && p.inJail && p.money >= 50000) {
            p.money -= 50000; p.inJail = false; p.jailTurns = 0;
            io.to(roomId).emit('moneyUpdate', { playerId: p.id, money: p.money });
            io.to(roomId).emit('log', `${p.name} kefalet ödedi.`);
            socket.emit('bailPaid');
        }
    });

    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        const p = room.players.find(x => x.id === socket.id);
        if (!room || room.turn !== socket.id) return;
        if(room.timer) clearInterval(room.timer);

        const d1 = Math.floor(Math.random()*6)+1;
        const d2 = Math.floor(Math.random()*6)+1;
        const total = d1 + d2;
        io.to(roomId).emit('diceRolled', { die1: d1, die2: d2 });

        if(p.inJail) {
            if(d1 === d2) {
                p.inJail = false; p.jailTurns = 0;
                io.to(roomId).emit('log', `${p.name} çift attı ve çıktı!`);
                movePlayer(room, p, total, total);
            } else {
                p.jailTurns++;
                if(p.jailTurns >= 3) {
                    p.money -= 50000; p.inJail = false;
                    io.to(roomId).emit('log', `${p.name} zorunlu kefalet ödedi.`);
                    movePlayer(room, p, total, total);
                } else {
                    io.to(roomId).emit('log', `${p.name} hapiste kaldı.`);
                    io.to(p.id).emit('purchaseSuccess'); // Manuel bitir
                }
            }
        } else {
            movePlayer(room, p, total, total);
            if(d1 === d2 && !p.inJail) {
                io.to(roomId).emit('allowReRoll');
                startTurnTimer(roomId);
            }
        }
    });

    socket.on('buyProperty', (roomId) => {
        const room = rooms[roomId];
        const p = room.players.find(x => x.id === socket.id);
        const tile = boardData[p.position];
        if (p.money >= tile.price && !room.boardState[p.position]) {
            p.money -= tile.price;
            p.properties.push(p.position);
            room.boardState[p.position] = p.id;
            io.to(roomId).emit('propertyBought', { playerId: p.id, tileIndex: p.position, money: p.money });
            io.to(roomId).emit('log', `${p.name}, ${tile.name} aldı.`);
            socket.emit('purchaseSuccess');
        }
    });
    
    socket.on('endTurn', (roomId) => endTurn(roomId));

    socket.on('disconnect', () => {
        Object.keys(rooms).forEach(rid => {
            const r = rooms[rid];
            const idx = r.players.findIndex(p => p.id === socket.id);
            if(idx !== -1) {
                if(r.status === 'LOBBY') r.players.splice(idx, 1);
                setTimeout(() => {
                    const s = io.sockets.adapter.rooms.get(rid);
                    if(!s || s.size === 0) delete rooms[rid];
                }, 1000);
            }
        });
    });
});

function movePlayer(room, player, steps, diceTotal) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    if (player.position < oldPos) {
        player.money += 200000;
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
    }

    if(player.position === 30) {
        player.position = 10; player.inJail = true;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
        io.to(room.id).emit('log', `${player.name} Hapse girdi!`);
        endTurn(room.id);
        return;
    }

    io.to(room.id).emit('playerMoved', { playerId: player.id, position: player.position });
    
    const tile = boardData[player.position];

    // KART
    if (tile.type === 'chance' || tile.type === 'chest') {
        setTimeout(() => drawCard(room, player, tile.type), 1000);
        return;
    }

    // MÜLK İŞLEMLERİ
    if (['property', 'station', 'utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            const rent = calcRent(room, player.position, diceTotal);
            const owner = room.players.find(p => p.id === ownerId);
            player.money -= rent;
            owner.money += rent;
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
            io.to(room.id).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
            io.to(room.id).emit('log', `${player.name} ${rent}₺ kira ödedi.`);
            io.to(player.id).emit('purchaseSuccess');
        } else if (!ownerId && player.money >= tile.price) {
            io.to(player.id).emit('offerBuy', tile);
        } else {
            io.to(player.id).emit('purchaseSuccess');
        }
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(player.id).emit('purchaseSuccess');
    } else {
        io.to(player.id).emit('purchaseSuccess');
    }
}

function drawCard(room, player, type) {
    const deck = type === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
    const card = deck[Math.floor(Math.random() * deck.length)];
    io.to(room.id).emit('showCard', { type: type === 'chance' ? 'ŞANS' : 'KAMU FONU', text: card.text });
    
    setTimeout(() => {
        if(card.action === 'money') {
            player.money += card.amount;
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        } else if (card.action === 'move') {
            const current = player.position;
            let dist = card.target - current;
            if (dist < 0) dist += 40;
            movePlayer(room, player, dist, 0);
            return;
        } else if (card.action === 'jail') {
            player.position = 10; player.inJail = true;
            io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
            endTurn(room.id);
            return;
        }
        io.to(player.id).emit('purchaseSuccess');
    }, 2500);
}

function endTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    if(room.timer) clearInterval(room.timer);
    
    let nextIdx = (room.players.findIndex(p => p.id === room.turn) + 1) % room.players.length;
    room.turn = room.players[nextIdx].id;
    io.to(roomId).emit('turnChanged', room.turn);
    startTurnTimer(roomId);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server 3000'de!`));
