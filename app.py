import os
import datetime
import pymysql
from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from flask_socketio import SocketIO, emit
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash

# Create database if it doesn't exist
db_user = 'root'
db_password = '' # Default empty for local mysql
db_host = 'localhost'
db_name = 'remotesurgery'

try:
    conn = pymysql.connect(host=db_host, user=db_user, password=db_password)
    cursor = conn.cursor()
    cursor.execute(f"CREATE DATABASE IF NOT EXISTS {db_name}")
    conn.close()
    default_db_url = f'mysql+pymysql://{db_user}:{db_password}@{db_host}/{db_name}'
    print(f"Connected to MySQL server and using database: {db_name}")
except Exception as e:
    print(f"Warning: Could not connect to MySQL server. Falling back to SQLite. {e}")
    default_db_url = 'sqlite:///app.db'

app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey'
# Use MySQL by default with SQLite fallback, overridable via environment variable for AWS RDS
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', default_db_url)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Use eventlet for async mode which is recommended for production WebSocket servers
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# --- Database Models ---

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(50), nullable=False) # 'surgeon' or 'patient'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


class Session(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    start_time = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    end_time = db.Column(db.DateTime, nullable=True)
    duration_seconds = db.Column(db.Integer, nullable=True)

class VitalLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'))
    type = db.Column(db.String(10)) # 'highest' or 'lowest'
    hr = db.Column(db.Integer)
    o2 = db.Column(db.Integer)
    bp_sys = db.Column(db.Integer)
    bp_dia = db.Column(db.Integer)

class Suggestion(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'))
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    text = db.Column(db.Text)
    audio_path = db.Column(db.String(255), nullable=True)

class Event(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'))
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    event_type = db.Column(db.String(50)) # e.g., 'alarm', 'stabilization_started', 'stabilized'
    details = db.Column(db.Text, nullable=True)

# Initialize database
with app.app_context():
    db.create_all()

# Ensure uploads directory exists
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- REST Routes ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        role = request.form.get('role')
        
        user = User.query.filter_by(username=username).first()
        if user:
            flash('Username already exists.', 'danger')
            return redirect(url_for('signup'))
        
        new_user = User(
            username=username, 
            password_hash=generate_password_hash(password, method='pbkdf2:sha256'), 
            role=role
        )
        db.session.add(new_user)
        db.session.commit()
        
        flash('Account created successfully! Please log in.', 'success')
        return redirect(url_for('login'))
    return render_template('signup.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password_hash, password):
            login_user(user)
            if user.role == 'surgeon':
                return redirect(url_for('surgeon'))
            else:
                return redirect(url_for('patient'))
        else:
            flash('Invalid username or password.', 'danger')
            return redirect(url_for('login'))
            
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/patient')
@login_required
def patient():
    if current_user.role != 'patient' and current_user.role != 'surgeon':
        flash('Unauthorized access.', 'danger')
        return redirect(url_for('index'))
    return render_template('patient.html')

@app.route('/surgeon')
@login_required
def surgeon():
    if current_user.role != 'surgeon':
        flash('Unauthorized access. Surgeon role required.', 'danger')
        return redirect(url_for('index'))
    return render_template('surgeon.html')

@app.route('/report/<int:session_id>')
@login_required
def report(session_id):
    session = Session.query.get_or_404(session_id)
    vitals = VitalLog.query.filter_by(session_id=session_id).all()
    suggestions = Suggestion.query.filter_by(session_id=session_id).order_by(Suggestion.timestamp).all()
    events = Event.query.filter_by(session_id=session_id).order_by(Event.timestamp).all()
    return render_template('report.html', session=session, vitals=vitals, suggestions=suggestions, events=events)

@app.route('/upload_audio', methods=['POST'])
def upload_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file part'}), 400
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file:
        filename = f"audio_{int(datetime.datetime.utcnow().timestamp())}.webm"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)
        return jsonify({'audio_url': f'/static/uploads/{filename}'}), 200

@app.route('/upload_file', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    session_id = request.form.get('session_id')
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file and session_id:
        from werkzeug.utils import secure_filename
        import shutil
        
        session_folder = os.path.join(UPLOAD_FOLDER, 'sessions', str(session_id))
        os.makedirs(session_folder, exist_ok=True)
        
        filename = secure_filename(f"doc_{int(datetime.datetime.utcnow().timestamp())}_{file.filename}")
        filepath = os.path.join(session_folder, filename)
        file.save(filepath)
        return jsonify({
            'file_url': f'/static/uploads/sessions/{session_id}/{filename}',
            'filename': file.filename
        }), 200
    return jsonify({'error': 'Missing file or session_id'}), 400

@app.route('/api/sessions', methods=['GET'])
@login_required
def get_sessions():
    sessions = Session.query.order_by(Session.start_time.desc()).all()
    sessions_data = []
    for s in sessions:
        # Check if this session has a folder
        session_folder = os.path.join(UPLOAD_FOLDER, 'sessions', str(s.id))
        files = []
        video_url = None
        if os.path.exists(session_folder):
            for filename in os.listdir(session_folder):
                if filename.endswith('.mp4'):
                    video_url = f'/static/uploads/sessions/{s.id}/{filename}'
                else:
                    files.append({
                        'filename': filename,
                        'url': f'/static/uploads/sessions/{s.id}/{filename}'
                    })
        
        sessions_data.append({
            'id': s.id,
            'start_time': s.start_time.isoformat() if s.start_time else None,
            'end_time': s.end_time.isoformat() if s.end_time else None,
            'duration_seconds': s.duration_seconds,
            'files': files,
            'video_url': video_url,
            'report_url': f'/report/{s.id}'
        })
    return jsonify({'sessions': sessions_data})

# --- WebSocket Events ---

active_session_id = None

@socketio.on('connect')
def handle_connect():
    global active_session_id
    print('Client connected')
    if active_session_id:
        emit('session_started', {'session_id': active_session_id})

@socketio.on('start_session')
def handle_start_session():
    global active_session_id
    new_session = Session()
    db.session.add(new_session)
    db.session.commit()
    active_session_id = new_session.id
    emit('session_started', {'session_id': new_session.id}, broadcast=True)

@socketio.on('end_session')
def handle_end_session(data):
    global active_session_id
    session_id = data.get('session_id')
    if session_id:
        session = Session.query.get(session_id)
        if session:
            end_time = datetime.datetime.utcnow()
            session.end_time = end_time
            if session.start_time:
                duration = (end_time - session.start_time).total_seconds()
                session.duration_seconds = int(duration)
            db.session.commit()

            if active_session_id == session_id:
                active_session_id = None
            emit('session_ended', {'session_id': session_id}, broadcast=True)

@socketio.on('vitals_update')
def handle_vitals_update(data):
    session_id = data.get('session_id')
    hr = data.get('hr')
    o2 = data.get('o2')
    bp_sys = data.get('bp_sys')
    bp_dia = data.get('bp_dia')
    
    # Check abnormality against normal ranges
    # HR: 60-100, O2: >95, BP: <120 / <80
    is_abnormal = False
    if hr < 60 or hr > 100 or o2 <= 95 or bp_sys >= 120 or bp_sys < 90 or bp_dia >= 80 or bp_dia < 60:
        is_abnormal = True

    if session_id:
        highest_log = VitalLog.query.filter_by(session_id=session_id, type='highest').first()
        lowest_log = VitalLog.query.filter_by(session_id=session_id, type='lowest').first()
        
        if not highest_log:
            highest_log = VitalLog(session_id=session_id, type='highest', hr=hr, o2=o2, bp_sys=bp_sys, bp_dia=bp_dia)
            db.session.add(highest_log)
        else:
            highest_log.hr = max(highest_log.hr, hr)
            highest_log.o2 = max(highest_log.o2, o2)
            highest_log.bp_sys = max(highest_log.bp_sys, bp_sys)
            highest_log.bp_dia = max(highest_log.bp_dia, bp_dia)

        if not lowest_log:
            lowest_log = VitalLog(session_id=session_id, type='lowest', hr=hr, o2=o2, bp_sys=bp_sys, bp_dia=bp_dia)
            db.session.add(lowest_log)
        else:
            lowest_log.hr = min(lowest_log.hr, hr)
            lowest_log.o2 = min(lowest_log.o2, o2)
            lowest_log.bp_sys = min(lowest_log.bp_sys, bp_sys)
            lowest_log.bp_dia = min(lowest_log.bp_dia, bp_dia)
            
        db.session.commit()
        
    data['is_abnormal'] = is_abnormal
    # Broadcast to surgeon dashboard
    emit('vitals_broadcast', data, broadcast=True)

@socketio.on('trigger_alarm')
def handle_trigger_alarm(data):
    session_id = data.get('session_id')
    if session_id:
        event = Event(session_id=session_id, event_type='alarm', details=data.get('reason'))
        db.session.add(event)
        db.session.commit()
    # Forward alarm to UI
    emit('alarm_broadcast', data, broadcast=True)

@socketio.on('patient_shared_file')
def handle_patient_shared_file(data):
    session_id = data.get('session_id')
    file_url = data.get('file_url')
    filename = data.get('filename')
    
    if session_id:
        event = Event(session_id=session_id, event_type='file_shared', details=f"Patient shared file: {filename}")
        db.session.add(event)
        db.session.commit()
        
    # Broadcast to surgeon dashboard so they can view the file
    emit('file_shared_broadcast', data, broadcast=True)

@socketio.on('send_suggestion')
def handle_suggestion(data):
    session_id = data.get('session_id')
    text = data.get('text')
    audio_path = data.get('audio_url')
    
    if session_id:
        suggestion = Suggestion(session_id=session_id, text=text, audio_path=audio_path)
        db.session.add(suggestion)
        
        event = Event(session_id=session_id, event_type='stabilization_started', details="Suggestion received, simulating patient stabilization.")
        db.session.add(event)
        db.session.commit()
        
    # Tell patient simulator to begin stabilization process and pass the message
    emit('stabilize_vitals', {
        'session_id': session_id, 
        'message': 'Applying suggestion: Stabilizing vitals...',
        'text': text,
        'audio_url': audio_path
    }, broadcast=True)

@socketio.on('vitals_stabilized')
def handle_vitals_stabilized(data):
    session_id = data.get('session_id')
    if session_id:
        event = Event(session_id=session_id, event_type='stabilized', details="Vitals return to normal limits.")
        db.session.add(event)
        db.session.commit()
    emit('stabilization_complete', {'session_id': session_id, 'message': 'Vitals Stabilized'}, broadcast=True)

import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

if __name__ == '__main__':
    print("Server starting...")
    print("Visit http://localhost:5000")
    socketio.run(app, debug=False, port=5000, log_output=False)
