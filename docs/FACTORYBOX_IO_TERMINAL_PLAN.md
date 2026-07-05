# FactoryBox One IO Terminal Plan

## Amaç

FactoryBox One ilk pilot cihazı için klemens ve giriş/çıkış planını sade şekilde tanımlamak.

---

## MVP Terminal Planı

İlk pilot için önerilen minimum klemensler:

```text
PWR+     → Cihaz besleme artı
PWR-     → Cihaz besleme eksi
DI1      → Makine RUN sinyali girişi
DI_COM   → DI1 ortak / GND tarafı
GND      → Cihaz düşük voltaj GND
```

---

## DI1 Kullanımı

DI1, makine RUN/STOP bilgisini okumak için kullanılır.

```text
DI1 ACTIVE   → RUNNING
DI1 INACTIVE → STOPPED
```

Firmware varsayılanı:

```text
GPIO27
INPUT_PULLUP
Active LOW
```

---

## Gelecek IO Planı

FactoryBox One ürün hedefinde ileride şu giriş/çıkışlar yer alabilir:

```text
DI1 → Machine RUN
DI2 → Machine alarm / fault
DI3 → Door / cover / safety
DI4 → Operator button / counter input
AI1 → Current sensor
AI2 → Temperature / analog signal
RO1 → Warning relay
RO2 → External buzzer / light
RS485 → Modbus
ETH → Network
```

---

## Pilot İçin Sadelik Kararı

İlk pilotta sadece DI1 zorunludur.

Amaç:

```text
Önce makine çalışıyor mu / durdu mu bilgisini güvenilir almak.
```

Diğer giriş/çıkışlar sonraki pilotlarda eklenecektir.
