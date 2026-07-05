# FactoryBox One Pilot Installation Plan

## Amaç

İlk pilot kurulumda ürünü karmaşık hale getirmeden, sadece çalışma / duruş takibini doğrulamak.

---

## Pilot Hedefi

```text
1 makine
1 cihaz
1 günlük rapor
1 bildirim kanalı
```

İlk pilot için önerilen sektör:

```text
Lazer kesim veya CNC atölyesi
```

---

## Kurulumda Toplanacak Veriler

```text
Makine çalışıyor mu?
Makine durdu mu?
Günlük çalışma süresi
Günlük duruş süresi
Duruş sayısı
En uzun duruş
```

---

## Pilot Başarı Kriterleri

```text
Cihaz 1 gün boyunca reset sorunu yaşamadan çalıştı mı?
MQTT bağlantısı stabil kaldı mı?
RUNNING / STOPPED mantığı doğru mu?
Günlük runtime sayacı mantıklı mı?
Gün sonu raporu anlaşılır mı?
Atölye sahibi raporu faydalı buldu mu?
```

---

## Donanım Notu

Sensör hazır olana kadar yazılım simülasyon / manuel state ile test edilebilir.

Gerçek kurulumda state kaynağı şu seçeneklerden biri olabilir:

```text
Akım sensörü
Makine kontaktör yardımcı kontağı
Dijital giriş
Röle durum bilgisi
Modbus çalışma biti
```

---

## İlk Pilot Mesajı

```text
Bu sistem makinenizin ne kadar çalıştığını ve ne kadar durduğunu takip eder.
Gün sonunda size kısa bir özet gönderir.
İlk kurulumda sadece çalışma / duruş takibi yapılır.
```
