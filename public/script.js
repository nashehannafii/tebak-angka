const socket = typeof io === 'function' ? io() : null;
const multiplayerOnline = Boolean(socket && !socket.offline);

let currentRoomId = null;
let gameDigits = 4;
let timerInterval;
let localName = '';
let opponentName = '';
let roomOwnerId = null;
let amOwner = false;
let myScore = 0;
let opponentScore = 0;

// UI Elements
const ui = {
    menu: document.getElementById('menu'),
    waitingRoom: document.getElementById('waitingRoom'),
    setSecretScreen: document.getElementById('setSecretScreen'),
    gameArea: document.getElementById('gameArea'),
    roomCodeDisplay: document.getElementById('roomCodeDisplay'),
    digitLenDisplay: document.getElementById('digitLen'),
    timerDisplay: document.getElementById('timerDisplay'),
    statusInfo: document.getElementById('statusInfo'),
    myHistory: document.getElementById('myHistory'),
    opponentHistory: document.getElementById('opponentHistory'),
    myScoreDisplay: document.getElementById('myScoreDisplay'),
    opponentScoreDisplay: document.getElementById('opponentScoreDisplay'),
    guessBtn: document.getElementById('guessBtn'),
    secretInputContainer: document.getElementById('secretInputContainer'),
    guessInputContainer: document.getElementById('guessInputContainer')
};

function updateScoreDisplay() {
    ui.myScoreDisplay.innerText = myScore;
    ui.opponentScoreDisplay.innerText = opponentScore;
}

function switchView(viewElement) {
    ui.menu.classList.add('hidden');
    ui.waitingRoom.classList.add('hidden');
    ui.setSecretScreen.classList.add('hidden');
    ui.gameArea.classList.add('hidden');
    viewElement.classList.remove('hidden');
}

function showOfflineNotice() {
    const errorTxt = document.getElementById('errorTxt');
    if (errorTxt) {
        errorTxt.innerText = 'Mode demo: Vercel hanya melayani frontend. Multiplayer Socket.IO butuh backend Node.js terpisah.';
    }
}

// --- Menu Actions ---
function createRoom() {
    if (!multiplayerOnline) {
        showOfflineNotice();
        alert('Multiplayer tidak aktif di deployment Vercel ini. Jalankan backend Node.js/socket.io terpisah untuk fitur penuh.');
        return;
    }
    const digits = document.getElementById('digitsInput').value;
    const roundTime = document.getElementById('roundTimeInput').value || 20;
    localName = document.getElementById('createNameInput').value || 'Player1';
    socket.emit('createRoom', { digits, roundTime, name: localName });
}

function joinRoom() {
    if (!multiplayerOnline) {
        showOfflineNotice();
        alert('Multiplayer tidak aktif di deployment Vercel ini. Jalankan backend Node.js/socket.io terpisah untuk fitur penuh.');
        return;
    }
    const code = document.getElementById('joinCode').value.toUpperCase();
    if (code) {
        currentRoomId = code; // <-- Ini kunci perbaikannya
        localName = document.getElementById('joinNameInput').value || 'Player2';
        socket.emit('joinRoom', { roomId: code, name: localName });
    }
}

// --- Socket Listeners ---
socket.on('roomCreated', (roomId) => {
    currentRoomId = roomId;
    ui.roomCodeDisplay.innerText = roomId;
    switchView(ui.waitingRoom);
    // show local name in waiting view
    const myNameEl = document.getElementById('myNameDisplay');
    if (myNameEl) myNameEl.innerText = localName;
});

if (!multiplayerOnline) {
    showOfflineNotice();
}

socket.on('errorMsg', (msg) => {
    document.getElementById('errorTxt').innerText = msg;
});

socket.on('gameStart', (payload) => {
    // payload: { digits, roundTime, players, ownerId }
    let digits = 4;
    if (payload && typeof payload === 'object') {
        digits = payload.digits || 4;
        roomOwnerId = payload.ownerId || null;
        // players: { socketId: name }
        if (payload.players) {
            // find opponent name
            const ids = Object.keys(payload.players);
            for (let id of ids) {
                if (id === socket.id) continue;
                opponentName = payload.players[id];
            }
            // if opponent not found yet, set placeholder
            if (!opponentName) opponentName = '-';
        }
    } else {
        digits = payload;
    }
    gameDigits = digits;
    ui.digitLenDisplay.innerText = digits;
    // update name displays
    const myNameGame = document.getElementById('myNameDisplayGame');
    const oppNameGame = document.getElementById('opponentNameDisplayGame');
    if (myNameGame) myNameGame.innerText = localName || 'Anda';
    if (oppNameGame) oppNameGame.innerText = opponentName || '-';
    // waitingRoom also show opponent
    const oppWait = document.getElementById('opponentNameDisplay');
    if (oppWait) oppWait.innerText = opponentName || '-';

    amOwner = roomOwnerId === socket.id;
    // hide/show rematch area
    document.getElementById('rematchArea').classList.add('hidden');

    if (payload && payload.scores) {
        myScore = payload.scores[socket.id] || 0;
        const opponentId = Object.keys(payload.players || {}).find(id => id !== socket.id);
        opponentScore = opponentId ? payload.scores[opponentId] || 0 : 0;
        updateScoreDisplay();
    }

    clearHistoryUI();
    switchView(ui.setSecretScreen);
    renderSecretInputs(digits);
});

function clearHistoryUI() {
    ui.myHistory.innerHTML = '';
    ui.opponentHistory.innerHTML = '';
}

function lockSecret() {
    if (!multiplayerOnline) {
        showOfflineNotice();
        return;
    }
    const secret = getContainerValue('secretInputContainer');
    if (secret.length != gameDigits || !/^\d+$/.test(secret)) {
        alert(`Harus tepat ${gameDigits} digit!`);
        return;
    }
    socket.emit('setSecret', { roomId: currentRoomId, secret });
    document.getElementById('secretStatus').innerText = "Menunggu lawan mengunci angka...";
}

socket.on('roundStart', (seconds) => {
    switchView(ui.gameArea);
    
    // --- INI BARIS YANG DITAMBAHKAN ---
    document.getElementById('secretStatus').innerText = ""; 
    // ----------------------------------
    renderGuessInputs(gameDigits);
    ui.guessBtn.disabled = false;
    ui.statusInfo.innerText = "Mulai menebak!";
    
    let time = seconds;
    ui.timerDisplay.innerText = `Waktu: ${time}s`;
    clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        time--;
        ui.timerDisplay.innerText = `Waktu: ${time}s`;
        if (time <= 0) {
            clearInterval(timerInterval);
            ui.guessBtn.disabled = true;
            ui.statusInfo.innerText = "Waktu Habis! Menilai tebakan...";
        }
    }, 1000);
});

function submitGuess() {
    if (!multiplayerOnline) {
        showOfflineNotice();
        return;
    }
    let guess = getContainerValue('guessInputContainer');
    if (guess.length != gameDigits || !/^\d+$/.test(guess)) {
        alert(`Tebakan harus ${gameDigits} digit!`);
        return;
    }
    ui.guessBtn.disabled = true; // Kunci setelah nebak
    ui.statusInfo.innerText = "Tebakan terkirim. Menunggu waktu habis...";
    socket.emit('submitGuess', { roomId: currentRoomId, guess });
}

function renderSecretInputs(len) {
    renderInputs('secretInputContainer', len);
}

function renderGuessInputs(len) {
    renderInputs('guessInputContainer', len);
}

function renderInputs(containerId, len) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < len; i++) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.inputMode = 'numeric';
        inp.maxLength = 1;
        inp.className = 'digit-input';
        inp.autocomplete = 'off';
        inp.addEventListener('input', (e) => {
            const val = e.target.value.replace(/[^0-9]/g, '');
            e.target.value = val;
            if (val && e.target.nextElementSibling) e.target.nextElementSibling.focus();
        });
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && e.target.previousElementSibling) {
                e.target.previousElementSibling.focus();
            }
        });
        container.appendChild(inp);
    }
    const first = container.querySelector('input');
    if (first) first.focus();
}

function getContainerValue(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return '';
    const inputs = Array.from(container.querySelectorAll('input'));
    return inputs.map(i => i.value || '').join('');
}

socket.on('roundResult', (data) => {
    const myData = data[socket.id];
    let opponentId = Object.keys(data).find(id => id !== socket.id);
    const opponentData = data[opponentId];

    appendHistory(ui.myHistory, myData.guess, myData.result);
    // Untuk lawan, kita tunjukkan warnanya tapi sembunyikan angkanya (opsional, tapi biar adil kita tampilkan saja tebakannya)
    appendHistory(ui.opponentHistory, opponentData.guess, opponentData.result);
});

socket.on('gameOver', ({ p1Win, p2Win, scores }) => {
    clearInterval(timerInterval);
    if (scores) {
        myScore = scores[socket.id] || 0;
        const opponentId = Object.keys(scores).find(id => id !== socket.id);
        opponentScore = opponentId ? scores[opponentId] || 0 : 0;
        updateScoreDisplay();
    }
    if (p1Win && p2Win) {
        ui.statusInfo.innerText = "GAME OVER! HASIL: SERI!";
    } else if (p1Win) {
        ui.statusInfo.innerText = "GAME OVER! PLAYER 1 MENANG!";
    } else {
        ui.statusInfo.innerText = "GAME OVER! PLAYER 2 MENANG!";
    }
    ui.timerDisplay.innerText = "Selesai";
    // show rematch UI
    document.getElementById('rematchArea').classList.remove('hidden');
    if (amOwner) {
        document.getElementById('rematchOwnerControls').classList.remove('hidden');
        document.getElementById('rematchWaiting').classList.add('hidden');
        // prefill with current settings
        document.getElementById('rematchDigitsInput').value = gameDigits;
        // roundTime unknown here on client side; leave default
    } else {
        document.getElementById('rematchOwnerControls').classList.add('hidden');
        document.getElementById('rematchWaiting').classList.remove('hidden');
    }
});

function appendHistory(container, guess, resultArr) {
    const row = document.createElement('div');
    row.className = 'guess-row';
    for (let i = 0; i < gameDigits; i++) {
        const block = document.createElement('div');
        block.className = `digit-block ${resultArr[i]}`;
        block.innerText = guess[i] || '-';
        row.appendChild(block);
    }
    container.appendChild(row);
}

function requestRematch() {
    if (!multiplayerOnline) {
        showOfflineNotice();
        return;
    }
    const digits = parseInt(document.getElementById('rematchDigitsInput').value) || gameDigits;
    const roundTime = parseInt(document.getElementById('rematchRoundTimeInput').value) || 20;
    socket.emit('requestRematch', { roomId: currentRoomId, digits, roundTime });
    // owner waits for players to ready (we'll hide owner controls to prevent dup)
    document.getElementById('rematchOwnerControls').classList.add('hidden');
    document.getElementById('rematchWaiting').classList.remove('hidden');
}

socket.on('rematchRequested', () => {
    // non-owner will see waiting message (owner already sees it after requesting)
    document.getElementById('rematchArea').classList.remove('hidden');
    document.getElementById('rematchOwnerControls').classList.add('hidden');
    document.getElementById('rematchWaiting').classList.remove('hidden');
});