# FactoryBox One v2.9 Pilot Wiring Plan

## Amaç

FactoryBox One cihazının ilk saha prototipinde gerçek makineden RUN / STOP bilgisini güvenli şekilde almak.

Bu sprintte kod yazılmaz. Amaç; DI1 dijital girişinin gerçek makineye nasıl bağlanacağını, hangi bağlantı seçeneklerinin kullanılacağını ve pilot kurulumda nelere dikkat edileceğini netleştirmektir.

---

## Ana Prensip

FactoryBox One, makinenin çalışıp çalışmadığını öncelikle DI1 dijital girişinden okuyacaktır.

```text
DI1 ACTIVE   → Machine RUNNING
DI1 INACTIVE → Machine STOPPED
```

Firmware tarafında DI1 şu an şu şekilde tanımlıdır:

```text
DI1 Pin: GPIO27
Mode: INPUT_PULLUP
Logic: Active LOW
```

Yani test seviyesinde:

```text
DI1 GND’ye çekilirse → ACTIVE
DI1 açıkta kalırsa    → INACTIVE
```

---

## Saha İçin En Güvenli Yaklaşım

ESP32 GPIO hattı makine panosuna doğrudan bağlanmamalıdır.

Saha kurulumunda önerilen yapı:

```text
Makine RUN sinyali
↓
İzole giriş / optokuplör / ara röle
↓
FactoryBox DI1
↓
Machine Runtime Tracker
```

Önemli güvenlik notu:

```text
220V / 380V / 24V makine sinyali ESP32 pinine doğrudan bağlanmayacak.
```

---

## Bağlantı Seçeneği 1 — Kuru Kontak RUN Sinyali

En temiz senaryo makineden voltajsız bir röle kontağı almaktır.

Örnek kaynaklar:

```text
Makine çalışıyor rölesi
Kontaktör yardımcı kontağı
Program çalışıyor kuru kontak çıkışı
PLC kuru kontak çıkışı
```

Bağlantı mantığı:

```text
RUN kuru kontak kapalı → DI1 GND’ye çekilir → RUNNING
RUN kuru kontak açık   → DI1 açıkta kalır   → STOPPED
```

Bu bağlantı sadece sinyalin gerçekten voltajsız / kuru kontak olduğundan emin olunursa kullanılmalıdır.

---

## Bağlantı Seçeneği 2 — 24V RUN Sinyali

Makinede 24V RUN çıkışı varsa ESP32’ye doğrudan bağlanmaz.

Araya şu yapılardan biri konulmalıdır:

```text
24V optokuplör giriş modülü
24V ara röle
İzole dijital giriş kartı
```

Önerilen mantık:

```text
24V RUN sinyali aktif
↓
Optokuplör / ara röle aktif
↓
FactoryBox DI1 GND’ye çekilir
↓
RUNNING
```

---

## Bağlantı Seçeneği 3 — Akım Sensörü Yedek Yöntem

Makineden güvenli RUN sinyali alınamıyorsa akım sensörü kullanılacaktır.

Mantık:

```text
Akım eşik üstünde  → RUNNING
Akım eşik altında → STOPPED
```

Bu yöntem için saha kalibrasyonu gerekir.

Örnek:

```text
Makine beklemede: 0–2A
Makine çalışırken: 3A+
Eşik: 3A
```

---

## Pilot Kurulumda Önerilen Sıra

```text
1. Makine panosunda RUN sinyali var mı kontrol et
2. Kuru kontak varsa onu tercih et
3. Kuru kontak yoksa 24V RUN sinyalini izole girişle kullan
4. RUN sinyali yoksa akım sensörü yaklaşımına geç
5. FactoryBox input source değerini DI1 veya AUTO_CURRENT olarak ayarla
6. get_machine_runtime ile doğrula
7. n8n günlük rapor ve duruş uyarısı akışlarını kontrol et
```

---

## Firmware Ayarı

DI1 kullanılacaksa MQTT komutu:

```json
{
  "command": "set_machine_input_source",
  "request_id": "pilot-source-di1",
  "source": "DI1"
}
```

Akım sensörü / simüle akım kullanılacaksa:

```json
{
  "command": "set_machine_input_source",
  "request_id": "pilot-source-auto-current",
  "source": "AUTO_CURRENT"
}
```

v2.8.1 itibarıyla bu seçim restart sonrası korunur.

---

## Pilot Başarı Kriterleri

Pilot kurulum başarılı sayılması için:

```text
Makine çalışırken FactoryBox RUNNING görmeli
Makine dururken FactoryBox STOPPED görmeli
get_machine_runtime doğru state döndürmeli
get_daily_summary çalışma / duruş sürelerini saymalı
n8n günlük rapor göndermeli
n8n duruş uyarısı gerektiğinde tek sefer göndermeli
Restart sonrası input source korunmalı
```

---

## Sonuç

FactoryBox One ilk saha pilotunda öncelikli olarak DI1 üzerinden RUN sinyali okuyacak şekilde planlanmıştır.

Güvenli sinyal yoksa akım sensörü yaklaşımı kullanılacaktır.
