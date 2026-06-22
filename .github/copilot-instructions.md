# OPNsense Central Management System

## Project Structure

```
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── main.py         # FastAPI application
│   │   ├── config.py       # Settings from environment
│   │   ├── database.py     # SQLAlchemy setup
│   │   ├── models/         # ORM models
│   │   ├── schemas/        # Pydantic validation schemas
│   │   ├── services/       # Business logic
│   │   │   ├── opnsense_api.py         # OPNsense API client
│   │   │   ├── encryption_service.py   # Secret encryption
│   │   │   ├── monitoring_service.py   # Health monitoring
│   │   │   ├── backup_service.py       # Backup management
│   │   │   ├── update_service.py       # Firmware updates
│   │   │   └── email_service.py        # Email notifications
│   │   └── routers/        # API endpoints
│   │       ├── firewalls.py
│   │       ├── backups.py
│   │       ├── updates.py
│   │       └── alerts.py
│   ├── scheduler.py        # APScheduler for background tasks
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/               # React + Tailwind CSS
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   └── main.jsx
│   ├── Dockerfile
│   └── package.json
├── db/
│   └── schema.sql         # PostgreSQL schema
├── docker-compose.yml     # Full stack orchestration
├── .env.example           # Environment template
└── README.md
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Or: Python 3.11+, Node.js 18+, PostgreSQL 16

### With Docker Compose (Recommended)

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your SMTP settings
nano .env

# Start all services
docker-compose up -d

# Check services
docker-compose ps

# View logs
docker-compose logs -f cms-backend
```

Services will be available at:
- **Backend API**: http://localhost:8000
- **Frontend**: http://localhost:3000
- **API Docs**: http://localhost:8000/docs
- **Database**: localhost:5432

### Local Development

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

**Database:**
```bash
# Create database
createdb opnsense_cms

# Load schema
psql opnsense_cms < db/schema.sql

# Or use docker for PostgreSQL
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:16
```

## Environment Variables

Create `.env` file in root directory:

```
# Database
DATABASE_URL=postgresql://cms:password@localhost:5432/opnsense_cms

# Security
SECRET_KEY=your-min-32-char-secret-key

# SMTP (for email alerts)
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=cms@example.com
SMTP_PASSWORD=your-password
SMTP_FROM=cms@example.com

# OPNsense
VERIFY_SSL=false  # Set to cert path for production

# Scheduler
MONITORING_INTERVAL_MINUTES=5
LICENSE_CHECK_HOUR=2
BACKUP_CHECK_HOUR=1
```

## API Endpoints

### Firewalls
- `GET /api/firewalls` - List all firewalls
- `POST /api/firewalls` - Add new firewall
- `GET /api/firewalls/{id}` - Get firewall details
- `PATCH /api/firewalls/{id}` - Update firewall
- `DELETE /api/firewalls/{id}` - Delete firewall
- `GET /api/firewalls/{id}/status` - Get current status
- `POST /api/firewalls/{id}/check-health` - Manual health check

### Backups
- `GET /api/backups/firewalls/{id}` - List backups
- `POST /api/backups/firewalls/{id}/create` - Create backup
- `POST /api/backups/firewalls/{id}/restore` - Restore backup
- `DELETE /api/backups/firewalls/{id}/backups/{backup_id}` - Delete backup

### Updates
- `POST /api/updates/firewalls/{id}/check` - Check for updates
- `POST /api/updates/firewalls/{id}/install` - Install updates
- `GET /api/updates/firewalls/{id}/history` - Update history
- `GET /api/updates/pending` - List all pending updates

### Alerts
- `GET /api/alerts` - List alerts
- `GET /api/alerts/{id}` - Get specific alert
- `POST /api/alerts/{id}/resolve` - Mark as resolved
- `DELETE /api/alerts/{id}` - Delete alert

Full API docs: http://localhost:8000/docs

## Database Schema

Core tables:
- `firewalls` - Managed firewall instances
- `firewall_status` - Latest health metrics
- `backups` - Backup records
- `alerts` - Alarms and notifications
- `update_history` - Firmware update tracking
- `license_notifications` - License expiry tracking
- `users` - CMS user accounts

## Scheduling

Automatic tasks via APScheduler:
- **Health Monitoring**: Every 5 minutes (configurable)
- **License Checks**: Daily at 2 AM (configurable)
- **Auto Backups**: Daily at 1 AM (configurable)
- **Auto Updates**: Within configured maintenance windows

## Security Considerations

- API secrets encrypted at rest (Fernet encryption)
- HTTPS recommended for production
- Firewall API keys use minimal required permissions
- Full audit logging of all CMS actions
- Database password should be strong
- SECRET_KEY must be ≥32 characters
- Use environment variables for all secrets

## Deployment

### Production Checklist

- [ ] Change all default passwords
- [ ] Set `DEBUG=false` in .env
- [ ] Configure SMTP for notifications
- [ ] Enable HTTPS with valid certificate
- [ ] Set up SSL certificate verification for OPNsense
- [ ] Configure firewall network access
- [ ] Set up database backups
- [ ] Configure monitoring/alerting
- [ ] Review security settings
- [ ] Test all critical workflows

### Reverse Proxy (Nginx Example)

```nginx
upstream backend {
    server cms-backend:8000;
}

upstream frontend {
    server cms-frontend:3000;
}

server {
    listen 443 ssl http2;
    server_name cms.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /api {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
    }
}
```

## Troubleshooting

### Backend won't start
```bash
# Check database connection
docker-compose logs db

# Check environment variables
docker-compose exec cms-backend env

# Check tables created
docker-compose exec db psql -U cms -d opnsense_cms -c "\dt"
```

### Scheduler not running tasks
```bash
# Check scheduler logs
docker-compose logs cms-scheduler

# Verify database connectivity
docker-compose exec cms-scheduler python -c "from app.database import engine; engine.connect()"
```

### API connection to OPNsense fails
- Verify firewall IP and connectivity
- Check API key/secret are correct
- Verify SSL certificate settings
- Check OPNsense API logs

## Development

### Running tests
```bash
pytest backend/tests/
```

### Code formatting
```bash
black backend/app/
isort backend/app/
```

### Type checking
```bash
mypy backend/app/
```

## License

Proprietary - TSF Computertechnik GmbH

## Support

For issues and questions, contact the development team.
