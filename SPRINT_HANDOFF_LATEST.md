# HukaTech Sprint Devam / Devir Notu

## Sprint Bilgileri

- **Sprint Adı:** Production Image and Release Alignment
- **Sürüm:** v6.13.7
- **Tarih:** 8 Ağustos 2026
- **Ana geliştirme dizini:** C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)
- **Production dizini:** C:\FactoryBox
- **Release commit:** dc3ba56ec108dc31c2dcac7967b9a2138200ffda
- **Tag:** v6.13.7

## Amaç

Backend kaynak sürümü, Docker image etiketi ve production ortamındaki çalışan sürümün hizalanması; Mail Gateway image yönetiminin backend sürümünden ayrılması.

## Tamamlanan Değişiklikler

- Backend sürümü 6.12.0 sürümünden 6.13.7 sürümüne yükseltildi.
- package.json ve package-lock.json sürümleri hizalandı.
- Backend için FACTORYBOX_BACKEND_IMAGE_TAG tanımlandı.
- Varsayılan backend image etiketi v6.13.7 yapıldı.
- Mail Gateway mevcut FACTORYBOX_IMAGE_TAG değişkeninde bırakıldı.
- Production backend image yeniden oluşturuldu ve devreye alındı.

## Değişen Dosyalar

- deployment/production/docker-compose.production.yml
- platform/backend/package.json
- platform/backend/package-lock.json

## Test ve Doğrulamalar

- Node.js sözdizimi kontrolü: BAŞARILI
- Git diff kontrolü: BAŞARILI
- Docker image build: BAŞARILI
- Container başlangıcı: BAŞARILI
- Backend sağlık kontrolü: HEALTHY
- Container sürümü: 6.13.7
- Çalışan image: factorybox-backend:v6.13.7
- Release sonrasında Git çalışma ağacı: TEMİZ

## Production Durumu

Production backend sağlıklı biçimde çalışıyor.

    IMAGE=factorybox-backend:v6.13.7
    HEALTH=healthy
    VERSION=6.13.7
    DESCRIPTION=HukaTech Platform v6.13.7 Production Image and Release Alignment

## Kaynak Yedeği

    Dosya: C:\New DeviceOs Project\Backups\HukaTech_v6.13.7_Production_Image_Release_Alignment_Complete_20260808-233108.zip
    SHA256: 4B0A37117A4670F937BC298E193A37B37E4986DA5B4A731221D88179CF769FD9
    Boyut: 0.99 MB
    Dosya sayısı: 496

Yedek Git tarafından takip edilen kaynak dosyalarını içerir. Docker image, veritabanı ve production çalışma verileri ZIP içerisinde değildir.

## Bilinen Teknik Notlar

- npm build çıktısında 2 yüksek önem dereceli bağımlılık uyarısı görüldü.
- Bağımlılıklar sonraki sprintte kontrollü incelenmelidir.
- npm audit fix --force doğrulama yapılmadan çalıştırılmamalıdır.
- LF/CRLF bildirimleri Windows satır sonu uyarısıdır; hata değildir.
- Release commit ve tag yerelde oluşturuldu; uzak depoya gönderim ayrıca doğrulanmalıdır.

## Sonraki Sprint

1. npm bağımlılık güvenlik uyarılarını paket bazında incele.
2. Güvenli güncellemelerin kırılma riskini değerlendir.
3. Backend ve production smoke testlerini çalıştır.
4. Git push durumunu doğrula.

## Devam Kuralları

- Her adımda tek PowerShell komutu kullanılacak.
- Komut çıktısı görülmeden sonraki adıma geçilmeyecek.
- Değişiklikler tam dosya veya kurulabilir ZIP halinde hazırlanacak.
- Sprint sonunda test, production, commit, tag, ZIP yedek ve handoff tamamlanacak.