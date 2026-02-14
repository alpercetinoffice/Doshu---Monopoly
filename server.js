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
const TURN_TIME_LIMIT = 30; // 30 Saniye Kuralı

// --- KART DESTELERİ ---
const CHANCE_CARDS = [
    { text: "Bankadan 10.000₺ temettü aldın.", action: 'money', amount: 10000 },
    { text: "Aşırı hız cezası! 5.000₺ öde.", action: 'money', amount: -5000 },
    { text: "Başlangıç noktasına git (20.000₺ Al).", action: 'move', target: 0 },
    { text: "Doğrudan Hapse Git!", action: 'jail' },
    { text: "Tüm oyunculara 1.000₺ öde.", action: 'payall', amount: 1000 },
    { text: "Yeniköy'e git.", action: 'move', target: 39 },
];

const CHEST_CARDS = [
    { text: "Doktor masrafı: 5.000₺ öde.", action: 'money', amount: -5000 },
    { text: "Vergi iadesi: 2.000₺ al.", action: 'money', amount: 2000 },
    { text: "Miras kaldı! 10.000₺", action: 'money', amount: 10000 },
    { text: "Her oyuncudan 1.000₺ topla.", action: 'collectall', amount: 1000 },
    { text: "Doğrudan Hapse Git!", action: 'jail' },
    { text: "Tadilat masrafı: Ev başına 2.500₺ öde.", action: 'repair', amount: 2500 }
];

const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 200000, // Başlangıç parası dengelendi
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false, jailTurns: 0, isBankrupt: false
});

const calcRent = (room, tileIndex, diceTotal) => {
    const tile = boardData[tileIndex];
    const houses = (room.houseState && room.houseState[tileIndex]) || 0;
    
    if(tile.type === 'station') {
        const ownerId = room.boardState[tileIndex];
        const owner = room.players.find(p => p.id === ownerId);
        if(!owner) return 5000;
        const count = owner.properties.filter(idx => boardData[idx].type === 'station').length;
        return 5000 * Math.pow(2, count - 1);
    }
    if(tile.type === 'utility') return (diceTotal || 7) * 400; // Zar x 400
    if (tile.rents && tile.rents.length > 0) {
        return houses > 0 ? tile.rents[houses] : tile.rents[0];
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
            endTurn(roomId); // Süre bitince otomatik pas
        }
    }, 1000);
};

const handleBankruptcy = (room, debtor, creditorId) => {
    debtor.isBankrupt = true;
    debtor.money = 0;
    debtor.properties.forEach(idx => { if(room.houseState) room.houseState[idx] = 0; });
    
    if(creditorId) {
        const creditor = room.players.find(p => p.id === creditorId);
        if(creditor) {
            debtor.properties.forEach(idx => {
                room.boardState[idx] = creditor.id;
                creditor.properties.push(idx);
            });
            creditor.money += debtor.money;
        }
    } else {
        debtor.properties.forEach(idx => delete room.boardState[idx]);
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
        const p = room.players.find(x => x.id === socket.id);
        if(p && p.inJail && p.money >= 10000) {
            p.money -= 10000; p.inJail = false; p.jailTurns = 0;
            io.to(roomId).emit('moneyUpdate', { playerId: p.id, money: p.money });
            io.to(roomId).emit('log', `${p.name} 10K kefalet ödeyip çıktı!`);
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
                    p.money-=10000; p.inJail=false; 
                    io.to(roomId).emit('log', `${p.name} zorunlu kefalet (10K) ödedi.`);
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
        const p = room.players.find(x => x.id === socket.id);
        const tile = boardData[tileIndex];
        if (room.boardState[tileIndex] !== p.id) return;
        if (p.money < tile.houseCost) return;
        
        if (!room.houseState) room.houseState = {};
        const currentLevel = room.houseState[tileIndex] || 0;
        if (currentLevel >= 5) return;

        p.money -= tile.houseCost;
        room.houseState[tileIndex] = currentLevel + 1;
        io.to(roomId).emit('propertyUpgraded', { tileIndex, level: room.houseState[tileIndex], playerId: p.id, money: p.money });
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
                   if(!s || s.size === 0) { delete rooms[rid]; io.emit('roomList', getList()); }
                }, 1000);
            }
        });
    });
});

function movePlayer(room, player, steps, diceTotal) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    if (player.position < oldPos) {
        player.money += 20000;
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
    }
    
    if (player.position === 30) { // HAPSE GİR KARESİ
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
        setTimeout(() => { drawCard(room, player, tile.type); }, 1500);
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
                io.to(player.id).emit('purchaseSuccess'); 
            } else {
                handleBankruptcy(room, player, owner.id);
            }
        } else if (!ownerId && player.money >= tile.price) {
            io.to(player.id).emit('offerBuy', tile);
        } else {
             io.to(player.id).emit('purchaseSuccess'); 
        }
    } else if (tile.type === 'tax') {
        if(player.money>=tile.price) { 
            player.money-=tile.price; 
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
            io.to(player.id).emit('purchaseSuccess');
        } else handleBankruptcy(room, player);
    } else {
        io.to(player.id).emit('purchaseSuccess');
    }
}

function drawCard(room, player, type) {
    const deck = type === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
    const card = deck[Math.floor(Math.random() * deck.length)];
    io.to(room.id).emit('showCard', { type: type === 'chance' ? 'ŞANS' : 'KAMU FONU', text: card.text });

    setTimeout(() => {
        if (card.action === 'money') { player.money += card.amount; io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money }); } 
        else if (card.action === 'move') { 
            let dist = card.target - player.position; 
            if (dist < 0) dist += 40; 
            movePlayer(room, player, dist, 0); 
            return; 
        }
        else if (card.action === 'jail') { 
            player.position = 10; player.inJail = true; 
            io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 }); 
            endTurn(room.id); return; 
        }
        else if (card.action === 'payall') {
            room.players.forEach(p => { if(p.id !== player.id) { player.money -= card.amount; p.money += card.amount; io.to(room.id).emit('moneyUpdate', { playerId: p.id, money: p.money }); } });
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        }
        else if (card.action === 'collectall') {
            room.players.forEach(p => { if(p.id !== player.id) { p.money -= card.amount; player.money += card.amount; io.to(room.id).emit('moneyUpdate', { playerId: p.id, money: p.money }); } });
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        }
        io.to(player.id).emit('purchaseSuccess');
    }, 2000);
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
