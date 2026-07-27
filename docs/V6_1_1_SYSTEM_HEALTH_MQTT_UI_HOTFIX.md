# FactoryBox One v6.1.1 — System Health Readability & MQTT Accuracy Hotfix

## Amaç

System Health ekranındaki servis kartı metinlerinin global `header` stilleri nedeniyle koyu zeminde okunamaması ve varsayılan genel MQTT broker bağlantısının gerçek üretim MQTT bağlantısı gibi görünmesi düzeltildi.

## Düzeltmeler

- Servis Durumları başlığı ve servis kartı başlıkları açık, okunabilir kart tasarımına geçirildi.
- Global header stillerini etkisizleştiren güvenli CSS override eklendi.
- Servis kartlarındaki başlık, açıklama ve durum rozetlerinin kontrastı yükseltildi.
- MQTT broker bağlantısı ile cihaz trafiği birbirinden ayrıldı.
- `MQTT_URL` açıkça tanımlı değilse durum `YAPILANDIRILMADI` olarak gösteriliyor.
- Varsayılan genel demo broker artık sağlıklı üretim bağlantısı sayılmıyor.
- Broker bağlı ancak cihaz mesajı yoksa `BROKER BAĞLI / CİHAZ VERİSİ YOK` görünümü eklendi.
- Son cihaz mesajı belirlenen süreden eskiyse `VERİ ESKİ` uyarısı eklendi.
- System Health servis listesine `MQTT Broker` ve `Cihaz Trafiği` kartları eklendi.
- `/api/health` yanıtına `mqtt_configured` ve `mqtt_broker_connected` alanları eklendi.

## MQTT Sağlık Kuralı

```text
MQTT_URL yok                  -> YAPILANDIRILMADI
MQTT_URL var, broker kapalı   -> ÇEVRİMDIŞI
Broker bağlı, cihaz mesajı yok-> BROKER BAĞLI / CİHAZ VERİSİ YOK
Cihaz mesajı eski             -> VERİ ESKİ
Broker ve cihaz trafiği aktif -> BAĞLI
```

Varsayılan cihaz mesajı eskime süresi 180 saniyedir. `.env` içinde `MQTT_HEALTH_STALE_SEC` ile değiştirilebilir.
