# FactoryBox One v6.2.0 — Security Hardening & Session Management

## Kapsam

Bu sürüm, FactoryBox One kimlik doğrulama ve yönetim panelini üretim ortamına hazırlamak için oturum, giriş ve şifre güvenliği katmanlarını güçlendirir.

## Güvenlik Merkezi

Admin Panel içinde `Sistem Ayarları > Güvenlik ve Oturumlar` ekranı eklendi.

Ekrandan:

- Aktif oturumlar ve cihaz/IP bilgileri görüntülenir.
- Başka cihazlardaki oturumlar kapatılır.
- Bir kullanıcının tüm oturumları iptal edilir.
- Kilitlenen hesaplar açılır.
- İlk girişte şifre değişimi zorunlu kılınır.
- Yönetici tarafından geçici şifre atanır.
- Oturum, giriş limiti ve parola politikaları yönetilir.
- Son güvenlik olayları izlenir.

## Giriş Koruması

- Hatalı giriş sayacı
- Geçici hesap kilidi
- IP bazlı giriş hız sınırı
- API hız sınırı
- Şüpheli hesap kilidinde Telegram bildirimi
- Başarılı ve başarısız girişlerin audit log kaydı

## Oturum Güvenliği

- Mutlak oturum süresi
- Boşta kalma zaman aşımı
- IP, user-agent ve cihaz etiketi
- Oturumların veritabanında hash ile takip edilmesi
- Rol veya hesap durumu değiştiğinde oturum iptali
- Şifre değişiminde diğer cihazların kapatılması

## Şifre Politikası

- Minimum uzunluk
- Büyük harf
- Küçük harf
- Rakam
- Özel karakter
- Yönetici şifre sıfırlama
- İlk girişte şifre değiştirme işareti

## HTTP / API Koruması

- X-Content-Type-Options
- X-Frame-Options
- Referrer-Policy
- Permissions-Policy
- Content-Security-Policy
- HTTPS kullanımında HSTS
- Origin tabanlı CSRF kontrolü
- Yapılandırılabilir CORS allowlist

## Admin Bootstrap Güvenliği

`FACTORYBOX_ADMIN_PASSWORD` artık mevcut admin şifresini her backend başlangıcında otomatik olarak ezmez.

Acil senkronizasyon gerekirse geçici olarak:

```env
FACTORYBOX_ADMIN_SYNC_PASSWORD=true
```

kullanılır. Backend bir kez başlatıldıktan sonra değer yeniden `false` yapılmalıdır.
