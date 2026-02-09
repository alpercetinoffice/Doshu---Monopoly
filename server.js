const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentPlayerIndex = 0;
let playerIds = [];

// Basit oyun durumu
const gameState = {
    properties: {}, // Satın alınan mülkler: { propertyIndex: ownerId }
    houses: {}      // Ev sayıları: { propertyIndex: count }
};

io.on('connection', (socket) => {
    console.log('Bir oyuncu bağlandı:', socket.id);

    // Yeni oyuncu oluştur
    players[socket.id] = {
        id: socket.id,
        color: getRandomColor(),
        position: 0,
        money: 1500,
        jail: false,
        name: `Oyuncu ${playerIds.length + 1}`
    };
    playerIds.push(socket.id);

    // Mevcut durumu gönder
    socket.emit('init', { 
        id: socket.id, 
        players: players, 
        gameState: gameState,
        currentTurn: playerIds[currentPlayerIndex] 
    });

    // Diğerlerine haber ver
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Zar atma
    socket.on('rollDice', () => {
        if (socket.id !== playerIds[currentPlayerIndex]) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        const player = players[socket.id];
        
        // Hapishane kontrolü (basitleştirilmiş)
        if (player.jail) {
            if (isDouble) {
                player.jail = false;
            } else {
                nextTurn();
                io.emit('diceResult', { die1, die2, move: false, playerId: socket.id });
                return;
            }
        }

        // Hareket
        player.position = (player.position + total) % 40;
        
        // Başlangıçtan geçme parası
        if (player.position < total && player.position !== 0) { // Basit kontrol
             player.money += 200;
        }

        io.emit('diceResult', { die1, die2, move: true, playerId: socket.id, newPosition: player.position, money: player.money });
        
        // Sıra yönetimi (Çift atarsa tekrar atar mantığı eklenebilir, burada basit tutuldu)
        if (!isDouble) {
            nextTurn();
        }
    });

    // Mülk Satın Alma
    socket.on('buyProperty', (propertyIndex, price) => {
        const player = players[socket.id];
        if (player.money >= price && !gameState.properties[propertyIndex]) {
            player.money -= price;
            gameState.properties[propertyIndex] = socket.id;
            io.emit('propertyBought', { propertyIndex, ownerId: socket.id, money: player.money });
        }
    });

    // Kira ödeme
    socket.on('payRent', (amount, ownerId) => {
        const player = players[socket.id];
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
        if (currentPlayerIndex >= playerIds.length) currentPlayerIndex = 0;
        io.emit('playerLeft', socket.id);
    });
});

function nextTurn() {
    currentPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
    io.emit('turnChange', playerIds[currentPlayerIndex]);
}

function getRandomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});
