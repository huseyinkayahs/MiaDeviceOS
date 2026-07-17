
# MiaDeviceOS / FactoryBox One v3.6.4 Hotfix

## Hotfix Adı

v3.6.4 Database Calculated Runtime Fix

---

## Amaç

Dashboard Günlük Özet kartında runtime ve stop sürelerinin cihaz state geçmişinden doğru hesaplanmasını sağlamak.

---

## Sorun

v3.6.3 ile RUNNING durumunda runtime canlı artıyordu.

Fakat makine STOPPED yapıldığında runtime tekrar eski snapshot değerine dönüyordu:

```text
Runtime: 56 sn
```

---

## Neden

`latest_state.duration_sec` sadece aktif state'in süresidir.

```text
RUNNING iken:
  latest_state.duration_sec = aktif çalışma süresi

STOPPED iken:
  latest_state.duration_sec = aktif duruş süresi
```

Bu yüzden günlük toplam çalışma/duruş süreleri dashboard tarafında tek aktif state üzerinden doğru hesaplanamaz.

---

## Çözüm

Backend içine yeni hesaplama fonksiyonu eklendi:

```text
getCalculatedTodayRuntime(machineId)
```

Bu fonksiyon PostgreSQL'deki `machine_state_events` tablosunu okuyarak bugünkü toplamları hesaplar:

```text
RUNNING event süreleri toplamı → runtime_sec
STOPPED event süreleri toplamı → stop_sec
runtime + stop → observed_sec
runtime / observed → utilization_pct
```

---

## API Güncellemesi

`GET /api/machines/laser01/status` çıktısına yeni alan eklendi:

```text
calculated_today_summary
```

Örnek:

```json
{
  "calculated_today_summary": {
    "runtime_sec": 15136,
    "stop_sec": 42,
    "observed_sec": 15178,
    "utilization_pct": 99.7
  }
}
```

---

## Dashboard Güncellemesi

Dashboard artık şu alanı kullanır:

```text
st.calculated_today_summary
```

Yani:

```text
Runtime: veritabanındaki bugünkü toplam RUNNING süresi
Stop: veritabanındaki bugünkü toplam STOPPED süresi
Utilization: runtime / observed
```

---

## SmartAI Güncellemesi

SmartAI raporu da öncelikli olarak `calculated_today_summary` kullanacak şekilde güncellendi.

Bu sayede SmartAI raporundaki çalışma süresi de dashboard ile tutarlı olur.

---

## Değişen Dosyalar

```text
platform/backend/server.js
platform/backend/public/app.js
platform/backend/package.json
```

---

## Test

API:

```text
http://localhost:3100/api/machines/laser01/status
```

Dashboard:

```text
http://localhost:3100
```

Tarayıcı:

```text
Ctrl + F5
```

---

## Beklenen Sonuç

```text
RUNNING iken:
  Runtime artar

STOPPED iken:
  Runtime düşmez
  Stop artar

Tekrar RUNNING iken:
  Runtime kaldığı yerden artmaya devam eder
```

---

## Sonuç

v3.6.4 ile dashboard artık snapshot değerine değil, veritabanındaki gerçek state geçmişine göre günlük çalışma/duruş sürelerini hesaplar.
