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
    money: 1500,
    position: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    properties: [],
    inJail: false,
    jailTurns: 0
});

// GÜVENLİ LİSTE ALICI
const getRoomList = () => {
    try {
        const list = Object.values(rooms).map(r => ({
            id: r.id,
            name: (r.players[0] ? r.players[0].name : 'Bilinmeyen') + "'in Odası",
            count: r.players.length,
            status: r.status
        }));
        console.log("Sunucudaki Odalar:", list); // Server loguna yaz
        return list;
    } catch(e) {
        console.error("Liste Hatası:", e);
        return [];
    }
};

const getNextTurn = (room) => {
    const currentIdx = room.players.findIndex(p => p.id === room.turn);
    const nextIdx = (currentIdx + 1) % room.players.length;
    return room.players[nextIdx].id;
};

io.on('connection', (socket) => {
    console.log('🔗 Bağlantı:', socket.id);
    
    // Bağlanan herkese mevcut odaları hemen gönder
    socket.emit('roomList', getRoomList());

    socket.on('getRooms', () => {
        socket.emit('roomList', getRoomList());
    });

    socket.on('createRoom', ({ nickname, avatar }) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        console.log(`Oda Kuruluyor... ID: ${roomId} Kurucu: ${nickname}`);
        
        rooms[roomId] = {
            id: roomId,
            players: [createPlayer(socket.id, nickname, avatar)],
            status: 'LOBBY',
            turn: null,
            boardState: {}, 
            logs: []
        };
        
        socket.join(roomId);
        // Hem isHost true hem de roomId'yi garanti gönderiyoruz
        socket.emit('roomJoined', { roomId: roomId, isHost: true });
        
        // Herkese duyur
        io.emit('roomList', getRoomList());
    });

    socket.on('joinRoom', ({ roomId, nickname, avatar }) => {
        // ID düzeltme (Boşlukları sil, büyük harf yap)
        const cleanId = roomId ? roomId.trim().toUpperCase() : "";
        console.log(`Katılma İsteği -> Gelen ID: "${roomId}", Aranan ID: "${cleanId}"`);
        
        const room = rooms[cleanId];
        
        if (room) {
            console.log("Oda bulundu, oyuncu ekleniyor.");
            if(room.status !== 'LOBBY') {
                socket.emit('error', 'Oyun çoktan başlamış!');
                return;
            }
            if(room.players.length >= 4) {
                socket.emit('error', 'Oda dolu!');
                return;
            }

            room.players.push(createPlayer(socket.id, nickname, avatar));
            socket.join(cleanId);
            
            socket.emit('roomJoined', { roomId: cleanId, isHost: false });
            io.to(cleanId).emit('updateLobby', room);
            io.emit('roomList', getRoomList());
        } else {
            console.log("HATA: Oda bulunamadı!");
            console.log("Mevcut Odalar:", Object.keys(rooms));
            socket.emit('error', `Oda bulunamadı! (Kod: ${cleanId})`);
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

    // OYUN İÇİ AKSİYONLAR
    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room) return; 
        
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const player = room.players.find(p => p.id === socket.id);

        if(player) {
            io.to(roomId).emit('diceRolled', { die1, die2, playerId: socket.id });
            movePlayer(roomId, player, total);
            // Basitleştirilmiş tur geçişi
            setTimeout(() => endTurn(roomId), 2000);
        }
    });

    socket.on('buyProperty', (roomId) => {
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        const tile = boardData[player.position];
        
        if (room && player && tile.price && player.money >= tile.price) {
            player.money -= tile.price;
            player.properties.push(player.position);
            room.boardState[player.position] = player.id;
            io.to(roomId).emit('propertyBought', { playerId: player.id, tileIndex: player.position, money: player.money });
            io.to(roomId).emit('log', `${player.name}, ${tile.name} mülkünü aldı.`);
        }
    });

    socket.on('endTurn', (roomId) => endTurn(roomId));
});

function movePlayer(roomId, player, steps) {
    const room = rooms[roomId];
    if(!room) return;
    
    player.position = (player.position + steps) % 40;
    io.to(roomId).emit('playerMoved', { playerId: player.id, position: player.position });
    
    // Basit kira mantığı vs buraya eklenebilir
}

function endTurn(roomId) {
    const room = rooms[roomId];
    if(room) {
        room.turn = getNextTurn(room);
        io.to(roomId).emit('turnChanged', room.turn);
    }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server aktif: Port ${PORT}`));
