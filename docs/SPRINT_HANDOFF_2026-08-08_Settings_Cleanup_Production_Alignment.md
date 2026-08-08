# HukaTech v6.13.6 — Settings Cleanup & Production Alignment Sprint Devir Notu

## Sprint Adı
**Settings Cleanup & Production Alignment**

## Tarih
**08.08.2026**

## Amaç
HukaTech yönetim panelindeki **Ayarlar** bölümünü production ortamıyla hizalamak; eski FactoryBox/sürüm kalıntılarını temizlemek; kullanıcıya gereksiz teknik iç detayları azaltmak; Named Tunnel, bildirimler, sistem sağlığı, yedekleme ve güvenlik ekranlarını doğrulamak; Ayarlar arayüzünü HukaTech görsel diliyle tutarlı hale getirmek.

---

## Başlangıç Durumu

Sprint başlangıcında kaynak repo temizdi ve son Users + Analysis sprinti kapanmıştı.

Önceki commit:
```text
8387223 docs: add users and analysis sprint handoff
```

Settings çalışmaları sırasında kaynak backend ve admin dosyaları production ortamıyla birlikte incelendi.

Ana çalışma dizini:
```text
C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)
```

Production:
```text
C:\FactoryBox
```

Yedekler:
```text
C:\New DeviceOs Project\Backups
```

---

## Yapılan Ana Değişiklikler

### 1. Production Sürüm Hizalaması
Backend içindeki kullanıcıya gösterilen uygulama sürümü:
```text
6.13.2 -> 6.13.6
```

Sistem Sağlığı ekranındaki Backend kartı artık doğru olarak:
```text
v6.13.6
```
gösteriyor.

### 2. HukaTech E-posta Markalaması
Test e-postalarındaki eski FactoryBox markalaması kaldırıldı.

Doğrulanan test e-postası:
```text
Konu: HukaTech v6.13.6 E-posta Testi
Gönderen: HukaTech <noreply@hukatech.com>
İçerik: HukaTech v6.13.6 test e-postası başarıyla gönderildi.
Footer: HukaTech platform bildirimi · v6.13.6
```

Gerçek Gmail teslimatı başarıyla doğrulandı.

### 3. Named Tunnel Production Hizalaması
Production uzak erişim ayarı eski Quick Tunnel adresinden kalıcı Named Tunnel yapısına geçirildi.

Production değerleri:
```text
REMOTE_ACCESS_ENABLED=true
REMOTE_ACCESS_MODE=named
REMOTE_PUBLIC_URL=https://panel.hukatech.com
```

DB remote access ayarı:
```text
mode=named
public_url=https://panel.hukatech.com
access_protected=false
```

Cloudflare Access koruması bu sprintte özellikle etkinleştirilmedi.

### 4. Uzak Erişim Doğrulaması
Windows üzerinde çalışan Cloudflared servisi token-file yöntemiyle çalışıyor.

Servis çalışma yaklaşımı:
```text
cloudflared.exe tunnel run --token-file C:\ProgramData\cloudflared\token
```

Panelin eski token kontrol mantığı bu yapıyı bilmiyordu ve yanlış şekilde "HAZIR DEĞİL" gösteriyordu.

UI tarafında production Named Tunnel çevrimiçi olduğunda:
```text
Uzak Erişim: ÇEVRİMİÇİ
Tünel Durumu: HAZIR
Tunnel çalıştırma bilgisi hazır: HAZIR
```
gösterilecek şekilde düzenlendi.

Son manuel uzak erişim testi:
```text
https://panel.hukatech.com
HTTP 200
339 ms
```

### 5. Sistem Sağlığı ve Yedekler
Eski:
```text
Tam Sağlık Kontrolü
```
butonu modern HukaTech stilinde:
```text
Sağlık Kontrolünü Çalıştır
```
olarak değiştirildi.

Servis isimleri Türkçeleştirildi:
```text
Alarm Teslimatı
Otomasyon Zamanlayıcı
Alarm Raporları
Bakım Zamanlayıcı
Cihaz Trafiği
E-posta / SMTP
Otomatik Yedek
```

Sistem Günlükleri tablosundan ham metadata sütunu kaldırıldı.

Bileşen adları kullanıcı diline çevrildi:
```text
backup       -> Yedekleme
health-check -> Sağlık Kontrolü
```

### 6. Veritabanı Yedek Adı
Yeni oluşturulacak DB yedeklerinde:
```text
FactoryBox_DB_...
```
yerine:
```text
HukaTech_DB_...
```
kullanılıyor.

Mevcut eski geçmiş kayıtları özellikle yeniden adlandırılmadı.

Sprint sırasında manuel DB backup testi başarıyla tamamlanmıştı:
```text
FactoryBox_DB_20260808_165341.dump
675 KB
TAMAMLANDI
DOĞRULANDI
SHA256 üretildi
pg_restore ön kontrolü başarılı
```

Bu eski kayıt geçmişte oluşturulduğu için eski adıyla görünmeye devam eder.

### 7. Bildirimler
Bildirimler ekranında eski geliştirici/teknik dili sadeleştirildi.

Örnek değişiklikler:
```text
DELIVERY        -> TESLİMAT
ON              -> AÇIK
CENTRAL         -> MERKEZİ
DB              -> VERİTABANI
true / false    -> Açık / Kapalı
Auto Worker     -> Otomatik Çalıştırma
Batch Size      -> Paket Boyutu
Email Delivery  -> E-posta Teslimatı
```

Kanal durumları:
```text
KAPALI
HAZIR
HAZIR DEĞİL
```
olarak kullanıcı dilinde gösteriliyor.

Normal durum özetinden:
```text
host.docker.internal
Installation ID
Provider ID
```
gibi teknik bilgiler kaldırıldı.

Mail Gateway teknik alanları:
```text
Gelişmiş Teknik Ayarlar
```
altında varsayılan kapalı biçimde tutuluyor.

### 8. Otomasyon Zamanlayıcı
Eski:
```text
v5.19
retry/backoff
Dead Letter
OFF
Retry Due
Pending
```
ifadeleri sadeleştirildi.

Yeni görünüm:
```text
KAPALI
YENİDEN DENEME BEKLEYEN
BEKLEYEN
HATA KUYRUĞU
En fazla 5 deneme
```

"Şimdi Çalıştır" alarm teslimat zincirini manuel tetikleyebileceği için güvenlik amacıyla test sırasında kullanılmadı.

### 9. Güvenlik ve Oturumlar
Şifre değişimi formuna:
```text
Yeni Şifre Tekrar
```
alanı eklendi.

İstemci tarafında yeni şifrelerin eşleşme kontrolü eklendi.

Eski görünen:
```text
FactoryBox Admin
```
ismi güvenlik ekranında:
```text
HukaTech Yönetici
```
olarak sunuluyor.

Güvenlik olaylarında ham:
```text
session_id
metadata JSON
```
gösterimi kaldırıldı.

Olay isimleri kullanıcı diline çevrildi:
```text
login_success -> Başarılı giriş
login_failed  -> Hatalı giriş
logout        -> Çıkış
...
```

Eski koyu lacivert güvenlik bölüm başlıkları Settings tasarımıyla hizalandı.

Teknik terminoloji sadeleştirildi:
```text
API Limiti / dakika -> Servis İstek Limiti / dakika
CSRF Origin Kontrolü -> Form Kaynağı Güvenlik Kontrolü
```

### 10. Güvenlik Aktiviteleri / Denetim Günlüğü
Ekrandaki kullanıcı dili sadeleştirildi.

Örnek:
```text
Action      -> İşlem
Entity      -> Varlık
Limit       -> Kayıt Sayısı
Actor       -> İşlemi Yapan
Actions     -> İşlemler
Entities    -> Varlıklar
```

Aşağıdaki gibi backend action/entity kodları kullanıcıya Türkçe gösteriliyor:
```text
test_remote_access                -> Uzak erişim test edildi
test_email_notification           -> E-posta testi gönderildi
create_database_backup            -> Veritabanı yedeği oluşturuldu
update_alarm_automation_scheduler -> Otomasyon zamanlayıcı güncellendi
notification_channel              -> Bildirim kanalı
system_backup                     -> Sistem yedeği
automation_scheduler              -> Otomasyon zamanlayıcı
customer_installation             -> Müşteri kurulumu
```

Uzun dahili kullanıcı/UUID kimlikleri ana tabloda gizlendi.

---

## Manuel Testler

### Genel Ayarlar
```text
Ayarları Kaydet: PASS
```

### Bildirimler
```text
Gateway bağlantı testi: PASS
Gerçek e-posta teslimatı: PASS
HukaTech v6.13.6 branding: PASS
```

### Otomasyon Zamanlayıcı
```text
Durumu Yenile: PASS
Ayarları Kaydet: PASS
Scheduler: KAPALI
Pending: 0
Retry due: 0
Dead-letter: 0
```

Risk nedeniyle:
```text
Şimdi Çalıştır: TEST EDİLMEDİ
```

### Sistem Sağlığı
```text
Durumu Yenile: PASS
Sağlık kontrolü: PASS
PostgreSQL: BAĞLI
MQTT Broker: BAĞLI
E-posta / SMTP: HAZIR
pg_dump: HAZIR
pg_restore: HAZIR
```

MQTT cihaz mesajı olmadığı için:
```text
Cihaz Trafiği: VERİ ESKİ / cihaz mesajı alınmadı
```
uyarısı beklenen durumdur.

### DB Backup
```text
Manuel backup: PASS
Checksum: PASS
pg_restore precheck: PASS
```

### Uzak Erişim
```text
Named Tunnel: PASS
https://panel.hukatech.com: PASS
HTTP 200: PASS
Tünel Durumu HAZIR: PASS
Tunnel çalışma bilgisi HAZIR: PASS
```

### Güvenlik ve Oturumlar
```text
Durumu Yenile: PASS
Aktif oturum görüntüleme: PASS
Kilitli kullanıcı görüntüleme: PASS
Güvenlik olaylarının sade görünümü: PASS
Yeni Şifre Tekrar alanı: PASS (UI)
```

Şifre gerçekten değiştirilmedi; mevcut kullanıcı oturumunu gereksiz yere etkilememek için işlevsel parola değişim testi yapılmadı.

### Güvenlik Aktiviteleri
```text
Boş filtre: PASS
İstatistikler: PASS
Türkçe action/entity gösterimi: PASS
Ham metadata gizleme: PASS
Uzun dahili kimlik gizleme: PASS
```

---

## Production Durumu

```text
Backend health: healthy
Public panel: https://panel.hukatech.com
Public health HTTP: 200
Backend version: 6.13.6
Remote access: Named Tunnel
Mail: HukaTech Central Mail Gateway
```

Production backend rebuild/recreate işlemleri sonrasında source, production, container ve local panel dosya hash eşleşmeleri doğrulandı.

---

## Son Dosya Hashleri

### admin.html
```text
A00DE9BEAD64567F2CB3FD397FA03D2864EDB4C14F92D2977DC0E2F0127A9AF8
```

### server.js
```text
CEF920158EA963E230B4ECAF26BFD836A1A94CDB9D7ED69D252FBC80F638CCEB
```

### invite.html
Bu sprintte değiştirilmedi:
```text
C45604AE110C5E2668F5C65D28BC248B6764EFD35C4404D7B8BB6F11574AE22B
```

---

## Feature Commit

```text
b65e4e0 feat(settings): align production configuration and polish admin settings
```

Feature commit değişikliği:
```text
platform/backend/public/admin.html | 277 ++++++++++++++++++++++++-------------
platform/backend/server.js         |  12 +-
2 files changed, 184 insertions(+), 105 deletions(-)
```

Commit öncesi:
```text
git diff --check
```
başarıyla geçti. Yalnızca Windows LF -> CRLF bilgilendirme uyarıları görüldü; whitespace hatası bulunmadı.

---

## Bilinen / Bilerek Açık Bırakılan Noktalar

### 1. Cloudflare Access
Şu anda:
```text
Cloudflare Access Koruması: Kapalı / Henüz ayarlanmadı
```

Bu nedenle güvenlik kontrol listesinde ilgili satır:
```text
KONTROL
```
olarak görünür.

Bu bir hata değildir. Cloudflare Access ayrı güvenlik adımı olarak ele alınmalıdır.

### 2. Audit İşlem Placeholder
Güvenlik Aktiviteleri filtre alanında örnek:
```text
örn: login_failed
```
teknik kod olarak kalmaktadır.

İşlevsel sorun değildir; ileride küçük terminoloji temizliğinde değiştirilebilir.

### 3. Genel Ayarlar Organizasyon Etiketi
Mevcut:
```text
Müşteri / Organizasyon Adı
```

Hiyerarşi terminolojisine daha uygun olabilecek:
```text
Şirket / Organizasyon Adı
```
ileride değerlendirilebilir.

### 4. Mevcut Eski Backup Kaydı
Geçmişte oluşturulmuş:
```text
FactoryBox_DB_20260808_165341.dump
```
kaydı eski adıyla kalır.

Yeni yedekler:
```text
HukaTech_DB_...
```
adıyla oluşturulacaktır.

### 5. Teknik Sistem Sağlığı İfadeleri
Production kontrol tablosunda bazı teknik değerler:
```text
AUTH_ENABLED=true
PGPASSWORD
pg_dump
pg_restore
```
görünmeye devam eder.

Bu alan yönetici/teknik ekran olduğu için bu sprintte bırakılmıştır.

---

## Alınan Kararlar

1. Kullanıcı arayüzünde global FactoryBox değişimi yapılmayacak.
2. Dahili DB isimleri, container isimleri, device model adları ve eski teknik yollar körlemesine yeniden adlandırılmayacak.
3. Kullanıcıya görünen marka ve durum metinleri hedefli şekilde HukaTech olarak temizlenecek.
4. Named Tunnel production erişimi `panel.hukatech.com` üzerinden devam edecek.
5. Cloudflared Windows servisi token-file yöntemiyle çalışmaya devam edecek.
6. Cloudflare Access bu sprint kapsamı dışında bırakıldı.
7. Teknik Mail Gateway bilgileri normal kullanıcı ekranından gizlenecek fakat yönetici için Gelişmiş Teknik Ayarlar altında korunacak.
8. Alarm teslimatı manuel "Şimdi Çalıştır" testi güvenlik nedeniyle yapılmayacak.
9. Yeni DB backup adı `HukaTech_DB_...` olacak; geçmiş kayıtlar yeniden adlandırılmayacak.
10. Settings sprinti kullanıcı ekranı ve production hizalaması açısından tamamlandı kabul edildi.

---

## Sonraki Adımlar

1. Handoff dokümantasyon commitini tamamla.
2. Sprint final ZIP backup oluştur ve SHA256 kaydet.
3. Git çalışma ağacının temiz olduğunu doğrula.
4. Cloudflare Access güvenliğini ayrı sprint/iş adımı olarak değerlendir.
5. Kalan küçük terminoloji notlarını ileride toplu kozmetik pakette ele al.
6. Sonraki ana HukaTech sprintine geç.

---

## Sprint Sonucu

**Settings Cleanup & Production Alignment: BAŞARILI**

Ayarlar ekranları production ile hizalanmış, HukaTech markasıyla temizlenmiş, kritik işlevler manuel olarak doğrulanmış ve production panel sağlıklı biçimde çalışmaktadır.
