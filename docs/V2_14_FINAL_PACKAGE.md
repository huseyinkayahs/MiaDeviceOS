# MiaDeviceOS / FactoryBox One v2.14 Final V2 Package

## Amaç
V2 hattını temiz bir kapanış noktasına getirmek, pilot kurulum öncesi yazılım, dashboard, dokümantasyon, n8n akışları ve GitHub sürüm durumunu kontrol etmek.

Bu sprint yeni özellik sprinti değildir. Amaç, mevcut sistemi paketlemek ve V3 gerçek saha aşamasına güvenli geçiş hazırlığı yapmaktır.

## Kapsam

- Git durum kontrolü
- SmartDashboard Lite son kontrolü
- ESP32 firmware final smoke kontrolü
- n8n workflow durum kontrolü
- Dokümantasyon kontrolü
- Release tag hazırlığı
- Temiz ZIP yedek alma
- V3 geçiş notları

## V2 Final Sistem Özeti

FactoryBox One V2 hattı aşağıdaki bileşenleri içerir:

- MiaDeviceOS firmware core
- MQTT command engine
- Remote config
- Alarm system
- Heartbeat
- OTA
- BLE service mode
- BLE security
- Diagnostics
- Runtime log level
- Persistent runtime settings
- Production health monitor
- Watchdog
- Boot diagnostics
- Field reliability layer
- Machine runtime tracker
- Daily summary
- Digital input runtime driver
- Input source persistence
- SmartFlows n8n daily report
- SmartFlows machine stop alert
- Stop alert anti-spam logic
- SmartDashboard Lite

## Final Kontrol Komutları

V2 final kontrolünde aşağıdaki komutlar tekrar doğrulanmalıdır:

```json
{"command":"get_config","request_id":"v214-config-001"}
```

```json
{"command":"get_machine_runtime","request_id":"v214-machine-001"}
```

```json
{"command":"get_daily_summary","request_id":"v214-daily-001"}
```

```json
{"command":"get_digital_inputs","request_id":"v214-di-001"}
```

```json
{"command":"get_runtime_settings","request_id":"v214-runtime-001"}
```

```json
{"command":"get_health","request_id":"v214-health-001"}
```

```json
{"command":"get_diagnostics","request_id":"v214-diag-001"}
```

## Beklenen Güvenli Varsayılanlar

Pilot öncesi güvenli varsayılan durum:

```text
log_level = INFO
machine_input_source = AUTO_CURRENT
DI1 simulation = false
SmartDashboard Lite çalışıyor
n8n daily report workflow aktif
n8n stop alert workflow aktif
```

## Release Tag Önerisi

V2 final package için önerilen tag:

```text
v2.14.0
```

Tag mesajı:

```text
FactoryBox One v2.14.0 final V2 package
```

## Sonuç
v2.14 sonunda V2 hattı kapatılır ve V3 gerçek saha / donanım / pilot kurulum dönemine geçilir.
