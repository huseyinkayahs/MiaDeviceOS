# FactoryBox One v6.5.3 SmartAI Report History Rendering Hotfix

## Amaç

SmartAI Rapor Geçmişi tablosunda HTML etiketlerinin metin olarak görünmesini düzeltmek ve dönem tarihlerini panelin tarih/saat ayarlarına göre okunabilir göstermek.

## Düzeltmeler

- Dönem alanındaki `<br>` ve `<small>` etiketleri artık metin olarak görünmez.
- Detay, TXT ve PDF işlem düğmeleri gerçek buton olarak oluşturulur.
- İşlem düğmeleri yeniden tıklanabilir hale getirildi.
- Rapor dönem tarihleri ISO zaman damgası yerine seçili tarih biçiminde gösterilir.
- Saat dilimi kaynaklı bir önceki gün görünümü düzeltildi.
- SmartAI rapor oluşturma ve PostgreSQL sorgu düzeltmeleri korunur.

## Değişen Dosyalar

- `platform/backend/public/admin.html`
- `platform/backend/server.js`
