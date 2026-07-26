# FactoryBox One v5.24.0 — Machine Downtime & OEE Analytics

## Amaç

Makine bazında üretim adetlerini ve duruş kayıtlarını birleştirerek Availability, Performance, Quality ve OEE KPI değerlerini hesaplamak.

## Eklenenler

- Admin paneline **OEE & Downtime** ekranı
- Makine bazlı günlük planlı üretim süresi ayarı
- İdeal çevrim süresi ve hedef OEE ayarı
- Sağlam, hatalı ve toplam üretim kaydı
- Planlı ve plansız duruş kaydı
- Açık duruşu sonradan kapatma
- MQTT/makine durumundaki tamamlanmış `STOPPED` olaylarını duruş kayıtlarına aktarma
- Tarih ve makine filtresi
- Availability, Performance, Quality ve OEE hesaplamaları
- Makine bazlı OEE tablosu ve günlük trend
- Üretim ve duruş geçmişi
- Audit log kayıtları

## Hesaplama

```text
Net Planlı Süre = Günlük Planlı Süre - Planlı Duruş
Çalışma Süresi = Net Planlı Süre - Plansız Duruş
Availability = Çalışma Süresi / Net Planlı Süre
Performance = (İdeal Çevrim × Toplam Üretim) / Çalışma Süresi
Quality = Sağlam Üretim / Toplam Üretim
OEE = Availability × Performance × Quality
```

Yüzdeler %100 ile sınırlandırılır. Üretim kaydı bulunmadığında Performance, Quality ve OEE değeri `0` gösterilir.

## API

```text
GET   /api/admin/oee-analytics
PATCH /api/admin/oee/settings/:machineId
POST  /api/admin/oee/production
POST  /api/admin/oee/downtime
PATCH /api/admin/oee/downtime/:id/close
POST  /api/admin/oee/sync-machine-states
```
