# HukaTech v6.13.6 — Sprint Devam / Devir Notu

> **Bu belge, sohbet donması, kota dolması veya yeni sohbet açılması durumunda önceki çalışmanın kesin kapanış durumudur.**
>
> Yeni sohbette bu belgeyi önce tamamen incele. Tamamlanmış işleri tekrar yaptırma, tahmin ederek dosya veya ayar değiştirme ve aşağıdaki çalışma kurallarına uy.

---

## 1. Sprint Kimliği

- **Proje:** HukaTech Platform
- **Sprint adı:** Otomatik Oturum Kapatma ve Sekmeler Arası Logout Senkronizasyonu
- **Sprint kapanış tarihi:** 06 Ağustos 2026
- **Admin arayüz sürümü:** v6.13.6
- **Backend uygulama/image sürümü:** v6.12.0
- **Git branch:** `main`
- **Feature commit:** `e50984f fix(auth): synchronize logout across browser tabs`
- **Git çalışma alanı:** Feature commit sonrasında temiz

> Bu sprintte sürüm artırılmadı. Backend image etiketi `factorybox-backend:v6.12.0` olarak korundu; image aynı etiketle yeniden build edildi.

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

Admin kaynak:
C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)\platform\backend\public\admin.html

Admin production:
C:\FactoryBox\platform\backend\public\admin.html

Container admin:
factorybox-prod-backend:/app/public/admin.html

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
3. Önce teşhis et; doğrulamadan dosya veya ayar değiştirme.
4. Kod parçaları yerine **tam dosya veya ZIP deploy paketi** kullan.
5. İlgili testler geçmeden sürüm artırma, final yedek veya commit yapma.
6. Kaynak, production ve container ayrımını açık yaz.
7. Şifre, token veya SMTP anahtarı gibi gizli bilgileri ekrana basma.
8. Sprint sonunda tarihli devir notu, `SPRINT_HANDOFF_LATEST.md`, Backups kopyası, final ZIP, Git ve servis doğrulaması hazırlanmalı.

---

## 4. Kullanıcı Tarafından Bildirilen Sorun

Bağlantı veya oturum kesildiğinde panel kabuğu açık kalıyor, ancak içerik alanında `Login required / Giriş gerekli` mesajı görünüyordu.

Beklenen davranış:

```text
Oturum geçersiz
→ panelde kullanıcı açık görünmemeli
→ kullanıcı bilgileri temizlenmeli
→ login.html sayfasına yönlendirilmeli
```

Ek testte bir tarayıcı sekmesinden çıkış yapıldığında ikinci sekmenin açık kaldığı görüldü.

---

## 5. Kök Nedenler

### 5.1 Merkezi API işleyicisi yalnızca hata üretiyordu

`apiJson()` fonksiyonundaki 401 kontrolü tokenları temizlemiyor ve login sayfasına yönlendirmiyordu.

### 5.2 Logout isteği Bearer token göndermiyordu

Oturum tokenı `localStorage.factorybox_auth_token` anahtarında tutuluyordu. Ancak `POST /api/auth/logout` isteği `Authorization: Bearer ...` başlığı göndermediği için backend gerçek session revoke işlemini uygulayamıyordu.

### 5.3 Sekmeler arası bildirim yoktu

Açık HukaTech sekmelerini anında bilgilendiren `storage event` veya `BroadcastChannel` mekanizması bulunmuyordu.

### 5.4 Çalışan Docker container eski admin dosyasını sunuyordu

Host production dosyası güncel olmasına rağmen backend container içindeki `/app/public/admin.html` eski hashteydi. Backend admin dosyası image içine gömüldüğü için yalnızca host dosyasını değiştirmek ve container’ı restart etmek yeterli olmadı.

---

## 6. Uygulanan Düzeltmeler

### 6.1 Oturum geçersizliğinde merkezi yönlendirme

Admin arayüzüne `HUKATECH_AUTOMATIC_SESSION_LOGOUT_V1` bloğu eklendi.

```text
401 + unauthorized + Login required
→ tokenları temizle
→ tekrar eden paralel yönlendirmeleri engelle
→ /login.html?reason=session_expired
```

### 6.2 Bağlantı kesilmesinde çıkış

`fetch` network error veya browser offline durumunda kullanıcı `/login.html?reason=connection_lost` adresine yönlendirilir. Bilinen auth anahtarları hem `localStorage` hem `sessionStorage` üzerinden temizlenir.

### 6.3 Logout isteğine Bearer token eklendi

```http
POST /api/auth/logout
Authorization: Bearer <aktif-token>
```

Böylece backend aktif sessionı bulur, memory session kaydını siler, veritabanındaki session kaydını revoked yapar ve logout audit kaydı oluşturur.

### 6.4 Sekmeler arası logout senkronizasyonu eklendi

Admin arayüzüne `HUKATECH_CROSS_TAB_LOGOUT_SYNC_V2` bloğu eklendi.

```text
BroadcastChannel('hukatech_auth_v2')
localStorage storage event
hukatech_auth_sync_v2
```

Bir sekmede çıkış yapıldığında diğer açık HukaTech sekmeleri kullanıcı etkileşimi beklemeden `/login.html?reason=user_logout` adresine yönlendirilir.

### 6.5 Tekrarlı yönlendirme koruması

Aynı anda çok sayıda API isteği 401 dönerse yalnızca tek yönlendirme yapılır.

### 6.6 Backend image yeniden build edildi

```text
Build context: C:\FactoryBox
Dockerfile: deployment/production/Dockerfile.backend
Image: factorybox-backend:v6.12.0
```

Uygulanan işlem:

```text
docker compose build --no-cache backend
docker compose up -d --no-deps --force-recreate backend
```

---

## 7. Testler

```text
STATIC_AUTH_REDIRECT_CHECK=passed
STATIC_CROSS_TAB_LOGOUT_CHECK=passed
SOURCE_PRODUCTION_MATCH=true
```

Gerçek iki sekmeli logout testi geçti:

1. Panel iki ayrı sekmede açıldı.
2. Aynı kullanıcı iki sekmede aktifti.
3. Bir sekmede Çıkış Yap kullanıldı.
4. Diğer sekme kullanıcı etkileşimi olmadan giriş ekranına yönlendi.

Panel ve servis kontrolleri:

```text
LOCAL_PANEL_STATUS=200
PUBLIC_PANEL_STATUS=200
factorybox-prod-backend   healthy
factorybox-prod-mqtt      healthy
factorybox-prod-nginx     healthy
factorybox-prod-postgres  healthy
```

---

## 8. Son Dosya Hashi

```text
admin.html
0C4EC39E0C7C329F29578DF356EDA0A6E47432E937BB693B398E2B6BFA8B4B19
```

Aynı hash doğrulanan yerler:

```text
Kaynak repo
C:\FactoryBox production
factorybox-prod-backend:/app/public/admin.html
https://localhost:8443/admin.html
```

---

## 9. Oluşturulan Yedekler

```text
C:\New DeviceOs Project\Backups\admin.html.before-automatic-session-logout-v1-20260806-070553.bak
C:\New DeviceOs Project\Backups\production-admin.before-automatic-session-logout-v1-20260806-070553.bak
C:\New DeviceOs Project\Backups\admin.html.before-cross-tab-logout-sync-v2-20260806-071424.bak
C:\New DeviceOs Project\Backups\production-admin.before-cross-tab-logout-sync-v2-20260806-071424.bak
```

---

## 10. Git Durumu

Feature commit:

```text
e50984f fix(auth): synchronize logout across browser tabs
```

Commit içeriği:

```text
platform/backend/public/admin.html
```

Değişiklik özeti:

```text
1 file changed
135 insertions
14 deletions
```

---

## 11. Kritik Teknik Not

Backend static dosyaları image içine gömülmektedir:

```dockerfile
COPY platform/backend/public ./public
```

Backend container mountları yalnızca backups ve logs içindir. Bu nedenle gelecekte `admin.html`, `login.html` veya diğer `public` dosyaları değiştirildiğinde yalnızca `docker compose restart backend` yeterli değildir.

Gerekli işlem:

```text
docker compose build backend
docker compose up -d --no-deps --force-recreate backend
```

---

## 12. Bilinen Konular

- `login.html?reason=...` parametresine göre kullanıcıya özel açıklama gösteren mesaj kutusu henüz eklenmedi.
- Backend image etiketi aynı kaldığı için image digest değişmiştir; etiket tek başına içeriğin güncelliğini kanıtlamaz.
- `npm ci` sırasında iki high severity dependency uyarısı görüldü. Bu sprintte paket sürümleri değiştirilmedi; ayrı dependency audit sprinti olarak ele alınmalıdır.

---

## 13. Sprint Kapanış Özeti

```text
401 Login required durumunda otomatik login yönlendirmesi eklendi.
Bağlantı kesilmesinde otomatik çıkış eklendi.
Logout isteğine Bearer token eklendi.
Backend session revoke işlemi düzeltildi.
Sekmeler arası BroadcastChannel logout senkronizasyonu eklendi.
Sekmeler arası localStorage storage-event yedek mekanizması eklendi.
Kaynak ve production admin dosyaları eşitlendi.
Backend image güncel admin dosyasıyla yeniden build edildi.
Container ve panel hashleri doğrulandı.
Gerçek iki sekmeli logout testi geçti.
Yerel ve dış panel HTTP 200.
Dört production servisi healthy.
Feature commit oluşturuldu: e50984f.
Sürüm artırılmadı.
```
