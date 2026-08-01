# HukaTech v6.13.0 – Device Capability Firmware Sync

## Amaç

HukaTech panelinden MQTT ile gönderilen `set_capabilities` komutunun ESP32 firmware tarafından kabul edilmesi, doğrulanması, kalıcı NVS belleğe yazılması ve `command/status` üzerinden sonuç döndürülmesi.

## Değişen dosyalar

```text
src/command_manager.cpp
src/storage_manager.cpp
src/mqtt_manager.cpp
include/storage_manager.h
```

## Eklenen davranışlar

- `set_capabilities` komutu
- Backend `command_id` alanı için korelasyon desteği
- `factorybox-device-capabilities-v1` şema kontrolü
- En fazla 40 yetkinlik kontrolü
- Zorunlu `key` ve `type` alanı kontrolü
- Yinelenen yetkinlik anahtarı kontrolü
- En fazla 8192 bayt yetkinlik manifesti
- NVS belleğe kalıcı kayıt
- Eski sürümün yeni sürümün üzerine yazılmasını engelleme
- Aynı sürüm ve aynı içerikte idempotent başarı cevabı
- Aynı sürüm ve farklı içerikte sürüm çakışması cevabı
- `get_capabilities` durum sorgusu
- MQTT paket tamponu 12288 bayta yükseltildi

## Önemli teknik sınır

Bu aşama yetkinlik manifestini doğrular ve kalıcı olarak kaydeder. Fiziksel sensör sürücülerini çalışma sırasında otomatik olarak değiştirmez. Durum cevabında bu nedenle:

```json
{
  "apply_mode": "manifest",
  "hardware_runtime_updated": false
}
```

alanları bulunur.

## Kurulum

ZIP içeriğini aşağıdaki proje klasörünün üzerine kopyalayın ve dosya değiştirmeyi onaylayın:

```text
C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)
```

Ardından PlatformIO ile önce derleme yapılmalıdır. ESP32 bu kopyalama ve derleme aşamasında bağlı olmak zorunda değildir.
