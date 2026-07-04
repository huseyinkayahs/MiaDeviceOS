# MiaDeviceOS Log Level System

## Amaç
Serial Monitor çıktısını ihtiyaca göre kontrol etmek.

## Seviyeler

| Seviye | Değer | Kullanım |
|---|---:|---|
| ERROR | 0 | Kritik hatalar |
| WARN | 1 | Uyarılar ve reddedilen işlemler |
| INFO | 2 | Normal saha/test çıktısı |
| DEBUG | 3 | Detaylı MQTT payload ve düşük seviye debug |

Varsayılan seviye:

```text
INFO
```

## MQTT Komutları

### Log seviyesini oku

Topic:

```text
mia/site01/laser01/command
```

Payload:

```json
{
  "command": "get_log_level",
  "request_id": "log-001"
}
```

### Log seviyesini değiştir

```json
{
  "command": "set_log_level",
  "request_id": "log-002",
  "level": "DEBUG"
}
```

Geçerli değerler:

```text
ERROR
WARN
INFO
DEBUG
```

veya numeric:

```text
0, 1, 2, 3
```

## Notlar
- Log level şu an runtime ayardır.
- Cihaz restart sonrası varsayılan `INFO` seviyesine döner.
- MQTT, Heartbeat, Telemetry ve Alarm sistemleri çalışmaya devam eder; sadece Serial Monitor çıktısı değişir.


## v1.6 Persistence

`set_log_level` komutu artık seçilen seviyeyi runtime settings storage içine kaydeder.
Cihaz yeniden başlasa bile son kaydedilen log level ile açılır.

Önerilen üretim seviyesi: `INFO`.
Sorun analizi için geçici seviye: `DEBUG`.
