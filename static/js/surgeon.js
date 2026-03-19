const socket = io();

// UI Elements
const statusSpan = document.getElementById('connection-status');
const sessionIdDisplay = document.getElementById('session-id');
const sysStatus = document.getElementById('sys-status');

const valHr = document.getElementById('s-val-hr');
const valO2 = document.getElementById('s-val-o2');
const valBpSys = document.getElementById('s-val-bpsys');
const valBpDia = document.getElementById('s-val-bpdia');

const cardHr = document.getElementById('s-card-hr');
const cardO2 = document.getElementById('s-card-o2');
const cardBp = document.getElementById('s-card-bp');

const suggestionText = document.getElementById('suggestion-text');
const sendBtn = document.getElementById('send-suggestion-btn');
const micBtn = document.getElementById('record-mic-btn');
const recordStatus = document.getElementById('recording-status');
const alarmAudio = document.getElementById('alarm-audio');

// Audio Context required for some browsers to unblock autoplay
let audioContextPlayable = false;
document.body.addEventListener('click', () => {
    if (!audioContextPlayable) {
        alarmAudio.play().then(() => {
            alarmAudio.pause();
            audioContextPlayable = true;
        }).catch(err => console.log('Audio autoplay blocked initially'));
    }
});

let currentSessionId = null;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let currentlyAbnormal = false;

// Socket Event Handlers
socket.on('connect', () => {
    statusSpan.textContent = '🔌 Connected';
    statusSpan.className = 'badge success';
});

socket.on('disconnect', () => {
    statusSpan.textContent = '🔌 Disconnected';
    statusSpan.className = 'badge disconnected';
    sysStatus.textContent = 'OFFLINE';
});

socket.on('session_started', (data) => {
    currentSessionId = data.session_id;
    if(sessionIdDisplay) sessionIdDisplay.textContent = currentSessionId;
    sysStatus.textContent = 'SYSTEM NOMINAL';
    sysStatus.className = 'system-status nominal';
    sendBtn.disabled = false;
    micBtn.disabled = false;

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
});

socket.on('session_ended', (data) => {
    if (currentSessionId === data.session_id) {
        currentSessionId = null;
        sessionIdDisplay.textContent = 'Waiting...';
        sendBtn.disabled = true;
        micBtn.disabled = true;
        stopAlarm();
        valHr.textContent = '--';
        valO2.textContent = '--';
        valBpSys.textContent = '--';
        valBpDia.textContent = '--';
        sysStatus.textContent = 'SESSION ENDED';
        sysStatus.className = 'system-status';

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

socket.on('vitals_broadcast', (data) => {
    if (data.session_id !== currentSessionId) return;

    valHr.textContent = data.hr;
    valO2.textContent = data.o2;
    valBpSys.textContent = data.bp_sys;
    valBpDia.textContent = data.bp_dia;

    const hrAbnormal = data.hr < 60 || data.hr > 100;
    const o2Abnormal = data.o2 <= 95;
    // Normal: <120 / <80. Anything above (Elevated, Stage 1, Stage 2) is abnormal.
    const bpAbnormal = data.bp_sys >= 120 || data.bp_sys < 90 || data.bp_dia >= 80 || data.bp_dia < 60;

    cardHr.className = hrAbnormal ? 'vital-monitor alarm' : 'vital-monitor';
    cardO2.className = o2Abnormal ? 'vital-monitor alarm' : 'vital-monitor';
    cardBp.className = bpAbnormal ? 'vital-monitor alarm' : 'vital-monitor';

    if (data.is_abnormal) {
        if (!currentlyAbnormal) {
            currentlyAbnormal = true;
            sysStatus.textContent = 'CRITICAL ALARM';
            sysStatus.className = 'system-status alert';
            // Trigger server to log event
            socket.emit('trigger_alarm', { session_id: currentSessionId, reason: 'Vitals entered critical range.' });
            playAlarm();
        }
    } else {
        if (currentlyAbnormal && sysStatus.textContent !== 'STABILIZING...') {
            currentlyAbnormal = false;
            stopAlarm();
            sysStatus.textContent = 'SYSTEM NOMINAL';
            sysStatus.className = 'system-status nominal';
        }
    }
});

socket.on('stabilize_vitals', (data) => {
    if (data.session_id === currentSessionId) {
        stopAlarm();
        sysStatus.textContent = 'STABILIZING...';
        sysStatus.className = 'system-status stabilizing';
    }
});

socket.on('stabilization_complete', (data) => {
    if (data.session_id === currentSessionId) {
        currentlyAbnormal = false;
        sysStatus.textContent = 'SYSTEM NOMINAL';
        sysStatus.className = 'system-status nominal';
        stopAlarm();
    }
});

socket.on('file_shared_broadcast', (data) => {
    if (data.session_id !== currentSessionId) return;

    const filesList = document.getElementById('shared-files-list');

    // Clear the "No files" message if it's the first file
    if (filesList.querySelector('p')) {
        filesList.innerHTML = '';
    }

    const fileDiv = document.createElement('div');
    fileDiv.className = 'chat-msg surgeon';
    fileDiv.style.background = '#1e293b';
    fileDiv.style.border = '1px solid var(--border)';
    fileDiv.style.alignSelf = 'stretch';
    fileDiv.style.maxWidth = '100%';
    fileDiv.style.display = 'flex';
    fileDiv.style.justifyContent = 'space-between';
    fileDiv.style.alignItems = 'center';

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    fileDiv.innerHTML = `
        <div style="display:flex; align-items:center; gap: 10px;">
            <span style="font-size: 1.5rem;">📄</span>
            <div>
                <strong>${data.filename}</strong><br>
                <small style="color: var(--text-muted);">${timeStr}</small>
            </div>
        </div>
        <a href="${data.file_url}" target="_blank" class="btn small primary" style="text-decoration:none;">View</a>
    `;

    filesList.appendChild(fileDiv);
    filesList.scrollTop = filesList.scrollHeight;

    // Optional: play a notification sound
    const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3');
    audio.play().catch(e => { });
});

// Alarm actions
function playAlarm() {
    alarmAudio.play().catch(e => {
        console.warn("Autoplay prevented by browser. User must click on viewport first.");
    });
}
function stopAlarm() {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
}

// Dashboard Text Input Action
sendBtn.addEventListener('click', () => {
    const text = suggestionText.value.trim();
    if (!text || !currentSessionId) return;

    socket.emit('send_suggestion', {
        session_id: currentSessionId,
        text: text,
        audio_url: null
    });
    suggestionText.value = '';
    stopAlarm();
});

// Audio Recording via Web Audio / MediaRecorder API
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    micBtn.addEventListener('click', () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });
} else {
    micBtn.style.display = 'none';
    recordStatus.textContent = "Mic access blocked or unsupported (HTTPS required).";
}

function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        mediaRecorder.start();
        isRecording = true;

        micBtn.innerHTML = '⏹ Stop Audio';
        micBtn.className = 'btn warning tooltip';
        recordStatus.innerHTML = '<span class="red-dot"></span> Mic Live...';

        audioChunks = [];
        mediaRecorder.addEventListener("dataavailable", event => {
            audioChunks.push(event.data);
        });

        mediaRecorder.addEventListener("stop", () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            uploadAudio(audioBlob);
            stream.getTracks().forEach(track => track.stop());
        });
    }).catch(err => {
        console.error("Error accessing mic: ", err);
        recordStatus.textContent = "Mic denied by browser.";
    });
}

function stopRecording() {
    if (mediaRecorder) {
        mediaRecorder.stop();
    }
    isRecording = false;
    micBtn.innerHTML = '🎤 Record Voice';
    micBtn.className = 'btn secondary tooltip';
    recordStatus.textContent = 'Processing and sending...';
}

function uploadAudio(blob) {
    if (!currentSessionId) {
        recordStatus.textContent = 'Error: No active session.';
        return;
    }

    const formData = new FormData();
    formData.append('audio', blob, 'audio_suggest.webm');

    fetch('/upload_audio', {
        method: 'POST',
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            if (data.audio_url) {
                recordStatus.textContent = 'Voice sent successfully!';
                setTimeout(() => recordStatus.textContent = '', 3000);

                socket.emit('send_suggestion', {
                    session_id: currentSessionId,
                    text: 'Audio suggestion attached.',
                    audio_url: data.audio_url
                });
                stopAlarm();
            } else {
                recordStatus.textContent = 'Failed to upload audio.';
            }
        })
        .catch(error => {
            console.error('Error uploading audio:', error);
            recordStatus.textContent = 'Network error saving audio.';
        });
}

// Session History Logic
const historyBtn = document.getElementById('view-history-btn');
const historyModal = document.getElementById('history-modal');
const closeHistoryBtn = document.getElementById('close-history-btn');
const historyListContainer = document.getElementById('history-list-container');
const historyDetailsContainer = document.getElementById('history-details-container');

if (historyBtn) {
    historyBtn.addEventListener('click', () => {
        historyModal.style.display = 'flex';
        fetchSessions();
    });
}

if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
        historyModal.style.display = 'none';
    });
}

function fetchSessions() {
    historyListContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">Loading sessions...</p>';
    fetch('/api/sessions')
        .then(res => res.json())
        .then(data => {
            historyListContainer.innerHTML = '';
            if (data.sessions.length === 0) {
                historyListContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No sessions found.</p>';
                return;
            }

            data.sessions.forEach(session => {
                const start = new Date(session.start_time);
                const isOngoing = !session.end_time;
                const statusStr = isOngoing ? '<span class="badge warning small">Active</span>' : '<span class="badge success small">Ended</span>';

                const btn = document.createElement('button');
                btn.className = 'btn outline';
                btn.style.width = '100%';
                btn.style.textAlign = 'left';
                btn.style.marginBottom = '0.5rem';
                btn.style.display = 'flex';
                btn.style.flexDirection = 'column';
                btn.style.gap = '0.2rem';

                btn.innerHTML = `
                    <div style="display:flex; justify-content:space-between; width:100%;">
                        <strong>Session #${session.id}</strong>
                        ${statusStr}
                    </div>
                    <small style="color: var(--text-muted);">${start.toLocaleString()}</small>
                `;

                btn.onclick = () => renderSessionDetails(session);
                historyListContainer.appendChild(btn);
            });
        })
        .catch(err => {
            console.error(err);
            historyListContainer.innerHTML = '<p style="color: var(--danger); font-size: 0.9rem;">Error loading sessions.</p>';
        });
}

function renderSessionDetails(session) {
    let filesHtml = '';
    if (session.files && session.files.length > 0) {
        filesHtml = '<ul style="list-style: none; padding: 0;">';
        session.files.forEach(f => {
            filesHtml += `<li style="margin-bottom: 0.5rem;"><a href="${f.url}" target="_blank" class="btn small outline">📄 ${f.filename}</a></li>`;
        });
        filesHtml += '</ul>';
    } else {
        filesHtml = '<p style="color: var(--text-muted); font-size: 0.8rem;">No files shared during this session.</p>';
    }

    let videoHtml = '';
    if (session.duration_seconds !== null && session.duration_seconds !== undefined) {
        const minutes = Math.floor(session.duration_seconds / 60);
        const seconds = session.duration_seconds % 60;
        videoHtml = `
            <div style="background: var(--bg-dark); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-top: 1rem;">
                <p style="margin: 0; color: var(--text-muted);">
                    <span style="font-size: 1.5rem; vertical-align: middle;">⏱️</span> 
                    <strong style="color: var(--text-light); vertical-align: middle; margin-left: 0.5rem;">Recorded Duration:</strong> 
                    <span style="vertical-align: middle;">${minutes}m ${seconds}s</span>
                </p>
            </div>
        `;
    } else if (!session.end_time) {
        videoHtml = '<p style="color: var(--warning); font-size: 0.8rem;">Session is currently active. Recording duration will be available when ended.</p>';
    } else {
        videoHtml = '<p style="color: var(--text-muted); font-size: 0.8rem;">No recording duration found.</p>';
    }

    historyDetailsContainer.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1rem;">
            <div>
                <h2>Session #${session.id} Details</h2>
                <p style="color: var(--text-muted); font-size: 0.9rem;">Started: ${new Date(session.start_time).toLocaleString()}</p>
                ${session.end_time ? `<p style="color: var(--text-muted); font-size: 0.9rem;">Ended: ${new Date(session.end_time).toLocaleString()}</p>` : ''}
            </div>
            <a href="${session.report_url}" target="_blank" class="btn primary">View Full Report</a>
        </div>
        
        <h3>Shared Files</h3>
        ${filesHtml}
        
        <h3 style="margin-top: 1.5rem;">Session Recording</h3>
        ${videoHtml}
    `;
}
