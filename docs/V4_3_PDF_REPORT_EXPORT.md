
# MiaDeviceOS / FactoryBox One v4.3 Sprint

## Sprint Adı

v4.3 PDF Report Export

---

## Amaç

Bu sprintin amacı, v4.2 ile otomasyona hazır hale gelen site / fabrika raporlarını PDF olarak kaydedilebilir hale getirmektir.

---

## Yaklaşım

Bu sprintte ağır bir server-side PDF kütüphanesi kullanılmadı.

Bunun yerine güvenli ve hafif bir yöntem seçildi:

```text
Backend PDF/Yazdır HTML görünümü üretir
↓
Tarayıcı bu görünümü açar
↓
Kullanıcı PDF olarak kaydeder
```

Bu yöntem şu avantajları sağlar:

```text
Türkçe karakterler sorunsuz görünür
Ek Node dependency gerekmez
Browser print engine ile daha temiz çıktı alınır
Windows ortamında hızlı çalışır
```

---

## Yeni Endpointler

Son kayıtlı site raporu:

```text
GET /api/sites/site01/ai/reports/latest/print
```

Belirli site raporu:

```text
GET /api/sites/site01/ai/reports/:id/print
```

Yeni rapor üret + kaydet + PDF ekranı:

```text
GET /api/sites/site01/ai/daily-report/print?save=1
```

---

## PDF/Yazdır İçeriği

PDF export ekranında şu bilgiler yer alır:

```text
FactoryBox Günlük Yönetici Raporu
Site bilgisi
Rapor ID
Genel fabrika skoru
Toplam makine
Çalışan makine
Duruşta / bilinmeyen makine
Aktif alarm
Özet
Makine bazlı tablo
Bulgular
Öneriler
Telegram mesajı
```

---

## Dashboard Güncellemesi

Dashboard’a PDF export butonları eklendi:

```text
Son Site Raporu PDF / Yazdır
Yeni Rapor Üret + PDF
Rapor detayında PDF / Yazdır
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/styles.css

KURULUM_V4_3.txt
docs/V4_3_PDF_REPORT_EXPORT.md
```

---

## Bu Sprintte Yapılmayanlar

```text
Server-side binary PDF üretimi yapılmadı
PDF arşiv dosyası kaydetme yapılmadı
E-posta ile PDF gönderme yapılmadı
OpenAI API entegrasyonu yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v4.3 ile FactoryBox site / fabrika raporları artık PDF olarak dışa aktarılabilir hale gelir.
