# FactoryBox One v6.3.0 — Device Installation & Onboarding Wizard

## Amaç

Yeni FactoryBox cihazlarının sahada müşteri, tesis ve makineye güvenli ve izlenebilir biçimde bağlanmasını sağlamak.

## Kurulum Akışı

1. Cihaz UID, seri numarası, model ve beklenen firmware bilgileri girilir.
2. Müşteri, tesis ve makine eşleştirmesi yapılır.
3. Ethernet veya Wi-Fi seçilir; MQTT URL ve base topic tanımlanır.
4. Tek kullanımlık provisioning token ve yerel QR kod üretilir.
5. Cihaz bilgisi, heartbeat, telemetri, firmware ve alarm testleri çalıştırılır.
6. Testler tamamlandığında cihaz aktive edilir ve kurulum raporu indirilir.

## Güvenlik

- Provisioning token yalnızca üretildiği anda gösterilir.
- QR kod dış servise gönderilmeden sunucu içinde oluşturulur.
- Wi-Fi şifresi veritabanına kaydedilmez.
- Wi-Fi şifresi yalnızca tarayıcıda oluşturulan indirilebilir JSON dosyasına eklenir.
- Kurulum, test, yeniden açma, aktivasyon ve devre dışı bırakma işlemleri audit log'a yazılır.

## API

```text
GET  /api/admin/device-onboarding
POST /api/admin/device-onboarding
POST /api/admin/device-onboarding/:id/provision-token
POST /api/admin/device-onboarding/:id/device-command
POST /api/admin/device-onboarding/:id/tests
POST /api/admin/device-onboarding/:id/skip-firmware-test
POST /api/admin/device-onboarding/:id/skip-alarm-test
POST /api/admin/device-onboarding/:id/activate
POST /api/admin/device-onboarding/:id/reopen
POST /api/admin/device-onboarding/:id/deactivate
```

## Cihaz Komutları

Sihirbaz şu MQTT komutlarını gönderebilir:

```text
get_device_info
get_status
test_alarm
```

Cihaz firmware'i `test_alarm` komutunu desteklemiyorsa alarm testi yetkili kullanıcı tarafından atlanabilir.
