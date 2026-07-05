# v2.11 SmartDashboard Lite Sprint

## Sprint Amacı

FactoryBox One için lokal çalışan ilk kontrol panelini hazırlamak.

## Kapsam

```text
Node.js backend
MQTT bağlantısı
Socket.IO ile canlı arayüz
Makine durum kartları
Temel komut butonları
Lokal web panel
```

## Firmware Durumu

Bu sprintte ESP32 firmware koduna dokunulmaz.

Panel, MQTT üzerinden mevcut v2.10.0 komutlarını kullanır.

## Beklenen Test

```text
npm install ✅
npm start ✅
http://localhost:3000 açıldı ✅
MQTT bağlı göründü ✅
Yenile butonu çalıştı ✅
get_machine_runtime sonucu geldi ✅
DI1 / AUTO_CURRENT butonları çalıştı ✅
```
