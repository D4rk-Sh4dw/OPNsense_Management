FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV CMS_API_URL=http://cms-backend:8000

# MCP over stdio – kein Port nötig
CMD ["python", "server.py"]
