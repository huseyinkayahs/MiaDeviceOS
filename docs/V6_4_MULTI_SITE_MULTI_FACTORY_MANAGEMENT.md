# FactoryBox One v6.4.0 — Multi-Site / Multi-Factory Management

## Amaç

FactoryBox One platformunu tek atölye yapısından çoklu şirket, fabrika, tesis, üretim hattı ve makine hiyerarşisine taşımak.

## Organizasyon Hiyerarşisi

```text
Şirket / Tenant
└─ Fabrika
   └─ Tesis / Üretim Bölümü
      └─ Üretim Hattı
         └─ Makine
            └─ FactoryBox Cihazları
```

Mevcut müşteri, tesis ve makine kayıtları silinmez. Güncelleme sırasında:

- Her mevcut şirket için `main` kodlu varsayılan fabrika oluşturulur.
- Fabrikası olmayan tesisler varsayılan fabrikaya bağlanır.
- Her tesis için `general` kodlu varsayılan üretim hattı oluşturulur.
- Üretim hattı olmayan makineler varsayılan hatta bağlanır.

## Admin Panel Ekranları

```text
Organizasyon
├─ Şirketler
├─ Fabrikalar ve Tesisler
├─ Üretim Hatları
├─ Makineler
├─ Lokasyon Erişimi
└─ Fabrika Karşılaştırması
```

## Lokasyon Erişimi

Kullanıcı erişimi aşağıdaki seviyelerden biriyle sınırlandırılabilir:

- Tüm şirket
- Tek fabrika
- Tek tesis
- Tek üretim hattı

Granüler erişim ilk kez etkinleştirildiğinde eski tenant erişim kayıtları yerine yeni lokasyon politikası kaynak kabul edilir. Erişim değişikliğinde kullanıcının açık oturumları kapatılır.

## Fabrika Karşılaştırması

Seçilen tarih aralığında fabrika bazında şunlar karşılaştırılır:

- Tesis, makine ve cihaz sayısı
- Online cihaz oranı
- Aktif alarm sayısı
- Toplam / sağlam / hatalı üretim
- Plansız duruş süresi
- Availability
- Performance
- Quality
- OEE

OEE hesaplaması mevcut v5.24 hesap motorunu kullanır; ayrı veya farklı bir formül uygulanmaz.

## Yeni API Uçları

```text
GET    /api/admin/organization/hierarchy
POST   /api/admin/organization/factories
PATCH  /api/admin/organization/factories/:id
POST   /api/admin/organization/sites
PATCH  /api/admin/organization/sites/:id
POST   /api/admin/organization/production-lines
PATCH  /api/admin/organization/production-lines/:id
PATCH  /api/admin/organization/machines/:id/assignment
GET    /api/admin/organization/access
POST   /api/admin/organization/access
DELETE /api/admin/organization/access/:id
GET    /api/admin/organization/comparison
```

## Veritabanı

Yeni tablolar:

```text
factories
production_lines
app_user_location_access
app_user_location_policy
```

Yeni alanlar:

```text
sites.factory_id
sites.address
sites.timezone
sites.workweek_start
machines.production_line_id
```

Backend açılışta şemayı ve geriye uyumlu hiyerarşi atamalarını otomatik olarak uygular. SQL migration dosyası ayrıca paket içinde bulunur.
