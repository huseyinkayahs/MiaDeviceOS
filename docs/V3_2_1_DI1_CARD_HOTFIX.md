# v3.2.1 DI1 Card Hotfix

SmartDashboard Lite'ta makine RUNNING/STOPPED durumu canlı değişirken DI1 kartının eski değerde kalması düzeltildi.

- `machine/status` mesajındaki `di1_active` değeri canlı DI1 durumuna aktarılır.
- Heartbeat içindeki `di1_active` yedek canlı kaynak olarak kullanılır.
- DI1 kartı ACTIVE/INACTIVE değerini canlı MQTT verisinden gösterir.
- ESP32 firmware değişikliği yoktur; tekrar Build/Upload gerekmez.
