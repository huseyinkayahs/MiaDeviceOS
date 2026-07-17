
# MiaDeviceOS / FactoryBox One v3.6.2 Hotfix

## Hotfix Adı

v3.6.2 Dashboard Time Format Hotfix

---

## Amaç

Dashboard Günlük Özet kartında 60 saniyenin altındaki runtime / stop değerlerinin doğru gösterilmesini sağlamak.

---

## Sorun

v3.6.1 SmartAI API çıktısı doğruydu:

```text
Bugünkü çalışma süresi 56 saniye
```

Ancak dashboard Günlük Özet kartı aynı veriyi yanlış gösteriyordu:

```text
Runtime: 0s 0dk
Stop: 0s 0dk
```

---

## Çözüm

`platform/backend/public/app.js` içindeki süre formatlama fonksiyonu güncellendi.

Yeni davranış:

```text
0 sn
56 sn
1 dk 20 sn
2 sa 15 dk
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

Tarayıcıda gerekirse:

```text
Ctrl + F5
```

---

## Beklenen Sonuç

Günlük Özet kartında 60 saniyenin altındaki değerler artık doğru görünür.

Örnek:

```text
Runtime: 56 sn
Stop: 0 sn
Utilization: 100%
```

---

## Sonuç

Bu hotfix ile API, SmartAI raporu ve dashboard süre gösterimleri tutarlı hale getirildi.
