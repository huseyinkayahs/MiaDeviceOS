# FactoryBox One v5.5.0

## Subscription Enforcement / Usage Limit Guard Pack

Bu sürüm, v5.4 ile oluşturulan plan ve abonelik kayıtlarını gerçek çalışma kurallarına bağlar.

## Ana Kazanımlar

```text
Abonelik durumuna göre operasyon API erişim kontrolü
expired / cancelled / past_due tenant engeli
Kullanıcı plan limitinin davet oluştururken kontrol edilmesi
Kullanıcı plan limitinin davet kabul edilirken tekrar kontrol edilmesi
Bekleyen davetlerin quota hesabında ayrılmış kapasite olarak gösterilmesi
Aynı tenant için tekrar bekleyen davet oluşturma engeli
Users / sites / devices quota-check API
Admin panelinde enforcement ON/OFF ve quota görünümü
SUBSCRIPTION_ENFORCEMENT_ENABLED ayarı
```

## Korunan Operasyon API Grupları

```text
/api/machines/*
/api/sites/*
/api/devices/*
```

`system_admin` rolü, abonelik sorunlarını düzeltebilmek için operasyon engelinden muaftır. Admin ve billing endpointleri açık kalır.

## Yeni API

```text
GET /api/subscription/quota-check/users?additional=1
GET /api/subscription/quota-check/sites?additional=1
GET /api/subscription/quota-check/devices?additional=1
```

Limit uygunsa `200 OK`, limit aşılacaksa `409 subscription_quota_blocked` döner.

## Ortam Ayarı

```env
SUBSCRIPTION_ENFORCEMENT_ENABLED=true
```

`false` yapılırsa abonelik ve quota bilgileri hesaplanır fakat operasyon API engeli uygulanmaz.

## Not

Bu sürüm ödeme sağlayıcısı entegrasyonu içermez. Stripe, iyzico veya diğer ödeme sistemlerinden bağımsızdır.
