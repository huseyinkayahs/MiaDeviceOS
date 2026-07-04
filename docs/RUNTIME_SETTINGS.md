# MiaDeviceOS Runtime Settings

## Amaç

Runtime settings, cihaz çalışırken değiştirilen bazı ayarların restart sonrası da korunmasını sağlar.

v1.6 kapsamında ilk kalıcı runtime ayarı:

```text
log_level
```

## Kalıcı Log Level

`set_log_level` komutu artık sadece RAM içinde değişiklik yapmaz. Seçilen log seviyesi ESP32 Preferences storage içine kaydedilir.

Cihaz restart sonrası kayıtlı log seviyesi ile açılır.

## Komutlar

### get_log_level

```json
{
  "command": "get_log_level",
  "request_id": "log-001"
}
```

### set_log_level

```json
{
  "command": "set_log_level",
  "request_id": "log-002",
  "level": "DEBUG"
}
```

Başarılı cevapta:

```json
{
  "status": "done",
  "message": "Log level updated and persisted",
  "log_level": "DEBUG",
  "persistent": true
}
```

### get_runtime_settings

```json
{
  "command": "get_runtime_settings",
  "request_id": "runtime-001"
}
```

Örnek cevap:

```json
{
  "command": "get_runtime_settings",
  "status": "done",
  "runtime_settings": {
    "log_level": "INFO",
    "log_level_value": 2,
    "log_level_persistent": true
  }
}
```

## Test Planı

1. `set_log_level` ile `DEBUG` yap.
2. `get_log_level` ile `DEBUG` olduğunu doğrula.
3. `restart` komutu gönder.
4. Cihaz açıldıktan sonra `get_log_level` gönder.
5. Hâlâ `DEBUG` ise persistence başarılıdır.
6. Üretim kullanımı için tekrar `INFO` seviyesine al.

## Notlar

- Gerçek WiFi/MQTT config zaten ayrı config storage içinde kalıcıdır.
- Runtime settings ayrı Preferences namespace kullanır: `runtime`.
- İleride BLE servis ayarları ve diğer saha ayarları buraya taşınabilir.
