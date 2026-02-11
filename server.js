const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('OK'));

// GAME STATE
const rooms = {};
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

const CHANCE_CARDS = [
    { text: 'Bankadan 200₺ alın!', money: 200 },
    { text: 'Her oyuncudan 50₺ alın!', type: 'birthday' },
    { text: '100₺ ceza ödeyin!', money: -100 },
    { text: 'Başlangıca gidin, 200₺ alın!', type: 'go' },
    { text: 'Hapse gidin!', type: 'jail' }
];

const CHEST_CARDS = [
    { text: 'Banka hatası! 200₺ alın!', money: 200 },
    { text: 'Doktor ücreti! 100₺ ödeyin!', money: -100 },
    { text: 'Yarışma kazandınız! 100₺', money: 100 },
    { text: 'Hapse gidin!', type: 'jail' }
];

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            hostId: socket.id,
            players: [{
                id: socket.id,
                name: data.name,
                avatar: data.avatar,
                money: 1500,
                position: 0,
                properties: [],
                houses: {},
                inJail: false,
                jailTurns: 0,
                bankrupt: false,
                isHost: true,
                color: COLORS[0]
            }],
            gameStarted: false,
            currentTurnIndex: 0,
            properties: {},
            lastDice: null
        };
        
        socket.join(roomCode);
        socket.emit('roomJoined', { roomCode, isHost: true });
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });
    
    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return socket.emit('error', 'Oda bulunamadı!');
        if (room.players.length >= 6) return socket.emit('error', 'Oda dolu!');
        if (room.gameStarted) return socket.emit('error', 'Oyun başlamış!');
        
        const player = {
            id: socket.id,
            name: data.name,
            avatar: data.avatar,
            money: 1500,
            position: 0,
            properties: [],
            houses: {},
            inJail: false,
            jailTurns: 0,
            bankrupt: false,
            isHost: false,
            color: COLORS[room.players.length]
        };
        
        room.players.push(player);
        socket.join(data.roomCode);
        socket.emit('roomJoined', { roomCode: data.roomCode, isHost: false });
        io.to(data.roomCode).emit('updatePlayers', room.players);
    });
    
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        if (room.players.length < 2) return socket.emit('error', 'En az 2 oyuncu gerekli!');
        
        room.gameStarted = true;
        room.currentTurnIndex = 0;
        
        io.to(roomCode).emit('gameStarted', {
            players: room.players,
            currentTurnId: room.players[0].id
        });
    });
    
    socket.on('rollDice', (data) => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        const currentPlayer = room.players[room.currentTurnIndex];
        
        if (currentPlayer.id !== socket.id) return socket.emit('error', 'Sıra sende değil!');
        if (player.bankrupt) return;
        
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;
        const isDoubles = die1 === die2;
        
        room.lastDice = { die1, die2, playerId: socket.id };
        
        // Jail handling
        if (player.inJail) {
            if (isDoubles) {
                player.inJail = false;
                player.jailTurns = 0;
                io.to(room.code).emit('jailChange', { playerId: socket.id, inJail: false });
            } else {
                player.jailTurns++;
                if (player.jailTurns >= 3) {
                    player.money -= 50;
                    player.inJail = false;
                    player.jailTurns = 0;
                    io.to(room.code).emit('jailChange', { playerId: socket.id, inJail: false });
                } else {
                    io.to(room.code).emit('diceRolled', {
                        playerId: socket.id,
                        die1, die2,
                        newPosition: player.position,
                        money: player.money
                    });
                    if (!isDoubles) nextTurn(room);
                    return;
                }
            }
        }
        
        // Move player
        const oldPos = player.position;
        player.position = (player.position + total) % 40;
        
        // Pass GO
        if (player.position < oldPos) {
            player.money += 200;
        }
        
        // Go to Jail tile
        if (player.position === 30) {
            player.position = 10;
            player.inJail = true;
            player.jailTurns = 0;
            io.to(room.code).emit('jailChange', { playerId: socket.id, inJail: true, jailTurns: 0 });
        }
        
        io.to(room.code).emit('diceRolled', {
            playerId: socket.id,
            die1, die2,
            newPosition: player.position,
            money: player.money
        });
        
        // Handle tile landing
        setTimeout(() => {
            handleTileLanding(room, player);
            if (!isDoubles && !player.inJail) {
                setTimeout(() => nextTurn(room), 2000);
            }
        }, 1000);
    });
    
    socket.on('buyProperty', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !room.lastDice || room.lastDice.playerId !== socket.id) return;
        
        const position = player.position;
        const tile = getTileData(position);
        
        if (tile.type !== 'property' || room.properties[position]) return;
        if (player.money < tile.price) return socket.emit('error', 'Yeterli paranız yok!');
        
        player.money -= tile.price;
        player.properties.push(position);
        room.properties[position] = socket.id;
        
        io.to(room.code).emit('propertyBought', {
            playerId: socket.id,
            position,
            money: player.money
        });
    });
    
    socket.on('payBail', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.inJail || player.money < 50) return;
        
        player.money -= 50;
        player.inJail = false;
        player.jailTurns = 0;
        
        io.to(room.code).emit('jailChange', { playerId: socket.id, inJail: false });
    });
    
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        for (const code in rooms) {
            const room = rooms[code];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                
                if (room.players.length === 0) {
                    delete rooms[code];
                } else {
                    if (room.hostId === socket.id) {
                        room.hostId = room.players[0].id;
                        room.players[0].isHost = true;
                    }
                    io.to(code).emit('updatePlayers', room.players);
                }
                break;
            }
        }
    });
});

function handleTileLanding(room, player) {
    const tile = getTileData(player.position);
    
    if (tile.type === 'property') {
        const owner = room.properties[player.position];
        
        if (!owner) {
            io.to(player.id).emit('propertyOffer', { position: player.position });
        } else if (owner !== player.id) {
            const ownerPlayer = room.players.find(p => p.id === owner);
            const rent = calculateRent(room, player.position, ownerPlayer);
            
            if (player.money >= rent) {
                player.money -= rent;
                ownerPlayer.money += rent;
                
                io.to(room.code).emit('rentPaid', {
                    payerId: player.id,
                    receiverId: owner,
                    amount: rent,
                    payerMoney: player.money,
                    receiverMoney: ownerPlayer.money
                });
            } else {
                handleBankruptcy(room, player);
            }
        }
    } else if (tile.type === 'chance') {
        const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
        handleCard(room, player, card, 'chance');
    } else if (tile.type === 'chest') {
        const card = CHEST_CARDS[Math.floor(Math.random() * CHEST_CARDS.length)];
        handleCard(room, player, card, 'chest');
    } else if (tile.type === 'tax') {
        player.money -= tile.amount;
    }
}

function calculateRent(room, position, owner) {
    const tile = getTileData(position);
    const houses = room.properties[position + '_houses'] || 0;
    return tile.rent[houses];
}

function handleCard(room, player, card, type) {
    if (card.money) {
        player.money += card.money;
    } else if (card.type === 'jail') {
        player.position = 10;
        player.inJail = true;
        player.jailTurns = 0;
        io.to(room.code).emit('jailChange', { playerId: player.id, inJail: true, jailTurns: 0 });
    } else if (card.type === 'go') {
        player.position = 0;
        player.money += 200;
    } else if (card.type === 'birthday') {
        room.players.forEach(p => {
            if (p.id !== player.id) {
                p.money -= 50;
                player.money += 50;
            }
        });
    }
    
    io.to(room.code).emit('cardDrawn', { playerId: player.id, type, text: card.text });
}

function handleBankruptcy(room, player) {
    player.bankrupt = true;
    player.money = 0;
    
    io.to(room.code).emit('playerBankrupt', { playerId: player.id });
    
    const activePlayers = room.players.filter(p => !p.bankrupt);
    if (activePlayers.length === 1) {
        io.to(room.code).emit('gameOver', { winnerId: activePlayers[0].id });
    }
}

function nextTurn(room) {
    do {
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    } while (room.players[room.currentTurnIndex].bankrupt);
    
    const currentPlayer = room.players[room.currentTurnIndex];
    io.to(room.code).emit('turnChange', { currentTurnId: currentPlayer.id });
}

function getTileData(position) {
    const tiles = [
        {name:"BAŞLANGIÇ",type:"corner"},
        {name:"Kadıköy",type:"property",price:60,rent:[2,10,30,90,160,250],color:"#8B4513",group:"brown",housePrice:50},
        {name:"Kamu Fonu",type:"chest"},
        {name:"Moda",type:"property",price:60,rent:[4,20,60,180,320,450],color:"#8B4513",group:"brown",housePrice:50},
        {name:"Gelir Vergisi",type:"tax",amount:200},
        {name:"Haydarpaşa Garı",type:"railroad",price:200,rent:[25,50,100,200]},
        {name:"Beşiktaş",type:"property",price:100,rent:[6,30,90,270,400,550],color:"#87CEEB",group:"lightblue",housePrice:50},
        {name:"Şans",type:"chance"},
        {name:"Ortaköy",type:"property",price:100,rent:[6,30,90,270,400,550],color:"#87CEEB",group:"lightblue",housePrice:50},
        {name:"Bebek",type:"property",price:120,rent:[8,40,100,300,450,600],color:"#87CEEB",group:"lightblue",housePrice:50},
        {name:"ZİYARET",type:"corner"},
        {name:"Şişli",type:"property",price:140,rent:[10,50,150,450,625,750],color:"#FF69B4",group:"pink",housePrice:100},
        {name:"Elektrik",type:"utility",price:150},
        {name:"Mecidiyeköy",type:"property",price:140,rent:[10,50,150,450,625,750],color:"#FF69B4",group:"pink",housePrice:100},
        {name:"Gayrettepe",type:"property",price:160,rent:[12,60,180,500,700,900],color:"#FF69B4",group:"pink",housePrice:100},
        {name:"Sirkeci",type:"railroad",price:200,rent:[25,50,100,200]},
        {name:"Fatih",type:"property",price:180,rent:[14,70,200,550,750,950],color:"#FFA500",group:"orange",housePrice:100},
        {name:"Kamu Fonu",type:"chest"},
        {name:"Aksaray",type:"property",price:180,rent:[14,70,200,550,750,950],color:"#FFA500",group:"orange",housePrice:100},
        {name:"Eminönü",type:"property",price:200,rent:[16,80,220,600,800,1000],color:"#FFA500",group:"orange",housePrice:100},
        {name:"PARK",type:"corner"},
        {name:"Taksim",type:"property",price:220,rent:[18,90,250,700,875,1050],color:"#FF0000",group:"red",housePrice:150},
        {name:"Şans",type:"chance"},
        {name:"İstiklal",type:"property",price:220,rent:[18,90,250,700,875,1050],color:"#FF0000",group:"red",housePrice:150},
        {name:"Beyoğlu",type:"property",price:240,rent:[20,100,300,750,925,1100],color:"#FF0000",group:"red",housePrice:150},
        {name:"Karaköy",type:"railroad",price:200,rent:[25,50,100,200]},
        {name:"Sarıyer",type:"property",price:260,rent:[22,110,330,800,975,1150],color:"#FFFF00",group:"yellow",housePrice:150},
        {name:"Tarabya",type:"property",price:260,rent:[22,110,330,800,975,1150],color:"#FFFF00",group:"yellow",housePrice:150},
        {name:"Su",type:"utility",price:150},
        {name:"Yeniköy",type:"property",price:280,rent:[24,120,360,850,1025,1200],color:"#FFFF00",group:"yellow",housePrice:150},
        {name:"KODESE GİT",type:"corner"},
        {name:"Etiler",type:"property",price:300,rent:[26,130,390,900,1100,1275],color:"#008000",group:"green",housePrice:200},
        {name:"Levent",type:"property",price:300,rent:[26,130,390,900,1100,1275],color:"#008000",group:"green",housePrice:200},
        {name:"Kamu Fonu",type:"chest"},
        {name:"Maslak",type:"property",price:320,rent:[28,150,450,1000,1200,1400],color:"#008000",group:"green",housePrice:200},
        {name:"Halkalı",type:"railroad",price:200,rent:[25,50,100,200]},
        {name:"Şans",type:"chance"},
        {name:"Nişantaşı",type:"property",price:350,rent:[35,175,500,1100,1300,1500],color:"#00008B",group:"darkblue",housePrice:200},
        {name:"Lüks Vergisi",type:"tax",amount:100},
        {name:"Maçka",type:"property",price:400,rent:[50,200,600,1400,1700,2000],color:"#00008B",group:"darkblue",housePrice:200}
    ];
    return tiles[position];
}

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (rooms[code]);
    return code;
}

function findPlayerRoom(playerId) {
    for (const code in rooms) {
        if (rooms[code].players.find(p => p.id === playerId)) {
            return rooms[code];
        }
    }
    return null;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`
╔════════════════════════════════╗
║   MONOPOLY SERVER RUNNING      ║
║   Port: ${PORT}                 ║
║   Status: ✅ ONLINE            ║
╚════════════════════════════════╝
    `);
});
