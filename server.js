const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// --- ÖNEMLİ GÜNCELLEME: CORS AYARLARI ---
const io = require('socket.io')(http, {
    cors: {
        // Sadece senin sitene ve yerel test ortamına izin veriyoruz
        origin: [
            "https://doshu.gamer.gd", 
            "http://doshu.gamer.gd",
            "http://localhost:3000",
            "http://127.0.0.1:5500" // Eğer VS Code Live Server kullanıyorsan
        ],
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Render'da statik dosya sunmaya gerek yok ama hata vermemesi için kalsın
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
        // Sıra kontrolü
        if (playerIds.length > 0 && socket.id !== playerIds[currentPlayerIndex]) return;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDouble = die1 === die2;

        const player = players[socket.id];
        if (!player) return; // Güvenlik kontrolü
        
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
        if (player.position < total && player.position !== 0) { 
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
        if (player && player.money >= price && !gameState.properties[propertyIndex]) {
            player.money -= price;
            gameState.properties[propertyIndex] = socket.id;
            io.emit('propertyBought', { propertyIndex, ownerId: socket.id, money: player.money });
        }
    });

    // Kira ödeme
    socket.on('payRent', (amount, ownerId) => {
        const player = players[socket.id];
        
        // Bankaya ödeme (Vergi vb.)
        if (ownerId === 'bank') {
            if (player) {
                player.money -= amount;
                io.emit('rentPaid', { payerId: socket.id, receiverId: 'bank', amount, payerMoney: player.money, receiverMoney: 0 });
            }
            return;
        }

        // Oyuncuya ödeme
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
        
        // Eğer giden oyuncu sıradaki oyuncuysa sırayı kaydır
        if (currentPlayerIndex >= playerIds.length) {
            currentPlayerIndex = 0;
        }
        
        // Oyuncu gittikten sonra kalanlara bildir
        io.emit('playerLeft', socket.id);
        
        // Eğer oyun devam ediyorsa sırayı güncelle
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
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});
