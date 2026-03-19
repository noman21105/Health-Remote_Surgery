const socket = io();

// DOM Elements
const statusSpan = document.getElementById('connection-status');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const sessionIdDisplay = document.getElementById('session-id-display');
const sessionInfo = document.getElementById('session-info');
const reportLink = document.getElementById('report-link');
const logList = document.getElementById('log-list');
const messagesList = document.getElementById('messages-list');

const valHr = document.getElementById('val-hr');
const valO2 = document.getElementById('val-o2');
const valBpSys = document.getElementById('val-bpsys');
const valBpDia = document.getElementById('val-bpdia');
const stabilizerStatus = document.getElementById('stabilizer-status');

// State
let isRunning = false;
let currentSessionId = null;
let vitalsInterval = null;

// Normal Ranges
// HR: 60-100, O2: 96-100, BP: 90-120/60-80

// Current Vitals (start nominal)
let vitals = {
    hr: 75,
    o2: 98,
    bp_sys: 110,
    bp_dia: 70
};

let stabilizing = false;
let forceAbnormal = null; // 'hr', 'o2', etc.

function logAction(msg) {
    if (!logList) return;
    const li = document.createElement('li');
    li.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logList.prepend(li);
}

function addChatMessage(text, isAudio = false) {
    if (!messagesList) return;
    const div = document.createElement('div');
    div.className = 'chat-msg surgeon';
    let content = text;
    if (isAudio) {
        content = `🎤 ${text}`;
    }
    div.innerHTML = `${content} <span class="time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
    messagesList.appendChild(div);
    messagesList.scrollTop = messagesList.scrollHeight;
}

// Socket Connections
socket.on('connect', () => {
    statusSpan.textContent = '🔌 Connected';
    statusSpan.className = 'badge success';
    logAction('Connected to server via WebSocket');
});

socket.on('disconnect', () => {
    statusSpan.textContent = '🔌 Disconnected';
    statusSpan.className = 'badge disconnected';
    logAction('Disconnected from server');
    stopSession();
});

socket.on('session_started', (data) => {
    if (isRunning && !currentSessionId) {
        currentSessionId = data.session_id;
        if(sessionIdDisplay) sessionIdDisplay.textContent = currentSessionId;
        if (sessionInfo) sessionInfo.style.display = 'inline-block';
        if (reportLink) {
            reportLink.href = `/report/${currentSessionId}`;
            reportLink.style.display = 'none'; // Only show when ended
        }
        logAction(`Session #${currentSessionId} started.`);

        // Play video
        const video = document.getElementById('surgery-video');
        const overlay = document.getElementById('video-overlay');
        if (video) {
            let playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.then(_ => {
                  // Automatic playback started!
                  // Show playing UI.
                })
                .catch(error => {
                  // Auto-play was prevented
                  // Show paused UI.
                  console.warn("Video play blocked:", error);
                });
            }
            if (overlay) overlay.style.display = 'none';
        }
    }
});

socket.on('session_ended', (data) => {
    if (currentSessionId === data.session_id) {
        reportLink.style.display = 'inline-block';
        logAction(`Session #${currentSessionId} ended by command.`);
        currentSessionId = null;

        // Pause video
        const video = document.getElementById('surgery-video');
        const overlay = document.getElementById('video-overlay');
        if (video) {
            video.pause();
            video.currentTime = 0;
            if (overlay) overlay.style.display = 'flex';
        }
    }
});

socket.on('stabilize_vitals', (data) => {
    if (data.session_id === currentSessionId) {
        // Add exact text to chat UI
        if (data.text) {
            addChatMessage(data.text, !!data.audio_url);
        }
        logAction(`Stabilization triggered by surgeon.`);

        // Auto-play surgeon audio if provided
        if (data.audio_url) {
            const surgeonAudio = document.getElementById('surgeon-audio');
            if (surgeonAudio) {
                surgeonAudio.src = data.audio_url;
                surgeonAudio.play().catch(e => console.warn("Patient audio autoplay blocked:", e));
            }
        }

        stabilizing = true;
        forceAbnormal = null; // Clear override
        stabilizerStatus.textContent = "Stabilizing to baseline...";
        stabilizerStatus.style.color = "var(--warning)";

        // Let server know when we finish after some time, but we simulate it locally per tick
        setTimeout(() => {
            if (stabilizing && isRunning) {
                stabilizing = false;
                stabilizerStatus.textContent = "Stabilized";
                stabilizerStatus.style.color = "var(--success)";
                socket.emit('vitals_stabilized', { session_id: currentSessionId });
                logAction("Vitals stabilized successfully.");
                setTimeout(() => { stabilizerStatus.textContent = ""; }, 3000);
            }
        }, 30000); // 30 seconds to simulate stabilization fully completing
    }
});


// Simulation Logic
function generateRandomDelta(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function updateVitals() {
    if (stabilizing) {
        // Move towards nominal
        if (vitals.hr > 80) vitals.hr -= generateRandomDelta(1, 3);
        if (vitals.hr < 65) vitals.hr += generateRandomDelta(1, 3);
        if (vitals.o2 < 98) vitals.o2 += 1;
        if (vitals.bp_sys > 115) vitals.bp_sys -= generateRandomDelta(1, 2);
        if (vitals.bp_sys < 95) vitals.bp_sys += generateRandomDelta(1, 2);
    } else {
        // Normal drift
        vitals.hr += generateRandomDelta(-2, 2);
        vitals.o2 += (generateRandomDelta(0, 5) === 0) ? -1 : (vitals.o2 < 100 ? 1 : 0);
        vitals.bp_sys += generateRandomDelta(-3, 3);
        vitals.bp_dia += generateRandomDelta(-2, 2);

        // Clamping naturally unless forced
        if (forceAbnormal !== 'hr') {
            if (vitals.hr > 95) vitals.hr -= 2;
            if (vitals.hr < 65) vitals.hr += 2;
        } else {
            vitals.hr += generateRandomDelta(3, 6); // Aggressive climb
        }

        if (forceAbnormal !== 'o2') {
            if (vitals.o2 > 100) vitals.o2 = 100;
            if (vitals.o2 < 96) vitals.o2 += 1;
        } else {
            vitals.o2 -= generateRandomDelta(1, 2); // Aggressive drop
        }

        if (vitals.bp_sys > 125) vitals.bp_sys -= 2;
        if (vitals.bp_sys < 90) vitals.bp_sys += 2;
        if (vitals.bp_dia > 85) vitals.bp_dia -= 2;
        if (vitals.bp_dia < 60) vitals.bp_dia += 2;
    }

    // Update DOM
    valHr.textContent = vitals.hr;
    valO2.textContent = vitals.o2;
    valBpSys.textContent = vitals.bp_sys;
    valBpDia.textContent = vitals.bp_dia;

    // Local Visual Feedback
    document.getElementById('card-hr').className = (vitals.hr < 60 || vitals.hr > 100) ? 'reading-card abnormal' : 'reading-card';
    document.getElementById('card-o2').className = (vitals.o2 <= 95) ? 'reading-card abnormal' : 'reading-card';
    document.getElementById('card-bp').className = (vitals.bp_sys < 90 || vitals.bp_sys > 120 || vitals.bp_dia < 60 || vitals.bp_dia > 80) ? 'reading-card abnormal' : 'reading-card';

    // Emit to server
    if (currentSessionId) {
        socket.emit('vitals_update', {
            session_id: currentSessionId,
            hr: vitals.hr,
            o2: vitals.o2,
            bp_sys: vitals.bp_sys,
            bp_dia: vitals.bp_dia
        });
    }
}

function startSession() {
    isRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    socket.emit('start_session');

    // Broadcast vitals every 3 seconds for simulation
    vitalsInterval = setInterval(updateVitals, 3000);
}

function stopSession() {
    if (!isRunning) return;
    isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    clearInterval(vitalsInterval);
    if (currentSessionId) {
        socket.emit('end_session', { session_id: currentSessionId });
    }
}

// Controls
startBtn.addEventListener('click', startSession);
stopBtn.addEventListener('click', stopSession);

document.getElementById('force-hr-high').addEventListener('click', () => {
    forceAbnormal = 'hr';
    stabilizing = false;
    logAction('Forced Tachycardia (>100 HR)');
});

document.getElementById('force-o2-low').addEventListener('click', () => {
    forceAbnormal = 'o2';
    stabilizing = false;
    logAction('Forced Hypoxia (<95 SpO2)');
});

// File Sharing Logic
const fileInput = document.getElementById('patient-file-input');
const shareFileBtn = document.getElementById('share-file-btn');
const uploadStatus = document.getElementById('file-upload-status');

socket.on('session_started', (data) => {
    // Enable share button when session starts
    shareFileBtn.disabled = !fileInput.files.length;
});

socket.on('session_ended', () => {
    shareFileBtn.disabled = true;
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0 && isRunning) {
        shareFileBtn.disabled = false;
    } else {
        shareFileBtn.disabled = true;
    }
});

shareFileBtn.addEventListener('click', () => {
    if (!fileInput.files.length || !currentSessionId) return;

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', currentSessionId); // added session_id to formData

    uploadStatus.textContent = 'Uploading...';
    shareFileBtn.disabled = true;

    fetch('/upload_file', {
        method: 'POST',
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            if (data.file_url) {
                uploadStatus.textContent = 'File shared successfully!';
                uploadStatus.style.color = 'var(--success)';
                setTimeout(() => { uploadStatus.textContent = ''; }, 3000);

                socket.emit('patient_shared_file', {
                    session_id: currentSessionId,
                    file_url: data.file_url,
                    filename: data.filename
                });

                // Clear input
                fileInput.value = '';
            } else {
                uploadStatus.textContent = 'Upload failed.';
                uploadStatus.style.color = 'var(--danger)';
                shareFileBtn.disabled = false;
            }
        })
        .catch(error => {
            console.error('Error uploading file:', error);
            uploadStatus.textContent = 'Network error.';
            uploadStatus.style.color = 'var(--danger)';
            shareFileBtn.disabled = false;
        });
});
