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
const TURN_TIME_LIMIT = 45;

// --- KART DESTELERİ ---
const CHANCE_CARDS = [
    { id: 1, text: "Bankadan 50.000₺ temettü aldın.", action: 'money', amount: 50000 },
    { id: 2, text: "Aşırı hız cezası! 15.000₺ öde.", action: 'money', amount: -15000 },
    { id: 3, text: "İlerleyin: Başlangıç noktasına git.", action: 'move', target: 0 },
    { id: 4, text: "Doğrudan Hapse Git!", action: 'jail' },
    { id: 5, text: "Tüm oyunculara 10.000₺ öde.", action: 'payall', amount: 10000 },
    { id: 6, text: "Yeniköy'e git (Eğer geçersen 200K al).", action: 'move', target: 39 },
    { id: 7, text: "Bankanın hatası! 200.000₺ kazandın.", action: 'money', amount: 200000 },
    { id: 8, text: "Okul masrafları: 50.000₺ öde.", action: 'money', amount: -50000 }
];

const CHEST_CARDS = [
    { id: 1, text: "Doktor masrafı: 50.000₺ öde.", action: 'money', amount: -50000 },
    { id: 2, text: "Vergi iadesi: 20.000₺ al.", action: 'money', amount: 20000 },
    { id: 3, text: "Hapisten Ücretsiz Çıkış Kartı!", action: 'jailcard' }, // Şimdilik para verelim
    { id: 4, text: "Miras kaldı! 100.000₺", action: 'money', amount: 100000 },
    { id: 5, text: "Her oyuncudan 10.000₺ topla.", action: 'collectall', amount: 10000 },
    { id: 6, text: "Doğrudan Hapse Git!", action: 'jail' },
    { id: 7, text: "Hastane masrafları: 100.000₺ öde.", action: 'money', amount: -100000 },
    { id: 8, text: "Emlak vergisi: Her ev için 25.000₺ öde.", action: 'repair', amount: 25000 }
];

const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 1500000, 
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

const calcRent = (room, tileIndex, diceTotal = 0) => {
    const tile = boardData[tileIndex];
    const houses = (room.houseState && room.houseState[tileIndex]) || 0;
    if(tile.type === 'station') {
        const ownerId = room.boardState[tileIndex];
        const owner = room.players.find(p => p.id === ownerId);
        if(!owner) return 25000;
        const stationCount = owner.properties.filter(idx => boardData[idx].type === 'station').length;
        return 25000 * Math.pow(2, stationCount - 1);
    }
    if(tile.type === 'utility') return (diceTotal || 7) * 2000;
    if (tile.rents && tile.rents.length > 0) {
        if (houses > 0 && houses <= 5) return tile.rents[houses];
        return tile.rents[0]; 
    }
    return tile.rent || 0;
};

// --- OYUN AKIŞI ---
const startTurnTimer = (roomId) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'PLAYING') return;
    if (room.timer) clearInterval(room.timer);
    room.timeLeft = TURN_TIME_LIMIT;
    io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, turnId: room.turn });

    room.timer = setInterval(() => {
        room.timeLeft--;
        if(room.timeLeft % 5 === 0 || room.timeLeft <= 10) {
             io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, turnId: room.turn });
        }
        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            handleAutoPass(roomId);
        }
    }, 1000);
};

const handleAutoPass = (roomId) => {
    const room = rooms[roomId];
    if (room) {
        io.to(roomId).emit('log', `⏳ Süre doldu! Pas geçiliyor.`);
        endTurn(roomId);
    }
};

const handleBankruptcy = (room, debtor, creditorId) => {
    debtor.isBankrupt = true;
    debtor.money = 0;
    debtor.properties.forEach(idx => { if(room.houseState) room.houseState[idx] = 0; });

    if (creditorId) {
        const creditor = room.players.find(p => p.id === creditorId);
        if (creditor) {
            debtor.properties.forEach(idx => {
                room.boardState[idx] = creditor.id;
                creditor.properties.push(idx);
            });
            creditor.money += debtor.money;
            io.to(room.id).emit('log', `${debtor.name} iflas etti! Mallar ${creditor.name}'e geçti.`);
        }
    } else {
        debtor.properties.forEach(idx => delete room.boardState[idx]);
        io.to(room.id).emit('log', `${debtor.name} iflas etti! Mallar bankaya.`);
    }
    debtor.properties = [];
    io.to(room.id).emit('playerBankrupt', { bankruptId: debtor.id, boardState: room.boardState });
    
    const active = room.players.filter(p => !p.isBankrupt);
    if(active.length === 1 && room.players.length > 1) {
        if(room.timer) clearInterval(room.timer);
        io.to(room.id).emit('gameOver', { winnerName: active[0].name, winnerMoney: active[0].money });
    }
};

io.on('connection', (socket) => {
    const getList = () => Object.values(rooms).filter(r => r.players.length).map(r => ({ id: r.id, name: r.players[0].name, count: r.players.length, status: r.status }));
    socket.emit('roomList', getList());
    
    socket.on('createRoom', ({ nickname, avatar }) => {
        const id = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[id] = { id, players: [createPlayer(socket.id, nickname, avatar)], status: 'LOBBY', turn: null, boardState: {}, houseState: {}, logs: [], timeLeft: TURN_TIME_LIMIT };
        socket.join(id);
        socket.emit('roomJoined', { roomId: id, isHost: true });
        io.emit('roomList', getList());
    });

    socket.on('joinRoom', ({ roomId, nickname, avatar }) => {
        const room = rooms[roomId];
        if (room && room.status === 'LOBBY' && room.players.length < 4) {
            room.players.push(createPlayer(socket.id, nickname, avatar));
            socket.join(roomId);
            socket.emit('roomJoined', { roomId, isHost: false });
            io.to(roomId).emit('updateLobby', room);
            io.emit('roomList', getList());
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[0].id === socket.id) {
            room.status = 'PLAYING';
            room.turn = room.players[0].id;
            io.to(roomId).emit('gameStarted', room);
            io.emit('roomList', getList());
            startTurnTimer(roomId);
        }
    });

    socket.on('payBail', (roomId) => {
        const room = rooms[roomId];
        if(!room || room.turn !== socket.id) return;
        const p = room.players.find(x => x.id === socket.id);
        if(p && p.inJail && p.money >= 50000) {
            p.money -= 50000; p.inJail = false; p.jailTurns = 0;
            io.to(roomId).emit('moneyUpdate', { playerId: p.id, money: p.money });
            io.to(roomId).emit('log', `${p.name} kefalet ödeyip çıktı!`);
            socket.emit('bailPaid'); 
        }
    });

    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;
        if(room.timer) clearInterval(room.timer);

        const p = room.players.find(x => x.id === socket.id);
        const d1 = Math.floor(Math.random()*6)+1, d2 = Math.floor(Math.random()*6)+1;
        const total = d1 + d2;
        io.to(roomId).emit('diceRolled', { die1: d1, die2: d2, playerId: socket.id });

        if(p.inJail) {
            if(d1===d2) { 
                p.inJail=false; p.jailTurns=0; 
                io.to(roomId).emit('log', `${p.name} çift attı ve çıktı!`);
                movePlayer(room, p, total, total); 
            } else { 
                p.jailTurns++; 
                if(p.jailTurns>=3) { 
                    p.money-=50000; p.inJail=false; 
                    io.to(roomId).emit('log', `${p.name} zorunlu kefalet ödedi.`);
                    movePlayer(room, p, total, total); 
                } else { 
                    io.to(roomId).emit('log', `${p.name} hapiste.`);
                    endTurn(roomId); 
                }
            }
        } else {
            movePlayer(room, p, total, total);
            if(d1===d2 && !p.isBankrupt && !p.inJail) { 
                io.to(roomId).emit('allowReRoll'); 
                startTurnTimer(roomId);
            } else {
                // Manuel bitirme için bekle
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

    socket.on('upgradeProperty', ({ roomId, tileIndex }) => {
        const room = rooms[roomId];
        if(!room || room.turn !== socket.id) return;
        const p = room.players.find(x => x.id === socket.id);
        const tile = boardData[tileIndex];
        if (room.boardState[tileIndex] !== p.id) return;
        if (!hasFullGroup(room, p, tile.group)) return;
        if (p.money < tile.houseCost) return;
        if (!room.houseState) room.houseState = {};
        const currentLevel = room.houseState[tileIndex] || 0;
        if (currentLevel >= 5) return;

        p.money -= tile.houseCost;
        room.houseState[tileIndex] = currentLevel + 1;
        io.to(roomId).emit('propertyUpgraded', { tileIndex, level: room.houseState[tileIndex], playerId: p.id, money: p.money });
        io.to(roomId).emit('log', `${p.name}, ${tile.name} geliştirdi.`);
    });

    socket.on('endTurn', (roomId) => endTurn(roomId));
    
    socket.on('disconnect', () => {
        // Oda temizleme mantığı (basitleştirilmiş)
        Object.keys(rooms).forEach(rid => {
            const r = rooms[rid];
            const idx = r.players.findIndex(p => p.id === socket.id);
            if(idx !== -1) {
                if(r.status === 'LOBBY') r.players.splice(idx, 1);
                // Oyun başladıysa sadece bağlantı kopar
                
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
    
    if (player.position === 30) { 
        player.position = 10; player.inJail = true;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
        io.to(room.id).emit('log', `${player.name} Hapse girdi!`);
        endTurn(room.id);
        return;
    }
    
    io.to(room.id).emit('playerMoved', { playerId: player.id, position: player.position });
    
    const tile = boardData[player.position];
    
    // --- KART ÇEKME MANTIĞI (YENİ) ---
    if (tile.type === 'chance' || tile.type === 'chest') {
        setTimeout(() => {
            drawCard(room, player, tile.type);
        }, 1000); // Piyon yerine otursun diye bekle
        return;
    }

    if (['property','station','utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            const rent = calcRent(room, player.position, diceTotal);
            const owner = room.players.find(p => p.id === ownerId);
            if (player.money >= rent) {
                player.money -= rent; owner.money += rent;
                io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
                io.to(room.id).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
                io.to(room.id).emit('log', `${player.name}, ${rent}₺ kira ödedi.`);
                // Kira ödeyen de manuel bitirsin
                io.to(player.id).emit('purchaseSuccess'); 
            } else {
                handleBankruptcy(room, player, owner.id);
            }
        } else if (!ownerId && player.money >= tile.price) {
            io.to(player.id).emit('offerBuy', tile);
        } else {
             // Satın alamazsa veya boşsa
             io.to(player.id).emit('purchaseSuccess'); // Turu bitirebilsin
        }
    } else if (tile.type === 'tax') {
        if(player.money>=tile.price) { 
            player.money-=tile.price; 
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
            io.to(room.id).emit('log', `${player.name} vergi ödedi.`);
            io.to(player.id).emit('purchaseSuccess');
        } else handleBankruptcy(room, player);
    } else {
        // Köşe taşları (Başlangıç, Otopark vb.)
        io.to(player.id).emit('purchaseSuccess');
    }
}

// Kart Çekme ve İşleme
function drawCard(room, player, type) {
    const deck = type === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
    const card = deck[Math.floor(Math.random() * deck.length)];
    
    // Kartı göster
    io.to(room.id).emit('showCard', { type: type === 'chance' ? 'ŞANS' : 'KAMU FONU', text: card.text });
    io.to(room.id).emit('log', `${player.name} kart çekti: ${card.text}`);

    setTimeout(() => {
        applyCardEffect(room, player, card);
        // Kart işlemi bitince turu bitirme butonu aktif olsun
        io.to(player.id).emit('purchaseSuccess');
    }, 2000); // Kartı okusunlar
}

function applyCardEffect(room, player, card) {
    if (card.action === 'money') {
        player.money += card.amount;
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
    } 
    else if (card.action === 'move') {
        // İleri gitme
        const current = player.position;
        let dist = card.target - current;
        if (dist < 0) dist += 40; // Dönüp geçiyorsa
        movePlayer(room, player, dist, 0);
    }
    else if (card.action === 'jail') {
        player.position = 10; player.inJail = true;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
        io.to(room.id).emit('log', 'Hapse gönderildi!');
        endTurn(room.id); // Hapis hemen bitirir
    }
    else if (card.action === 'payall') {
        room.players.forEach(p => {
            if(p.id !== player.id && !p.isBankrupt) {
                player.money -= card.amount;
                p.money += card.amount;
                io.to(room.id).emit('moneyUpdate', { playerId: p.id, money: p.money });
            }
        });
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
    }
    else if (card.action === 'collectall') {
        room.players.forEach(p => {
            if(p.id !== player.id && !p.isBankrupt) {
                p.money -= card.amount;
                player.money += card.amount;
                io.to(room.id).emit('moneyUpdate', { playerId: p.id, money: p.money });
            }
        });
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
    }
    else if (card.action === 'repair') {
        // Ev başına para (Basit hesap: Toplam tapu sayısına göre de olabilir, ama houseState lazım)
        let totalCost = 0;
        player.properties.forEach(idx => {
            const h = (room.houseState && room.houseState[idx]) || 0;
            totalCost += h * card.amount;
        });
        player.money -= totalCost;
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
    }
}

function endTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    if(room.timer) clearInterval(room.timer);
    
    let nextIdx = (room.players.findIndex(p => p.id === room.turn) + 1) % room.players.length;
    let loopCount = 0;
    while(room.players[nextIdx].isBankrupt && loopCount < 4) {
        nextIdx = (nextIdx + 1) % room.players.length;
        loopCount++;
    }
    room.turn = room.players[nextIdx].id;
    io.to(roomId).emit('turnChanged', room.turn);
    startTurnTimer(roomId);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server Running on ${PORT}`));
