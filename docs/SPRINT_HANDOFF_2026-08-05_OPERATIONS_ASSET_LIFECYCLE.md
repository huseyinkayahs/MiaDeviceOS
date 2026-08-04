# HukaTech v6.13.6 — Sprint Devam / Devir Notu

> **Bu belge, sohbet donması, kota dolması veya yeni sohbet açılması durumunda önceki çalışmanın kesin kapanış durumudur.**
>
> Yeni sohbette bu belgeyi önce tamamen incele. Tamamlanmış işleri tekrar yaptırma, tahmin ederek dosya veya ayar değiştirme ve aşağıdaki çalışma kurallarına uy.

---

## 1. Sprint Kimliği

- **Proje:** HukaTech Platform
- **Sprint adı:** Operasyon Hiyerarşisi, Kataloglar ve Güvenli Kayıt Yaşam Döngüsü
- **Sprint kapanış tarihi:** 05 Ağustos 2026
- **Admin arayüz sürümü:** v6.13.6
- **Backend uygulama/image sürümü:** v6.12.0
- **ESP32 firmware sürümü:** 3.3.3
- **Git branch:** `main`
- **Feature commit:** `4218ae1 feat(operations): add hierarchy catalogs and safe asset lifecycle`
- **Git çalışma alanı:** Feature commit sonrasında temiz

> Backend image adının `factorybox-backend:v6.12.0` görünmesi bu sprint sonunda beklenen durumdur. Bu sprintte sürüm artırılmadı.

---

## 2. Ana Proje Yolları

```text
Kaynak repo:
C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)

Production:
C:\FactoryBox

Production compose klasörü:
C:\FactoryBox\deployment\production

Production compose dosyası:
C:\FactoryBox\deployment\production\docker-compose.production.yml

Production environment:
C:\FactoryBox\deployment\production\.env.production

Backend kaynak:
C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)\platform\backend\server.js

Backend production:
C:\FactoryBox\platform\backend\server.js

Admin kaynak:
C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)\platform\backend\public\admin.html

Admin production:
C:\FactoryBox\platform\backend\public\admin.html

Yedek klasörü:
C:\New DeviceOs Project\Backups

Yerel panel:
https://localhost:8443/admin.html

Dış panel:
https://panel.hukatech.com
```

---

## 3. Çalışma Kuralları

1. Her turda yalnızca **tek PowerShell/CMD komutu** ver.
2. Kullanıcının çıktısını görmeden sonraki komuta geçme.
3. Önce teşhis et; doğrulamadan dosya veya veritabanı değiştirme.
4. Kod parçaları yerine **tam dosya veya ZIP deploy paketi** kullan.
5. İlgili testler geçmeden sürüm artırma, final yedek veya commit yapma.
6. Kaynak, production ve firmware ayrımını açık yaz.
7. Alarm teslimatında güvenli olmayan işlem yapma.
8. Şifre, token veya SMTP anahtarı gibi gizli bilgileri ekrana basma.
9. Sprint sonunda:
   - ayrıntılı devir notu,
   - tarihli repo belgesi,
   - `docs\SPRINT_HANDOFF_LATEST.md`,
   - Backups kopyası,
   - final ZIP,
   - Git ve servis doğrulaması hazırlanmalı.

---

## 4. Bu Sprintte Tamamlanan Geliştirmeler

### 4.1 Operasyon menüsü sadeleştirildi

Sol menü:

```text
Operasyon
├── Organizasyon
├── Makineler
├── Cihazlar
└── Bakım ve Servis
```

Eski “Varlıklar ve Bakım” ifadesi kaldırıldı.

### 4.2 Standart organizasyon hiyerarşisi kuruldu

Kesin hiyerarşi:

```text
Şirket
└── Fabrika
    └── Bölüm / Alan
        └── Üretim Hattı
            └── Makine
                └── Cihaz
```

Arayüzde eski `site/tesis` kavramı Operasyon ekranlarında **Bölüm / Alan** olarak gösteriliyor. Backend veritabanındaki mevcut `sites` yapısı korunmuştur; şema kırılmamıştır.

### 4.3 Organizasyon ekranları netleştirildi

İç sekmeler:

```text
Şirketler
Fabrikalar ve Bölümler
Üretim Hatları
```

Tamamlananlar:

- Fabrika ve Bölüm / Alan ayrı sayaçlarda gösteriliyor.
- Organizasyon ağacında seviyeler etiketleniyor.
- “Fabrika Kayıtları” ve “Bölüm / Alan Kayıtları” ayrı tablolar.
- “Yeni Fabrika” ve “Yeni Bölüm / Alan” formları ayrıldı.
- Bölüm / Alan kaydı bağlı fabrikayı zorunlu seçiyor.
- Seçilen şirket localStorage ile korunuyor.
- Async yanıt yarışına karşı şirket kapsamı koruması eklendi.
- Üretim hattı oluşturma:
  - şirket,
  - fabrika,
  - bağlı bölüm / alan
  zincirini kullanıyor.
- Üretim hattı tablolarında Fabrika ve Bölüm / Alan ayrı sütunlarda.
- Makine atamaları makinenin kendi bölümüne ait hatlarla sınırlandırıldı.

### 4.4 Makine ve cihaz formlarına fabrika zinciri eklendi

Makine oluşturma:

```text
Şirket → Fabrika → Bölüm / Alan
```

Cihaz kaydı ve Kurulum Sihirbazı:

```text
Şirket → Fabrika → Bölüm / Alan → Makine
```

Bölüm / Alan seçenekleri seçilen fabrikaya göre filtreleniyor. Bölümün yanlış fabrikaya ait olması istemci tarafında engelleniyor.

### 4.5 Tenant erişim sorunu çözüldü

`admin@factorybox.local` kullanıcısına aşağıdaki erişim eklendi:

```text
mia-creative-art / atolye / owner
```

Mevcut `first-company / main-site` erişimi korunmuştur.

Böylece Cihaz Yetkinlikleri ekranındaki:

```text
Device tenant access denied
```

hatası kaldırıldı ve `laser01` yetkinlikleri görüntülendi.

> Bu erişim satırı production PostgreSQL verisidir; Git dosyası değildir.

### 4.6 Makine Tipleri merkezi kataloğu eklendi

Yeni tablo:

```text
machine_type_catalog
```

Varsayılan kayıtlar:

```text
general
laser_cutting
cnc
plastic_injection
furniture
unknown
```

Panel:

```text
Makineler
├── Makine Listesi
└── Makine Tipleri
```

Katalog alanları:

- Tip Kodu
- Türkçe Ad
- İngilizce Ad
- Kategori
- Açıklama
- Durum
- Sıralama
- Kullanım sayısı

Yeni makine oluşturma, makine düzenleme ve Kurulum Sihirbazı aktif katalog kayıtlarını kullanıyor.

### 4.7 Cihaz Modelleri merkezi kataloğu eklendi

Yeni tablo:

```text
device_model_catalog
```

Cihaz tablosuna:

```text
devices.model_code
```

Kurulum tablosuna:

```text
device_onboarding_sessions.model_code
```

alanları eklendi.

Panel:

```text
Cihazlar
├── Cihaz Kayıtları
├── Cihaz Modelleri
├── Kurulum Sihirbazı
└── Cihaz Yetkinlikleri
```

Model alanları:

- Model Kodu
- Model Adı
- Cihaz Ailesi
- Üretici
- Firmware Ailesi
- Bağlantılar
- Varsayılan Profil
- Açıklama
- Durum
- Sıralama
- Kullanım sayısı

Mevcut `FactoryBox One` kayıtları `factorybox-one` katalog koduna otomatik eşlendi.

Sprint sonundaki katalog durumu:

```text
Makine tipi sayısı: 6
Cihaz modeli sayısı: 2
Eşleşmemiş cihaz: 0
```

İkinci cihaz modeli test amacıyla eklenen `SensorBox` kaydıdır.

### 4.8 Katalog kayıt yaşam döngüsü tamamlandı

Makine tipi ve cihaz modeli listeleri artık varsayılan olarak salt okunur.

Normal görünüm:

```text
Düzenle
Sil / Kullanımda
```

Düzenleme görünümü:

```text
Kaydet
İptal
```

Kurallar:

- Kullanım sayısı `0` olan sistem veya özel kayıt silinebilir.
- Kullanımdaki kayıt silinemez; önce bağlı varlıklar başka katalog kaydına taşınmalı.
- Silme öncesi onay sorulur.
- Silme denetim günlüğüne yazılır.
- Sistem kayıtları da kullanılmıyorsa silinebilir.
- Silinen varsayılan kayıt backend yeniden başladığında geri gelmez.
- `asset_catalog_seed_state` tablosu ile varsayılan seed yalnızca ilk kurulumda uygulanır.

### 4.9 Gerçek makine ve cihaz satırları salt okunur yapıldı

Makine ve cihaz satırları artık doğrudan değiştirilemiyor.

Normal görünüm:

```text
Düzenle
Arşivle
```

Düzenleme görünümü:

```text
Kaydet
İptal
```

Yalnızca seçilen satır düzenleme moduna geçer. Diğer satırlar salt okunur kalır. Düzenleme sırasında Arşivle butonu gizlenir.

Test edilenler:

- Makine Listesi Düzenle/İptal: geçti.
- Cihaz Kayıtları Düzenle/İptal: geçti.
- Makine Tipleri Düzenle/Kaydet/İptal/Sil görünümü: geçti.
- Cihaz Modelleri Düzenle/Kaydet/İptal/Sil görünümü: geçti.
- Cihaz modeli seçim listesinde `FactoryBox One` ve `SensorBox`: geçti.

### 4.10 Güvenli Arşivleme API’leri eklendi

Makine:

```text
POST /api/admin/machines/:customerCode/:siteCode/:machineCode/archive
```

Cihaz:

```text
POST /api/admin/devices/:uid/archive
```

Makine arşivleme kuralları:

- Aktif cihaz bağlıysa arşivleme engellenir.
- Kayıt `archived` yapılır.
- Telemetri, alarm, bakım ve denetim geçmişi korunur.
- Aktif listeden gizlenir.

Cihaz arşivleme kuralları:

- Durum `archived` yapılır.
- Provisioning durumu `revoked` yapılır.
- Provisioning token hash ve süre bilgisi temizlenir.
- Açık onboarding oturumu deactivated yapılır.
- Geçmiş veriler korunur.
- Aktif listeden gizlenir.

> Gerçek üretim makinesi veya cihazı bu sprintte arşivlenmedi. Arşivleme rotaları kaynak, production ve panel çağrılarında doğrulandı.

### 4.11 Cloudflare Tunnel kesintisi teşhis edildi

Belirti:

```text
Cloudflare Error 1033
```

Tespit:

- Yerel panel: `HTTPS 200`
- Yerel HTTP: `301`
- Cloudflared Windows servisi: Running
- DNS çözümleme: başarılı
- TCP 7844: başarılı
- TCP 443: başarılı
- Fakat servis Cloudflare’a aktif tunnel bağlantısı kurmamıştı.

Çözüm:

```text
Cloudflared Windows servisi yeniden başlatıldı.
```

Dış panel yeniden çalıştı.

> Cloudflared servisinin `Running` görünmesi aktif tunnel bağlantısının kesin kanıtı değildir. Error 1033 tekrar ederse önce yerel paneli ve aktif bağlantıları kontrol et, sonra kontrollü `Restart-Service Cloudflared` uygula.

---

## 5. Eklenen / Güncellenen Backend Yapıları

```text
machine_type_catalog
device_model_catalog
asset_catalog_seed_state
devices.model_code
device_onboarding_sessions.model_code
```

Önemli backend davranışları:

- Makine tipi aktif katalog kaydıyla doğrulanır.
- Cihaz modeli aktif katalog kaydıyla doğrulanır.
- Model adı değiştiğinde bağlı cihaz ve onboarding kayıtları güncellenir.
- Katalog create/update/delete işlemleri audit log üretir.
- Makine ve cihaz archive işlemleri audit log üretir.
- Arşivlenen kayıtlar aktif yönetim listelerinden filtrelenir.
- Abonelik cihaz sayımında arşiv kayıtları hariç tutulur.

---

## 6. Son Kaynak / Production Hashleri

```text
server.js
BDF645E98FA3200AFE4385B6D9B98696538902DCE88449B71CD20A77CBF5AEE2

admin.html
C08F8DFFBA4B4C9EC7F0F112C3A8E7F239C955C3ACA6626FD1AC98DC86816418
```

Kaynak ve production dosyaları eşleşmektedir.

---

## 7. Production Servis Durumu

Sprint kapanış kontrolünde:

```text
factorybox-prod-backend   healthy
factorybox-prod-mqtt      healthy
factorybox-prod-nginx     healthy
factorybox-prod-postgres  healthy
```

Backend image:

```text
factorybox-backend:v6.12.0
```

---

## 8. Bu Sprintte Oluşturulan Önemli Yedekler

```text
admin.html.before-organization-hierarchy-v4-20260804-193242.bak
production-admin.before-organization-hierarchy-v4-20260804-193242.bak

admin.html.before-machine-device-factory-v5-20260804-202428.bak
production-admin.before-machine-device-factory-v5-20260804-202428.bak

server.js.before-asset-catalogs-v1-20260804-204530.bak
admin.html.before-asset-catalogs-v1-20260804-204530.bak
production-server.before-asset-catalogs-v1-20260804-204530.bak
production-admin.before-asset-catalogs-v1-20260804-204530.bak

server.js.before-catalog-delete-controls-v1-20260804-210015.bak
admin.html.before-catalog-delete-controls-v1-20260804-210015.bak

server.js.before-catalog-edit-delete-ux-v2-20260804-211410.bak
admin.html.before-catalog-edit-delete-ux-v2-20260804-211410.bak

server.js.before-record-edit-archive-v1-20260804-213751.bak
admin.html.before-record-edit-archive-v1-20260804-213751.bak
production-server.before-record-edit-archive-v1-20260804-213751.bak
production-admin.before-record-edit-archive-v1-20260804-213751.bak
```

---

## 9. Git Durumu

Feature commit:

```text
4218ae1 feat(operations): add hierarchy catalogs and safe asset lifecycle
```

Feature commit içeriği:

```text
platform/backend/server.js
platform/backend/public/admin.html
```

Değişiklik özeti:

```text
2 files changed
1826 insertions
277 deletions
```

LF → CRLF mesajları Git çalışma ağacı uyarısıdır; runtime hatası değildir.

---

## 10. Bilinen Eksikler ve Sonraki Sprint Adayları

### 10.1 Arşiv yönetim ekranı yok

Arşivlenen makine ve cihazlar aktif listeden gizleniyor; ancak panelde henüz:

```text
Arşivlenenler
Arşivden Çıkar
```

ekranı bulunmuyor.

Sonraki sprintte önerilen yapı:

```text
Makineler
├── Makine Listesi
├── Makine Tipleri
└── Arşivlenen Makineler

Cihazlar
├── Cihaz Kayıtları
├── Cihaz Modelleri
├── Kurulum Sihirbazı
├── Cihaz Yetkinlikleri
└── Arşivlenen Cihazlar
```

### 10.2 Gerçek arşivleme testi yapılmadı

Production verisini korumak için gerçek makine/cihaz üzerinde Arşivle butonuna basılmadı.

Gelecekte test yapılacaksa:

1. Geçici test makinesi ve test cihazı oluştur.
2. Cihazı arşivle.
3. Listeden gizlendiğini ve geçmişin korunduğunu doğrula.
4. Makineyi arşivle.
5. API ve audit kayıtlarını doğrula.
6. Gerekirse arşivden çıkarma özelliğini ekle.

### 10.3 Katalog tablo mobil genişlikleri

Cihaz Modelleri ve Makine Tipleri tabloları geniş ekranlarda düzgün çalışıyor; dar ekranlarda yatay kaydırma gerekiyor. İşlem sütunu sabitleme veya kart görünümü sonraki UI rötuşu olabilir.

### 10.4 Fabrika/Bölüm tabloları

Fabrika ve Bölüm / Alan kayıt tablolarında bazı uzun adlar yatay kaydırmaya neden olabilir. Kolon sıkıştırma sonraki UI rötuşu olabilir.

### 10.5 Cloudflared otomatik sağlık kontrolü

Cloudflared servisi açık olup tunnel bağlantısı kopmuş olabilir. Sonraki sprintte öneri:

```text
Saatlik / 5 dakikalık dış panel health check
Başarısızsa kontrollü Cloudflared restart
Audit/log kaydı
Tekrarlı restart koruması
```

---

## 11. Yeni Sohbette İlk Kontrol Sırası

```powershell
Set-Location -LiteralPath 'C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)'
git status --short
git log -3 --oneline
```

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath `
'C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)\platform\backend\server.js',`
'C:\FactoryBox\platform\backend\server.js'
```

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath `
'C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)\platform\backend\public\admin.html',`
'C:\FactoryBox\platform\backend\public\admin.html'
```

```powershell
Set-Location -LiteralPath 'C:\FactoryBox\deployment\production'
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

```powershell
curl.exe -k -sS -o NUL -w "LOCAL=%{http_code}`n" https://localhost:8443/admin.html
curl.exe -sS -o NUL -w "PUBLIC=%{http_code}`n" https://panel.hukatech.com/admin.html
```

---

## 12. Kritik Uyarılar

- Production veritabanındaki erişim satırını yanlışlıkla silme:
  ```text
  admin@factorybox.local | mia-creative-art | atolye | owner
  ```
- Mevcut `first-company/main-site` erişimini koru.
- Gerçek cihazlarda Arşivle işlemi provisioning erişimini iptal eder.
- Bağlı cihaz varken makine arşivleme engellenir.
- `FactoryBox One` cihaz modeli iki gerçek cihaz tarafından kullanılmaktadır.
- Katalog kodları ilişkilerde kullanılır; kodu değiştirmek yerine yeni kayıt oluştur.
- Production ve kaynak dosya hashleri eşleşmeden sprint kapatma.
- Backend image etiketini bu sprintte değiştirme.
- Cloudflared servisi Running görünse bile dış paneli ayrıca test et.

---

## 13. Sprint Kapanış Özeti

```text
Operasyon menüsü sadeleştirildi.
Şirket > Fabrika > Bölüm / Alan > Üretim Hattı > Makine > Cihaz hiyerarşisi kuruldu.
Makine ve cihaz formlarına fabrika zinciri eklendi.
Tenant cihaz erişimi düzeltildi.
Makine Tipleri merkezi kataloğu eklendi.
Cihaz Modelleri merkezi kataloğu eklendi.
Katalog kayıtlarında güvenli Düzenle / Kaydet / İptal / Sil akışı eklendi.
Gerçek makine ve cihaz kayıtlarında Düzenle / Kaydet / İptal / Arşivle akışı eklendi.
Arşivleme API’leri kaynak ve production’da doğrulandı.
Cloudflare Error 1033 tünel bağlantısı yeniden başlatılarak çözüldü.
Kaynak ve production hashleri eşleşiyor.
Production servisleri healthy.
Feature commit oluşturuldu: 4218ae1.
Sürüm artırılmadı.
```
