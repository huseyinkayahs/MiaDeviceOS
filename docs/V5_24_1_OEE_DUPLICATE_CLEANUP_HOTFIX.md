# FactoryBox One v5.24.1 — OEE Duplicate Cleanup Hotfix

Bu hotfix, OEE testleri sırasında aynı üretim ve duruş kayıtlarının birden fazla kez eklenmesi sonucu hesapların beklenenden farklı görünmesini düzeltmek için hazırlanmıştır.

## Düzeltmeler

- Aynı üretim kaydının 5 dakika içinde tekrar eklenmesi engellendi.
- Aynı duruş kaydının 5 dakika içinde tekrar eklenmesi engellendi.
- Üretim kayıtlarına tek tek **Sil** işlemi eklendi.
- Duruş kayıtlarına tek tek **Sil** işlemi eklendi.
- Seçilen makine ve tarih aralığındaki bütün manuel OEE test kayıtlarını temizleme işlemi eklendi.
- Kayıt silme ve toplu temizleme işlemleri audit log'a bağlandı.
- OEE'nin seçili aralıktaki bütün kayıtları topladığına dair açıklama eklendi.

## Test Verisini Temizleme

OEE & Downtime ekranında:

1. Başlangıç ve Bitiş tarihini seçin.
2. `Tüm makineler` yerine tek bir makine seçin.
3. **Seçili Manuel Test Kayıtlarını Temizle** düğmesine basın.
4. Onayı kabul edin.
5. Bir üretim ve bir duruş kaydı oluşturarak testi tekrarlayın.

Temizleme işlemi yalnızca `source=manual` olan kayıtları siler. MQTT/import ve STOPPED sinyallerinden aktarılan kayıtlar etkilenmez.
