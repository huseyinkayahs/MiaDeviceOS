# V3 Transition Readiness

## Amaç
V2 yazılım ve dashboard hattı tamamlandıktan sonra V3 gerçek saha aşamasına geçiş için kontrol listesi oluşturmak.

## V3 Ana Hedefi
V3 döneminin amacı artık simülasyon ve lokal testten çıkıp gerçek makine sinyali, gerçek sensör ve pilot kurulum tarafına geçmektir.

## Önerilen V3 Sprintleri

```text
v3.1 Real DI1 Wiring Test
v3.2 First Machine Pilot Installation
v3.3 Current Sensor Selection / Test
v3.4 Real Sensor Driver
v3.5 Sensor Calibration
v3.6 First 7-Day Field Report
```

## V3 Öncesi Hazırlık

### Donanım

```text
FactoryBox kutu / pano içi yerleşim
DI1 izole giriş devresi
Klemens planı
Güç besleme planı
Kablo etiketleri
Durum LED'i
```

### Saha

```text
İlk pilot makine seçimi
Makinede RUN sinyali var mı kontrolü
Kontaktör yardımcı kontağı var mı kontrolü
Pano bağlantı güvenliği
Akım sensörü alternatifi
```

### Yazılım

```text
Firmware v2.14.0 tag hazır
SmartDashboard Lite çalışıyor
n8n workflows aktif
Backup ZIP hazır
```

## Geçiş Kararı
V3'e geçmek için minimum koşul:

```text
V2 final tag alınmış olmalı
Temiz backup alınmış olmalı
Pilot bağlantı planı hazır olmalı
İlk makine seçilmiş olmalı
Elektrik bağlantısı güvenli şekilde planlanmış olmalı
```
