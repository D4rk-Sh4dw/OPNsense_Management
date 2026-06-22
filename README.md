# OPNsense Central Management System (CMS)

A self-hosted, MSP-ready central management system for OPNsense firewalls. Manage multiple customer firewalls, monitor their health, handle updates, backups, and more.

## Features

- **Firewall Inventory** - Manage customer firewalls with API credentials
- **Health Monitoring** - Real-time CPU, RAM, uptime, firmware status dashboards
- **Firmware Updates** - Manual and scheduled automatic updates with pre-update backups
- **Backup Management** - Automated backup creation with retention policies
- **License Tracking** - Email alerts before license expiry (14, 7, 1 day options)
- **Error Monitoring** - Centralized log collection and alerting
- **S.M.A.R.T. Monitoring** - Hard drive health tracking with critical alerts
- **Zero-Touch Deployment** - Deploy configurations to new firewalls from existing backups

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend   | Python FastAPI |
| Database  | PostgreSQL 16 |
| Frontend  | React + Tailwind CSS |
| Scheduler | APScheduler |
| Email     | SMTP |
| Deployment| Docker Compose |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Or locally: Python 3.11+, Node.js 18+, PostgreSQL 16

### Using Docker Compose

```bash
# Build and start all services
docker-compose up -d

# Verify services are running
docker-compose ps
```

Services will be available at:
- **Backend API**: http://localhost:8000
- **Frontend**: http://localhost:3000
- **API Docs**: http://localhost:8000/docs

### Local Development

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
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
createdb opnsense_cms
psql opnsense_cms < db/schema.sql
```

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── config.py            # Configuration management
│   │   ├── database.py          # Database connection & sessions
│   │   ├── models/              # SQLAlchemy ORM models
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── services/            # Business logic
│   │   │   ├── opnsense_api.py  # OPNsense API client
│   │   │   ├── firewall_service.py
│   │   │   ├── monitoring_service.py
│   │   │   ├── backup_service.py
│   │   │   ├── update_service.py
│   │   │   └── email_service.py
│   │   ├── routers/             # API route handlers
│   │   │   ├── auth.py
│   │   │   ├── firewalls.py
│   │   │   ├── monitoring.py
│   │   │   ├── backups.py
│   │   │   ├── updates.py
│   │   │   └── alerts.py
│   │   └── tasks/               # APScheduler tasks
│   ├── requirements.txt
│   ├── Dockerfile
│   └── scheduler.py             # Standalone scheduler process
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── Dockerfile
├── db/
│   ├── schema.sql               # PostgreSQL schema
│   └── migrations/              # Future Alembic migrations
├── docker-compose.yml
├── .github/
│   └── copilot-instructions.md
└── README.md
```

## Environment Variables

Create a `.env` file in the root directory:

```
# Database
DATABASE_URL=postgresql://cms:password@db:5432/opnsense_cms

# FastAPI
SECRET_KEY=your-secret-key-min-32-chars
DEBUG=false

# SMTP
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=cms@example.com
SMTP_PASSWORD=your-password
SMTP_FROM=cms@example.com

# OPNsense
VERIFY_SSL=false
```

## API Documentation

Interactive API docs available at `/docs` (Swagger UI) or `/redoc` (ReDoc).

Key endpoints:
- `POST /api/firewalls` - Add new firewall
- `GET /api/firewalls` - List all firewalls
- `GET /api/firewalls/{id}/status` - Get firewall health
- `POST /api/firewalls/{id}/backups` - Trigger backup
- `POST /api/firewalls/{id}/updates` - Trigger firmware update
- `GET /api/alerts` - View alerts & alarms

## Security

- API secrets encrypted at rest (Fernet encryption)
- All traffic over HTTPS
- Firewall API keys stored with minimal required permissions
- Full audit logging of CMS actions
- Authentication required for all endpoints (JWT tokens)

## Documentation

- [OPNsense API Documentation](https://docs.opnsense.org/development/api.html)
- [OPNsense API How-To](https://docs.opnsense.org/development/how-tos/api.html)
- [Deployment Guide](./docs/DEPLOYMENT.md) (coming soon)

## License

Proprietary - TSF Computertechnik GmbH

## Support

For issues and feature requests, contact the development team.
