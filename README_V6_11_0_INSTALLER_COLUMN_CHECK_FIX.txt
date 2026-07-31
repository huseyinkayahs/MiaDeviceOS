HukaTech Platform v6.11.0
Installer Provisioning Column Check Fix

Duzeltilen sorun:
- Migration 043 basariyla uygulandiktan sonra installer icindeki PostgreSQL
  kolon dogrulama komutu ic ice tirnaklar nedeniyle bos sonuc donduruyordu.
- Script bu nedenle "Provisioning columns missing: /3" hatasiyla duruyordu.

Duzeltme:
- SQL sorgusu standart girdiden psql komutuna aktariliyor.
- provisioning_status, provisioning_token_sha256 ve key_generation kolonlari
  guvenilir sekilde 3/3 olarak dogrulaniyor.
- Migration ve kurulum adimlari idempotent oldugu icin installer yeniden
  calistirilabilir.
