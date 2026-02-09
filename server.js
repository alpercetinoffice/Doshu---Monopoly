const express = require('express');
const app = express();
const http = require('http').createServer(app);

const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Tüm kökenlere izin ver
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true // Eski versiyonlarla uyumluluk için
});

// Oda verilerini tutan obje
let rooms = {};

io.on('connection', (socket) => {
    console.log('Sunucuya yeni biri bağlandı:', socket.id);

    // ODA KURMA
    socket.on('createRoom', (data) => {
        console.log("Oda kurma isteği alındı:", data);
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        rooms[roomId] = {
            id: roomId,
            name: `${data.nickname}'in Masası`,
            hostId: socket.id,
            hostName: data.nickname,
            players: [],
            status: 'LOBBY',
            gameState: { properties: {}, houses: {} }
        };

        joinRoomLogic(socket, roomId, data.nickname, data.avatar);
    });

    // ODA LİSTESİ
    socket.on('getRooms', () => {
        const list = Object.keys(rooms).map(id => ({
            id: id,
            name: rooms[id].name,
            count: rooms[id].players.length,
            status: rooms[id].status,
            host: rooms[id].hostName
        }));
        socket.emit('roomList', list);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', (data) => {
        joinRoomLogic(socket, data.roomId, data.nickname, data.avatar);
    });

    // ODA AYRILMA / KOPMA
    socket.on('disconnect', () => {
        const roomId = Object.keys(rooms).find(id => 
            rooms[id].players.find(p => p.id === socket.id)
        );
        if(roomId) {
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            if(rooms[roomId].players.length === 0) {
                delete rooms[roomId];
            } else {
                io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
            }
        }
    });
});

function joinRoomLogic(socket, roomId, nickname, avatar) {
    if (!rooms[roomId]) return;
    
    socket.join(roomId);
    const newPlayer = {
        id: socket.id,
        name: nickname,
        avatar: avatar,
        isHost: rooms[roomId].hostId === socket.id
    };
    rooms[roomId].players.push(newPlayer);
    
    socket.emit('roomJoined', { roomId: roomId, isHost: newPlayer.isHost });
    io.to(roomId).emit('updateRoomPlayers', rooms[roomId].players);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Sunucu ${PORT} portunda aktif.`));
