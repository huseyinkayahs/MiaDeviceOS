# FactoryBox One v6.8.0 — Central Mail Gateway Foundation

## Sprint Adı

**Central Mail Gateway Foundation**

## Amaç

FactoryBox müşteri kurulumlarından merkezi sistem e-postaları göndermek; müşterinin bilgisayarına FactoryBox SMTP kullanıcı adı veya SMTP şifresi koymamak.

## Mimari

```text
Müşteri FactoryBox backend
        |
        | HTTPS + Installation ID + revocable API key
        v
FactoryBox Central Mail Gateway
        |
        | FactoryBox merkezi SMTP hesabı
        v
Müşterinin kullanıcı e-posta adresi
```

Şifre sıfırlama bağlantısı müşterinin FactoryBox adresine aittir. Gateway yalnızca e-postayı teslim eder; parola sıfırlama tokenını üretmez ve doğrulamaz.

## v6.8.0 ile Gelenler

- `gateway`, `direct_smtp` ve `disabled` e-posta modları
- FactoryBox Central Mail Gateway istemcisi
- Aynı backend kodunda güvenli `MAIL_GATEWAY_ONLY` merkezi sunucu modu
- Kurulum kimliği ve iptal edilebilir API anahtarı
- API anahtarının merkezi tarafta SHA-256 özetiyle saklanabilmesi
- Kurulum bazlı dakika ve günlük gönderim limiti
- İstek kimliğiyle tekrar gönderim/idempotency kontrolü
- Müşteri ve merkez tarafında teslimat kayıtları
- Gateway bağlantı kontrolü ve test maili
- Gateway modunda SMTP alanlarının Admin Panelde gizlenmesi
- Geliştirme için isteğe bağlı Direct SMTP fallback
- Şifre sıfırlama ve kullanıcı daveti için transactional mail amacı
- v6.7.1 Quick Tunnel Origin/CORS düzeltmesinin korunması

## Güvenlik Kuralları

1. Standart müşteriye SMTP şifresi verilmez.
2. `FACTORYBOX_MAIL_ALLOW_SMTP_FALLBACK=false` kullanılır.
3. Her müşteri kurulumu için ayrı Installation ID ve API key üretilir.
4. Merkezi sunucuda mümkünse yalnızca API key SHA-256 özeti tutulur.
5. Bir anahtar sızarsa yalnızca ilgili kurulum anahtarı iptal edilir.
6. Gerçek kullanımda gateway yalnızca HTTPS üzerinden yayınlanır.
7. Gateway gönderici adresini istemciden kabul etmez. Gerçek `From` merkezi sunucu ayarından gelir.
8. Müşteri adı yalnızca `FactoryBox | Müşteri Adı` biçimindeki görünen gönderici adına eklenir.
9. SMTP ve API anahtarlarını sohbet, ekran görüntüsü veya kaynak kod içinde paylaşmayın.

## Anahtar Üretme

Production klasöründe:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\GENERATE_MAIL_GATEWAY_KEY.ps1"
```

Çıktı iki tarafa ayrılır:

### Müşteri Kurulumu

```env
FACTORYBOX_MAIL_INSTALLATION_ID=fbx-...
FACTORYBOX_MAIL_API_KEY=...
```

### Merkezi Gateway

```env
MAIL_GATEWAY_SINGLE_INSTALLATION_ID=fbx-...
MAIL_GATEWAY_SINGLE_API_KEY_SHA256=...
```

Orijinal API key merkezi `.env` dosyasına yazılmak zorunda değildir; SHA-256 özeti yeterlidir.

## Merkezi Gateway Kurulumu

`deployment\production\.env.mail-gateway.example` dosyasını aynı klasörde `.env.mail-gateway` adıyla kopyalayın.

Doldurulması gereken temel alanlar:

```env
MAIL_GATEWAY_PGPASSWORD=GUCLU_VERITABANI_SIFRESI

MAIL_GATEWAY_SINGLE_INSTALLATION_ID=fbx-...
MAIL_GATEWAY_SINGLE_CUSTOMER_NAME=Müşteri Adı
MAIL_GATEWAY_SINGLE_API_KEY_SHA256=...

MAIL_GATEWAY_SMTP_HOST=smtp.provider.com
MAIL_GATEWAY_SMTP_PORT=587
MAIL_GATEWAY_SMTP_SECURE=false
MAIL_GATEWAY_SMTP_USER=bildirim@factorybox.com
MAIL_GATEWAY_SMTP_PASS=UYGULAMA_SIFRESI
MAIL_GATEWAY_SMTP_FROM=bildirim@factorybox.com
MAIL_GATEWAY_REPLY_TO=destek@factorybox.com
```

Başlatma:

```cmd
docker compose --env-file ".env.mail-gateway" -f "docker-compose.mail-gateway.yml" up -d --build
```

Kontrol:

```cmd
docker compose --env-file ".env.mail-gateway" -f "docker-compose.mail-gateway.yml" ps
```

Yerel servis yalnızca `127.0.0.1:3101` üzerinde açılır. Gerçek sunucuda Nginx, Cloudflare Tunnel veya başka bir reverse proxy ile TLS üzerinden şu tür bir adrese yayınlanmalıdır:

```text
https://mail.factorybox.com
```

## Müşteri Kurulumu

`deployment\production\.env.customer-mail.example` içindeki gerekli satırları müşterinin `.env.production` dosyasına ekleyin:

```env
EMAIL_REPORTS_ENABLED=true
FACTORYBOX_MAIL_MODE=gateway
FACTORYBOX_MAIL_GATEWAY_URL=https://mail.factorybox.com
FACTORYBOX_MAIL_INSTALLATION_ID=fbx-...
FACTORYBOX_MAIL_API_KEY=...
FACTORYBOX_MAIL_ALLOW_SMTP_FALLBACK=false
FACTORYBOX_MAIL_SENDER_NAME=FactoryBox | Müşteri Adı
```

Backend yeniden oluşturulur:

```cmd
docker compose --env-file "C:\FactoryBox\deployment\production\.env.production" -f "C:\FactoryBox\deployment\production\docker-compose.production.yml" up -d --build --no-deps backend
```

## Yerel Pilot

Gateway ve müşteri backend aynı Windows bilgisayarda farklı Docker Compose projeleri olarak çalışıyorsa:

```env
FACTORYBOX_MAIL_GATEWAY_URL=http://host.docker.internal:3101
```

Bu yalnızca geliştirme/pilot içindir. Gerçek müşteride merkezi HTTPS adresi kullanılmalıdır.

## Admin Panel Testi

1. `https://localhost:8443/admin.html`
2. **System → Notifications**
3. Gönderim Modu: **FactoryBox Central Gateway**
4. **Gateway Bağlantısını Kontrol Et**
5. **Email Test Mesajı**
6. Giriş ekranında **Şifremi unuttum** testi

Auth durum kontrolü:

```cmd
curl.exe -k -s "https://localhost:8443/api/auth/status"
```

Beklenen:

```json
"password_reset_email_configured": true
```

## API

### Gateway Durumu

```http
GET /api/mail-gateway/v1/status
Authorization: Bearer <API_KEY>
X-FactoryBox-Installation-Id: <INSTALLATION_ID>
```

### E-posta Gönderimi

```http
POST /api/mail-gateway/v1/send
Authorization: Bearer <API_KEY>
X-FactoryBox-Installation-Id: <INSTALLATION_ID>
Content-Type: application/json
```

Gateway şunları uygular:

- kurulum/anahtar doğrulaması
- dakika ve günlük gönderim limiti
- alıcı ve içerik boyutu doğrulaması
- aynı `request_id` için tekrar gönderim koruması
- teslimat/hata kaydı
- merkezi SMTP hesabından gönderim

## Veritabanı Tabloları

Müşteri backend:

```text
outbound_email_deliveries
```

Merkezi gateway:

```text
mail_gateway_deliveries
```

Bu tablolarda API anahtarı, SMTP şifresi veya e-posta HTML içeriği saklanmaz. Alıcılar maskelenerek kaydedilir.

## Geriye Uyumluluk

Eski SMTP kurulumu korunur:

```env
FACTORYBOX_MAIL_MODE=direct_smtp
```

Standart müşteri ürününde önerilmez. Yalnızca geliştirme veya özel kurumsal kurulum için kullanılmalıdır.

## Sürüm

```text
FactoryBox One v6.8.0
Central Mail Gateway Foundation
```
