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
const TURN_TIME_LIMIT = 45; // Süreyi biraz artırdım, rahat oynansın

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

const hasFullGroup = (room, player, group) => {
    if (!group) return false;
    const groupTiles = boardData.filter(t => t.group === group).map(t => t.index);
    const ownedInGroup = player.properties.filter(idx => {
        const tile = boardData[idx];
        return tile.group === group;
    });
    return groupTiles.length === ownedInGroup.length;
};

// KİRA HESAPLAMA (Gelişmiş)
const calcRent = (room, tileIndex, diceTotal = 0) => {
    const tile = boardData[tileIndex];
    const houses = (room.houseState && room.houseState[tileIndex]) || 0;
    
    // İSTASYONLAR (Sahip olunan istasyon sayısına göre artar)
    if(tile.type === 'station') {
        const ownerId = room.boardState[tileIndex];
        const owner = room.players.find(p => p.id === ownerId);
        if(!owner) return 25000;
        
        // Sahibinin kaç istasyonu var?
        const stationCount = owner.properties.filter(idx => boardData[idx].type === 'station').length;
        return 25000 * Math.pow(2, stationCount - 1); // 25k, 50k, 100k, 200k
    }

    // FATURALAR (Elektrik/Su)
    if(tile.type === 'utility') {
        // Zarın 4 katı veya 10 katı (basitlik için sabit yüksek tutar yapalım veya zarla çarpalım)
        // Gerçek Monopoly'de: 1 taneyse Zar x 4, 2 taneyse Zar x 10.
        // Biz burada basitleştirip "Zar x 1000" yapalım ki hissedilsin.
        return (diceTotal || 7) * 2000; 
    }

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
        rooms[id] = { 
            id, 
            players: [createPlayer(socket.id, nickname, avatar)], 
            status: 'LOBBY', turn: null, boardState: {}, houseState: {}, 
            logs: [], timeLeft: TURN_TIME_LIMIT 
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

    // --- HAPİSTEN KEFALETLE ÇIKMA ---
    socket.on('payBail', (roomId) => {
        const room = rooms[roomId];
        if(!room || room.turn !== socket.id) return;
        
        const p = room.players.find(x => x.id === socket.id);
        if(p && p.inJail && p.money >= 50000) {
            p.money -= 50000;
            p.inJail = false;
            p.jailTurns = 0;
            
            io.to(roomId).emit('moneyUpdate', { playerId: p.id, money: p.money });
            io.to(roomId).emit('log', `${p.name} 50K kefalet ödeyip özgür kaldı!`);
            // Kefalet ödeyince hemen zar atabilsin diye client'a bildir
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
                movePlayer(room, p, total, total); // Zar toplamını gönderiyoruz
            } else { 
                p.jailTurns++; 
                if(p.jailTurns>=3) { 
                    p.money-=50000; p.inJail=false; 
                    io.to(roomId).emit('log', `${p.name} 3 turdur çıkamadı, zorunlu kefalet ödendi.`);
                    movePlayer(room, p, total, total); 
                } else { 
                    io.to(roomId).emit('log', `${p.name} hapiste kaldı.`);
                    endTurn(roomId); 
                }
            }
        } else {
            movePlayer(room, p, total, total);
            if(d1===d2 && !p.isBankrupt && !p.inJail) { 
                io.to(roomId).emit('allowReRoll'); 
                startTurnTimer(roomId);
            } else {
                // Manuel bitirme için timer'ı durdurmuyoruz, buton bekliyoruz
                // Ama oyuncu unutursa diye süre işlemeye devam ediyor.
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
            io.to(roomId).emit('log', `${p.name}, ${tile.name} mülkünü aldı.`);
            
            // DİKKAT: Burada endTurn'ü sildim! Oyuncu butona basmalı.
            socket.emit('purchaseSuccess'); // Client'a butonları güncellemesi için sinyal
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
        
        io.to(roomId).emit('propertyUpgraded', { 
            tileIndex, level: room.houseState[tileIndex], playerId: p.id, money: p.money
        });
        const type = room.houseState[tileIndex] === 5 ? 'OTEL' : 'EV';
        io.to(roomId).emit('log', `${p.name}, ${tile.name} bölgesine ${type} kurdu.`);
    });

    socket.on('endTurn', (roomId) => endTurn(roomId));

    // --- SORUN ÇÖZÜMÜ 1: ODA TEMİZLİĞİ ---
    socket.on('disconnect', () => {
        // Hangi odada olduğunu bul
        let roomToDelete = null;
        Object.keys(rooms).forEach(roomId => {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                // Oyuncuyu odadan çıkar (Ama oyun kopmasın diye "offline" işaretlemek daha iyi olurdu, şimdilik siliyoruz)
                // Gerçekçi oyunlarda reconnect için silinmez. Ama "Oda boş kalınca" silinmesi istendi.
                
                // Eğer LOBİ aşamasındaysa direkt sil
                if (room.status === 'LOBBY') {
                    room.players.splice(playerIndex, 1);
                } else {
                    // Oyun başladıysa oyuncuyu "Bot" veya "Offline" yapabiliriz.
                    // Şimdilik isteğine uygun olarak: Herkes çıkarsa odayı sil.
                }

                // Odada kimse kalmadı mı?
                const activePlayers = io.sockets.adapter.rooms.get(roomId);
                // Socket.io room'u boşalınca otomatik silinir ama bizim 'rooms' objesinden de silmeliyiz.
                
                // Bizim objemizde oyuncu sayısını kontrol et
                // (Not: Yukarıda splice yapmadık oyun içi kopmalarda, sadece bağlantı koptu)
                
                // Basit çözüm: Eğer bu socket host ise ve odada başka socket yoksa sil.
                // Daha güvenli çözüm: Periyodik temizlik veya anlık kontrol.
                
                setTimeout(() => {
                    const roomSockets = io.sockets.adapter.rooms.get(roomId);
                    if (!roomSockets || roomSockets.size === 0) {
                        delete rooms[roomId];
                        console.log(`🧹 Oda silindi: ${roomId}`);
                        io.emit('roomList', getList());
                    }
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
    
    // HAPİS KONTROLÜ
    if (player.position === 30) { // Hapse Gir karesi
        player.position = 10; player.inJail = true;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
        io.to(room.id).emit('log', `${player.name} Hapse girdi!`);
        endTurn(room.id);
        return;
    }
    
    io.to(room.id).emit('playerMoved', { playerId: player.id, position: player.position });
    
    const tile = boardData[player.position];
    if (['property','station','utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            // DÜZELTME: Zar toplamını gönderiyoruz (Fatura hesabı için)
            const rent = calcRent(room, player.position, diceTotal);
            const owner = room.players.find(p => p.id === ownerId);
            
            if (player.money >= rent) {
                player.money -= rent;
                owner.money += rent;
                io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
                io.to(room.id).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
                io.to(room.id).emit('log', `${player.name}, ${rent}₺ kira/fatura ödedi.`);
                // Kira ödedikten sonra pas butonu görünsün diye işlem yok, timeout ile sıra geçebilir veya manuel.
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
            io.to(room.id).emit('log', `${player.name} ${tile.price}₺ vergi ödedi.`);
        } else handleBankruptcy(room, player);
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
