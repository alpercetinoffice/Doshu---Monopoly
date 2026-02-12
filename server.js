const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const BOARD = require('./gameData');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let rooms = {};

// Oyuncu Modeli
const createPlayer = (id, name, avatar) => ({
    id, name, avatar,
    money: 1500,
    position: 0,
    color: getRandomColor(),
    properties: [],
    inJail: false,
    jailTurns: 0,
    isEliminated: false
});

function getRandomColor() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
    return colors[Math.floor(Math.random() * colors.length)];
}

io.on('connection', (socket) => {
    
    // --- ODA YÖNETİMİ ---
    socket.on('createRoom', ({ nickname, avatar }) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: [createPlayer(socket.id, nickname, avatar)],
            status: 'LOBBY', // LOBBY, PLAYING, FINISHED
            turnIndex: 0,
            boardOwner: {}, // { tileId: playerId }
            logs: []
        };
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, isHost: true });
        io.to(roomId).emit('updateLobby', rooms[roomId]);
    });

    socket.on('joinRoom', ({ roomId, nickname, avatar }) => {
        if (!rooms[roomId]) return socket.emit('error', 'Oda bulunamadı!');
        if (rooms[roomId].status !== 'LOBBY') return socket.emit('error', 'Oyun çoktan başladı!');
        if (rooms[roomId].players.length >= 4) return socket.emit('error', 'Oda dolu!');

        const player = createPlayer(socket.id, nickname, avatar);
        rooms[roomId].players.push(player);
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, isHost: false });
        io.to(roomId).emit('updateLobby', rooms[roomId]);
    });

    socket.on('startGame', (roomId) => {
        if (rooms[roomId] && rooms[roomId].players[0].id === socket.id) {
            rooms[roomId].status = 'PLAYING';
            io.to(roomId).emit('gameStarted', { 
                players: rooms[roomId].players, 
                board: BOARD,
                turn: rooms[roomId].players[0].id 
            });
            log(roomId, "Oyun Başladı! İyi şanslar...");
        }
    });

    // --- OYUN MANTIĞI ---
    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'PLAYING') return;
        
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        // Zar Atma
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        io.to(roomId).emit('diceResult', { die1, die2, playerId: socket.id });

        // Hapis Mantığı
        if (player.inJail) {
            if (isDouble) {
                player.inJail = false;
                player.jailTurns = 0;
                log(roomId, `${player.name} çift atarak hapisten çıktı!`);
                movePlayer(roomId, player, total);
            } else {
                player.jailTurns++;
                if(player.jailTurns >= 3) {
                    player.money -= 50;
                    player.inJail = false;
                    player.jailTurns = 0;
                    log(roomId, `${player.name} cezasını ödeyip hapisten çıktı.`);
                    movePlayer(roomId, player, total);
                } else {
                    log(roomId, `${player.name} hapiste kaldı.`);
                    endTurn(roomId);
                }
            }
        } else {
            movePlayer(roomId, player, total);
            // Çift gelirse tekrar oynama hakkı (basitleştirilmiş: sonsuz döngü koruması yok)
            if (isDouble && !player.inJail) {
                log(roomId, `${player.name} çift attı, tekrar oynayacak!`);
                // Turu değiştirme, tekrar bekle
                return; 
            }
        }
    });

    socket.on('buyProperty', (roomId) => {
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = BOARD[player.position];

        if (tile.price && player.money >= tile.price && !room.boardOwner[tile.id]) {
            player.money -= tile.price;
            player.properties.push(tile.id);
            room.boardOwner[tile.id] = player.id;
            
            io.to(roomId).emit('propertyBought', { 
                tileId: tile.id, 
                playerId: player.id, 
                money: player.money 
            });
            log(roomId, `${player.name}, ${tile.name} tapusunu aldı!`);
            endTurn(roomId);
        }
    });

    socket.on('endTurn', (roomId) => {
        endTurn(roomId);
    });

    socket.on('disconnect', () => {
        // Basit kopma yönetimi: Odayı temizle (Geliştirilebilir)
        for(let rid in rooms) {
            rooms[rid].players = rooms[rid].players.filter(p => p.id !== socket.id);
            io.to(rid).emit('updateLobby', rooms[rid]);
        }
    });
});

function movePlayer(roomId, player, steps) {
    const room = rooms[roomId];
    const oldPos = player.position;
    player.position = (player.position + steps) % 40;

    // Başlangıçtan geçme
    if (player.position < oldPos) {
        player.money += 200;
        log(roomId, `${player.name} başlangıçtan geçti, 200₺ kazandı.`);
    }

    // Hapse Girme
    if (player.position === 30) {
        player.position = 10;
        player.inJail = true;
        log(roomId, `${player.name} HAPSE GİRDİ!`);
        io.to(roomId).emit('playerMoved', { playerId: player.id, position: 10, money: player.money });
        endTurn(roomId);
        return;
    }

    io.to(roomId).emit('playerMoved', { playerId: player.id, position: player.position, money: player.money });

    // Gittiği yerin analizi
    const tile = BOARD[player.position];
    let autoEndTurn = true;

    // Mülk Kontrolü
    if (['property', 'station', 'utility'].includes(tile.type)) {
        const ownerId = room.boardOwner[tile.id];
        if (ownerId && ownerId !== player.id) {
            // Kira öde
            const owner = room.players.find(p => p.id === ownerId);
            let rent = tile.rent[0] || 10; // Basitleştirilmiş kira
            player.money -= rent;
            owner.money += rent;
            log(roomId, `${player.name}, ${owner.name}'e ${rent}₺ kira ödedi.`);
            io.to(roomId).emit('moneyUpdate', { players: room.players });
        } else if (!ownerId) {
            // Satın alma teklifi sun
            io.to(player.id).emit('offerProperty', tile);
            autoEndTurn = false;
        }
    } else if (tile.type === 'tax') {
        player.money -= tile.price;
        log(roomId, `${player.name} ${tile.price}₺ vergi ödedi.`);
    } else if (tile.type === 'chance' || tile.type === 'chest') {
        const luck = Math.random() > 0.5 ? 50 : -50;
        player.money += luck;
        log(roomId, luck > 0 ? `${player.name} piyangodan 50₺ kazandı!` : `${player.name} hastane masrafı 50₺ ödedi.`);
    }

    io.to(roomId).emit('moneyUpdate', { players: room.players });

    if (autoEndTurn) {
        setTimeout(() => endTurn(roomId), 1500);
    }
}

function endTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    // Eğer oyuncu elendiyse bir sonrakine geç (Burası eklenebilir)
    io.to(roomId).emit('newTurn', { turnId: room.players[room.turnIndex].id });
}

function log(roomId, message) {
    const room = rooms[roomId];
    if(room) {
        room.logs.push(message);
        if(room.logs.length > 50) room.logs.shift();
        io.to(roomId).emit('gameLog', message);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda aktif.`));
