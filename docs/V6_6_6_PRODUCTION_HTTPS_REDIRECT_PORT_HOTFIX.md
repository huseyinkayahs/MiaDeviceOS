# FactoryBox One v6.6.6 Production HTTPS Redirect Port Preservation Hotfix

## Sorun

Yerel production kurulumu `https://IP:8443` adresinden `/admin.html` sayfasına yönlenirken
Nginx container içindeki `443` portunu esas alıyor ve tarayıcıya `https://IP/admin.html`
veya `http://IP/admin.html` adresi döndürebiliyordu.

## Düzeltme

- Nginx yönlendirmeleri relative `Location` başlığı kullanacak şekilde ayarlandı.
- `absolute_redirect off` eklendi.
- Proxy `Host` ve `X-Forwarded-Host` başlıklarında dış port korunuyor.
- `X-Forwarded-Port` başlığı eklendi.
- Yerel `8443`, özel HTTPS portları ve gerçek domain modu destekleniyor.
- Ana adres ve `/index.html` güncel `/admin.html` sayfasına yönleniyor.

## Onarım

```cmd
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\repair-https-redirect.ps1"
```
