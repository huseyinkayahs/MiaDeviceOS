# v3.2 Live DI1 Updates

## Amaç

PC817 optokuplör üzerinden gelen DI1 değişikliklerinin SmartDashboard Lite üzerinde butona basmadan otomatik görünmesi.

## Eklenenler

- DI1 kararlı durumu değiştiğinde otomatik MQTT olay mesajı
- Yeni topic: `mia/site01/laser01/digital-input/status`
- Dashboard bu topic'i sürekli dinler
- `ACTIVE / INACTIVE` durumu otomatik güncellenir
- DI1 makine kaynağı seçiliyse mevcut `machine/status` mesajı ile `RUNNING / STOPPED` da otomatik güncellenir

## Test

1. Dashboard'u yeniden başlatın.
2. Makine giriş kaynağını `DI1` seçin.
3. PC817 IN1 girişine test gerilimi uygulayın: DI1 `ACTIVE`, makine `RUNNING`.
4. Test gerilimini kaldırın: DI1 `INACTIVE`, makine `STOPPED`.
5. `Dijital Girişleri Getir` butonuna basmak gerekmemelidir.
