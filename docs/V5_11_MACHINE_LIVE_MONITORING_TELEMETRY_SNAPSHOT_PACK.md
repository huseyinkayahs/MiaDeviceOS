# FactoryBox One v5.11.0

## Machine Live Monitoring / Telemetry Snapshot Pack

Bu sprint, v5.10 ile yönetilebilir hale gelen customer/site/machine kayıtlarını canlı izleme ekranına bağlar.

## Amaç

Admin panelde makinelerin son telemetri, cihaz bağlantısı, alarm ve çalışma durumu bilgisini tek ekranda göstermek.

## Eklenenler

- Live Monitoring menüsü
- Makine canlı durum kartları
- Son telemetri snapshot alanları
- Current, temperature, WiFi RSSI ve uptime görünümü
- Cihaz online/toplam sayısı
- Aktif alarm sayısı
- Signal age / veri tazeliği hesabı
- Health sınıflandırması: running, stopped, online, offline, stale, alarm, no_device, maintenance, archived
- `/api/admin/live-monitoring` endpoint'i
- Telemetri ve durum sorguları için performans indeksleri

## Not

Bu sprint ödeme, cihaz claim veya asset yönetim mantığını değiştirmez. Mevcut API akışları korunur; admin panel daha izlenebilir hale gelir.
