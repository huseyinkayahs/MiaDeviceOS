
# MiaDeviceOS / FactoryBox One v5.2.1 Hotfix

## Sprint Adı

v5.2.1 User Permission Visibility Fix

---

## Amaç

v5.2 Role Based Permission Pack sonrası admin panelde sadece aktif kullanıcının yetkileri görünüyordu.

Bu hotfix ile diğer kullanıcıların hangi role göre hangi permission'ları alacağı da görünür hale getirildi.

---

## Eklenen Görünürlükler

```text
Role Matrix tablosu
Kullanıcılar tablosunda Permissions kolonu
Role değişince permission önizlemesinin canlı değişmesi
```

---

## Role Matrix

Admin panelde artık şu rollerin tüm yetki karşılığı görünür:

```text
system_admin
owner
admin
operator
viewer
```

---

## Kullanıcılar Tablosu

Her kullanıcı satırında artık:

```text
Role
Status
Permissions
Customer
Site
Aksiyon
```

görünür.

Role select değiştirildiğinde Permissions kolonu da kaydetmeden önce güncellenir.

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/admin.html
platform/backend/public/styles.css

KURULUM_V5_2_1.txt
docs/V5_2_1_USER_PERMISSION_VISIBILITY_FIX.md
```

---

## Sonuç

v5.2.1 ile admin, kullanıcı rolü vermeden önce o rolün hangi yetkileri getirdiğini ekranda net olarak görebilir.
