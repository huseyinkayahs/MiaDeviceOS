
# MiaDeviceOS / FactoryBox One v3.6.1 Hotfix

## Hotfix Adı

v3.6.1 SmartAI Time Format Hotfix

---

## Amaç

SmartAI günlük üretim raporunda 60 saniyenin altındaki sürelerin `0 dakika` olarak görünmesini düzeltmek.

---

## Sorun

v3.6 testinde API başarılı çalıştı ancak günlük raporda küçük bir gösterim hatası görüldü.

Veri:

```text
runtime_sec: 56
```

Rapor metni:

```text
Bugünkü çalışma süresi 0 dakika
```

Bu teknik olarak yanlış yönlendirebilir. Çünkü makine aslında 56 saniye çalışmıştı.

---

## Çözüm

`platform/backend/server.js` içinde süre formatlama fonksiyonu güncellendi.

Yeni davranış:

```text
0 saniye
56 saniye
1 dakika 20 saniye
2 saat 15 dakika
```

---

## Değişen Dosya

```text
platform/backend/server.js
platform/backend/package.json
```

---

## Test Endpoint

```text
http://localhost:3100/api/machines/laser01/ai/daily-report
```

---

## Beklenen Sonuç

SmartAI bulgularında süre artık şu şekilde görünür:

```text
Bugünkü çalışma süresi 56 saniye, duruş süresi 0 saniye.
```

---

## Sonuç

Bu hotfix ile SmartAI rapor metni daha doğru ve kullanıcıya daha anlaşılır hale getirildi.
