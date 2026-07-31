# HukaTech Platform v6.11.0

## Sprint Adı

Customer Installation Provisioning & Key Lifecycle

## Amaç

v6.10.0 ile oluşturulan müşteri kurulum kayıtlarını gerçek müşteri sunucularına güvenli şekilde aktarabilmek; kalıcı API anahtarını dosya veya sohbet üzerinden taşımadan, kısa süreli ve tek kullanımlık provisioning tokenı ile kurulum yapmak.

## Yeni Akış

1. HukaTech system_admin müşteri kurulum kaydını oluşturur.
2. Panelden **Kurulum Paketi** üretilir.
3. Pakette 30 dakika geçerli tek kullanımlık provisioning tokenı bulunur.
4. Paket müşteri sunucusuna güvenli olarak taşınır.
5. `PROVISION_HUKATECH_CUSTOMER_INSTALLATION.ps1` tokenı HukaTech merkezine gönderir.
6. Merkez tokenı atomik olarak tüketir ve yeni kalıcı API anahtarı üretir.
7. Kalıcı anahtar doğrudan müşteri sunucusundaki `.env.customer-mail` dosyasına yazılır.
8. Müşteri backend ve Nginx servisleri yeniden başlatılır.
9. İlk başarılı merkezi doğrulamada kurulum durumu `verified` olur.

## Güvenlik

- Provisioning tokenı veritabanında açık olarak tutulmaz; yalnızca SHA-256 özeti saklanır.
- Token varsayılan 30 dakika geçerlidir.
- Token yalnızca bir kez kullanılabilir.
- Token değişimi sırasında kalıcı API anahtarı yenilenir.
- Kalıcı API anahtarı panelde veya script çıktısında gösterilmez.
- Müşteri JSON paketi başarılı işlem sonrasında varsayılan olarak silinir.
- Kurulum devre dışı bırakıldığında provisioning durumu `revoked` olur.
- Anahtar yenileme sayısı `key_generation` ile izlenir.

## Provisioning Durumları

- `registered`: Kurulum kaydı oluşturuldu.
- `package_generated`: Tek kullanımlık paket üretildi.
- `provisioned`: Token kullanıldı ve müşteri anahtarı teslim edildi.
- `verified`: Müşteri merkezi servisle başarıyla doğrulandı.
- `revoked`: Kurulum devre dışı bırakıldı.

## Yeni API Uçları

- `POST /api/admin/installations/:installationId/provisioning-token`
- `GET /api/admin/installations/:installationId/events`
- `POST /api/public/installations/provision/exchange`
- `POST /api/central-mail/v1/send`

## Yeni Dosyalar

- `platform/database/migrations/043_customer_installation_provisioning_key_lifecycle.sql`
- `deployment/production/APPLY_V6_11_0_CUSTOMER_INSTALLATION_PROVISIONING.ps1`
- `deployment/production/PROVISION_HUKATECH_CUSTOMER_INSTALLATION.ps1`

## Arayüz

Müşteri Kurulumları tablosuna şu bilgiler ve işlemler eklendi:

- Provisioning durumu
- API key generation sayısı
- Kurulum Paketi oluşturma
- Kurulum olay geçmişini görüntüleme
- Anahtar yenileme
- Aktif/pasif yönetimi
