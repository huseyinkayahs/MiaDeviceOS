# FactoryBox One v5.8.0 Admin Panel Navigation / UI Organization Pack

## Amaç

Admin paneli tek uzun sayfa görünümünden çıkarıp sol menülü, bölümlere ayrılmış ve demo/pilot kullanımına daha uygun bir SaaS yönetim paneline dönüştürmek.

## Kapsam

```text
Sol menü sistemi
Üst başlık / aktif bölüm bilgisi
Dashboard bölümü
Customers / Tenants bölümü
Users & Invites bölümü
Roles & Permissions bölümü
Subscriptions bölümü
Device Registry bölümü
Security Activity bölümü
Mobil ekran için açılır menü
Mevcut backend API akışlarını bozmadan UI organizasyonu
```

## Teknik Not

Bu sprintte veritabanı şeması değiştirilmedi. Yeni migration yoktur.

Mevcut fonksiyonlar korunmuştur:

```text
Invite User / Tenant Access
Role & Permission görünümü
Subscription plan ve tenant subscription yönetimi
Subscription enforcement görünümü
Device Registry / Provisioning
Audit Log filtreleme ve CSV export
Customer, site ve user status güncellemeleri
```

## Test

```text
/api/health -> version 5.8.0
/admin.html?fresh=580 -> sol menü ve bölümlenmiş panel görünümü
Menü geçişleri -> çalışır
Mevcut tablo ve aksiyonlar -> korunur
```
