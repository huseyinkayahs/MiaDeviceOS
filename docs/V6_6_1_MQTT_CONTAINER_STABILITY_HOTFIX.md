# FactoryBox v6.6.1 MQTT Container Stability Hotfix

## Amaç

Windows Docker Desktop ortamında Mosquitto containerinin yeniden başlama döngüsüne girmesini önlemek ve production kurulumunun backend/Nginx aşamasına devam etmesini sağlamak.

## Düzeltmeler

- Mosquitto dosya logu yerine Docker stdout logu kullanır.
- Windows bind-mount log izin riski kaldırıldı.
- MQTT kalıcı verisi Docker named volume üzerinde saklanır.
- Eski `message_size_limit` ayarı `max_packet_size` ile değiştirildi.
- Health-check, kimlik doğrulamalı gerçek MQTT publish işlemi yapar.
- Kurulum yeniden çalıştırıldığında yalnızca eski MQTT containeri yenilenir; PostgreSQL volume korunur.
- Ayrı `repair-mqtt.ps1` onarım komutu eklendi.
