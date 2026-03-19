# Remote Surgical Supervision System

A real-time remote surgical supervision system built with Flask, WebSockets (Flask-SocketIO), and SQLite.

## Features
- **Patient Simulator:** Emulates real-time vital signs streaming via WebSockets. Periodically injects abnormalities.
- **Surgeon Dashboard:** Receives low-latency vital updates. Emits visual/audio alarms on abnormalities. Allows the surgeon to provide text/audio suggestions, triggering a stabilization simulation on the patient end.
- **Reporting:** Complete session tracking with vitals, events, and suggestions logged to SQLite, offering a printable (PDF) post-session report.

## Running Locally

1. Ensure you have Python 3 installed.
2. Clone/cd into this directory.
3. Create a virtual environment and install dependencies:
   ```bash
   python -m venv venv
   source venv/bin/activate  # Or `venv\Scripts\activate` on Windows
   pip install -r requirements.txt
   ```
4. Run the development server:
   ```bash
   python app.py
   ```
5. Open two browser windows:
    - Tab 1: `http://localhost:5000/patient` (The Patient Simulator)
    - Tab 2: `http://localhost:5000/surgeon` (The Surgeon Dashboard)
6. Start a session from the patient tab and monitor the surgeon tab!

## Deploying to AWS (Step-by-Step)

This application can be deployed to AWS Elastic Beanstalk, using an Amazon RDS MySQL instance for production data storage, and implicitly handling files through local disk or eventually an S3 integration.

### Prerequisites
- AWS Account
- EB CLI installed (`pip install awsebcli`)

### 1. Setup AWS RDS (MySQL)
1. In the AWS Console, go to **RDS** -> **Create Database**.
2. Select **MySQL**, Free Tier.
3. Set your Master Username and Password.
4. Ensure **Publicly Accessible** is No, but the security group allows inbound traffic from your Elastic Beanstalk environment.
5. Create the database. Note the endpoint (e.g., `mydb.xxxxxxxxx.us-east-1.rds.amazonaws.com`).

### 2. Setup AWS S3 (For Audio/Video Storage scaling - Optional but recommended)
1. Go to **S3** -> **Create bucket**. Give it a unique name (e.g., `remote-surgery-assets`).
2. If implementing the code modifications for S3, you'd use `boto3` in Python instead of the local filesystem `static/uploads/`.
*Note: This sample currently stores audio blobs locally in `static/uploads`. For a true stateless cloud deployment, you must update `app.py` upload route to upload directly to your S3 bucket.*

### 3. Deploy via Elastic Beanstalk
1. Initialize EB in your directory:
   ```bash
   eb init -p python-3.9 remote-surgical-supervision
   ```
2. Create an environment (this provisions an EC2 instance, Load Balancer, etc.):
   ```bash
   eb create rss-env
   ```
3. Set the environment variables for your database:
   ```bash
   eb setenv DATABASE_URL=mysql+pymysql://<username>:<password>@<rds-endpoint>:3306/<dbname>
   ```
   *(You may need to add `PyMySQL` to your `requirements.txt` to support MySQL bindings).*

4. Set environment to use HTTPS if required by assigning an SSL certificate to your Load Balancer in the AWS Console. *Note: Web Audio API (Mic recording) requires HTTPS/localhost to function.*

5. Deploy any future updates with:
   ```bash
   eb deploy
   ```

### 4. Technical Explanations
- **WebSockets:** We use `Flask-SocketIO` to enable persistent, bidirectional real-time communication without the overhead of HTTP polling.
- **Eventlet:** Listed in `Procfile` because production WSGI servers require an async worker class (like eventlet or gevent) to efficiently handle long-held WebSocket connections concurrently.
- **Database CRUD:** Handled gracefully using SQLAlchemy ORM. SQLite is used for rapid local development, but easily swapped to MySQL in AWS via standard SQLAlchemy connection strings.
- **Reporting:** Instead of heavy server-side PDF generation binaries (like `wkhtmltopdf`/`pdfkit`), we rely on responsive CSS print media queries and `window.print()` to allow the user to painlessly save the HTML report as a PDF directly from the browser natively.
- **Vital Logic:** Vitals check logic runs both locally for generation and server-side for validation, guaranteeing data integrity before notifying dashboards of alarms.
