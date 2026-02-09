const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: {
        origin: function (origin, callback) {
            const allowedOrigins = ["https://doshu.gamer.gd", "http://doshu.gamer.gd", "http://localhost:3000", "http://127.0.0.1:5500"];
            if (!origin || allowedOrigins.indexOf(origin) !== -1) callback(null, true);
            else callback(new Error('CORS not allowed'));
        },
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Oyun Durumu
let players = {};
let gameStarted = false;
let playerIds = [];
let currentPlayerIndex = 0;

const gameState = {
    properties: {}, // { propIndex: { owner: id, level: 0 (0-4 house, 5 hotel), mortgaged: false } }
};

io.on('connection', (socket) => {
    console.log('Bağlantı:', socket.id);

    // 1. Lobby Girişi
    socket.on('joinLobby', (playerName) => {
        players[socket.id] = {
            id: socket.id,
            name: playerName || `Oyuncu ${playerIds.length + 1}`,
            color: getRandomColor(),
            position: 0,
            money: 1500,
            jail: false,
            jailTurn: 0
        };
        playerIds.push(socket.id);

        // Tüm lobiye haber ver
        io.emit('updateLobby', Object.values(players));
    });

    // 2. Oyunu Başlat
    socket.on('startGame', () => {
        if (playerIds.length < 1) return; // Test için 1 kişi yeterli, normalde 2
        gameStarted = true;
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

    // 4. Mülk Satın Alma
    socket.on('buyProperty', (index, price) => {
        const player = players[socket.id];
        if (player.money >= price && !gameState.properties[index]) {
            player.money -= price;
            gameState.properties[index] = { owner: socket.id, level: 0, mortgaged: false };
            io.emit('propertyUpdate', { index, property: gameState.properties[index], money: player.money, ownerId: socket.id });
        }
    });

    // 5. Ev Kurma (Geliştirme)
    socket.on('upgradeProperty', (index, price) => {
        const player = players[socket.id];
        const prop = gameState.properties[index];
        if (player && prop && prop.owner === socket.id && player.money >= price && prop.level < 5) {
            player.money -= price;
            prop.level++;
            io.emit('propertyUpdate', { index, property: prop, money: player.money, ownerId: socket.id });
        }
    });

    // 6. Kira Ödeme
    socket.on('payRent', (amount, ownerId) => {
        const payer = players[socket.id];
        const owner = players[ownerId];
        if (payer) {
            payer.money -= amount;
            if (owner) owner.money += amount;
            io.emit('moneyUpdate', { players });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        playerIds = playerIds.filter(id => id !== socket.id);
        io.emit('updateLobby', Object.values(players));
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
