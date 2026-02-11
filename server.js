const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// === VERİLER ===
const boardData = require('./public/board_data.js'); // Board verisini dosyadan çekiyoruz
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
let rooms = {};

io.on('connection', (socket) => {
    console.log('✅ Giriş:', socket.id);

    // ODA YÖNETİMİ
    socket.on('createRoom', (data) => {
        let roomId;
        do { roomId = Math.random().toString(36).substring(2, 7).toUpperCase(); } while (rooms[roomId]);
        
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname} Masası`,
            hostId: socket.id,
            players: [],
            status: 'LOBBY',
            gameState: { 
                turnIndex: 0, 
                properties: {}, // { tapuId: { owner: socketId, level: 0 } }
                lastDice: [0, 0],
                turnStartTime: Date.now()
            }
        };
        joinRoomLogic(socket, roomId, data);
    });

    socket.on('joinRoom', (data) => joinRoomLogic(socket, data.roomId, data));
    
    socket.on('getRooms', () => {
        socket.emit('roomList', Object.values(rooms).map(r => ({
            id: r.id, name: r.name, count: r.players.length, status: r.status
        })));
    });

    // OYUN BAŞLATMA
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.hostId === socket.id && room.players.length >= 2) {
            room.status = 'PLAYING';
            room.gameState.turnStartTime = Date.now();
            
            // Oyuncu Başlangıç Ayarları
            room.players.forEach((p, i) => {
                p.money = 1500;
                p.position = 0;
                p.color = PLAYER_COLORS[i];
                p.properties = [];
                p.jail = false;
                p.bankrupt = false;
            });

            io.to(roomId).emit('gameStarted', { players: room.players, turnIndex: 0 });
            startTurnTimer(roomId); // AFK Sayacı Başlat
        }
    });

    // ZAR ATMA
    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        // Sıra kontrolü ve İflas kontrolü
        if (room.players[room.gameState.turnIndex].id !== socket.id || player.bankrupt) return;

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const total = d1 + d2;
        const isDouble = d1 === d2;

        // Hapishane Mantığı
        if (player.jail) {
            if (isDouble) {
                player.jail = false;
                io.to(roomId).emit('notification', { msg: `${player.name} çift attı ve çıktı!`, type: 'success' });
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.jail = false;
                    io.to(roomId).emit('notification', { msg: `${player.name} cezasını ödedi ve çıktı.`, type: 'info' });
                } else {
                    io.to(roomId).emit('diceResult', { d1, d2, playerId: socket.id, move: false });
                    nextTurn(roomId);
                    return;
                }
            }
        }

        // Hareket
        const oldPos = player.position;
        player.position = (player.position + total) % 40;
        if (player.position < oldPos) {
            player.money += 200; // Başlangıç parası
            io.to(roomId).emit('notification', { msg: `${player.name} başlangıçtan geçti +200₺`, type: 'money' });
        }

        // Kodes Karesi
        if (player.position === 30) {
            player.position = 10;
            player.jail = true;
            player.jailTurns = 0;
            io.to(roomId).emit('diceResult', { d1, d2, playerId: socket.id, move: true, target: 10, isJail: true });
            nextTurn(roomId);
            return;
        }

        io.to(roomId).emit('diceResult', { d1, d2, playerId: socket.id, move: true, target: player.position });

        // Kare Aksiyonu (Gecikmeli)
        setTimeout(() => handleTile(roomId, player), 2000); // Piyon animasyonu bitince
        
        // Çift atarsa tekrar oyna, yoksa sıra devret
        if (!isDouble) {
            setTimeout(() => nextTurn(roomId), 4000);
        } else {
             io.to(roomId).emit('notification', { msg: `Çift zar! ${player.name} tekrar oynuyor.`, type: 'info' });
             startTurnTimer(roomId); // Süreyi sıfırla
        }
    });

    // SATIN ALMA
    socket.on('buyProperty', () => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[player.position];

        if (tile && tile.price && player.money >= tile.price && !room.gameState.properties[player.position]) {
            player.money -= tile.price;
            player.properties.push(player.position);
            room.gameState.properties[player.position] = { owner: socket.id, level: 0 };
            
            io.to(roomId).emit('propertyBought', { 
                playerId: socket.id, 
                tileIndex: player.position, 
                money: player.money 
            });
        }
    });

    // EV KURMA (Yükseltme)
    socket.on('upgradeProperty', (tileIndex) => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const prop = room.gameState.properties[tileIndex];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[tileIndex];

        if (prop && prop.owner === socket.id && prop.level < 5 && player.money >= (tile.price * 0.5)) {
            const cost = Math.floor(tile.price * 0.5);
            player.money -= cost;
            prop.level++;
            io.to(roomId).emit('propertyUpgraded', { tileIndex, level: prop.level, money: player.money });
        }
    });

    // KOPMA YÖNETİMİ (30sn Grace Period eklenebilir ama şimdilik basit tutalım)
    socket.on('disconnect', () => {
        const roomId = getPlayerRoom(socket.id);
        if (roomId) {
            const room = rooms[roomId];
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                // Oyuncu oyundaysa iflas etmiş say
                if(room.status === 'PLAYING') {
                    room.players[pIndex].bankrupt = true;
                    room.players[pIndex].money = 0;
                    // Tapularını boşa çıkar
                    Object.keys(room.gameState.properties).forEach(key => {
                        if(room.gameState.properties[key].owner === socket.id) delete room.gameState.properties[key];
                    });
                    io.to(roomId).emit('playerLeft', { playerId: socket.id });
                    
                    // Eğer sıradaki oyuncuyduysa turu devret
                    if (room.gameState.turnIndex === pIndex) nextTurn(roomId);
                } else {
                    room.players.splice(pIndex, 1);
                }
                
                if (room.players.filter(p => !p.bankrupt).length < 2 && room.status === 'PLAYING') {
                    endGame(roomId);
                } else {
                    io.to(roomId).emit('updateRoomPlayers', room.players);
                }
            }
        }
    });
});

// YARDIMCI FONKSİYONLAR
function handleTile(roomId, player) {
    const room = rooms[roomId];
    const tile = boardData[player.position];
    
    // Tapulu Alan
    if (tile.type === 'property' || tile.type === 'railroad' || tile.type === 'utility') {
        const prop = room.gameState.properties[player.position];
        if (prop) {
            if (prop.owner !== player.id) {
                // Kira Ödeme
                let rent = calculateRent(tile, prop.level);
                const owner = room.players.find(p => p.id === prop.owner);
                
                // İflas Kontrolü
                if (player.money < rent) {
                    rent = player.money; // Tüm parasını ver
                    player.bankrupt = true;
                    io.to(roomId).emit('gameOver', { winner: owner.name }); // Basit bitiş
                }
                
                player.money -= rent;
                owner.money += rent;
                io.to(roomId).emit('rentPaid', { payer: player.id, receiver: owner.id, amount: rent });
            }
        } else {
            // Satın Alma Fırsatı
            io.to(player.id).emit('offerBuy', { tileIndex: player.position });
        }
    }
    // Şans / Vergi
    else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('notification', { msg: `${player.name} vergi ödedi: ${tile.price}₺`, type: 'bad' });
    }
    
    // Durum Güncelle
    io.to(roomId).emit('updateStats', room.players);
}

function calculateRent(tile, level) {
    if (!tile.rent) return 0;
    // Basit mantık: Seviye başına kira artar
    return tile.rent[level] || tile.rent[0]; 
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    
    // İflas etmemiş bir sonraki oyuncuyu bul
    let attempts = 0;
    do {
        room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.players.length;
        attempts++;
    } while (room.players[room.gameState.turnIndex].bankrupt && attempts < room.players.length);

    startTurnTimer(roomId);
    io.to(roomId).emit('turnChange', { 
        turnIndex: room.gameState.turnIndex, 
        playerId: room.players[room.gameState.turnIndex].id 
    });
}

let timers = {};
function startTurnTimer(roomId) {
    if(timers[roomId]) clearTimeout(timers[roomId]);
    timers[roomId] = setTimeout(() => {
        // AFK - Otomatik oyna
        const room = rooms[roomId];
        if(room && room.status === 'PLAYING') {
            const socketId = room.players[room.gameState.turnIndex].id;
            // Sunucu kendisi tetikleyemez, istemciye "zaman doldu" sinyali yollarız
            // Veya direkt nextTurn çağırırız ama zar atılmazsa oyun sıkışır.
            // Basitçe pas geçelim:
            io.to(roomId).emit('notification', { msg: "Süre doldu! Sıra geçiyor.", type: 'bad' });
            nextTurn(roomId);
        }
    }, 30000); // 30 Saniye
}

function joinRoomLogic(socket, roomId, data) {
    if(!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].players.push({
        id: socket.id,
        name: data.nickname,
        avatar: data.avatar,
        money: 0,
        isHost: rooms[roomId].hostId === socket.id
    });
    socket.emit('roomJoined', { roomId });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function getPlayerRoom(id) {
    return Object.keys(rooms).find(rid => rooms[rid].players.find(p => p.id === id));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server Active'));
