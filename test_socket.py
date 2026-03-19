import socketio
import time

sio_patient = socketio.Client()
sio_surgeon = socketio.Client()

session_id = None

@sio_surgeon.event
def connect():
    print("Surgeon connected!")

@sio_surgeon.event
def session_started(data):
    print("Surgeon received session_started:", data)
    global session_id
    session_id = data.get('session_id')

@sio_surgeon.event
def vitals_broadcast(data):
    print("Surgeon received vitals_broadcast:", data)

@sio_patient.event
def connect():
    print("Patient connected!")

@sio_patient.event
def session_started(data):
    print("Patient received session_started:", data)

try:
    print("Connecting clients...")
    sio_patient.connect('http://localhost:5000')
    sio_surgeon.connect('http://localhost:5000')

    print("Patient starting session...")
    sio_patient.emit('start_session')
    
    time.sleep(1)
    
    print("Patient sending vitals...")
    sio_patient.emit('vitals_update', {
        'session_id': session_id,
        'hr': 75,
        'o2': 98,
        'bp_sys': 110,
        'bp_dia': 70
    })
    
    time.sleep(2)
except Exception as e:
    print("Error:", e)
finally:
    sio_patient.disconnect()
    sio_surgeon.disconnect()
