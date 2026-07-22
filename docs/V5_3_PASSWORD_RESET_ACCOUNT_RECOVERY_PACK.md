# MiaDeviceOS / FactoryBox One v5.3 Sprint

## Sprint Adı

v5.3 Password Reset / Account Recovery Pack

---

## Amaç

Bu sprintin amacı, FactoryBox kullanıcılarının giriş şifresini güvenli bir e-posta bağlantısı üzerinden yenileyebilmesini sağlamaktır.

---

## Ana Kazanım

FactoryBox artık kullanıcıya eski şifresini bilmeden hesap kurtarma imkânı verir.

Akış:

```text
Login ekranı
  → Şifremi unuttum
  → E-posta adresini yaz
  → Tek kullanımlık bağlantı gönder
  → Bağlantıyı doğrula
  → Yeni şifre belirle
  → Eski oturumları kapat
  → Yeni şifre ile login ol
```

---

## Yeni Backend Endpointleri

```text
POST /api/auth/forgot-password
POST /api/auth/password-reset/validate
POST /api/auth/reset-password
```

### Şifre Sıfırlama İsteği

```json
POST /api/auth/forgot-password
{
  "email": "user@example.com"
}
```

Backend, kullanıcı bulunup bulunmadığını dışarı açıklamaz.

Her durumda genel cevap döner:

```text
If an active account exists for this email,
a password reset link has been sent.
```

Bu sayede e-posta adresi üzerinden kullanıcı hesabı sorgulaması yapılamaz.

---

## Güvenli Token Yapısı

Kullanıcıya gönderilen token:

```text
32 byte cryptographic random token
64 karakter hexadecimal değer
```

Veritabanında ham token saklanmaz.

Sadece:

```text
SHA-256 token hash
```

saklanır.

Token özellikleri:

```text
Tek kullanımlık
Varsayılan 30 dakika geçerli
Yeni istek oluşturulunca eski token geçersiz
Kullanıldıktan sonra tekrar kullanılamaz
Süresi dolmuş token kabul edilmez
```

---

## Yeni Database Tablosu

```text
password_reset_tokens
```

Alanlar:

```text
id
user_id
token_hash
expires_at
used_at
requested_ip
used_ip
email_sent_at
email_message_id
email_last_error
created_at
```

Migration:

```text
platform/database/migrations/016_password_reset_account_recovery_pack.sql
```

Backend başlangıcında tablo ve indexler ayrıca otomatik kontrol edilir.

---

## Yeni Kullanıcı Ekranları

```text
/forgot-password.html
/reset-password.html?token=...
```

Login ekranına yeni bağlantı eklendi:

```text
Şifremi unuttum
```

### Forgot Password Ekranı

Kullanıcı e-posta adresini yazar ve sıfırlama bağlantısı ister.

### Reset Password Ekranı

Ekran önce token geçerliliğini kontrol eder.

Geçerliyse:

```text
Yeni Şifre
Yeni Şifre Tekrar
Şifreyi Güncelle
```

alanları açılır.

---

## Parola Kuralları

Yeni parola:

```text
En az 8 karakter
En fazla 128 karakter
```

olmalıdır.

---

## Oturum Güvenliği

Şifre başarıyla değiştirildiğinde kullanıcıya ait bellekteki tüm aktif auth session kayıtları iptal edilir.

```text
revokeSessionsForUser()
```

Böylece daha önce açık kalan oturumlar yeni parola sonrasında kullanılamaz.

Kullanıcının tekrar login olması gerekir.

---

## İstek Sınırlama

Aynı e-posta veya IP adresinden arka arkaya sıfırlama maili gönderilmesini azaltmak için cooldown kontrolü eklendi.

Varsayılan:

```text
60 saniye
```

---

## Yeni Ortam Ayarları

```text
PASSWORD_RESET_ENABLED=true
PASSWORD_RESET_TOKEN_MINUTES=30
PASSWORD_RESET_COOLDOWN_SECONDS=60
PUBLIC_APP_URL=http://localhost:3100
```

Production örneği:

```text
PUBLIC_APP_URL=https://panel.firmaniz.com
```

Şifre sıfırlama e-postaları mevcut SMTP altyapısını kullanır:

```text
EMAIL_REPORTS_ENABLED=true
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM
```

---

## Audit Log Kayıtları

Yeni işlemler:

```text
request_password_reset
reset_user_password
```

Audit kayıtlarında ham token veya yeni parola tutulmaz.

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/package-lock.json
platform/backend/server.js
platform/backend/.env.auth.example

platform/backend/public/login.html
platform/backend/public/signup.html
platform/backend/public/admin.html
platform/backend/public/styles.css
platform/backend/public/forgot-password.html
platform/backend/public/reset-password.html

platform/database/migrations/016_password_reset_account_recovery_pack.sql

KURULUM_V5_3.txt
docs/V5_3_PASSWORD_RESET_ACCOUNT_RECOVERY_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
SMS ile şifre sıfırlama yapılmadı
İki faktörlü doğrulama yapılmadı
Database tabanlı kalıcı login session yapısı kurulmadı
Admin tarafından manuel parola belirleme yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v5.3 ile FactoryBox SaaS giriş sistemi gerçek bir hesap kurtarma akışına kavuştu.

Kullanıcı artık güvenli, süreli ve tek kullanımlık e-posta bağlantısı ile şifresini yenileyebilir.
