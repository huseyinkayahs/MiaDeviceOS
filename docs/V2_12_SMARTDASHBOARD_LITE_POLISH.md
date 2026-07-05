# MiaDeviceOS / FactoryBox One v2.12 SmartDashboard Lite Polish

## Amaç
SmartDashboard Lite panelini pilot kullanım için daha anlaşılır ve daha stabil hale getirmek.

Bu sprintte ESP32 firmware'e dokunulmadı. Sadece lokal web panel iyileştirildi.

## Eklenen İyileştirmeler

- MQTT bağlantı durumu göstergesi iyileştirildi.
- Cihaz online / bekleniyor göstergesi eklendi.
- Son panel güncelleme zamanı eklendi.
- Son MQTT mesaj zamanı eklendi.
- Son gönderilen komut bilgisi eklendi.
- Son komut cevabı özeti eklendi.
- Son hata alanı eklendi.
- Komut gönderirken butonlar geçici olarak disabled oluyor.
- Komut gönderildi / hata oluştu bildirimleri toast olarak gösteriliyor.
- Komut geçmişi paneli eklendi.
- Raw MQTT mesajları korunmaya devam ediyor.
- `.env.example` içine `DEVICE_ONLINE_TIMEOUT_SEC` eklendi.

## Online Durum Mantığı

Panel cihazı online kabul etmek için son 90 saniye içinde şu mesajlardan en az birini bekler:

```text
heartbeat
command/status
machine/status
```

Bu süre `.env` üzerinden değiştirilebilir:

```text
DEVICE_ONLINE_TIMEOUT_SEC=90
```

## Test Edilecekler

```text
npm.cmd start
http://localhost:3000
Tüm Verileri Yenile
get_health
get_machine_runtime
get_daily_summary
DI1 seç
AUTO_CURRENT seç
Restart
```

## Beklenen Sonuç

```text
Panel açılır
MQTT bağlı görünür
Cihaz online görünür
Son MQTT mesaj zamanı güncellenir
Komut gönderildi bildirimi görünür
Komut geçmişi dolar
Hata yoksa Son hata = Yok görünür
```

## Notlar

Bu panel hâlâ lokal pilot panelidir. Production dashboard değildir.
