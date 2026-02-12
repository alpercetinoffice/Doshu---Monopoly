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

// GLOBAL DEĞİŞKENLER
let rooms = {};
const TURN_TIME_LIMIT = 30; // Saniye

// --- YARDIMCI FONKSİYONLAR ---

const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 1500000, // 1.5M Başlangıç
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false,
    jailTurns: 0,
    isBankrupt: false
});

const getRoomList = () => {
    return Object.values(rooms)
        .filter(r => r.players && r.players.length > 0)
        .map(r => ({
            id: r.id,
            name: r.players[0].name + "'in Odası",
            count: r.players.length,
            status: r.status
        }));
};

const getNextTurn = (room) => {
    const activePlayers = room.players.filter(p => !p.isBankrupt);
    if (activePlayers.length === 0) return null;

    let currentIndex = room.players.findIndex(p => p.id === room.turn);
    let nextIndex = (currentIndex + 1) % room.players.length;
    
    // İflas etmiş oyuncuları atla
    while (room.players[nextIndex].isBankrupt) {
        nextIndex = (nextIndex + 1) % room.players.length;
    }
    
    return room.players[nextIndex].id;
};

// --- TIMER YÖNETİMİ (YENİ) ---
const startTurnTimer = (roomId) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'PLAYING') return;

    // Varsa eski sayacı temizle
    if (room.timer) clearInterval(room.timer);

    room.timeLeft = TURN_TIME_LIMIT;
    
    // İlk süreyi gönder
    io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, turnId: room.turn });

    room.timer = setInterval(() => {
        room.timeLeft--;
        
        // Her saniye güncelleme göndermek yerine kritik zamanlarda veya 5 saniyede bir gönder
        // (Ağ trafiğini azaltmak için)
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
    if (!room) return;
    
    const player = room.players.find(p => p.id === room.turn);
    if (player) {
        io.to(roomId).emit('log', `⏳ Süre doldu! ${player.name} pas geçildi.`);
        endTurn(roomId);
    }
};

// --- OYUN MANTIĞI (İFLAS & KAZANMA) ---

const handleBankruptcy = (room, debtor, creditorId = null) => {
    console.log(`💸 İFLAS: ${debtor.name}`);
    debtor.isBankrupt = true;
    debtor.money = 0;

    if (creditorId) {
        const creditor = room.players.find(p => p.id === creditorId);
        if (creditor) {
            debtor.properties.forEach(propIndex => {
                room.boardState[propIndex] = creditor.id;
                creditor.properties.push(propIndex);
            });
            creditor.money += debtor.money;
            io.to(room.id).emit('log', `${debtor.name} iflas etti! Malları ${creditor.name}'e geçti.`);
        }
    } else {
        debtor.properties.forEach(propIndex => delete room.boardState[propIndex]);
        io.to(room.id).emit('log', `${debtor.name} iflas etti! Malları bankaya döndü.`);
    }

    debtor.properties = [];
    
    io.to(room.id).emit('playerBankrupt', { 
        bankruptId: debtor.id, 
        creditorId: creditorId,
        boardState: room.boardState 
    });

    checkWinCondition(room);
};

const checkWinCondition = (room) => {
    const activePlayers = room.players.filter(p => !p.isBankrupt);
    if (activePlayers.length === 1 && room.players.length > 1) {
        const winner = activePlayers[0];
        room.status = 'FINISHED';
        if(room.timer) clearInterval(room.timer); // Sayacı durdur
        
        io.to(room.id).emit('gameOver', { 
            winnerName: winner.name, 
            winnerAvatar: winner.avatar,
            winnerMoney: winner.money
        });
    }
};

// --- SOCKET EVENTS ---

io.on('connection', (socket) => {
    socket.emit('roomList', getRoomList());
    socket.on('getRooms', () => socket.emit('roomList', getRoomList()));

    socket.on('createRoom', ({ nickname, avatar }) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: [createPlayer(socket.id, nickname, avatar)],
            status: 'LOBBY',
            turn: null,
            boardState: {}, 
            logs: [],
            timeLeft: TURN_TIME_LIMIT
        };
        socket.join(roomId);
        socket.emit('roomJoined', { roomId: roomId, isHost: true });
        io.emit('roomList', getRoomList());
    });

    socket.on('joinRoom', ({ roomId, nickname, avatar }) => {
        const room = rooms[roomId];
        if (room && room.status === 'LOBBY' && room.players.length < 4) {
            room.players.push(createPlayer(socket.id, nickname, avatar));
            socket.join(roomId);
            socket.emit('roomJoined', { roomId: roomId, isHost: false });
            io.to(roomId).emit('updateLobby', room);
            io.emit('roomList', getRoomList());
        } else {
            socket.emit('error', 'Oda yok veya dolu.');
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[0].id === socket.id) {
            room.status = 'PLAYING';
            room.turn = room.players[0].id;
            io.to(roomId).emit('gameStarted', room);
            io.emit('roomList', getRoomList());
            startTurnTimer(roomId); // SAYAÇ BAŞLAT
        }
    });

    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;
        
        // ZAR ATILDIĞI AN SAYACI DURDUR (Animasyon süresince timeout olmasın)
        if(room.timer) clearInterval(room.timer);

        const player = room.players.find(p => p.id === socket.id);
        if (player.isBankrupt) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;

        io.to(roomId).emit('diceRolled', { die1, die2, playerId: socket.id });
        
        if (player.inJail) {
             if (die1 === die2) {
                player.inJail = false; player.jailTurns = 0;
                io.to(roomId).emit('log', `${player.name} çift attı ve çıktı!`);
                movePlayer(room, player, total);
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    if (player.money >= 50000) {
                        player.money -= 50000;
                        player.inJail = false;
                        io.to(roomId).emit('log', `${player.name} kefaletle çıktı.`);
                        movePlayer(room, player, total);
                    } else {
                        handleBankruptcy(room, player, null);
                        endTurn(roomId);
                        return;
                    }
                } else {
                    io.to(roomId).emit('log', `${player.name} hapiste kaldı.`);
                    endTurn(roomId);
                }
            }
        } else {
            movePlayer(room, player, total);
            
            if (!player.isBankrupt) {
                if (die1 === die2) {
                     io.to(roomId).emit('log', `${player.name} çift attı!`);
                     io.to(roomId).emit('allowReRoll');
                     // Çift atarsa tekrar süre başlat
                     startTurnTimer(roomId);
                } else {
                    // Animasyon payı bırakıp sırayı devret
                    setTimeout(() => endTurn(roomId), 1500);
                }
            }
        }
    });

    socket.on('buyProperty', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;
        
        const p = room.players.find(x => x.id === socket.id);
        const tile = boardData[p.position];

        if (tile.price && p.money >= tile.price && !room.boardState[p.position]) {
            p.money -= tile.price;
            p.properties.push(p.position);
            room.boardState[p.position] = p.id;
            
            io.to(roomId).emit('propertyBought', { playerId: p.id, tileIndex: p.position, money: p.money });
            io.to(roomId).emit('log', `${p.name}, ${tile.name} tapusunu aldı.`);
            endTurn(roomId);
        }
    });

    socket.on('endTurn', (roomId) => endTurn(roomId));
    
    socket.on('disconnect', () => {
        // İleride buraya Reconnect eklenecek
    });
});

function movePlayer(room, player, steps) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;

    if (player.position < oldPos) {
        player.money += 200000;
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(room.id).emit('log', `${player.name} turu tamamladı (+200K).`);
    }

    if (player.position === 30) {
        player.position = 10;
        player.inJail = true;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
        io.to(room.id).emit('log', `${player.name} Hapse girdi!`);
        endTurn(room.id);
        return;
    }

    io.to(room.id).emit('playerMoved', { playerId: player.id, position: player.position });
    
    const tile = boardData[player.position];
    
    if (['property', 'station', 'utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        if (ownerId && ownerId !== player.id) {
            const owner = room.players.find(p => p.id === ownerId);
            const rent = tile.rent || 10000; 
            
            if (player.money >= rent) {
                player.money -= rent;
                owner.money += rent;
                io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
                io.to(room.id).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
                io.to(room.id).emit('log', `${player.name}, ${rent}₺ kira ödedi.`);
            } else {
                handleBankruptcy(room, player, owner.id);
            }
        } else if (!ownerId) {
            if (player.money >= tile.price) io.to(player.id).emit('offerBuy', tile);
        }
    } else if (tile.type === 'tax') {
        if (player.money >= tile.price) {
            player.money -= tile.price;
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        } else {
            handleBankruptcy(room, player, null);
        }
    }
}

function endTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    
    // Eski sayacı durdur
    if(room.timer) clearInterval(room.timer);

    room.turn = getNextTurn(room);
    
    if (room.turn) {
        io.to(room.id).emit('turnChanged', room.turn);
        startTurnTimer(roomId); // YENİ OYUNCU İÇİN SAYAÇ BAŞLAT
    }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server Running on ${PORT}`));
