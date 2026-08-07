# HukaTech v6.13.6 — Sprint Devam / Devir Notu

## Sprint Adı

**Kullanıcı Yetkileri, Davet Akışı ve Analiz Merkezi İyileştirmeleri**

## Tarih

**07.08.2026**

## Amaç

Bu sprintin amacı HukaTech yönetim panelinde iki ana alanı production kalitesine getirmekti:

1. **Kullanıcılar ve Davetler**
   - Rol ve kullanıcı yetkilerini daha anlaşılır ve güvenli hale getirmek.
   - Davet sırasında rol bazlı özel yetki seçimini desteklemek.
   - Kullanıcı tablosundaki teknik yetki görünümünü sadeleştirmek.
   - Davet kabul ekranını HukaTech markasına uygun hale getirmek.
   - Gereksiz “Roller ve Yetkiler” menüsünü kaldırmak.

2. **Analizler**
   - AI Raporları, Analiz Sor, Rapor Geçmişi, AI Ayarları ve Fabrika Karşılaştırması ekranlarını sadeleştirmek.
   - Veri olmayan durumlarda yanıltıcı KPI/OEE/skor göstermemek.
   - “Kaç alarm?” gibi doğrudan sorulara daha doğru ve kısa cevap vermek.
   - Günlük / Haftalık / Aylık / Özel Tarih seçimlerini tarihlerle otomatik senkronize etmek.

---

## Aktif Sürüm

```text
HukaTech v6.13.6
```

Bu sprintte **sürüm numarası artırılmadı**.

---

## Git Durumu

### Feature Commit

```text
4db7457 feat(admin): improve user permissions and analysis workflows
```

Bu commit aşağıdaki üç ana dosyayı içerir:

```text
platform/backend/server.js
platform/backend/public/admin.html
platform/backend/public/invite.html
```

### Feature Commit Öncesi Referans

```text
6f41577 docs: add auth session logout sprint handoff
```

---

## Son Dosya Hashleri

```text
SERVER_SHA256=5FEF02909FFC9F5FFE8FA5C12DF1EAE0909D65BF3471CB160C9B0FC4B296A490
ADMIN_SHA256=BF2726578C9853D39D9C58A81C25D2CBD8DBBEF4CD0DE15C1ABD065BD81AE02D
INVITE_SHA256=C45604AE110C5E2668F5C65D28BC248B6764EFD35C4404D7B8BB6F11574AE22B
```

Kaynak, production ve container eşleşmeleri ilgili deploy adımlarında doğrulandı.

---

# 1. Kullanıcılar ve Davetler

## 1.1 Kullanıcı Tablosu

Kullanıcı tablosu daha kompakt ve yönetilebilir hale getirildi.

Yapılanlar:

- Satırlar varsayılan olarak salt okunur.
- Düzenleme yalnızca seçilen satırda açılıyor.
- `Düzenle / Kaydet / İptal` akışı eklendi.
- Rol ve durum etiketleri kullanıcı dostu Türkçe metinlere çevrildi.
- Yetki sütununda teknik izin kodları yerine Türkçe etiketler gösteriliyor.
- İlk üç yetki gösteriliyor, kalanlar `+N yetki` olarak özetleniyor.
- Yetki özeti tıklanabilir hale getirildi.
- Yetki penceresinde tüm yetkiler görüntülenebiliyor.
- Müşteri + bölüm/alan bilgileri tek `Erişim` sütununda birleştirildi.
- Masaüstünde yatay scroll azaltıldı.
- Küçük ekranlarda yatay scroll korunuyor.

## 1.2 Granüler Kullanıcı Yetkileri

Veritabanına aşağıdaki alanlar eklendi:

```text
app_users.custom_permissions jsonb
user_invites.custom_permissions jsonb
```

Davranış:

- Mevcut kullanıcılar özel yetki tanımlanmamışsa rol varsayılanlarını kullanmaya devam eder.
- Özel yetkiler seçilen rolün izin verdiği yetkilerle sınırlandırılır.
- `Firma Sahibi` ve `Sistem Yöneticisi` kritik yetkileri sabit tutulur.
- `Yönetici` rolünde yönetim paneline erişim zorunlu tutulur.
- Kullanıcının özel yetkisi değiştiğinde hedef kullanıcının açık oturumları kapatılır.
- Kullanıcının kendi yetkisini değiştirmesi güvenlik nedeniyle engellenir.

## 1.3 Davet Akışı

Davet formunda:

- Şirket seçim alanı eklendi.
- Bölüm / Alan seçim zinciri eklendi.
- Rol seçimine bağlı özel yetki seçimi eklendi.
- Yetkiler rol sınırları içinde seçilebilir.
- “Davet e-postasını gönder” opsiyonu sadeleştirildi.
- Davet oluşturma sonucu raw token URL göstermiyor.
- Bekleyen davetlerde bağlantı kopyalama işlemi korunuyor.
- Kabul edilmiş / iptal edilmiş / süresi dolmuş davetlerde bağlantı kopyalama gösterilmiyor.

## 1.4 Davet Kabul Ekranı

`invite.html` tamamen HukaTech tasarımına geçirildi.

Yapılanlar:

- HukaTech markalı iki kolonlu modern ekran.
- Türkçe karakter sorunları giderildi.
- Rol, şirket, bölüm/alan ve davet durumu kartları.
- Şifre göster / gizle.
- Responsive mobil tasarım.
- İptal edilmiş davette form gizlenir ve uygun durum mesajı gösterilir.

## 1.5 Roller ve Yetkiler Menüsü

Ayrı `Roller ve Yetkiler` menüsü kaldırıldı.

Yetki yönetimi artık:

```text
Kullanıcı / Davet
→ Rol seçimi
→ Role bağlı yetki seçimi
```

akışı üzerinden yürütülür.

## 1.6 Şirket ve Lokasyon Erişimi

Eski teknik başlık:

```text
Tenant Erişimi
```

şu şekilde değiştirildi:

```text
Şirket ve Lokasyon Erişimi
```

Detaylı lokasyon erişimi mimarisi daha sonra ayrıca değerlendirilecek.

---

# 2. Mail Gateway Olayı

Davet e-postası testinde Mail Gateway'in durmuş olduğu tespit edildi.

Doğru production başlatma şekli:

```text
docker compose --env-file .env.production --env-file .env.mail-gateway -p factorybox-mail-gateway -f docker-compose.mail-gateway.yml up -d --force-recreate
```

Önemli not:

```text
Mail Gateway yalnızca .env.production ile başlatılmamalı.
.env.mail-gateway da zorunludur.
```

Doğrulanan durum:

```text
service: hukatech-central-mail-gateway
provider: brevo_api
connected: true
configured: true
```

Davet e-postası resend testi başarıyla geçti.

---

# 3. Analizler Menüsü

Aşağıdaki beş ekran gözden geçirildi:

```text
AI Raporları
HukaTech AI’ya Sor
Rapor Geçmişi
AI Ayarları
Fabrika Karşılaştırması
```

## 3.1 Görsel Düzenlemeler

- Kullanıcıya görünen `SmartAI` ifadeleri `HukaTech AI` olarak değiştirildi.
- `FactoryBox Kural Motoru` → `HukaTech Kural Motoru`.
- Tekrarlanan iç başlıklar sadeleştirildi.
- Uzun `Yenile` düğme metinleri kısaltıldı.
- `HukaTech AI Analiz Sor` → `HukaTech AI’ya Sor`.
- Form hizalamaları ve responsive görünüm iyileştirildi.
- Hızlı analiz düğmeleri nötr gri tasarıma geçirildi.
- Soru kutusu diğer form alanlarıyla uyumlu hale getirildi.
- Otomatik rapor kapalıysa gün/saat alanları pasifleştirildi.
- Teslimat kanalı kapalıysa alıcı alanları pasifleştirildi.

## 3.2 Fabrika Karşılaştırması

Tek fabrika durumunda:

```text
En İyi Fabrika
```

gibi yanıltıcı bir sonuç gösterilmemesi sağlandı.

Yeni davranış:

```text
Karşılaştırma Durumu
En az 2 fabrika gerekli
```

Operasyon verisi yoksa:

```text
OEE            —
Availability   —
Performance    —
Quality        —
```

gösterilir.

`Yeterli veri yok` ifadesinin kart ve tabloda gereksiz tekrar etmesi kaldırıldı.

Ham değerler korunur:

```text
Cihaz
Aktif Alarm
Üretim
Duruş
```

---

# 4. AI Operasyon Skoru Veri Güvenliği

## Sorun

Üretim / OEE verisi olmadığı halde sistem:

```text
100/100
```

operasyon skoru üretiyordu.

Kök neden:

Skor algoritması `100` değerinden alarm, duruş, bakım ve stok cezaları düşüyordu fakat gerçek üretim kanıtı kontrol edilmiyordu.

İncelenen gerçek veri:

```text
run_time_sec: 28800
net_planned_sec: 28800
availability_pct: 100

total_count: 0
good_count: 0
reject_count: 0
ideal_production_sec: 0
performance_pct: 0
quality_pct: 0
```

Makinenin çalıştığı biliniyor ancak üretim/OEE hesabı için yeterli veri bulunmuyordu.

## Yeni Kural

Operasyon skorunun hesaplanabilmesi için aşağıdaki üretim kanıtlarından en az biri sıfırdan büyük olmalı:

```text
total_count
production_count
good_count
reject_count
ideal_production_sec
```

Aşağıdaki alanlar tek başına artık yeterli değildir:

```text
run_time_sec
runtime_sec
net_planned_sec
planned_time_sec
observed_sec
availability_pct
```

Veri yetersizse:

```text
health_score = null
score_status = insufficient_data
```

UI:

```text
Skor: Hesaplanamadı
OEE: —
```

TXT / PDF / e-posta / rapor geçmişi aynı durumu destekler.

Eski rapor kayıtları bilinçli olarak değiştirilmedi.

---

# 5. “Kaç Alarm?” Analiz Niyeti

Aşağıdaki tür soru artık özel bir `alarm_count` niyetiyle ele alınır:

```text
Seçilen dönemde kaç alarm oluştu?
```

Doğrulanan sonuç:

```text
Seçilen dönemde 0 alarm oluştu.
Kritik alarm: 0.
Aktif alarm: 0.
```

Gereksiz genel operasyon özeti ve 100/100 skor cevabı kaldırıldı.

---

# 6. Dönem / Tarih Senkronizasyonu

Hem:

```text
AI Raporları
HukaTech AI’ya Sor
```

ekranlarında aynı tarih davranışı uygulanır.

## Günlük

```text
Dönem: Günlük
Tarih: bugün
```

- Bitiş alanı görünmez.
- İç payload için başlangıç ve bitiş aynı gündür.
- 07.08.2026 tarihinde bugünün tarihi doğru şekilde `07.08.2026` olarak doğrulandı.

## Haftalık

İçinde bulunulan haftanın:

```text
Pazartesi → Pazar
```

aralığı otomatik oluşturulur.

07.08.2026 testinde:

```text
Hafta Başlangıcı: 03.08.2026
Hafta Bitişi:     09.08.2026
```

doğrulandı.

## Aylık

İçinde bulunulan ayın ilk ve son günü otomatik oluşturulur.

Ağustos 2026 testinde:

```text
Ay Başlangıcı: 01.08.2026
Ay Bitişi:     31.08.2026
```

doğrulandı.

## Özel Tarih

```text
Başlangıç
Bitiş
```

alanları serbesttir.

Bitiş tarihi başlangıç tarihinden önce olamaz.

## Saat Dilimi

Varsayılan tarih üretimi UTC yerine HukaTech saat dilimine göre yapılır.

Varsayılan:

```text
Europe/Istanbul
```

---

# 7. Geçen Testler

## Kullanıcılar

- Kullanıcı satırı varsayılan salt okunur: **GEÇTİ**
- Tek satır düzenleme: **GEÇTİ**
- Kaydet / İptal görünümü: **GEÇTİ**
- İptal ile eski değerlerin geri gelmesi: **GEÇTİ**
- Yetki modalı: **GEÇTİ**
- Yetki rozetleri nötr görünüm: **GEÇTİ**
- Davet özel yetki seçimi: **GEÇTİ**
- İptal davet bağlantısının kullanılamaması: **GEÇTİ**
- Davet e-postası gönderimi: **GEÇTİ**
- Davet kabul ekranı: **GEÇTİ**
- Davet token URL gizliliği: **GEÇTİ**

## Analizler

- AI Raporu oluşturma ve kaydetme: **GEÇTİ**
- Veri yokken skor `Hesaplanamadı`: **GEÇTİ**
- Veri yokken OEE `—`: **GEÇTİ**
- `Kaç alarm?` doğrudan yanıtı: **GEÇTİ**
- AI Ayarlarını Kaydet: **GEÇTİ**
- Fabrika karşılaştırması tek fabrika davranışı: **GEÇTİ**
- Günlük tarih davranışı: **GEÇTİ**
- Haftalık tarih davranışı: **GEÇTİ**
- Aylık tarih davranışı: **GEÇTİ**
- Özel tarih davranışı: **GEÇTİ**
- Aynı tarih davranışının AI Raporları ekranında çalışması: **GEÇTİ**

---

# 8. Production Durumu

Son doğrulamalarda:

```text
BACKEND_HEALTH=healthy
```

Kaynak / Production / Container doğrulamaları geçti.

Son admin hash:

```text
BF2726578C9853D39D9C58A81C25D2CBD8DBBEF4CD0DE15C1ABD065BD81AE02D
```

Son server hash:

```text
5FEF02909FFC9F5FFE8FA5C12DF1EAE0909D65BF3471CB160C9B0FC4B296A490
```

Son invite hash:

```text
C45604AE110C5E2668F5C65D28BC248B6764EFD35C4404D7B8BB6F11574AE22B
```

---

# 9. Kritik Deployment Notları

## Public Dosyaları

Aşağıdaki dosyalar değiştirildiğinde:

```text
platform/backend/public/admin.html
platform/backend/public/login.html
platform/backend/public/invite.html
```

yalnızca restart yeterli değildir.

Backend image yeniden build edilmeli ve container recreate edilmelidir:

```text
docker compose build backend
docker compose up -d --no-deps --force-recreate backend
```

Ardından source / production / container / panel hashleri doğrulanmalıdır.

## Mail Gateway

Mail Gateway başlatılırken iki env dosyası birlikte kullanılmalıdır:

```text
--env-file .env.production --env-file .env.mail-gateway
```

---

# 10. Bilinen / Ertelenen Konular

## Lokasyon Erişimi

`Şirket ve Lokasyon Erişimi` ekranının mimarisi sonraki çalışma için ertelendi.

Karar verilmesi gereken konu:

```text
Kullanıcı tablosundaki özet erişim
vs.
detaylı şirket / fabrika / bölüm / hat erişim kayıtları
```

Bu konu yeniden ele alınmadan büyük UI değişikliği yapılmamalı.

## Eski AI Raporları

Hotfix öncesi oluşturulan eski raporlardaki `100/100` değerleri otomatik migrate edilmedi.

Yeni raporlar yeni veri yeterliliği kuralını kullanır.

---

# 11. Sonraki Önerilen Çalışma

Bir sonraki sprintte doğrudan yeni ana menüye geçilebilir.

Önerilen sıra:

```text
1. Ayarlar menüsü
2. Lokasyon Erişimi mimarisi
3. Kullanıcılar menüsündeki kalan Abonelikler ekranı
4. Production stabilizasyon
```

---

# 12. Kapanış Özeti

Bu sprint sonunda:

```text
Kullanıcı yetki sistemi       TAMAMLANDI
Davet UX                      TAMAMLANDI
Davet kabul ekranı            TAMAMLANDI
Granüler yetkiler             TAMAMLANDI
Analizler görsel düzenleme    TAMAMLANDI
AI veri güvenliği             TAMAMLANDI
Alarm count intent            TAMAMLANDI
Dönem / tarih senkronizasyonu TAMAMLANDI
Feature commit                TAMAMLANDI
```

Kapanış dokümanı ve final backup işlemleri bu notun oluşturulmasıyla tamamlanacaktır.
