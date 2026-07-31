# FactoryBox One v6.7.1 Quick Tunnel Origin / CORS Login Hotfix

## Amaç

Cloudflare Quick Tunnel adresi her değiştiğinde `CORS_ALLOWED_ORIGINS` ayarını elle güncelleme zorunluluğunu kaldırmak ve reddedilen Origin isteklerinde HTML 500 yerine JSON 403 döndürmek.

## Değişiklikler

- Güncel istek hostu ile aynı olan `https://*.trycloudflare.com` origin otomatik kabul edilir.
- Quick Tunnel kontrolü yalnızca HTTPS, portsuz ve gerçek `.trycloudflare.com` alt alanları için geçerlidir.
- Başka bir Quick Tunnel adresinden gelen çapraz origin istekleri reddedilir.
- CORS ve CSRF aynı normalize edilmiş origin kontrolünü kullanır.
- `X-Forwarded-Proto` ve `X-Forwarded-Host` çoklu proxy değerlerinin ilk elemanı güvenli biçimde okunur.
- Geçersiz origin istekleri `403 application/json` döndürür; Express varsayılan HTML 500 hatası oluşmaz.
- Mevcut localhost ve `CORS_ALLOWED_ORIGINS` tam eşleşmeleri korunur.
- Backend sürümü `6.7.1` olarak güncellenir.

## Güvenlik Notu

Wildcard tüm Quick Tunnel alanlarını körlemesine kabul etmez. Origin, o anda isteği sunan public tunnel hostu ile birebir aynı olmalıdır.
