# FactoryBox One v6.0.0

## Admin UI Refresh, Localization & General Settings

Bu sürüm admin panelinin görünümünü ve genel kullanım tercihlerini yeniler.

### Endüstriyel navigasyon

- Menü ikonları kaldırıldı.
- Menü yazı tipi ve punto dengesi yenilendi.
- Lacivert menü yerine antrasit/grafit endüstriyel görünüm kullanıldı.
- Aktif menü güvenlik turuncusu vurgu ile gösterilir.
- Alt menüler daha sade ve okunaklı hale getirildi.

### Dil desteği

- Türkçe ve English panel dili eklendi.
- Menü, ekran başlığı, açıklama, düğme, tablo başlığı, durum ve yaygın sistem mesajları birlikte çevrilir.
- Dil tercihi veritabanında saklanır.
- Mobil Operator Panel aynı genel dil ve saat ayarlarını kullanır.

### Genel Ayarlar

System Settings / Sistem Ayarları altında General Settings / Genel Ayarlar ekranı eklendi.

Ayarlar:

- Organizasyon / şirket adı
- Fabrika / tesis adı
- Panel dili
- Saat dilimi
- Tarih biçimi
- 12 / 24 saat biçimi
- Haftanın başlangıç günü
- Otomatik yenileme aralığı
- Varsayılan açılış ekranı
- Kompakt menü modu

### API

- `GET /api/admin/general-settings`
- `PATCH /api/admin/general-settings`
- `GET /api/ui-settings`

Ayar değişiklikleri audit log'a kaydedilir.
