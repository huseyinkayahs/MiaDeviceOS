
# MiaDeviceOS / FactoryBox One v3.6.3 Hotfix

## Hotfix Adı

v3.6.3 Live Runtime Dashboard Fix

---

## Amaç

Dashboard Günlük Özet kartında çalışma süresinin canlı artmasını sağlamak.

---

## Sorun

`latest_daily_summary.runtime_sec` sadece son alınan günlük özet snapshot değerini gösterir.

Bu yüzden dashboard'da runtime sabit kalıyordu:

```text
Runtime: 56 sn
```

Ancak makine RUNNING durumundayken canlı süre aslında şurada artıyordu:

```text
latest_state.duration_sec
```

---

## Çözüm

Dashboard runtime hesaplama mantığı güncellendi.

Yeni mantık:

```text
Makine RUNNING ise:
  Runtime = max(daily_summary.runtime_sec, latest_state.duration_sec)

Makine STOPPED ise:
  Stop = max(daily_summary.stop_sec, latest_state.duration_sec)

Utilization:
  Runtime / (Runtime + Stop)
```

---

## Değişen Dosyalar

```text
platform/backend/public/app.js
platform/backend/package.json
```

---

## Test

Dashboard:

```text
http://localhost:3100
```

Tarayıcıda:

```text
Ctrl + F5
```

---

## Beklenen Sonuç

Makine RUNNING ise Runtime değeri artık canlı artan süreyi gösterir.

Örnek:

```text
Runtime: 4 sa 15 dk
Stop: 0 sn
Utilization: 100%
```

---

## Not

Bu düzeltme dashboard gösterimi içindir.

`daily_summary` hâlâ cihazdan gelen snapshot rapordur.
İleride backend tarafında gerçek günlük runtime hesaplaması veritabanından ayrıca yapılabilir.
