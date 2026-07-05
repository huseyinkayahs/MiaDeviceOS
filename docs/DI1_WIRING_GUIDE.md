# FactoryBox One DI1 Wiring Guide

## Amaç

DI1 girişinin testte ve sahada nasıl kullanılacağını açıklamak.

---

## DI1 Teknik Mantığı

Firmware tarafında DI1:

```text
Pin: GPIO27
Mode: INPUT_PULLUP
Logic: Active LOW
Debounce: 50 ms
```

Anlamı:

```text
DI1 HIGH / açıkta  → INACTIVE → STOPPED
DI1 LOW / GND      → ACTIVE   → RUNNING
```

---

## Bench Test Bağlantısı

Masa üstü testte sadece düşük voltaj tarafında şu yapılabilir:

```text
GPIO27 / DI1 ---- buton ---- GND
```

Butona basılıyken:

```text
DI1 ACTIVE
Machine RUNNING
```

Buton bırakıldığında:

```text
DI1 INACTIVE
Machine STOPPED
```

Bu yöntem sadece ESP32 test ortamı içindir. Makine panosuna doğrudan uygulanmaz.

---

## Saha Bağlantısı — Kuru Kontak

Makineden voltajsız kuru kontak alınabiliyorsa:

```text
FactoryBox DI1 ---- RUN kuru kontak ---- FactoryBox GND
```

Kontak kapalı:

```text
DI1 ACTIVE → RUNNING
```

Kontak açık:

```text
DI1 INACTIVE → STOPPED
```

Kritik kontrol:

```text
Bu kontak üzerinde harici voltaj olmadığından emin olunmalıdır.
```

---

## Saha Bağlantısı — 24V Sinyal

24V RUN çıkışı varsa doğrudan DI1’e bağlanmaz.

Önerilen yapı:

```text
Makine 24V RUN çıkışı
↓
24V optokuplör / ara röle
↓
FactoryBox DI1-GND kuru kontak çıkışı
```

Amaç:

```text
Makine tarafı ile ESP32 tarafı izole kalsın.
```

---

## MQTT Test Komutları

DI1 durumunu okumak:

```json
{
  "command": "get_digital_inputs",
  "request_id": "di-check-001"
}
```

Makine kaynağını DI1 yapmak:

```json
{
  "command": "set_machine_input_source",
  "request_id": "source-di1-001",
  "source": "DI1"
}
```

Makine runtime kontrolü:

```json
{
  "command": "get_machine_runtime",
  "request_id": "machine-runtime-001"
}
```

---

## Test Beklentisi

DI1 aktifken:

```text
machine.state: RUNNING
machine.source: DI1
machine.input_source: DI1
```

DI1 pasifken:

```text
machine.state: STOPPED
machine.source: DI1
machine.input_source: DI1
```

---

## Güvenlik Notları

```text
ESP32 GPIO pinine pano voltajı bağlanmaz.
220V / 380V sinyal doğrudan kullanılmaz.
24V sinyal doğrudan kullanılmaz.
İzole giriş, optokuplör veya ara röle tercih edilir.
Pano içi bağlantı elektrikçiyle yapılmalıdır.
```
