# SmartDashboard Lite

## Amaç

SmartDashboard Lite, FactoryBox One / MiaDeviceOS için lokal çalışan basit bir web kontrol panelidir.

Bu panel ESP32 içine gömülmez. Bilgisayarda Node.js ile çalışır ve MQTT üzerinden cihaza bağlanır.

```text
FactoryBox One / ESP32
↓
MQTT
↓
SmartDashboard Lite
↓
Tarayıcı
```

## İlk Sürüm Kapsamı

Panelde gösterilen bilgiler:

```text
Makine durumu: RUNNING / STOPPED
Bugünkü çalışma süresi
Bugünkü duruş süresi
Kullanım oranı
DI1 durumu
Input source: AUTO_CURRENT / DI1
Alarm durumu
Firmware version
Reliability score
Son komut cevabı
Son MQTT mesajları
```

Panelden gönderilebilen komutlar:

```text
Yenile
get_health
get_machine_runtime
get_daily_summary
get_digital_inputs
AUTO_CURRENT seç
DI1 seç
Restart
```

## Kurulum

Proje klasöründe:

```powershell
cd smartdashboard-lite
copy .env.example .env
npm install
npm start
```

Sonra tarayıcıdan aç:

```text
http://localhost:3000
```

## MQTT Ayarları

`.env` dosyası:

```text
MQTT_URL=mqtt://broker.emqx.io:1883
MQTT_BASE_TOPIC=mia/site01/laser01
DEVICE_ID=laser01
```

Kullanıcı adı / şifreli broker kullanılırsa:

```text
MQTT_USERNAME=...
MQTT_PASSWORD=...
```

## Kullanım Notları

- Panel lokal çalışır.
- Çoklu cihaz desteği henüz yoktur.
- İlk hedef pilot kurulumda cihaz durumunu hızlı görmek ve temel komutları göndermektir.
- ESP32 firmware içine web server eklenmedi; cihazın kaynakları korunur.

## Sonraki Aşamalar

```text
Çoklu cihaz desteği
Grafikler
Günlük rapor geçmişi
Kullanıcı girişi
Bulut dashboard
Mobil uyum iyileştirme
SmartDashboard Pro
```
