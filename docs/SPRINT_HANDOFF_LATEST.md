# HukaTech v6.13.6 — Sprint Devam / Devir Notu

> **Bu belge, sohbet donması, kota dolması veya yeni sohbet açılması durumunda önceki çalışmanın kesin kapanış durumudur.**
>
> Yeni sohbette bu belgeyi önce tamamen incele. Tamamlanmış işleri tekrar yaptırma, tahmin ederek dosya veya ayar değiştirme ve aşağıdaki çalışma kurallarına uy.

---

## 1. Sprint Kimliği

- **Proje:** HukaTech Platform
- **Sprint adı:** Alarm Workflows & OverTemperature
- **Sprint kapanış tarihi:** 04 Ağustos 2026
- **Admin arayüz sürümü:** v6.13.6
- **Backend uygulama/image sürümü:** v6.12.0
- **ESP32 firmware sürümü:** 3.3.3
- **Git branch:** `main`
- **Son commit:** `59c01eb feat(alarms): streamline admin workflows and add temperature alarms`
- **Git çalışma alanı:** Temiz (`WORKTREE_CLEAN=true`)

> Backend image adının `factorybox-backend:v6.12.0` görünmesi bu sprint sonunda beklenen durumdur. Admin ve firmware değişiklikleri doğrulanmıştır; backend sürüm artışı yapılmamıştır.

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

Admin kaynak dosyası:
C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)\platform\backend\public\admin.html

Admin production dosyası:
C:\FactoryBox\platform\backend\public\admin.html

Yedek klasörü:
C:\New DeviceOs Project\Backups

PlatformIO:
C:\Users\husey\.platformio\penv\Scripts\pio.exe

Yerel panel:
https://localhost:8443/admin.html

Dış panel:
https://panel.hukatech.com
```

---

## 3. Bu Sprintte Tamamlanan Geliştirmeler

### 3.1 Alarm menüsü sadeleştirildi

Sol menü:

```text
Alarmlar
├── Alarm Takibi
├── Analiz ve Raporlar
└── Bildirimler
```

`Analiz ve Raporlar` iç sekmeleri:

```text
Alarm Analizi
SLA Kuralları
Raporlama
```

Başlıklar ve durum metinleri Türkçeleştirildi ve sadeleştirildi.

### 3.2 Alarm makine filtreleri select alanına dönüştürüldü

Aşağıdaki alanlar serbest metin yerine makine seçim listesi oldu:

```text
alarmMachineFilter
newAlarmRuleMachine
```

Makine seçenekleri `/api/admin/machines?limit=300` üzerinden yükleniyor.

Gösterim biçimi:

```text
Makine Adı — Makine Kodu
```

### 3.3 API rate limit sorunu kökten çözüldü

Kök neden:

- Genel `/api` rate limit aynı IP/dakika kovasını kullanıyordu.
- Admin `loadAdmin()` çok sayıda endpoint çağırıyordu.
- Alarm otomatik yenilemesi her 10 saniyede bütün `loadAdmin()` fonksiyonunu çalıştırıyordu.
- Alarm butonları da gereksiz şekilde tam admin yenilemesi yapıyordu.

Uygulanan çözüm:

```text
Alarm Takibi:
1 API / 10 saniye

Analiz ve Raporlar:
3 API / 30 saniye

Bildirimler:
2 API / 15 saniye
```

Ayrıca:

- Görünüm bazlı yenileme eklendi.
- Çakışan çağrılar için kilit eklendi.
- Alarm filtre ve aksiyon butonları yalnızca ilgili API’yi çağırıyor.
- Tekrarlı tıklama kilidi eklendi.

Gerçek kullanıcı testi:

```text
Alarm Takibi > Filtrele
15–20 kez arka arkaya test edildi.
429 oluşmadı.
Test sonucu: BAŞARILI
```

### 3.4 Gerçek `OVER_TEMPERATURE` firmware alarm motoru eklendi

Değiştirilen firmware dosyaları:

```text
src\alarm_manager.cpp
src\alarm_publisher.cpp
```

Davranış:

- Cihazdaki `temperature_limit` değeri kullanılır.
- Geçerli sıcaklık, limitin üzerinde 5 saniye kalırsa `OVER_TEMPERATURE` alarmı açılır.
- Mevcut `OVER_CURRENT` sistemi korunmuştur.
- Akım ve sıcaklık için ayrı alarm engine state’leri vardır.
- İki alarm aynı anda aktifse sıcaklık alarmı önceliklidir.
- Alarm tipi değişiminde eski alarm kapanır, yeni alarm başlar.
- Clear olayı son aktif alarm tipiyle yayınlanır.

Alarm payload’ına eklenen alanlar:

```json
{
  "temperature": "...",
  "temperature_limit": "...",
  "temperature_sensor_valid": "..."
}
```

Firmware build sonucu:

```text
RAM:   61,508 / 327,680  (%18.8)
Flash: 1,856,693 / 1,966,080  (%94.4)
Build: SUCCESS
Upload: SUCCESS
```

> Flash kullanımı yüksektir. Gelecek sprintlerde optimizasyon konusu olarak izlenmelidir; bu sprint için bloklayıcı değildir.

---

## 4. Gerçek Alarm ve SLA Test Sonuçları

### 4.1 Test öncesi cihaz ayarları

ESP32’den `get_config` ile okunan değerler:

```text
TEMPERATURE_LIMIT=30
CURRENT_LIMIT=12
FIRMWARE_VERSION=3.3.3
```

Gerçek sıcaklık yaklaşık `34.3 °C` olduğu için firmware gerçek alarm oluşturdu.

### 4.2 Oluşan alarm

```text
Alarm tipi: OVER_TEMPERATURE
Severity: warning
Status: active
Machine: laser01
Started at: 2026-08-04 16:30:36.034923+03
Message: OVER_TEMPERATURE alarm
```

### 4.3 Test SLA kuralı

```text
Ad: Laser01 Aşırı Sıcaklık Test Kuralı
Severity: warning
Alarm Type: OVER_TEMPERATURE
Machine: laser01
ACK SLA: 1 dakika
Resolve SLA: 5 dakika
Channel: dashboard
Recipients: boş
Priority: 900
Active: true
```

İlk oluşturulurken severity `critical` seçilmişti. Gerçek alarm `warning` olduğu için kural `warning` olarak güncellendi.

### 4.4 SLA sonucu

Aktif alarm SLA görünümünde:

```text
Durum: Çözüm gecikti
Alarm: OVER_TEMPERATURE / warning
Machine: laser01
ACK SLA: 1 dk
Resolve SLA: 5 dk
Rule: Laser01 Aşırı Sıcaklık Test Kuralı
```

### 4.5 Bildirim kuyruğu sonucu

`SLA Tara ve Kuyruğa Al` bir kez çalıştırıldı.

```text
Toplam olay: 1
Durum: Teslim edildi
Aşama: Çözüm gecikti
Alarm: OVER_TEMPERATURE / warning
Machine: laser01
Channel: dashboard
Recipients: -
```

- E-posta gönderilmedi.
- Telegram gönderilmedi.
- `Bekleyenleri Gönder` kullanılmadı.
- Dashboard kanalında güvenli test tamamlandı.

### 4.6 Alarmın kontrollü kapatılması

`temperature_limit` MQTT config mesajıyla `50 °C` yapıldı.

Cihaz yanıtı:

```text
STATUS=done
MESSAGE=Config applied
TEMPERATURE_LIMIT_SENT=50
```

Ardından alarm kapandı:

```text
Alarm tipi: OVER_TEMPERATURE
Severity: warning
Status: cleared
Started at: 2026-08-04 16:30:36.034923+03
Cleared at: 2026-08-04 16:49:52.473456+03
Machine: laser01
```

### 4.7 Kalıcılık testi

ESP32’ye MQTT ile `restart` komutu gönderildi.

Yanıt:

```text
STATUS=accepted
MESSAGE=Device will restart
```

Yeniden başladıktan sonra `get_config` sonucu:

```text
TEMPERATURE_LIMIT=50
CURRENT_LIMIT=12
FIRMWARE_VERSION=3.3.3
UPTIME_MS=69117
```

Sonuç:

- Cihaz gerçekten yeniden başladı.
- `temperature_limit=50` kalıcı olarak korundu.
- Firmware alarm açma ve kapatma akışı gerçek sensörle doğrulandı.

---

## 5. Değiştirilen ve Commit Edilen Dosyalar

```text
platform/backend/public/admin.html
src/alarm_manager.cpp
src/alarm_publisher.cpp
```

Commit özeti:

```text
3 files changed
490 insertions(+)
163 deletions(-)
```

Git commit:

```text
59c01eb feat(alarms): streamline admin workflows and add temperature alarms
```

---

## 6. Dosya Hashleri

### Admin

```text
SOURCE_SHA256:
CA222661AB2CE9A5E262F2A65B7EA92E7DB9799F2B708EF96E0E62092F4C822D

PRODUCTION_SHA256:
CA222661AB2CE9A5E262F2A65B7EA92E7DB9799F2B708EF96E0E62092F4C822D

ADMIN_MATCH=True
```

### Firmware

```text
src\alarm_manager.cpp:
25DDC30F8483A403F8237D55F26D2794D941D495AF42630CA56A1C62CC1D13BD

src\alarm_publisher.cpp:
AC8A593EF3845E3C272FBAB9B539FF7362CF0B11A3CB4547F58F6E111C06EF89
```

---

## 7. Production Servis Durumu

Sprint kapanışında:

```text
factorybox-prod-backend   healthy
factorybox-prod-mqtt      healthy
factorybox-prod-nginx     healthy
factorybox-prod-postgres  healthy
```

Production backend image:

```text
factorybox-backend:v6.12.0
```

Bu görüntü adı şu aşamada beklenen durumdur.

---

## 8. Sprint Sonu Yedeği

```text
C:\New DeviceOs Project\Backups\HukaTech_v6.13.6_Alarm_Workflows_OverTemperature_20260804-165850.zip
```

Boyut:

```text
0.92 MB
```

SHA256:

```text
31773CB8C2534E5892AA2774C20674D352ED09AC5A2ADFB3CF930817CEEE96ED
```

---

## 9. Bu Sprintte Yaşanan Hatalar ve Tekrar Edilmemesi Gerekenler

### 9.1 Tam `loadAdmin()` ile alarm yenileme yapılmamalı

Yanlış yaklaşım:

```text
Her alarm yenilemesinde bütün admin endpoint’lerini çağırmak.
```

Doğru yaklaşım:

```text
Aktif görünüm için yalnızca gerekli API’leri çağırmak.
```

Bu problem çözülmüştür. Aynı kök neden tekrar araştırılmamalıdır.

### 9.2 Alarm severity tahmin edilmemeli

Firmware alarm tipi `OVER_TEMPERATURE` olsa da backend severity değeri `warning` oluşturdu.

Kural eşleşmesinde:

```text
Alarm severity
Rule severity
```

değerleri birebir kontrol edilmelidir.

### 9.3 Panelde olmayan menü adı uydurulmamalı

Cihazın runtime çalışma ayarlarını yöneten ayrı bir ekran henüz yoktur.

`Cihaz Yetkinlikleri` bölümü:

```text
Capability / sensor manifest yönetimi
```

içindir.

`temperature_limit`, `current_limit` ve diğer firmware runtime ayarları farklı bir konfigürasyon yapısıdır.

### 9.4 MQTT şifresi sohbette paylaşılmamalı

MQTT environment bilgileri okunurken:

```text
MQTT_PASSWORD=***
```

şeklinde gizlenmelidir.

### 9.5 CMD içinde `|` karakteri yanlış yorumlanabilir

PowerShell komutu CMD üzerinden çalıştırılırken iç komuttaki pipe karakterleri kaçış/alıntılama sorunu oluşturabilir.

Gerekirse:

- PowerShell mantığı içinde filtreleme yapılmalı.
- Karmaşık script Base64 ile Node’a aktarılmalı.
- Şifreler komut satırına açık yazılmamalı.

### 9.6 `Compress-Archive` joker karakter hatası

Yanlış:

```powershell
Compress-Archive -LiteralPath (Join-Path $stage '*')
```

Doğru:

```powershell
Compress-Archive -Path (Join-Path $stage '*')
```

`-LiteralPath` joker karakteri genişletmez ve ZIP oluşmaz.

### 9.7 `PERSISTED=undefined` tek başına başarısızlık değildir

Config status mesajında `persisted` alanı bulunmadığı için `undefined` görüldü.

Kalıcılık kesin olarak:

1. Cihaz yeniden başlatılarak
2. `get_config` tekrar okunarak

doğrulandı.

### 9.8 Test sırasında dış bildirim gönderilmemeli

Güvenli test için:

```text
Channel: dashboard
Recipients: boş
```

kullanıldı.

E-posta veya Telegram gönderimine geçmeden önce hedefler ve kullanıcı onayı kontrol edilmelidir.

---

## 10. Kalıcı Çalışma Kuralları

1. Her turda yalnızca **bir PowerShell/CMD komutu** ver.
2. Kullanıcının çıktısını görmeden sonraki adıma geçme.
3. Önce kök nedeni teşhis et, sonra değişiklik yap.
4. Dosya değişikliklerini parça kod yerine **tam dosya veya ZIP deploy paketi** ile yap.
5. Kaynak, production ve firmware değişikliklerini açıkça ayır.
6. Testler bitmeden commit, sürüm artışı ve final yedek yapma.
7. `.env.production`, `.env.customer-mail`, MQTT/SMTP şifreleri, `secrets.h` ve özel anahtarları commit etme.
8. Alarm testlerinde dış teslim kanallarını kullanıcı onayı olmadan çalıştırma.
9. Tamamlanmış testi yeni sohbette yeniden yaptırma.
10. Tahmin ederek menü, route, tablo, kolon veya cihaz ayarı uydurma.
11. Windows satır sonu `LF → CRLF` uyarısını tek başına hata sayma.
12. Her sprint sonunda:
    - Git kontrolü
    - Commit
    - Güvenli ZIP yedeği
    - SHA256
    - Kaynak/production hash karşılaştırması
    - Servis sağlık kontrolü
    - Sprint Devam / Devir Notu
    hazırlanmalıdır.

---

## 11. Mevcut Sistem Kararları

- HukaTech’in ana amacı **izleme ve analizdir**, tam muhasebe veya operasyon yönetimi değildir.
- Production VPS taşıması ertelenmiştir.
- Sistem şu anda yerel Windows bilgisayarda çalışmaktadır.
- Bilgisayar kapalıyken dış panel erişimi çalışmaz.
- Gelecekteki hedef VPS: Netcup VPS Lite 2 G12s.
- Domain ve Cloudflare Tunnel aktiftir.
- Dış panel: `panel.hukatech.com`
- Merkezi mail yapısı Brevo ile devam etmektedir.
- ESP32 `laser01`, production MQTT’ye bağlıdır.

---

## 12. Bilinen Eksikler / Sonraki Sprint Adayları

### Öncelikli öneri: Cihaz Çalışma Ayarları ekranı

Panelde ayrı bir ekran eklenmesi önerilir:

```text
Varlıklar ve Bakım
└── Cihaz Çalışma Ayarları
```

Bu ekranda cihazdan gerçek ayarlar okunmalı ve güvenli biçimde gönderilmelidir:

```text
current_limit
temperature_limit
repeat_if_continues_min
normal_send_interval_sec
over_current_delay_sec
heartbeat_interval_sec
wifi_connect_timeout_sec
wifi_reconnect_interval_sec
mqtt_reconnect_interval_sec
```

Gerekli davranışlar:

- Cihaz seçimi
- `get_config` ile canlı okuma
- Mevcut ve düzenlenen değerlerin ayrı gösterimi
- Min/max doğrulama
- MQTT config gönderimi
- `CONFIG_STATUS` yanıtı
- Kalıcılık durumu
- Audit log
- Başarılı/başarısız transfer geçmişi
- Yetkilendirme kontrolü
- TR/EN desteği

### Diğer teknik not

Firmware flash kullanımı `%94.4` seviyesindedir. Yeni büyük firmware özelliklerinden önce boyut optimizasyonu değerlendirilebilir.

---

## 13. Yeni Sohbette İlk Yapılacak İş

Yeni sohbet açılırsa ilk işlem değişiklik yapmak değildir.

Önce aşağıdaki tek komutla kesin durum kontrol edilmelidir:

```powershell
powershell.exe -NoProfile -Command "Set-Location -LiteralPath 'C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)'; Write-Output '--- GIT ---'; git log -1 --oneline; $s=@(git status --short); if($s.Count){$s}else{Write-Output 'WORKTREE_CLEAN=true'}; Write-Output '--- PRODUCTION ---'; Set-Location -LiteralPath 'C:\FactoryBox\deployment\production'; & docker compose --env-file '.env.production' -f 'docker-compose.production.yml' ps"
```

Beklenen temel durum:

```text
59c01eb feat(alarms): streamline admin workflows and add temperature alarms
WORKTREE_CLEAN=true
Backend/MQTT/NGINX/PostgreSQL healthy
```

Durum farklıysa önce farkın nedeni incelenmelidir.

---

## 14. Yeni Sohbete Kopyalanacak Hazır Başlangıç Metni

```markdown
Aşağıdaki HukaTech Sprint Devam / Devir Notu önceki sohbetin kesin kapanış durumudur.

Notu önce tamamen incele.
Daha önce tamamlanmış işleri tekrar yaptırma.
Tahmin ederek dosya, ayar, menü, route veya veritabanı yapısı değiştirme.
Her adımda yalnızca tek PowerShell/CMD komutu ver ve sonucu bekle.
Dosya değişikliklerinde tam dosya veya ZIP deploy paketi kullan.
Kaynak, production ve firmware değişikliklerini birbirinden ayır.
Commit, sürüm artışı ve final yedek işlemlerini testler tamamlanmadan yapma.
Şifreleri ve secret dosyalarını sohbette veya Git içinde paylaşma.

İlk olarak Sprint Devam Notu içindeki “Yeni Sohbette İlk Yapılacak İş” komutunu çalıştırmamı iste.
Sonuç mevcut kapanış durumuyla eşleşirse sıradaki geliştirmeye geç.

Sprint Devam / Devir Notu:
[SPRINT_HANDOFF_LATEST.md DOSYASININ TAM İÇERİĞİ]
```

---

## 15. Sprint Kapanış Sonucu

```text
Admin UI değişiklikleri: BAŞARILI
Alarm menüsü sadeleştirme: BAŞARILI
Makine select alanları: BAŞARILI
API rate limit düzeltmesi: BAŞARILI
OVER_TEMPERATURE firmware build: BAŞARILI
ESP32 upload: BAŞARILI
Gerçek sıcaklık alarmı: BAŞARILI
SLA rule matching: BAŞARILI
Dashboard notification event: BAŞARILI
Alarm clear: BAŞARILI
Config persistence after restart: BAŞARILI
Git commit: BAŞARILI
Production hash match: BAŞARILI
Production services health: BAŞARILI
Final ZIP backup: BAŞARILI
```

**Sprint durumu: KAPALI ve TEMİZ**
