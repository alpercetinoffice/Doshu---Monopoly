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

// --- GAME CONFIG ---
let rooms = {};
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const boardData = require('./public/board_data.js');

const CHANCE_CARDS = [
    { text: 'Bankadan 200₺ kâr payı!', money: 200 },
    { text: 'Aşırı hız cezası! 100₺ öde.', money: -100 },
    { text: 'Başlangıç noktasına git.', type: 'go' },
    { text: 'Hapse gir!', type: 'jail' },
    { text: 'Doğum günü! Herkesten 50₺ al.', type: 'birthday' }
];

io.on('connection', (socket) => {
    console.log('Bağlantı:', socket.id);

    // ODA LİSTESİ
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id, name: rooms[id].name, count: rooms[id].players.length,
            status: rooms[id].status, host: rooms[id].hostName
        }));
        socket.emit('roomList', list);
    });

    // ODA KURMA
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Odası`,
            hostId: socket.id,
            hostName: data.nickname,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, turnIndex: 0 }
        };
        joinRoomLogic(socket, roomId, data.nickname, data.character);
    });

    // KATILMA
    socket.on('joinRoom', (data) => joinRoomLogic(socket, data.roomId, data.nickname, data.character));

    // BAŞLATMA
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id) return;
        
        room.status = 'PLAYING';
        room.players.forEach((p, i) => {
            p.money = 1500;
            p.position = 0;
            p.properties = [];
            p.jail = false;
            p.color = PLAYER_COLORS[i % PLAYER_COLORS.length];
        });

        io.to(roomId).emit('gameStarted', {
            players: room.players,
            currentTurn: room.players[0].id
        });
    });

    // ZAR ATMA
    socket.on('rollDice', () => {
        const roomId = getPlayerRoom(socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        // Sıra kontrolü
        if(room.players[room.gameState.turnIndex].id !== socket.id) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const isDouble = die1 === die2;
        
        // HAPİS MANTIĞI
        if(player.jail) {
            if(isDouble) {
                player.jail = false;
                movePlayer(player, die1 + die2);
                io.to(roomId).emit('diceResult', { playerId: socket.id, die1, die2, move: true, msg: "Çift attın, özgürsün!" });
            } else {
                player.jailTurns = (player.jailTurns || 0) + 1;
                if(player.jailTurns >= 3) {
                    player.money -= 50;
                    player.jail = false;
                    movePlayer(player, die1 + die2);
                    io.to(roomId).emit('diceResult', { playerId: socket.id, die1, die2, move: true, msg: "Cezayı ödedin ve çıktın." });
                } else {
                    io.to(roomId).emit('diceResult', { playerId: socket.id, die1, die2, move: false, msg: "Hapiste kaldın." });
                    setTimeout(() => nextTurn(roomId), 2000);
                    return;
                }
            }
        } else {
            // NORMAL HAREKET
            movePlayer(player, die1 + die2);
            // Kodes karesi kontrolü (30. kare)
            if(player.position === 30) {
                player.position = 10;
                player.jail = true;
                player.jailTurns = 0;
                io.to(roomId).emit('diceResult', { playerId: socket.id, die1, die2, move: true, msg: "KODESE GİDİYORSUN!" });
            } else {
                io.to(roomId).emit('diceResult', { playerId: socket.id, die1, die2, move: true });
            }
        }

        // Tapu/Olay Kontrolü
        if(!player.jail) {
            setTimeout(() => checkTile(roomId, player), 1000);
        } else {
             setTimeout(() => nextTurn(roomId), 2000);
        }

        // Çift atınca tekrar atma hakkı (Hapiste değilse)
        if(isDouble && !player.jail) {
            // Sıra değişmez
        } else if(!player.jail) {
            // Normalde checkTile içinde sıra değişecek ama garanti olsun
            // (checkTile logic'i aşağıda)
        }
    });

    // MÜLK SATIN ALMA
    socket.on('buyProperty', () => {
        const roomId = getPlayerRoom(socket.id);
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[player.position];

        if(player.money >= tile.price && !room.gameState.properties[player.position]) {
            player.money -= tile.price;
            player.properties.push(player.position);
            room.gameState.properties[player.position] = socket.id;
            io.to(roomId).emit('propertyBought', { playerId: socket.id, position: player.position, money: player.money });
            io.to(roomId).emit('playSound', 'buy');
            nextTurn(roomId);
        }
    });

    // PAS GEÇME
    socket.on('passTurn', () => {
        const roomId = getPlayerRoom(socket.id);
        nextTurn(roomId);
    });

    // KOPMA YÖNETİMİ
    socket.on('disconnect', () => {
        // Oyuncuyu hemen silme, belki geri gelir (Basit versiyon: sil ama odayı kapatma)
        const roomId = getPlayerRoom(socket.id);
        if(roomId) {
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);
            if(room.players.length === 0) delete rooms[roomId];
            else io.to(roomId).emit('updateRoomPlayers', room.players);
        }
    });
});

function movePlayer(player, steps) {
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;
    if(player.position < oldPos) player.money += 200; // Başlangıçtan geçiş
}

function checkTile(roomId, player) {
    const room = rooms[roomId];
    const tile = boardData[player.position];

    if(tile.type === 'property' || tile.type === 'railroad' || tile.type === 'utility') {
        const ownerId = room.gameState.properties[player.position];
        if(!ownerId) {
            // Satın alma fırsatı
            io.to(roomId).emit('promptBuy', { playerId: player.id, tile });
        } else if(ownerId !== player.id) {
            // Kira ödeme
            const owner = room.players.find(p => p.id === ownerId);
            const rent = tile.rent ? tile.rent[0] : 20; // Basit kira
            player.money -= rent;
            owner.money += rent;
            io.to(roomId).emit('rentPaid', { payer: player.id, receiver: owner.id, amount: rent });
            io.to(roomId).emit('playSound', 'pay');
            checkBankruptcy(roomId, player);
            setTimeout(() => nextTurn(roomId), 2000);
        } else {
            setTimeout(() => nextTurn(roomId), 1000);
        }
    } else if (tile.type === 'chance' || tile.type === 'chest') {
        const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
        handleCard(roomId, player, card);
        setTimeout(() => nextTurn(roomId), 3000);
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
        io.to(roomId).emit('taxPaid', { playerId: player.id, amount: tile.price });
        checkBankruptcy(roomId, player);
        setTimeout(() => nextTurn(roomId), 2000);
    } else {
        setTimeout(() => nextTurn(roomId), 1000);
    }
}

function handleCard(roomId, player, card) {
    // Kart mantığı (Önceki kodun aynısı)
    if(card.money) player.money += card.money;
    if(card.type === 'jail') { player.position = 10; player.jail = true; }
    if(card.type === 'go') { player.position = 0; player.money += 200; }
    io.to(roomId).emit('cardDrawn', { text: card.text });
    checkBankruptcy(roomId, player);
}

function checkBankruptcy(roomId, player) {
    if(player.money < 0) {
        io.to(roomId).emit('playerBankrupt', { playerId: player.id, name: player.name });
        // Oyuncuyu resetle veya at (Şimdilik basit bırakalım)
    }
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.players.length;
    io.to(roomId).emit('turnChange', room.players[room.gameState.turnIndex].id);
}

function joinRoomLogic(socket, roomId, nickname, character) {
    if(!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].players.push({
        id: socket.id, name: nickname, character,
        isHost: rooms[roomId].hostId === socket.id
    });
    socket.emit('roomJoined', { roomId });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

function getPlayerRoom(id) {
    return Object.keys(rooms).find(r => rooms[r].players.find(p => p.id === id));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server Active'));
