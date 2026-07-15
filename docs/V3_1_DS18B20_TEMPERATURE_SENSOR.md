# FactoryBox One v3.1 - DS18B20 Temperature Sensor

## Amaç

FactoryBox One cihazına gerçek DS18B20 sıcaklık sensörü desteği eklemek ve sıcaklık verisini firmware, MQTT, diagnostics ve SmartDashboard Lite katmanlarında görünür hale getirmek.

## Donanım bağlantısı

- DS18B20 VCC: ESP32 3.3V
- DS18B20 GND: ESP32 GND
- DS18B20 DATA: ESP32 GPIO4
- DATA ile 3.3V arasına pull-up direnç: 4.7 kOhm önerilir. Kısa kabloda 10 kOhm testte çalışabilir.

## Firmware

- Firmware sürümü: `3.1.0`
- Sensör tipi: `DS18B20`
- Data pini: `GPIO4`
- Çözünürlük: `10 bit`
- Okuma aralığı: `2000 ms`
- Sensör bağlantı ve okuma hata sayaçları eklendi.
- Seri port sıcaklık logu azaltıldı; sadece ilk okumada, anlamlı değişimde veya periyodik olarak yazdırılır.

## MQTT komutu

Topic:

```text
mia/site01/laser01/command
```

Payload:

```json
{
  "command": "get_temperature",
  "request_id": "temperature-test-001"
}
```

Cevap topic:

```text
mia/site01/laser01/command/status
```

Cevapta aşağıdaki alanlar bulunur:

- `connected`
- `valid`
- `temperature_c`
- `data_pin`
- `resolution_bits`
- `read_interval_ms`
- `read_count`
- `error_count`
- `temperature_limit_c`
- `over_limit`

## Diagnostics ve telemetri

- `get_diagnostics` cevabına `sensor.temperature_sensor` bölümü eklendi.
- `get_health` cevabına sıcaklık sensörü durum alanları eklendi.
- Heartbeat, telemetry ve BLE status mesajlarına sensör bağlantı/okuma durumu eklendi.

## SmartDashboard Lite

- Dashboard sürümü `0.4.0` oldu.
- Ana ekrana sıcaklık kartı eklendi.
- `get_temperature` butonu eklendi.
- Temperature Sensor detay paneli eklendi.
- Dashboard açılışında sıcaklık verisi otomatik istenir.

## Not

Bu sprint sıcaklık ölçüm ve izleme altyapısını tamamlar. `over_limit` alanı sıcaklık limitinin aşılıp aşılmadığını gösterir. Over-temperature alarm akışı, mevcut tek-alarm motorunu değiştirmemek için ayrı sprintte ele alınmalıdır.
