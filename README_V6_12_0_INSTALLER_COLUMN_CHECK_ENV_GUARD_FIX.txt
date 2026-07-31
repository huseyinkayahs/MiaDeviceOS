HukaTech Platform v6.12.0 Installer Column Check & Environment Guard Fix

Duzeltilenler:
1. Cloudflare deployment kolon sayisi kontrolu, SQL komutunu stdin uzerinden psql'e gonderecek sekilde duzeltildi.
2. Ic ice tirnaklama nedeniyle bos donen columnCount sorunu giderildi.
3. MAIL_GATEWAY_NO_REPLY_TEXT her kurulumda guvenli ve kisa varsayilan degerle normalize edilir.
4. Mail Gateway PostgreSQL konteynerinde "argument list too long" hatasina yol acabilecek sisirilmis no-reply metni tekrar engellenir.

Uygulama:
- ZIP'i ana gelistirme ve production klasorlerinin uzerine kopyalayin.
- APPLY_V6_12_0_AUTOMATED_CUSTOMER_DEPLOYMENT.ps1 scriptini yeniden calistirin.

Gizli .env dosyalari ve Cloudflare API tokeni bu pakete dahil degildir.
