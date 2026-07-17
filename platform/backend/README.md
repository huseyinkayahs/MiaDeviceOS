# FactoryBox Platform Backend MVP

Amaç:

```text
MQTT mesajlarını dinlemek
PostgreSQL'e kayıt atmak
Basit REST API açmak
Platform dashboard sayfası sunmak
```

## Kurulum

Önce PostgreSQL:

```powershell
cd platform\database
docker compose up -d
```

Sonra backend:

```powershell
cd platform\backend
copy .env.example .env
npm.cmd install
npm.cmd start
```

Açılacak adres:

```text
http://localhost:3100
```

API:

```text
GET /api/health
GET /api/machines
GET /api/machines/laser01/status
GET /api/machines/laser01/telemetry/latest
GET /api/machines/laser01/daily-summary
GET /api/machines/laser01/alarms
GET /api/machines/laser01/events
```
