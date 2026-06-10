const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

// Logika mencocokkan tebakan
function checkGuess(guess, secret) {
    let result = Array(guess.length).fill('red');
    let secretArr = secret.split('');
    let guessArr = guess.split('');

    // Cek posisi benar (Hijau)
    for (let i = 0; i < guess.length; i++) {
        if (guessArr[i] === secretArr[i]) {
            result[i] = 'green';
            secretArr[i] = null; 
            guessArr[i] = null;
        }
    }
    // Cek angka ada tapi posisi salah (Kuning)
    for (let i = 0; i < guess.length; i++) {
        if (guessArr[i] !== null && secretArr.includes(guessArr[i])) {
            result[i] = 'yellow';
            secretArr[secretArr.indexOf(guessArr[i])] = null;
        }
    }
    return result;
}

io.on('connection', (socket) => {
    socket.on('createRoom', (opts) => {
        const digits = opts && opts.digits ? parseInt(opts.digits) : 4;
        const roundTime = opts && opts.roundTime ? parseInt(opts.roundTime) : 20;
        const name = opts && opts.name ? String(opts.name) : 'Player1';
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            ownerId: socket.id,
            players: { [socket.id]: { id: 1, name } },
            digits: digits,
            roundTime: roundTime,
            secrets: {},
            guesses: {},
            history: [],
            roundActive: false,
            timeoutId: null,
            finished: false
        };
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
    });

    socket.on('joinRoom', (payload) => {
        const roomId = payload && payload.roomId ? payload.roomId : null;
        const name = payload && payload.name ? String(payload.name) : 'Player2';
        if (roomId && rooms[roomId] && Object.keys(rooms[roomId].players).length === 1) {
            rooms[roomId].players[socket.id] = { id: 2, name };
            socket.join(roomId);
            const playersMap = {};
            for (let id of Object.keys(rooms[roomId].players)) {
                playersMap[id] = rooms[roomId].players[id].name;
            }
            io.to(roomId).emit('gameStart', { digits: rooms[roomId].digits, roundTime: rooms[roomId].roundTime, players: playersMap, ownerId: rooms[roomId].ownerId });
        } else {
            socket.emit('errorMsg', 'Room penuh atau tidak ditemukan!');
        }
    });

    socket.on('setSecret', ({ roomId, secret }) => {
        const room = rooms[roomId];
        if (room) {
            room.secrets[socket.id] = secret;
            if (Object.keys(room.secrets).length === 2) {
                startRound(roomId);
            }
        }
    });

    socket.on('submitGuess', ({ roomId, guess }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.guesses[socket.id] = guess;

        // Jika semua pemain sudah mengirim tebakan, akhiri ronde lebih cepat
        const playersCount = Object.keys(room.players).length;
        const guessesCount = Object.keys(room.guesses).length;
        if (room.roundActive && guessesCount >= playersCount) {
            if (room.timeoutId) {
                clearTimeout(room.timeoutId);
                room.timeoutId = null;
            }
            endRound(roomId);
        }
    });

    function startRound(roomId) {
        const room = rooms[roomId];
        if (!room) return;
        room.guesses = {}; // Reset tebakan
        const seconds = room.roundTime || 20;
        io.to(roomId).emit('roundStart', seconds);

        // Set round active and save timeout id so it can be cleared if both guesses arrive early
        room.roundActive = true;
        if (room.timeoutId) {
            clearTimeout(room.timeoutId);
            room.timeoutId = null;
        }
        room.timeoutId = setTimeout(() => {
            room.timeoutId = null;
            endRound(roomId);
        }, seconds * 1000);
    }

    function endRound(roomId) {
        const room = rooms[roomId];
        if (!room) return;

        // Prevent double execution
        if (!room.roundActive) return;
        room.roundActive = false;
        if (room.timeoutId) {
            clearTimeout(room.timeoutId);
            room.timeoutId = null;
        }

        const players = Object.keys(room.players);
        // find by stored id (1/2)
        const p1Id = players.find(id => room.players[id].id === 1);
        const p2Id = players.find(id => room.players[id].id === 2);

        const p1Secret = room.secrets[p1Id];
        const p2Secret = room.secrets[p2Id];
        const p1Guess = room.guesses[p1Id] || '0'.repeat(room.digits);
        const p2Guess = room.guesses[p2Id] || '0'.repeat(room.digits);

        // Cek hasil (P1 menebak rahasia P2, P2 menebak rahasia P1)
        const p1Result = checkGuess(p1Guess, p2Secret);
        const p2Result = checkGuess(p2Guess, p1Secret);

        const p1Win = p1Guess === p2Secret;
        const p2Win = p2Guess === p1Secret;

        const roundData = {
            [p1Id]: { guess: p1Guess, result: p1Result, win: p1Win },
            [p2Id]: { guess: p2Guess, result: p2Result, win: p2Win }
        };

        io.to(roomId).emit('roundResult', roundData);

        if (p1Win || p2Win) {
            io.to(roomId).emit('gameOver', { p1Win, p2Win });
            // mark finished but keep room for rematch
            room.finished = true;
        } else {
            // Lanjut ronde berikutnya setelah jeda 3 detik
            setTimeout(() => startRound(roomId), 3000);
        }
    }

    socket.on('requestRematch', ({ roomId, digits, roundTime }) => {
        const room = rooms[roomId];
        if (!room) return;
        // only owner can request rematch
        if (socket.id !== room.ownerId) return;
        // update settings if provided
        if (digits) room.digits = parseInt(digits);
        if (roundTime) room.roundTime = parseInt(roundTime);
        // reset secrets/guesses/history
        room.secrets = {};
        room.guesses = {};
        room.history = [];
        room.finished = false;
        // inform clients that rematch requested
        io.to(roomId).emit('rematchRequested');
        // start new setup flow
        const playersMap = {};
        for (let id of Object.keys(room.players)) playersMap[id] = room.players[id].name;
        io.to(roomId).emit('gameStart', { digits: room.digits, roundTime: room.roundTime, players: playersMap, ownerId: room.ownerId });
    });
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});