# MiaDeviceOS / FactoryBox One v2.13 SmartDashboard Device Controls

## Amaç
SmartDashboard Lite üzerinden cihaz kontrolünü daha güvenli ve anlaşılır hale getirmek.

Bu sprintte ESP32 firmware'e dokunulmadı. Sadece lokal SmartDashboard Lite paneli geliştirildi.

## Eklenen Özellikler

```text
DI1 seçimi için onay penceresi
AUTO_CURRENT seçimi için onay penceresi
Restart için açıklayıcı onay penceresi
get_config butonu
get_diagnostics butonu
get_reliability butonu
get_watchdog butonu
get_boot_diagnostics butonu
get_runtime_settings butonu
Diagnostics detay paneli
Reliability detay paneli
Runtime Settings detay paneli
Digital Inputs detay paneli
Dashboard tarafında izin verilen komut listesi
```

## Güvenli Kontrol Mantığı

DI1 ve AUTO_CURRENT seçimleri kalıcıdır. Bu nedenle panelden kaynak değiştirilirken kullanıcıya onay sorulur.

Özellikle DI1 seçimi için uyarı önemlidir:

```text
DI1 fiziksel olarak bağlı değilse makine STOPPED görünebilir.
DI1 seçimi restart sonrası da korunur.
```

AUTO_CURRENT seçimi için de uyarı gösterilir:

```text
AUTO_CURRENT seçimi restart sonrası korunur.
Simüle akım yüksekse makine RUNNING görünebilir.
```

## Okuma Komutları

Panelden aşağıdaki okuma komutları gönderilebilir:

```text
get_config
get_health
get_machine_runtime
get_daily_summary
get_digital_inputs
get_runtime_settings
get_reliability
get_watchdog
get_boot_diagnostics
get_diagnostics
```

## Dashboard Komut Güvenliği

Backend tarafında izin verilen komut listesi eklendi. Panel `/api/command/:command` üzerinden sadece izin verilen okuma komutlarını gönderebilir.

Cihaz davranışını değiştiren özel işlemler ayrı endpoint üzerinden yapılır:

```text
/api/machine/input-source/AUTO_CURRENT
/api/machine/input-source/DI1
/api/device/restart
```

## Test Planı

```text
npm.cmd start
Paneli aç
Tüm Verileri Yenile
get_diagnostics çalıştır
get_reliability çalıştır
DI1 seç butonunda onay penceresini gör
İptal et ve komut gitmediğini doğrula
DI1 seç ve onayla
AUTO_CURRENT seç ve onayla
Restart butonunda açıklayıcı onay penceresini gör
```

## Bilinen Durumlar

```text
Panel hâlâ lokal çalışıyor.
Çoklu cihaz desteği yok.
Kullanıcı girişi yok.
Grafik geçmişi yok.
Production dashboard değil, pilot/test panelidir.
```
