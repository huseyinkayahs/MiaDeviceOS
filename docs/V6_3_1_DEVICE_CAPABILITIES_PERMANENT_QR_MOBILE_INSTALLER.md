# FactoryBox One v6.3.1

## Device Capabilities, Permanent QR & Mobile Installer

Bu sürüm, FactoryBox cihazlarının sensör ve kontrol yetkinliklerini hem Admin Panel hem de mobil kurulum panelinden yönetir.

## Ana özellikler

- Cihaz başına sensör ve yetkinlik kaydı
- Akım, sıcaklık, enerji, çalışma durumu, titreşim ve basınç ölçümü
- Dijital/analog giriş, röle çıkışı, Modbus ve özel yetkinlikler
- Fiziksel kanal, sensör modeli, telemetri alanı ve birim tanımlama
- Kalibrasyon, minimum/maksimum değer ve alarm limitleri
- Örnekleme ve veri gönderim aralıkları
- Lazer, CNC, plastik enjeksiyon ve genel makine hazır profilleri
- Sürümlü cihaz konfigürasyonu
- Admin Panel ve mobil panelin aynı API/veritabanını kullanması
- Kalıcı cihaz QR etiketi
- QR tokeninin veritabanında SHA-256 hash olarak saklanması
- QR token yenileme/iptal mekanizması
- Telefonun standart kamerasıyla QR açılışı
- Uygun tarayıcılarda uygulama içi kamera taraması
- Mobil PWA altyapısı
- MQTT `set_capabilities` komutuyla cihaza konfigürasyon gönderme
- JSON konfigürasyon indirme
- Audit log kayıtları

## Güvenlik

Kalıcı QR içinde müşteri şifresi, Wi-Fi şifresi veya MQTT parolası bulunmaz. QR erişimi cihaz UID yerine kısa bir slug ve rastgele token kullanır. Token veritabanında düz metin olarak değil SHA-256 hash biçiminde tutulur. QR ile açılan mobil panelde ayrıca yetkili FactoryBox kullanıcı oturumu ve `MANAGE_DEVICES` izni gerekir.

## Mobil erişim

Yerel ağ testinde QR ana adresi bilgisayarın IPv4 adresiyle oluşturulmalıdır:

```text
http://BILGISAYAR_IP:3100
```

`localhost` ile oluşturulan QR telefon üzerinden açılamaz.

Telefonun standart kamerası QR bağlantısını doğrudan açar. Uygulama içi kamera taraması tarayıcı güvenlik kuralları nedeniyle HTTPS gerektirebilir.

## Firmware notu

Yetkinlikler panelde kaydedilebilir ve JSON olarak indirilebilir. Konfigürasyonun MQTT üzerinden cihaza uygulanması için firmware tarafının aşağıdaki komutu desteklemesi gerekir:

```json
{
  "command": "set_capabilities",
  "configuration": {
    "schema": "factorybox-device-capabilities-v1"
  }
}
```
