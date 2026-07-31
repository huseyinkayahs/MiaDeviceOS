# HukaTech Platform v6.8.2

## Sprint Adı
Central Mail Routing and Password Reset Branding Fix

## Amaç
Müşteri backend'inde veritabanında kalmış eski SMTP ayarlarının HukaTech Central Mail Gateway ayarlarını geçersiz kılmasını önlemek ve şifre sıfırlama e-postalarını HukaTech markasıyla göndermek.

## Düzeltmeler
- `FACTORYBOX_MAIL_MODE=gateway` olduğunda merkezi gateway ayarları ortam dosyasından zorunlu olarak kullanılır.
- Eski Gmail/SMTP ayarlarına geri dönüş kapatılır.
- Müşteri veritabanındaki eski SMTP kullanıcı adı, parola ve gönderen bilgileri temizlenir.
- Şifre sıfırlama konusu ve içeriği `HukaTech` olarak güncellenir.
- Hatalı `PUBLIC_API_URL=...` biçimindeki bağlantılar normalize edilir.
- Docker iç ağ adreslerinin şifre sıfırlama bağlantısına yazılması engellenir.
- Güvenli `/api/email/status` çıktısına aktif gönderim modu eklenir.

## Beklenen Gönderen
```text
HukaTech <noreply@hukatech.com>
```

## Güvenlik
Brevo API anahtarı yalnızca merkezi mail gateway ortam dosyasında tutulur. Müşteri backend'i yalnızca iptal edilebilir gateway kimliği kullanır.
