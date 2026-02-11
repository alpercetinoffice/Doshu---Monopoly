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
app.get('/health', (req, res) => res.status(200).send('OK'));

// === VERİLER ===
let rooms = {};
const PLAYER_COLORS = ['#ff3838', '#17c0eb', '#3ae374', '#fff200', '#7158e2', '#ff9f43'];

// Board Data (Sunucu tarafı referansı)
const boardData = require('./public/board_data.js'); 
// (Eğer board_data.js yoksa hata vermemesi için basit require, ama dosyanın public'te olduğundan emin ol)

io.on('connection', (socket) => {
    console.log('✅ Yeni Bağlantı:', socket.id);

    // ODA OLUŞTURMA
    socket.on('createRoom', (data) => {
        let roomId;
        do {
            roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        } while (rooms[roomId]); // Çakışma kontrolü

        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            hostName: data.nickname,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, turnIndex: 0, turnPlayerId: null }
        };

        joinRoomLogic(socket, roomId, data.nickname, data.character);
    });

    // ODA LİSTELEME
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length,
            status: rooms[id].status, host: rooms[id].hostName
        }));
        socket.emit('roomList', list);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data.nickname, data.character);
    });

    // OYUN BAŞLATMA
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id) return;

        // Başlangıç Ayarları
        room.players.forEach((p, i) => {
            p.money = 1500;
            p.position = 0;
            p.color = PLAYER_COLORS[i % PLAYER_COLORS.length];
            p.properties = [];
            p.inJail = false;
            p.jailTurns = 0;
            p.isBankrupt = false;
        });

        room.status = 'PLAYING';
        room.gameState.turnPlayerId = room.players[0].id;
        
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            currentTurn: room.gameState.turnPlayerId
        });
    });

    // ZAR ATMA VE HAREKET
    socket.on('rollDice', (data) => {
        const roomId = findPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);

        if (room.gameState.turnPlayerId !== socket.id) return;

        // Zar Hesapla
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const total = d1 + d2;
        const isDouble = d1 === d2;

        // Hapis Kontrolü
        if (player.inJail) {
            if (isDouble || (data && data.tryJailEscape)) { // Çift attı veya şansını denedi
                if(isDouble) {
                    player.inJail = false;
                    player.jailTurns = 0;
                    movePlayer(room, player, total);
                    io.to(roomId).emit('diceResult', { playerId: socket.id, d1, d2, move: true, msg: "Çift attın ve çıktın!" });
                } else {
                    player.jailTurns++;
                    if(player.jailTurns >= 3) {
                         // 3 tur oldu, zorla öde ve çık
                        player.money -= 50;
                        player.inJail = false;
                        movePlayer(room, player, total);
                        io.to(roomId).emit('diceResult', { playerId: socket.id, d1, d2, move: true, msg: "3 tur doldu, ceza ödendi." });
                    } else {
                        io.to(roomId).emit('diceResult', { playerId: socket.id, d1, d2, move: false, msg: "Çıkamadın." });
                        nextTurn(roomId);
                    }
                }
            }
            return;
        }

        // Normal Hareket
        io.to(roomId).emit('diceResult', { playerId: socket.id, d1, d2, move: true });
        
        // Animasyon süresi (2sn) sonra sonucu işle
        setTimeout(() => {
            movePlayer(room, player, total);
            
            // Eğer çift atmadıysa sıra değişir
            if (!isDouble) {
                setTimeout(() => nextTurn(roomId), 1500); // Olayları görmesi için bekleme
            }
        }, 2000);
    });

    // MÜLK SATIN ALMA
    socket.on('buyProperty', (data) => {
        const roomId = findPlayerRoom(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        // Basit kontrol: Para yetiyor mu?
        // (Gerçek veriyi boardData'dan almak lazım ama şimdilik client güveniyoruz, sen board_data.js'i server'a da koyarsan daha güvenli olur)
        
        if(player.money >= data.price) {
            player.money -= data.price;
            player.properties.push(data.position);
            room.gameState.properties[data.position] = socket.id;
            
            io.to(roomId).emit('propertyBought', {
                playerId: socket.id,
                position: data.position,
                money: player.money,
                price: data.price
            });
        }
    });

    // HAPİS ÖDEME
    socket.on('payBail', () => {
        const roomId = findPlayerRoom(socket.id);
        const p = rooms[roomId].players.find(p => p.id === socket.id);
        if(p.money >= 50) {
            p.money -= 50;
            p.inJail = false;
            p.jailTurns = 0;
            io.to(roomId).emit('jailPaid', { playerId: socket.id });
        }
    });

    // KOPMA YÖNETİMİ
    socket.on('disconnect', () => {
        const roomId = findPlayerRoom(socket.id);
        if (roomId) {
            const room = rooms[roomId];
            // Oyuncu oyundaysa hemen silme, "disconnected" işaretle (Gelişmiş versiyon)
            // Şimdilik basitçe siliyoruz ama host değişimi yapıyoruz
            room.players = room.players.filter(p => p.id !== socket.id);
            
            if (room.players.length === 0) {
                delete rooms[roomId];
            } else {
                if(room.hostId === socket.id) {
                    room.hostId = room.players[0].id;
                    room.players[0].isHost = true;
                }
                io.to(roomId).emit('updateRoomPlayers', room.players);
            }
        }
    });
});

// YARDIMCI FONKSİYONLAR
function joinRoomLogic(socket, roomId, nickname, charId) {
    if (!rooms[roomId]) return socket.emit('error', 'Oda yok!');
    if (rooms[roomId].players.length >= 6) return socket.emit('error', 'Oda dolu!');

    socket.join(roomId);
    const newPlayer = {
        id: socket.id,
        name: nickname,
        character: charId, // Karakter ID (resim için)
        isHost: rooms[roomId].hostId === socket.id,
        money: 1500
    };
    rooms[roomId].players.push(newPlayer);
    socket.emit('roomJoined', { roomId });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function movePlayer(room, player, steps) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;

    // Başlangıçtan geçme
    if(player.position < oldPos) {
        player.money += 200;
        io.to(room.id).emit('passGo', { playerId: player.id });
    }

    // Kodes'e Git karesi (30. kare)
    if(player.position === 30) {
        player.position = 10;
        player.inJail = true;
        player.jailTurns = 0;
        io.to(room.id).emit('jailEntered', { playerId: player.id });
    } else {
        // İstemciye güncelleme at
        io.to(room.id).emit('playerMoved', { 
            playerId: player.id, 
            position: player.position, 
            money: player.money 
        });
        
        // Tapu/Kira kontrolü için istemciyi tetikle (Logic serverda olmalı ama şimdilik hibrit)
        // Burada basitçe: Eğer sahipli bir yerse kira kes, değilse satın alma sor
        checkTile(room, player);
    }
}

function checkTile(room, player) {
    const pos = player.position;
    const ownerId = room.gameState.properties[pos];

    if(ownerId && ownerId !== player.id) {
        // Kira öde
        const owner = room.players.find(p => p.id === ownerId);
        if(owner) {
            // Basit kira (geliştirilebilir)
            const rent = 50; // Standart kira, boardData'dan çekilmeli
            player.money -= rent;
            owner.money += rent;
            io.to(room.id).emit('rentPaid', { payer: player.id, receiver: owner.id, amount: rent });
        }
    }
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    const currentIdx = room.players.findIndex(p => p.id === room.gameState.turnPlayerId);
    const nextIdx = (currentIdx + 1) % room.players.length;
    room.gameState.turnPlayerId = room.players[nextIdx].id;
    io.to(roomId).emit('turnChange', room.gameState.turnPlayerId);
}

function findPlayerRoom(id) {
    return Object.keys(rooms).find(rid => rooms[rid].players.find(p => p.id === id));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Sunucu ${PORT} portunda aktif.`));
