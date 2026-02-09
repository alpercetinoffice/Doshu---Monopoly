const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: {
        origin: function (origin, callback) {
            // İzin verilen adresler (hem slash'li hem slash'siz)
            const allowedOrigins = [
                "https://doshu.gamer.gd", 
                "https://doshu.gamer.gd/",
                "http://doshu.gamer.gd",
                "http://localhost:3000",
                "http://127.0.0.1:5500"
            ];
            if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
                callback(null, true);
            } else {
                console.log("Blocked Origin:", origin);
                callback(new Error('CORS not allowed'));
            }
        },
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let playerIds = [];
let currentPlayerIndex = 0;

const gameState = {
    properties: {}, 
};

io.on('connection', (socket) => {
    console.log('Yeni Bağlantı:', socket.id);

    // 1. Lobby Girişi
    socket.on('joinLobby', (playerName) => {
        players[socket.id] = {
            id: socket.id,
            name: playerName || `Misafir`,
            color: getRandomColor(),
            position: 0,
            money: 1500,
            jail: false
        };
        
        if (!playerIds.includes(socket.id)) {
            playerIds.push(socket.id);
        }

        // Tüm lobiye güncel listeyi at
        io.emit('updateLobby', {
            players: Object.values(players),
            hostId: playerIds[0] // İlk giren kişi yönetici (host) olur
        });
    });

    // 2. Oyunu Başlat
    socket.on('startGame', () => {
        // Sadece host başlatabilir (güvenlik için check eklenebilir ama şimdilik gerek yok)
        if (playerIds.length < 1) return; 
        
        io.emit('gameStarted', { 
            players: players, 
            gameState: gameState, 
            currentTurn: playerIds[0] 
        });
    });

    // 3. Zar Atma
    socket.on('rollDice', () => {
        if (socket.id !== playerIds[currentPlayerIndex]) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;
        const player = players[socket.id];

        if(!player) return;

        // Hareket
        let oldPos = player.position;
        player.position = (player.position + total) % 40;

        // Başlangıçtan geçme
        if (player.position < oldPos) {
            player.money += 200;
        }

        io.emit('diceResult', { die1, die2, move: true, playerId: socket.id, newPosition: player.position, money: player.money, isDouble });

        if (!isDouble) nextTurn();
    });

    // 4. Mülk İşlemleri
    socket.on('buyProperty', (index, price) => {
        const player = players[socket.id];
        if (player && player.money >= price && !gameState.properties[index]) {
            player.money -= price;
            gameState.properties[index] = { owner: socket.id, level: 0 };
            io.emit('propertyUpdate', { index, property: gameState.properties[index], money: player.money, ownerId: socket.id });
        }
    });

    socket.on('payRent', (amount, ownerId) => {
        const payer = players[socket.id];
        
        if (ownerId === 'bank') {
            if(payer) payer.money -= amount;
        } else {
            const owner = players[ownerId];
            if (payer && owner) {
                payer.money -= amount;
                owner.money += amount;
            }
        }
        // Tüm bakiyeleri güncelle
        io.emit('moneyUpdate', players);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        playerIds = playerIds.filter(id => id !== socket.id);
        
        // Host çıktıysa ve biri kaldıysa yeni host ata
        const newHost = playerIds.length > 0 ? playerIds[0] : null;
        
        io.emit('updateLobby', {
            players: Object.values(players),
            hostId: newHost
        });
    });
});

function nextTurn() {
    currentPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
    io.emit('turnChange', playerIds[currentPlayerIndex]);
}

function getRandomColor() {
    const colors = ['#ff5252', '#448aff', '#69f0ae', '#e040fb', '#ffd740', '#ff6e40'];
    return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on ${PORT}`); });
