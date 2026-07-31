# FactoryBox One v6.8.1 — HukaTech Brevo Central Mail Provider

## Sprint Adı

**HukaTech Brevo Central Mail Provider Integration**

## Amaç

FactoryBox müşteri kurulumlarının bilgilendirme e-postalarını HukaTech merkezi mail gateway üzerinden Brevo Transactional Email API ile göndermek; Brevo API anahtarını ve e-posta sağlayıcı bilgilerini müşteri bilgisayarlarından tamamen uzak tutmak.

## Mimari

```text
Müşteri FactoryBox backend
        |
        | HTTPS + Installation ID + iptal edilebilir Gateway API key
        v
HukaTech Central Mail Gateway
        |
        | Brevo API key — yalnızca merkezi sunucuda
        v
Brevo Transactional Email API
        |
        v
Alıcı kullanıcı
```

## v6.8.1 ile Gelenler

- Merkezi gateway için `brevo_api`, `smtp` ve `disabled` sağlayıcı modları
- Varsayılan sağlayıcı olarak Brevo Transactional Email API
- `HukaTech <noreply@hukatech.com>` merkezi göndericisi
- Bütün HTML ve metin maillerine merkezi “yanıtlamayın” alt bilgisi
- Brevo API anahtarı için merkezi `.env.mail-gateway` alanı
- Brevo API bağlantısını gerçek hesap endpointiyle doğrulayan gateway sağlık kontrolü
- Brevo `messageId` değerinin mevcut teslimat kayıtlarına yazılması
- Müşteri kurulumlarında Brevo/SMTP bilgisi bulunmaması
- Eski merkezi SMTP sağlayıcısının isteğe bağlı uyumluluk modu olarak korunması

## Önemli Domain Ayrımı

```text
send.hukatech.com
```

Brevo branded subdomain olarak ayrılmıştır. HukaTech gateway uygulaması için kullanılmaz.

Merkezi gateway için önerilen adres:

```text
https://mail.hukatech.com
```

Bu adres daha sonra merkezi sunucuya reverse proxy veya Cloudflare Tunnel ile yönlendirilecektir.

## Merkezi Gateway Ayarları

`deployment\production\.env.mail-gateway.example` dosyasını aynı klasörde `.env.mail-gateway` adıyla kopyalayın.

Temel Brevo alanları:

```env
MAIL_GATEWAY_PROVIDER=brevo_api
MAIL_GATEWAY_BREVO_API_BASE_URL=https://api.brevo.com/v3
MAIL_GATEWAY_BREVO_API_KEY=MERKEZI_SUNUCUDA_TUTULACAK_API_ANAHTARI
MAIL_GATEWAY_SENDER_NAME=HukaTech
MAIL_GATEWAY_FROM_EMAIL=noreply@hukatech.com
MAIL_GATEWAY_REPLY_TO=
MAIL_GATEWAY_NO_REPLY_TEXT=Bu e-posta HukaTech tarafından otomatik olarak gönderilmiştir. Lütfen bu e-postayı yanıtlamayın.
```

Brevo API anahtarı sohbet, ekran görüntüsü, kaynak kod, Git veya müşteri `.env.production` dosyasında paylaşılmaz.

## Başlatma

Production klasöründe:

```cmd
docker compose --env-file ".env.mail-gateway" -f "docker-compose.mail-gateway.yml" up -d --build
```

Durum kontrolü:

```cmd
docker compose --env-file ".env.mail-gateway" -f "docker-compose.mail-gateway.yml" ps
```

## Müşteri Kurulumu

Müşterinin `.env.production` dosyasında yalnızca gateway erişim bilgileri bulunur:

```env
EMAIL_REPORTS_ENABLED=true
FACTORYBOX_MAIL_MODE=gateway
FACTORYBOX_MAIL_GATEWAY_URL=https://mail.hukatech.com
FACTORYBOX_MAIL_INSTALLATION_ID=fbx-...
FACTORYBOX_MAIL_API_KEY=...
FACTORYBOX_MAIL_ALLOW_SMTP_FALLBACK=false
FACTORYBOX_MAIL_SENDER_NAME=HukaTech | Müşteri Adı
```

## Güvenlik

1. Brevo API anahtarı yalnızca HukaTech merkezi sunucusunda tutulur.
2. Müşteriye her kurulum için ayrı gateway Installation ID ve API key verilir.
3. Merkezi tarafta gateway anahtarının yalnızca SHA-256 özeti tutulabilir.
4. Gateway gönderen e-posta adresini müşteriden kabul etmez.
5. Gönderici merkezi olarak `noreply@hukatech.com` değerine sabitlenir.
6. Gateway yalnızca HTTPS üzerinden yayınlanır.
7. `send.hukatech.com` Brevo branded subdomain olarak korunur.

## Sağlık Kontrolü

Müşteri Admin Panelinden:

1. **System → Notifications**
2. Gönderim modu: **HukaTech Central Gateway**
3. **Gateway Bağlantısını Kontrol Et**
4. Sonuçta sağlayıcı `brevo_api` ve durum `connected` görünmelidir.
5. Ardından **Email Test Mesajı** çalıştırılır.

## Mail Alt Bilgisi

Bütün merkezi iletilere otomatik eklenir:

```text
Bu e-posta HukaTech tarafından otomatik olarak gönderilmiştir. Lütfen bu e-postayı yanıtlamayın.
```

## Sürüm

```text
FactoryBox One v6.8.1
HukaTech Brevo Central Mail Provider Integration
```
