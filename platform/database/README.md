# FactoryBox Platform Database

Bu klasör, FactoryBox / Mia BusinessOS platformu için lokal PostgreSQL geliştirme ortamını içerir.

## Başlatma

```powershell
cd platform\database
docker compose up -d
```

## Durdurma

```powershell
docker compose down
```

## Veriyi tamamen silip sıfırdan başlatma

Dikkat: Lokal veriyi siler.

```powershell
docker compose down -v
docker compose up -d
```

## Tabloları Görme

```powershell
docker exec -it factorybox-postgres psql -U factorybox -d factorybox -c "\dt"
```

## Temel Kontrol Sorguları

```powershell
docker exec -it factorybox-postgres psql -U factorybox -d factorybox -f /app/queries/001_basic_checks.sql
```

## PgAdmin

http://localhost:5050

Giriş:

```text
admin@factorybox.local
factorybox_admin
```

Server ekleme:

```text
Host: factorybox-postgres
Port: 5432
Database: factorybox
User: factorybox
Password: factorybox_dev_pass
```
