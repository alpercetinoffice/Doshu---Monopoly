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
const TURN_TIME_LIMIT = 30;

// --- YARDIMCI FONKSİYONLAR ---
const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 1500000, 
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false,
    jailTurns: 0,
    isBankrupt: false
});

// Oyuncunun renk grubunun tamamına sahip olup olmadığını kontrol et
const hasFullGroup = (room, player, group) => {
    if (!group) return false;
    // O gruptaki tüm tapuların indexleri
    const groupTiles = boardData.filter(t => t.group === group).map(t => t.index);
    // Oyuncunun sahip olduğu o gruptaki tapular
    const ownedInGroup = player.properties.filter(idx => {
        const tile = boardData[idx];
        return tile.group === group;
    });
    return groupTiles.length === ownedInGroup.length;
};

// Kirayı hesapla (Ev durumuna göre)
const calcRent = (room, tileIndex) => {
    const tile = boardData[tileIndex];
    // Ev sayısı (boardState içinde houseCount olarak tutulacak)
    // boardState artık { tileIndex: ownerId } yerine { tileIndex: { owner: id, houses: 0 } } olmalıydı
    // ANCAK geriye dönük uyumluluk için boardState'i değiştirmek yerine
    // yeni bir `houseState` objesi açalım.
    
    const houses = (room.houseState && room.houseState[tileIndex]) || 0;
    
    // Eğer istasyon veya kamu hizmeti ise
    if(tile.type === 'station') return 25000; // Şimdilik sabit (İleride miktar arttırılabilir)
    if(tile.type === 'utility') return 0; // Zar ile hesaplanıyor (şimdilik 0)

    if (tile.rents && tile.rents.length > 0) {
        // Ev varsa ev kirası
        if (houses > 0 && houses <= 5) return tile.rents[houses];
        // Ev yoksa arsa kirası
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
    
    // Evleri bankaya sat (Yıkılır)
    debtor.properties.forEach(idx => {
        if(room.houseState) room.houseState[idx] = 0;
    });

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
    
    // Kazanma Kontrolü
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
        rooms[id] = { 
            id, 
            players: [createPlayer(socket.id, nickname, avatar)], 
            status: 'LOBBY', 
            turn: null, 
            boardState: {}, // { tileIndex: ownerId }
            houseState: {}, // { tileIndex: houseCount (1-5) } -> 5 = Hotel
            logs: [], timeLeft: 30 
        };
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

    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;
        if(room.timer) clearInterval(room.timer);

        const p = room.players.find(x => x.id === socket.id);
        const d1 = Math.floor(Math.random()*6)+1, d2 = Math.floor(Math.random()*6)+1;
        io.to(roomId).emit('diceRolled', { die1: d1, die2: d2, playerId: socket.id });

        if(p.inJail) {
            if(d1===d2) { p.inJail=false; p.jailTurns=0; movePlayer(room, p, d1+d2); }
            else { 
                p.jailTurns++; 
                if(p.jailTurns>=3) { p.money-=50000; p.inJail=false; movePlayer(room, p, d1+d2); } 
                else { endTurn(roomId); }
            }
        } else {
            movePlayer(room, p, d1+d2);
            if(d1===d2 && !p.isBankrupt) { 
                io.to(roomId).emit('allowReRoll'); 
                startTurnTimer(roomId);
            } else {
                setTimeout(() => endTurn(roomId), 1500);
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
            endTurn(roomId);
        }
    });

    // --- YENİ: EV KURMA ---
    socket.on('upgradeProperty', ({ roomId, tileIndex }) => {
        const room = rooms[roomId];
        if(!room || room.turn !== socket.id) return; // Sadece kendi sırasında yapabilsin
        
        const p = room.players.find(x => x.id === socket.id);
        const tile = boardData[tileIndex];

        // Kontroller
        // 1. Mülk onun mu?
        if (room.boardState[tileIndex] !== p.id) return;
        
        // 2. Set tamam mı?
        if (!hasFullGroup(room, p, tile.group)) {
             socket.emit('error', 'Seti tamamlamadan ev kuramazsın!');
             return;
        }

        // 3. Para var mı?
        if (p.money < tile.houseCost) return;

        // 4. Seviye kontrol (Max 5 = Otel)
        if (!room.houseState) room.houseState = {};
        const currentLevel = room.houseState[tileIndex] || 0;
        
        if (currentLevel >= 5) {
            socket.emit('error', 'Buraya daha fazla kuramazsın!');
            return;
        }

        // İŞLEM
        p.money -= tile.houseCost;
        room.houseState[tileIndex] = currentLevel + 1;
        
        io.to(roomId).emit('propertyUpgraded', { 
            tileIndex, 
            level: room.houseState[tileIndex], 
            playerId: p.id,
            money: p.money
        });
        
        const type = room.houseState[tileIndex] === 5 ? 'OTEL' : 'EV';
        io.to(roomId).emit('log', `${p.name}, ${tile.name} bölgesine ${type} kurdu.`);
    });

    socket.on('endTurn', (roomId) => endTurn(roomId));
});

function movePlayer(room, player, steps) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    if (player.position < oldPos) {
        player.money += 200000;
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
    }
    if (player.position === 30) {
        player.position = 10; player.inJail = true;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
        io.to(room.id).emit('log', 'Hapse girdi!');
        endTurn(room.id);
        return;
    }
    
    io.to(room.id).emit('playerMoved', { playerId: player.id, position: player.position });
    
    const tile = boardData[player.position];
    if (['property','station'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            // YENİ KİRA HESABI
            const rent = calcRent(room, player.position);
            const owner = room.players.find(p => p.id === ownerId);
            
            if (player.money >= rent) {
                player.money -= rent;
                owner.money += rent;
                io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
                io.to(room.id).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
                io.to(room.id).emit('log', `${player.name}, ${rent}₺ kira ödedi.`);
            } else {
                handleBankruptcy(room, player, owner.id);
            }
        } else if (!ownerId && player.money >= tile.price) {
            io.to(player.id).emit('offerBuy', tile);
        }
    } else if (tile.type === 'tax') {
        if(player.money>=tile.price) { 
            player.money-=tile.price; 
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        } else handleBankruptcy(room, player);
    }
}

function endTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    if(room.timer) clearInterval(room.timer);
    
    // Sıradaki aktif oyuncuyu bul
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
