const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// --- CİDDİ GÜNCELLEME: CORS ve WebSocket Ayarları ---
const io = require('socket.io')(http, {
    cors: {
        // origin kısmını bir fonksiyon yaparak esneklik sağlıyoruz
        origin: function (origin, callback) {
            const allowedOrigins = [
                "https://doshu.gamer.gd", 
                "http://doshu.gamer.gd",
                "http://localhost:3000",
                "http://127.0.0.1:5500"
            ];
            // Eğer origin listede varsa veya origin yoksa (server-to-server) izin ver
            if (!origin || allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                console.log("Engellenen Origin:", origin); // Loglardan kimin engellendiğini görebilirsin
                callback(new Error('CORS not allowed'));
            }
        },
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentPlayerIndex = 0;
let playerIds = [];

const gameState = {
    properties: {}, 
    houses: {}      
};

io.on('connection', (socket) => {
    console.log('Bağlantı başarılı! ID:', socket.id);

    players[socket.id] = {
        id: socket.id,
        color: getRandomColor(),
        position: 0,
        money: 1500,
        jail: false,
        name: `Oyuncu ${playerIds.length + 1}`
    };
    playerIds.push(socket.id);

    socket.emit('init', { 
        id: socket.id, 
        players: players, 
        gameState: gameState,
        currentTurn: playerIds[currentPlayerIndex] 
    });

    socket.broadcast.emit('playerJoined', players[socket.id]);

    socket.on('rollDice', () => {
        if (playerIds.length > 0 && socket.id !== playerIds[currentPlayerIndex]) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        const player = players[socket.id];
        if (!player) return;

        if (player.jail) {
            if (isDouble) {
                player.jail = false;
            } else {
                nextTurn();
                io.emit('diceResult', { die1, die2, move: false, playerId: socket.id });
                return;
            }
        }

        player.position = (player.position + total) % 40;
        
        if (player.position < total && player.position !== 0) { 
             player.money += 200;
        }

        io.emit('diceResult', { die1, die2, move: true, playerId: socket.id, newPosition: player.position, money: player.money });
        
        if (!isDouble) {
            nextTurn();
        }
    });

    socket.on('buyProperty', (propertyIndex, price) => {
        const player = players[socket.id];
        if (player && player.money >= price && !gameState.properties[propertyIndex]) {
            player.money -= price;
            gameState.properties[propertyIndex] = socket.id;
            io.emit('propertyBought', { propertyIndex, ownerId: socket.id, money: player.money });
        }
    });

    socket.on('payRent', (amount, ownerId) => {
        const player = players[socket.id];
        
        if (ownerId === 'bank') {
            if (player) {
                player.money -= amount;
                io.emit('rentPaid', { payerId: socket.id, receiverId: 'bank', amount, payerMoney: player.money, receiverMoney: 0 });
            }
            return;
        }

        const owner = players[ownerId];
        if (player && owner) {
            player.money -= amount;
            owner.money += amount;
            io.emit('rentPaid', { payerId: socket.id, receiverId: ownerId, amount, payerMoney: player.money, receiverMoney: owner.money });
        }
    });

    socket.on('disconnect', () => {
        console.log('Oyuncu ayrıldı:', socket.id);
        delete players[socket.id];
        playerIds = playerIds.filter(id => id !== socket.id);
        
        if (currentPlayerIndex >= playerIds.length) {
            currentPlayerIndex = 0;
        }
        
        io.emit('playerLeft', socket.id);
        
        if (playerIds.length > 0) {
            io.emit('turnChange', playerIds[currentPlayerIndex]);
        }
    });
});

function nextTurn() {
    if (playerIds.length === 0) return;
    currentPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
    io.emit('turnChange', playerIds[currentPlayerIndex]);
}

function getRandomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Sunucu çalışıyor port: ${PORT}`);
});
