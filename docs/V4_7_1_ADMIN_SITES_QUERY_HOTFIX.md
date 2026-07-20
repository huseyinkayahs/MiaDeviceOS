
# MiaDeviceOS / FactoryBox One v4.7.1 Hotfix

## Sprint Adı

v4.7.1 Admin Sites Query Hotfix

---

## Amaç

v4.7 admin panelinde görülen `/api/admin/sites 500` hatasını düzeltmek.

---

## Sorun

Admin panel açılıyordu ancak Sites endpointi 500 dönüyordu:

```text
/api/admin/sites 500
```

---

## Kök Sebep

`devices` tablosu `site_id` üzerinden bağlanmıştı.

Doğru ilişki:

```text
sites → machines → devices
```

---

## Düzeltme

Eski bağlantı:

```sql
LEFT JOIN devices d ON d.site_id=s.id
```

Yeni bağlantı:

```sql
LEFT JOIN devices d ON d.machine_id=m.id
```

---

## Ek İyileştirme

Admin panelde endpointler artık tek `Promise.all` içinde tümden kilitlenmez.

Bir endpoint hata verirse:

```text
diğer listeler yüklenmeye devam eder
hatalı bölümde hata mesajı görünür
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/admin.html

KURULUM_V4_7_1.txt
docs/V4_7_1_ADMIN_SITES_QUERY_HOTFIX.md
```

---

## Sonuç

v4.7.1 ile SaaS Admin Panel sites listesi düzeltildi ve panel daha dayanıklı hale getirildi.
