# Machine Runtime Tracker

## Amaç

FactoryBox One için ilk ürün mantığıdır.

Bu katman makinenin çalışma durumunu takip eder:

```text
RUNNING  -> Makine çalışıyor
STOPPED  -> Makine duruyor
```

İlk sürümde gerçek dijital giriş beklenmeden çalışır. Varsayılan otomatik modda simüle akım değeri kullanılır.

---

## State Kaynağı

Varsayılan kaynak:

```text
AUTO_CURRENT
```

Makine durumu şu eşik ile hesaplanır:

```text
current >= 3.0  -> RUNNING
current < 3.0   -> STOPPED
```

Gerçek sensör / dijital giriş geldiğinde bu katman korunacak, sadece giriş kaynağı değiştirilecektir.

---

## MQTT Topic

Cihaz otomatik olarak makine durumunu şu topic'e gönderir:

```text
mia/site01/laser01/machine/status
```

Örnek payload:

```json
{
  "device_id": "laser01",
  "event": "MACHINE_STATUS",
  "firmware_version": "2.2.0",
  "machine": {
    "state": "RUNNING",
    "source": "AUTO_CURRENT",
    "today_runtime_sec": 120,
    "today_stop_sec": 30,
    "utilization_pct": 80
  }
}
```

---

## Yeni Komutlar

### get_machine_runtime

Makinenin anlık çalışma durumunu döndürür.

```json
{
  "command": "get_machine_runtime",
  "request_id": "machine-001"
}
```

### get_daily_summary

n8n / AI raporu için günlük özet datası döndürür.

```json
{
  "command": "get_daily_summary",
  "request_id": "daily-001"
}
```

### set_machine_state

Sensör hazır değilken test için manuel state değiştirir.

```json
{
  "command": "set_machine_state",
  "request_id": "machine-state-001",
  "state": "STOPPED"
}
```

Geçerli değerler:

```text
RUNNING
STOPPED
AUTO
```

`AUTO` manuel override'ı kapatır ve cihaz tekrar otomatik akım eşiğine göre karar verir.

### reset_machine_runtime

Günlük sayaçları test için sıfırlar.

```json
{
  "command": "reset_machine_runtime",
  "request_id": "machine-reset-001"
}
```

---

## Sayaçlar

```text
today_runtime_sec
Makinenin bugün çalıştığı toplam süre.

 today_stop_sec
Makinenin bugün durduğu toplam süre.

utilization_pct
Çalışma süresinin toplam gözlenen süreye oranı.

state_change_count
RUNNING / STOPPED değişim sayısı.

longest_run_sec
En uzun çalışma segmenti.

longest_stop_sec
En uzun duruş segmenti.
```

---

## Bilinen Durum

- Bu sürümde gün kavramı gerçek saat değil, uptime day index üzerinden hesaplanır.
- Gerçek RTC / NTP eklendiğinde günlük rapor gerçek tarihe bağlanabilir.
- Gerçek sensör hazır olduğunda AUTO_CURRENT kaynağı gerçek sensör veya dijital girişe çevrilecek.


## v2.2.1 Machine Runtime Counter Hotfix

`longest_run_sec` hesaplamasında manuel RUNNING / STOPPED testleri sırasında görülebilen taşma değeri engellendi.

Düzeltme:

```text
longest_run_sec overflow koruması
state geçişinde segment istatistiğini güvenli kapatma
last_state_change_ms için güvenli elapsed hesaplama
Firmware 2.2.1
```
