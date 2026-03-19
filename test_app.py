from app import app, socketio, db

with app.app_context():
    db.create_all()

client_patient = socketio.test_client(app)
client_surgeon = socketio.test_client(app)

print("--- Start Session ---")
client_patient.emit('start_session')

print("Patient received:", client_patient.get_received())
print("Surgeon received:", client_surgeon.get_received())

print("--- Send Vitals ---")
client_patient.emit('vitals_update', {
    'session_id': 1,
    'hr': 75,
    'o2': 98,
    'bp_sys': 120,
    'bp_dia': 80
})

print("Patient received:", client_patient.get_received())
print("Surgeon received:", client_surgeon.get_received())
