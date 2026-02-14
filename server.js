const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const boardData = require('./public/board_data');

const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let rooms = {};
const TURN_TIME_LIMIT = 30; // 30 SANİYE

// --- KARTLAR ---
const CHANCE_CARDS = [
    { id: 1, text: "Bankadan 1000₺ temettü.", action: 'money', amount: 1000 },
    { id: 2, text: "Hız cezası! 300₺ öde.", action: 'money', amount: -300 },
    { id: 3, text: "Başlangıç noktasına git.", action: 'move', target: 0 },
    { id: 4, text: "Doğrudan Hapse Git!", action: 'jail' },
    { id: 5, text: "Tüm oyunculara 100₺ öde.", action: 'payall', amount: 100 },
    { id: 6, text: "Yeniköy'e git.", action: 'move', target: 39 },
];

const CHEST_CARDS = [
    { id: 1, text: "Doktor masrafı: 1000₺ öde.", action: 'money', amount: -1000 },
    { id: 2, text: "Vergi iadesi: 400₺ al.", action: 'money', amount: 400 },
    { id: 3, text: "Miras kaldı! 2000₺", action: 'money', amount: 2000 },
    { id: 4, text: "Doğrudan Hapse Git!", action: 'jail' },
    { id: 5, text: "Her oyuncudan 200₺ topla.", action: 'collectall', amount: 200 }
];

// OYUNCU (30.000 TL ile başlar)
const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 30000, 
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false, jailTurns: 0, isBankrupt: false
});

const hasFullGroup = (room, player, group) => {
    if (!group) return false;
    const groupTiles = boardData.filter(t => t.group === group).map(t => t.index);
    const ownedInGroup = player.properties.filter(idx => boardData[idx].group === group);
    return groupTiles.length === ownedInGroup.length;
};

const calcRent = (room, tileIndex, diceTotal) => {
    const tile = boardData[tileIndex];
    const houses = (room.houseState && room.houseState[tileIndex]) || 0;
    
    // İstasyon (250 * 2^n)
    if(tile.type === 'station') {
        const ownerId = room.boardState[tileIndex];
        const owner = room.players.find(p => p.id === ownerId);
        if(!owner) return 500;
        const count = owner.properties.filter(idx => boardData[idx].type === 'station').length;
        return 500 * Math.pow(2, count - 1);
    }
    // Fatura (Zar * 40 veya *100)
    if(tile.type === 'utility') return (diceTotal || 7) * 40;
    
    // Konut
    if (tile.rents) {
        if (houses > 0 && houses <= 5) return tile.rents[houses];
        return tile.rents[0]; 
    }
    return 0;
};

// --- SÜRE SİSTEMİ ---
const startTurnTimer = (roomId) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'PLAYING') return;
    if (room.timer) clearInterval(room.timer);
    
    room.timeLeft = TURN_TIME_LIMIT;
    io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, turnId: room.turn });

    room.timer = setInterval(() => {
        room.timeLeft--;
        // Her saniye güncelleme gönder (Client tarafında senkron için)
        io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, turnId: room.turn });

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            // PAS GEÇ
            const p = room.players.find(x => x.id === room.turn);
            io.to(roomId).emit('log', `⏳ ${p.name} süre aşımı! Pas.`);
            endTurn(roomId);
        }
    }, 1000);
};

// --- SOCKET ---
io.on('connection', (socket) => {
    // Oda Listesi
    const sendRooms = () => {
        const list = Object.values(rooms).filter(r => r.players.length).map(r => ({
            id: r.id, name: r.players[0].name, count: r.players.length, status: r.status
        }));
        io.emit('roomList', list);
    };
    socket.emit('roomList', []); sendRooms();

    // Oda Kur
    socket.on('createRoom', ({ nickname, avatar }) => {
        const id = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[id] = { id, players: [createPlayer(socket.id, nickname, avatar)], status: 'LOBBY', turn: null, boardState: {}, houseState: {}, logs: [], timeLeft: TURN_TIME_LIMIT };
        socket.join(id);
        socket.emit('roomJoined', { roomId: id, isHost: true });
        sendRooms();
    });

    // Katıl
    socket.on('joinRoom', ({ roomId, nickname, avatar }) => {
        const room = rooms[roomId];
        if (room && room.status === 'LOBBY' && room.players.length < 4) {
            room.players.push(createPlayer(socket.id, nickname, avatar));
            socket.join(roomId);
            socket.emit('roomJoined', { roomId, isHost: false });
            io.to(roomId).emit('updateLobby', room);
            sendRooms();
        }
    });

    // Başlat
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[0].id === socket.id) {
            room.status = 'PLAYING';
            room.turn = room.players[0].id;
            io.to(roomId).emit('gameStarted', room);
            sendRooms();
            startTurnTimer(roomId);
        }
    });

    // Zar At
    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;
        if(room.timer) clearInterval(room.timer); // Süreyi durdur

        const p = room.players.find(x => x.id === socket.id);
        const d1 = Math.floor(Math.random()*6)+1;
        const d2 = Math.floor(Math.random()*6)+1;
        const total = d1 + d2;
        io.to(roomId).emit('diceRolled', { die1: d1, die2: d2, playerId: socket.id });

        if(p.inJail) {
            // HAPİS MANTIĞI
            if(d1===d2) {
                p.inJail = false; p.jailTurns = 0;
                io.to(roomId).emit('log', `${p.name} çift attı ve çıktı!`);
                movePlayer(room, p, total, total);
            } else {
                p.jailTurns++;
                io.to(roomId).emit('log', `${p.name} hapisten çıkamadı.`);
                if(p.jailTurns >= 3) {
                    p.money -= 1000; p.inJail = false;
                    io.to(roomId).emit('log', `3 tur doldu, 1000₺ ödendi.`);
                    movePlayer(room, p, total, total);
                } else {
                    endTurn(roomId);
                }
            }
        } else {
            // NORMAL HAREKET
            movePlayer(room, p, total, total);
            
            // Çift attıysa tekrar oynamasın, sırayı manuel bitirsin ama süre başlasın
            // (Basitlik için çift atınca tekrar oynama kuralını devre dışı bırakıyorum ki oyun kilitlenmesin)
            // Eğer istersen buraya if(d1===d2) mantığı eklenir.
            
            // Kullanıcı işlem yapsın diye "purchaseSuccess" yolluyoruz (Tur Bitir butonu için)
            // Ancak kart veya mülk durumu movePlayer içinde hallediliyor.
        }
    });

    // Kefalet
    socket.on('payBail', (roomId) => {
        const room = rooms[roomId];
        const p = room.players.find(x => x.id === socket.id);
        if(p && p.inJail && p.money >= 1000) {
            p.money -= 1000; p.inJail = false; p.jailTurns = 0;
            io.to(roomId).emit('moneyUpdate', { playerId: p.id, money: p.money });
            io.to(roomId).emit('log', `${p.name} kefalet ödedi.`);
            socket.emit('bailPaid');
        }
    });

    // Satın Al
    socket.on('buyProperty', (roomId) => {
        const room = rooms[roomId];
        const p = room.players.find(x => x.id === socket.id);
        const tile = boardData[p.position];
        if (p.money >= tile.price && !room.boardState[p.position]) {
            p.money -= tile.price;
            p.properties.push(p.position);
            room.boardState[p.position] = p.id;
            io.to(roomId).emit('propertyBought', { playerId: p.id, tileIndex: p.position, money: p.money });
            io.to(roomId).emit('log', `${p.name}, ${tile.name} satın aldı.`);
            socket.emit('purchaseSuccess');
        }
    });

    // Ev Kur
    socket.on('upgradeProperty', ({ roomId, tileIndex }) => {
        const room = rooms[roomId];
        const p = room.players.find(x => x.id === socket.id);
        const tile = boardData[tileIndex];
        
        if(room.boardState[tileIndex] === p.id && hasFullGroup(room, p, tile.group) && p.money >= tile.houseCost) {
            if(!room.houseState[tileIndex]) room.houseState[tileIndex] = 0;
            if(room.houseState[tileIndex] < 5) {
                p.money -= tile.houseCost;
                room.houseState[tileIndex]++;
                io.to(roomId).emit('propertyUpgraded', { tileIndex, level: room.houseState[tileIndex], playerId: p.id, money: p.money });
            }
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
                    sendRooms();
                }, 1000);
            }
        });
    });
});

function movePlayer(room, player, steps, diceTotal) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    if (player.position < oldPos) {
        player.money += 4000; // Başlangıç parası
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
    }

    // Hapse Gir Karesi
    if (player.position === 30) {
        player.position = 10; player.inJail = true;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
        io.to(room.id).emit('log', 'Hapse girdi!');
        endTurn(room.id);
        return;
    }

    io.to(room.id).emit('playerMoved', { playerId: player.id, position: player.position });
    const tile = boardData[player.position];

    // KARTLAR
    if (tile.type === 'chance' || tile.type === 'chest') {
        setTimeout(() => drawCard(room, player, tile.type), 1000);
        return;
    }

    // MÜLK İŞLEMLERİ
    if (['property', 'station', 'utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            // Kira Öde
            const rent = calcRent(room, player.position, diceTotal);
            const owner = room.players.find(p => p.id === ownerId);
            if(player.money >= rent) {
                player.money -= rent; owner.money += rent;
                io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
                io.to(room.id).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
                io.to(room.id).emit('log', `${rent}₺ kira ödendi.`);
                io.to(player.id).emit('purchaseSuccess'); // Manuel bitir
            } else {
                handleBankruptcy(room, player, owner.id); // İflas
            }
        } else if (!ownerId && player.money >= tile.price) {
            // Satın Alma Teklifi
            io.to(player.id).emit('offerBuy', tile);
        } else {
            // Boş ama para yetmiyor veya kendi malı
            io.to(player.id).emit('purchaseSuccess');
        }
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(room.id).emit('log', `${tile.price}₺ vergi.`);
        io.to(player.id).emit('purchaseSuccess');
    } else {
        io.to(player.id).emit('purchaseSuccess');
    }
}

function drawCard(room, player, type) {
    const deck = type === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
    const card = deck[Math.floor(Math.random() * deck.length)];
    io.to(room.id).emit('showCard', { type: type === 'chance' ? 'ŞANS' : 'KAMU', text: card.text });
    
    setTimeout(() => {
        if(card.action === 'money') { player.money += card.amount; io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money }); }
        if(card.action === 'move') { movePlayer(room, player, card.target - player.position + (card.target < player.position ? 40 : 0), 0); return; }
        if(card.action === 'jail') { player.position = 10; player.inJail = true; io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 }); endTurn(room.id); return; }
        
        io.to(player.id).emit('purchaseSuccess');
    }, 2000);
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
http.listen(PORT, () => console.log(`🚀 Server Running on ${PORT}`));
