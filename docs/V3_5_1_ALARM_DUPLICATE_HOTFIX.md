
# v3.5.1 Alarm Duplicate Hotfix

## Sorun

Aynı `OVER_CURRENT` alarmı aktifken backend her yeni alarm mesajında yeni `active` alarm satırı açıyordu.

## Düzeltme

`platform/backend/server.js` içinde alarm kayıt mantığı güncellendi.

Yeni davranış:

```text
Aynı machine + device + alarm_type için active alarm varsa:
  Yeni satır açılmaz
  Mevcut active alarm güncellenir

Clear mesajı gelirse:
  Active alarm cleared yapılır

Farklı alarm tipi gelirse:
  Yeni alarm satırı açılır
```

## Kontrol Kelimesi

```text
existingActiveAlarm
```
