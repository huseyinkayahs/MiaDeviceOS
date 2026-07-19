
# MiaDeviceOS / FactoryBox One v4.5 Sprint

## Sprint Adı

v4.5 Email Report Delivery

---

## Amaç

Bu sprintin amacı, FactoryBox site / fabrika raporlarını e-posta ile gönderilebilir hale getirmektir.

v4.4 ile OpenAI destekli SmartAI raporu hazırlandı.  
v4.5 ile bu raporların yöneticiye veya müşteriye e-posta ile gönderim altyapısı eklendi.

---

## Ana Kazanım

FactoryBox artık raporları sadece dashboard / Telegram / PDF olarak göstermiyor; SMTP üzerinden e-posta ile de gönderebiliyor.

Yeni akış:

```text
Site raporu oluştur
↓
Veritabanına kaydet
↓
HTML mail içeriği hazırla
↓
SMTP ile gönder
↓
Dashboard’da gönderim sonucunu göster
```

---

## Eklenen Backend Endpointleri

Email status:

```text
GET /api/email/status
```

Son kayıtlı site raporunu e-posta gönder:

```text
GET /api/sites/site01/ai/reports/latest/email
```

Yeni site raporu üret + kaydet + e-posta gönder:

```text
GET /api/sites/site01/ai/daily-report/email?save=1
```

OpenAI raporu üret + kaydet + e-posta gönder:

```text
GET /api/sites/site01/ai/openai-report/email?save=1
```

---

## Dashboard Güncellemesi

Dashboard’a yeni bölüm eklendi:

```text
Email Report Delivery
```

Bu bölümde:

```text
E-posta Durumu
Alıcı e-posta alanı
Son Raporu Mail Gönder
Yeni Rapor + Mail
OpenAI Rapor + Mail
```

yer alır.

---

## SMTP Ayarları

Backend `.env` dosyasında tutulur:

```text
EMAIL_REPORTS_ENABLED=true
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
REPORT_EMAIL_TO=
```

---

## Güvenlik Notu

SMTP şifresi GitHub’a gönderilmez.

```text
.env lokal kalır
.env.email.example repo içinde örnek olarak kalabilir
```

---

## Yeni Dependency

```text
nodemailer
```

Bu yüzden kurulumdan sonra backend klasöründe:

```powershell
npm.cmd install
```

çalıştırılır.

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/styles.css
platform/backend/.env.email.example

KURULUM_V4_5.txt
docs/V4_5_EMAIL_REPORT_DELIVERY.md
```

---

## Bu Sprintte Yapılmayanlar

```text
PDF dosyası attachment olarak eklenmedi
Mail şablonu marka tasarımına göre özelleştirilmedi
Mail gönderim geçmişi ayrı tabloya yazılmadı
Kullanıcı yetkilendirme yapılmadı
Çoklu müşteri tenant mail ayarları yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v4.5 ile FactoryBox rapor teslim kanallarına e-posta da eklendi.

Sistem şu kanallara ulaştı:

```text
Dashboard
Telegram
PDF/Yazdır
OpenAI destekli rapor
E-posta
```
