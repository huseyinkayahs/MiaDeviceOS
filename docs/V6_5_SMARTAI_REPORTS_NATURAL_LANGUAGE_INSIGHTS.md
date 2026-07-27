# FactoryBox One v6.5.0 — SmartAI Reports & Natural Language Insights

## Amaç

Alarm, OEE, plansız duruş, bakım, önleyici bakım, stok ve çoklu fabrika verilerini tek bir salt-okunur analiz merkezinde birleştirmek.

## Ekranlar

- SmartAI → AI Raporları
- SmartAI → Analiz Sor
- SmartAI → Rapor Geçmişi
- SmartAI → AI Ayarları

## Analiz Motorları

### FactoryBox Kural Motoru

- Harici API gerektirmez.
- Seçilen şirket/fabrika/tesis ve tarih aralığındaki kayıtları okur.
- Yönetici, teknik ekip ve operatör odaklı özet üretir.
- Duruş, OEE, tekrar eden alarm, geciken bakım ve kritik stok risklerini açıklar.

### OpenAI + Kural Motoru

- Opsiyoneldir.
- `OPENAI_API_KEY` tanımlı ve `SMARTAI_OPENAI_ENABLED=true` olduğunda kullanılır.
- OpenAI yanıt vermezse sistem FactoryBox Kural Motoruna geri döner.
- API anahtarı panelde gösterilmez veya veritabanına kaydedilmez.

## Doğal Dil Soruları

Desteklenen ilk niyetler:

- En fazla duran makine
- Düşük OEE nedeni
- Tekrarlayan alarmlar
- Gecikmiş bakım kayıtları
- Kritik stoklar
- Fabrika karşılaştırması
- Genel operasyon özeti

Soru ve cevap geçmişi kullanıcı, dönem, analiz motoru ve kanıt özetiyle saklanır.

## Raporlar

- Günlük
- Haftalık
- Aylık
- Özel tarih aralığı
- Türkçe / İngilizce
- Yönetici / Teknik Ekip / Operatör
- TXT indirme
- PDF için yazdırma görünümü
- Telegram / E-posta teslimatı

## Otomatik Zamanlama

Her şirket için ayrı olarak günlük, haftalık ve aylık zamanlama tanımlanabilir. Saat dilimi şirket SmartAI ayarından alınır. Aynı dönem için yinelenen scheduler çalışması engellenir.

## Güvenlik

- SmartAI operasyon verilerini yalnızca okur.
- Cihazlara komut göndermez.
- Alarm, bakım, OEE veya stok kayıtlarını değiştirmez.
- Tenant ve v6.4 lokasyon erişim sınırlarını uygular.
- Rapor oluşturma, teslimat, soru sorma ve ayar değişiklikleri audit log'a yazılır.
