# SmartDashboard Lite

SmartDashboard Lite, FactoryBox One / MiaDeviceOS için lokal çalışan basit web kontrol panelidir.

## Mimari

```text
FactoryBox One / ESP32
↓
MQTT
↓
SmartDashboard Lite
↓
Web tarayıcı
```

## Çalıştırma

```powershell
cd "C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)\smartdashboard-lite"
npm.cmd install
npm.cmd start
```

Tarayıcı:

```text
http://localhost:3000
```

## Ayar Dosyası

İlk kurulumda:

```powershell
copy .env.example .env
```

Varsayılan ayarlar:

```text
MQTT_URL=mqtt://broker.emqx.io:1883
MQTT_BASE_TOPIC=mia/site01/laser01
DEVICE_ID=laser01
DEVICE_ONLINE_TIMEOUT_SEC=90
```

## Panelde Görünen Bilgiler

```text
Makine durumu
Input source
Çalışma süresi
Duruş süresi
Kullanım oranı
DI1 durumu
Alarm durumu
Firmware version
Reliability score
MQTT bağlantısı
Cihaz online durumu
Son MQTT mesaj zamanı
Son komut cevabı
Komut geçmişi
```

## Panel Komutları

```text
Tüm Verileri Yenile
get_health
get_machine_runtime
get_daily_summary
get_digital_inputs
AUTO_CURRENT seç
DI1 seç
Restart
```

## v2.12 İyileştirmeleri

```text
Cihaz online göstergesi
Son güncelleme zamanı
Son MQTT mesaj zamanı
Komut gönderildi bildirimi
Komut geçmişi
Son hata alanı
Buton disabled / gönderiliyor durumu
```

## Güvenlik Notu

Bu panel lokal pilot/test panelidir. Production kullanıcı yönetimi, yetkilendirme ve internet üzerinden erişim kapsam dışıdır.


## v2.13 Device Controls

SmartDashboard Lite cihaz kontrol bölümü güvenli hale getirildi.

Eklenenler:

```text
DI1 / AUTO_CURRENT seçimi için onay penceresi
Restart için daha açıklayıcı onay penceresi
get_config butonu
get_diagnostics butonu
get_reliability butonu
get_watchdog butonu
get_boot_diagnostics butonu
get_runtime_settings butonu
Diagnostics / Reliability / Runtime Settings / Digital Inputs detay panelleri
Dashboard üzerinden izin verilen komut listesi
```

Not: DI1 / AUTO_CURRENT seçimi cihazda kalıcıdır ve restart sonrası korunur.
