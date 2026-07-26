# FactoryBox One v5.20.0 — Daily / Weekly Alarm Reports

## Amaç

Alarm kayıtlarını günlük veya haftalık özetleyip Telegram, Email ya da iki kanal üzerinden teslim etmek.

## Admin Panel

```text
System Settings
  └─ Alarm Reports
```

## Özellikler

```text
Günlük alarm raporu
Haftalık alarm raporu
Telegram teslimatı
Email teslimatı
Telegram + Email birlikte teslimat
Manuel Günlük Rapor Gönder işlemi
Manuel Haftalık Rapor Gönder işlemi
Saat dilimi desteği
Günlük gönderim saati
Haftalık gönderim günü ve saati
Varsayılan Notifications alıcılarını kullanma
Rapor teslimat geçmişi
Son rapor KPI özeti
Aynı otomatik raporun tekrar gönderilmesini engelleyen report key
Audit log kaydı
```

## Rapor İçeriği

```text
Toplam alarm sayısı
Critical / Warning / Info dağılımı
Temizlenen alarm sayısı
Şu an aktif alarm sayısı
Ortalama acknowledge süresi
Ortalama çözüm süresi
SLA escalation sayısı
Delivered / Failed escalation sayıları
En sık alarm tipleri
En yoğun makineler
Son kritik alarmlar
```

## Rapor Dönemi

- Günlük rapor: Önceki tamamlanmış yerel gün.
- Haftalık rapor: Önceki tamamlanmış 7 yerel gün.
- Varsayılan saat dilimi: `Europe/Istanbul`.

## Yeni API'ler

```text
GET   /api/admin/alarm-reports
PATCH /api/admin/alarm-reports/settings
POST  /api/admin/alarm-reports/run-now
```

Manuel gönderim örneği:

```json
{
  "report_type": "daily"
}
```

## Veritabanı

`notification_settings` tablosuna alarm raporu planlama alanları eklenir.

Yeni geçmiş tablosu:

```text
alarm_report_deliveries
```

Şema güncellemeleri backend başlatılırken otomatik uygulanır.
