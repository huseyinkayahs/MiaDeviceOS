# FactoryBox One v6.7.0 — Cloud Access, Domain & Remote Management

## Amaç

FactoryBox production panelini modemde port yönlendirmesi yapmadan farklı Wi-Fi, mobil internet ve uzak lokasyonlardan güvenli şekilde erişilebilir hale getirmek.

## Eklenenler

- System Settings altında Uzak Erişim ve Domain ekranı
- Cloudflare Tunnel named tunnel desteği
- Geçici Quick Tunnel test desteği
- Cloudflare Access koruma kontrol listesi
- Public URL sağlık testi
- Tunnel tokeninin panel/veritabanında gösterilmemesi
- Docker Compose `remote` ve `quick-remote` profilleri
- Cloudflare için yalnızca Docker ağına açık `nginx:8081` origin servisi
- Uzak erişimi açma, kapatma ve durum scriptleri
- Modemde port açmadan outbound-only bağlantı yapısı

## Named Tunnel kurulumu

1. Cloudflare Zero Trust panelinde remotely-managed Tunnel oluştur.
2. Public hostname oluştur ve origin service olarak `http://nginx:8081` yaz.
3. FactoryBox production bilgisayarında:

```powershell
cd "C:\FactoryBox\deployment\production"
.\enable-cloudflare-tunnel.ps1 -TunnelToken "TOKEN" -PublicUrl "https://panel.example.com" -AccessProtected
```

4. Cloudflare Access uygulaması ve kimlik politikası ekle.
5. Admin panelde System Settings → Remote Access & Domain ekranından public URL testi yap.

## Quick Tunnel

```powershell
cd "C:\FactoryBox\deployment\production"
.\start-quick-remote-access.ps1
```

Quick Tunnel yalnızca test içindir. URL her yeniden başlatmada değişebilir.

## Kapatma

```powershell
.\disable-remote-access.ps1
```

Yerel `https://localhost:8443` erişimi çalışmaya devam eder.
