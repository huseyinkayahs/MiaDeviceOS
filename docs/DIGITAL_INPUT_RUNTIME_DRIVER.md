# FactoryBox One Digital Input Runtime Driver

## Amaç

FactoryBox One'ın gerçek sahada makinenin çalışıp çalışmadığını dijital giriş üzerinden anlayabilmesi.

Bu sprintte DI1 dijital giriş altyapısı eklendi ve Machine Runtime Tracker ile ilişkilendirildi.

---

## Temel Mantık

```text
DI1 aktif  -> Machine RUNNING
DI1 pasif -> Machine STOPPED
```

Varsayılan olarak cihaz hâlâ `AUTO_CURRENT` modu ile açılır. DI1 saha testinde komutla aktif edilir.

---

## Donanım Varsayımı

DI1 varsayılan pin:

```text
GPIO27
```

Giriş tipi:

```text
INPUT_PULLUP
Active LOW
```

Yani kuru kontak veya röle kontağı DI1'i GND'ye çektiğinde giriş aktif olur.

Örnek:

```text
DI1 açıkta / HIGH -> INACTIVE
DI1 GND'ye çekildi / LOW -> ACTIVE
```

Bu yapı pano içinden izole kuru kontak alınabildiğinde güvenli ve pratiktir.

---

## Eklenen Dosyalar

```text
include/digital_input_context.h
include/digital_input_manager.h
src/digital_input_manager.cpp
```

---

## Machine Runtime Entegrasyonu

Machine Runtime artık iki otomatik kaynak arasında geçiş yapabilir:

```text
AUTO_CURRENT -> Simüle / akım eşiği ile çalışma algılama
DI1          -> Dijital giriş ile çalışma algılama
```

Manuel test komutu hâlâ kullanılabilir:

```text
set_machine_state RUNNING / STOPPED / AUTO
```

Öncelik:

```text
Manual override varsa -> manuel durum kullanılır
Manual override yoksa ve input_source DI1 ise -> DI1 kullanılır
Manual override yoksa ve input_source AUTO_CURRENT ise -> akım eşiği kullanılır
```

---

## Yeni Komutlar

### get_digital_inputs

DI1 durumunu döndürür.

```json
{
  "command": "get_digital_inputs",
  "request_id": "di-001"
}
```

Beklenen cevap alanları:

```text
pin
raw_level
active
state
source
active_high
pullup
debounce_ms
change_count
simulation_enabled
simulated_active
```

---

### set_machine_input_source

Machine Runtime giriş kaynağını değiştirir.

DI1'e geçmek için:

```json
{
  "command": "set_machine_input_source",
  "request_id": "di-src-001",
  "source": "DI1"
}
```

Akım / simüle current moduna dönmek için:

```json
{
  "command": "set_machine_input_source",
  "request_id": "di-src-002",
  "source": "AUTO_CURRENT"
}
```

---

### set_di1_simulation

Fiziksel bağlantı olmadan DI1 davranışını test etmek için kullanılır.

DI1 aktif simülasyonu:

```json
{
  "command": "set_di1_simulation",
  "request_id": "di-sim-001",
  "enabled": true,
  "active": true
}
```

DI1 pasif simülasyonu:

```json
{
  "command": "set_di1_simulation",
  "request_id": "di-sim-002",
  "enabled": true,
  "active": false
}
```

Simülasyonu kapatmak için:

```json
{
  "command": "set_di1_simulation",
  "request_id": "di-sim-003",
  "enabled": false
}
```

---

## Test Senaryosu

### 1. DI1 durumunu oku

```json
{
  "command": "get_digital_inputs",
  "request_id": "di-test-001"
}
```

### 2. Machine Runtime kaynağını DI1 yap

```json
{
  "command": "set_machine_input_source",
  "request_id": "di-test-002",
  "source": "DI1"
}
```

### 3. DI1 aktif simüle et

```json
{
  "command": "set_di1_simulation",
  "request_id": "di-test-003",
  "enabled": true,
  "active": true
}
```

Beklenen:

```text
di1_active: true
machine state: RUNNING
```

### 4. DI1 pasif simüle et

```json
{
  "command": "set_di1_simulation",
  "request_id": "di-test-004",
  "enabled": true,
  "active": false
}
```

Beklenen:

```text
di1_active: false
machine state: STOPPED
```

### 5. AUTO_CURRENT moduna dön

```json
{
  "command": "set_machine_input_source",
  "request_id": "di-test-005",
  "source": "AUTO_CURRENT"
}
```

---

## Saha Notu

Gerçek pano bağlantısı yapılırken:

```text
220V / 380V doğrudan ESP32 girişine verilmez.
İzole kuru kontak tercih edilir.
Gerekirse optokuplörlü giriş kartı kullanılır.
Pano bağlantısı elektrikçi ile yapılır.
```

---

## Sonuç

Bu sprint ile FactoryBox One gerçek makine sinyaline bir adım daha yaklaştı.

---

## v2.8 Persistence Update

The selected machine input source is now persistent.

If `DI1` is selected using `set_machine_input_source`, the device keeps DI1 mode after restart.

If `AUTO_CURRENT` is selected, the device keeps AUTO_CURRENT mode after restart.

Related command:

```json
{
  "command": "get_runtime_settings",
  "request_id": "runtime-settings-001"
}
```

Expected fields:

```json
"machine_input_source": "DI1",
"machine_input_source_persistent": true
```
