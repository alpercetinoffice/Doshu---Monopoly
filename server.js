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

const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 1500000, // YENİ BAŞLANGIÇ PARASI (1.5M)
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false,
    jailTurns: 0,
    isBankrupt: false // İflas durumu eklendi
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
    // Sadece iflas etmemiş oyuncular arasında dön
    const activePlayers = room.players.filter(p => !p.isBankrupt);
    if (activePlayers.length === 0) return null;

    let currentIndex = room.players.findIndex(p => p.id === room.turn);
    let nextIndex = (currentIndex + 1) % room.players.length;
    
    // Sıradaki kişi iflas etmişse atla
    while (room.players[nextIndex].isBankrupt) {
        nextIndex = (nextIndex + 1) % room.players.length;
    }
    
    return room.players[nextIndex].id;
};

// === İFLAS ve OYUN SONU MANTIĞI ===
const handleBankruptcy = (room, debtor, creditorId = null) => {
    console.log(`💸 İFLAS: ${debtor.name} iflas etti!`);
    debtor.isBankrupt = true;
    debtor.money = 0;

    // Varlıkları temizle veya devret
    if (creditorId) {
        // Alacaklıya devret (Oyuncuya borçlu battıysa)
        const creditor = room.players.find(p => p.id === creditorId);
        if (creditor) {
            debtor.properties.forEach(propIndex => {
                room.boardState[propIndex] = creditor.id;
                creditor.properties.push(propIndex);
                // Tapu transferini görselleştir (Client tarafında halledilecek)
            });
            creditor.money += debtor.money; // Kalan kuruşları da ver
            io.to(room.id).emit('log', `${debtor.name} iflas etti! Tüm malları ${creditor.name}'e geçti.`);
        }
    } else {
        // Bankaya battıysa (Vergi vb.)
        debtor.properties.forEach(propIndex => {
            delete room.boardState[propIndex]; // Mülk boşa çıkar
        });
        io.to(room.id).emit('log', `${debtor.name} iflas etti! Malları bankaya döndü.`);
    }

    debtor.properties = []; // Mülk listesini boşalt
    
    // İstemciye bildir (Oyuncuyu gri yap, mülkleri güncelle)
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
        // KAZANAN BELLİ!
        const winner = activePlayers[0];
        room.status = 'FINISHED';
        io.to(room.id).emit('gameOver', { 
            winnerName: winner.name, 
            winnerAvatar: winner.avatar,
            winnerMoney: winner.money
        });
        console.log(`🏆 OYUN BİTTİ! Kazanan: ${winner.name}`);
    }
};

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
            logs: []
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
            socket.emit('error', 'Hata: Oda yok veya dolu.');
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

        const p = room.players.find(p => p.id === socket.id);
        if (p.isBankrupt) return; // İflas eden oynayamaz

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        // const die1 = 100; const die2 = 0; // Hızlı test için hile (kaldır)
        const total = die1 + die2;

        io.to(roomId).emit('diceRolled', { die1, die2, playerId: socket.id });
        
        // --- HAPİS MANTIĞI ---
        if (p.inJail) {
             if (die1 === die2) {
                p.inJail = false; p.jailTurns = 0;
                io.to(roomId).emit('log', `${p.name} çift attı ve çıktı!`);
                movePlayer(room, p, total);
            } else {
                p.jailTurns++;
                if (p.jailTurns >= 3) {
                    if (p.money >= 50000) {
                        p.money -= 50000;
                        p.inJail = false;
                        io.to(roomId).emit('log', `${p.name} kefalet (50K) ödeyip çıktı.`);
                        movePlayer(room, p, total);
                    } else {
                        // Parası yoksa iflas (Bankaya)
                        handleBankruptcy(room, p, null);
                        endTurn(room);
                        return;
                    }
                } else {
                    io.to(roomId).emit('log', `${p.name} hapiste kaldı.`);
                    endTurn(room);
                }
            }
        } else {
            movePlayer(room, p, total);
            if (!p.isBankrupt) {
                if (die1 === die2) {
                     io.to(roomId).emit('log', `${p.name} çift attı!`);
                     io.to(roomId).emit('allowReRoll');
                } else {
                    setTimeout(() => endTurn(room), 1500);
                }
            }
        }
    });

    socket.on('buyProperty', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const p = room.players.find(x => x.id === socket.id);
        const tile = boardData[p.position];

        if (tile.price && p.money >= tile.price && !room.boardState[p.position]) {
            p.money -= tile.price;
            p.properties.push(p.position);
            room.boardState[p.position] = p.id;
            io.to(roomId).emit('propertyBought', { playerId: p.id, tileIndex: p.position, money: p.money });
            io.to(roomId).emit('log', `${p.name}, ${tile.name} tapusunu aldı.`);
            endTurn(room);
        }
    });

    socket.on('endTurn', (roomId) => { 
        const room = rooms[roomId];
        if(room) endTurn(room); 
    });
});

function movePlayer(room, player, steps) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;

    // Başlangıç parası
    if (player.position < oldPos) {
        player.money += 200000; // 200K
        io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
        io.to(room.id).emit('log', `${player.name} turu tamamladı (+200K).`);
    }

    if (player.position === 30) { // Hapse Git
        player.position = 10;
        player.inJail = true;
        io.to(room.id).emit('playerMoved', { playerId: player.id, position: 10 });
        io.to(room.id).emit('log', `${player.name} Hapse girdi!`);
        endTurn(room);
        return;
    }

    io.to(room.id).emit('playerMoved', { playerId: player.id, position: player.position });
    
    // Kareyi kontrol et
    const tile = boardData[player.position];
    
    // 1. MÜLK
    if (['property', 'station', 'utility'].includes(tile.type)) {
        const ownerId = room.boardState[player.position];
        
        if (ownerId && ownerId !== player.id) {
            // KİRA ÖDEME
            const owner = room.players.find(p => p.id === ownerId);
            const rent = tile.rent || 10000; 
            
            // Para yetiyor mu?
            if (player.money >= rent) {
                player.money -= rent;
                owner.money += rent;
                io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
                io.to(room.id).emit('moneyUpdate', { playerId: owner.id, money: owner.money });
                io.to(room.id).emit('log', `${player.name}, ${owner.name}'e ${rent}₺ kira ödedi.`);
            } else {
                // YETMİYOR -> İFLAS (Kişiye)
                io.to(room.id).emit('log', `${player.name}, ${rent}₺ kirayı ödeyemedi!`);
                handleBankruptcy(room, player, owner.id);
            }

        } else if (!ownerId) {
            // Satın alma teklifi
            if (player.money >= tile.price) {
                io.to(player.id).emit('offerBuy', tile);
            } else {
                 io.to(room.id).emit('log', `${player.name} burayı alacak parası yok.`);
            }
        }
    
    // 2. VERGİ
    } else if (tile.type === 'tax') {
        if (player.money >= tile.price) {
            player.money -= tile.price;
            io.to(room.id).emit('moneyUpdate', { playerId: player.id, money: player.money });
            io.to(room.id).emit('log', `${player.name} ${tile.price}₺ vergi ödedi.`);
        } else {
            // YETMİYOR -> İFLAS (Bankaya)
            handleBankruptcy(room, player, null);
        }
    }
}

function endTurn(room) {
    room.turn = getNextTurn(room);
    if (room.turn) {
        io.to(room.id).emit('turnChanged', room.turn);
    } else {
        // Herkes batmışsa veya oyun bitmişse
        console.log("Sıra geçecek kimse kalmadı.");
    }
}

http.listen(PORT, () => console.log(`🚀 Server updated (Prices & Bankruptcy) on port ${PORT}`));
