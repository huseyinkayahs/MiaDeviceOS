# FactoryBox One v5.14.0 Alarm SLA / Escalation Rules Pack

## Amaç

Aktif alarmlar için ilk müdahale ve çözüm sürelerini kural bazlı takip etmek.

## Eklenenler

- Alarm SLA admin menüsü
- Critical, warning ve info için varsayılan SLA kuralları
- Acknowledge SLA süresi
- Resolve SLA süresi
- Makine ve alarm tipi bazlı özel kural oluşturma
- Kural önceliği ve enabled yönetimi
- SLA içinde, acknowledge gecikti, çözüm gecikti ve kural yok sınıflandırması
- Aktif alarm SLA özeti ve detay tablosu
- Kural değişiklikleri için audit log

## Varsayılan Kurallar

```text
Critical: acknowledge 5 dakika / resolve 30 dakika
Warning: acknowledge 15 dakika / resolve 120 dakika
Info: acknowledge 60 dakika / resolve 480 dakika
```

## Yeni API'ler

```text
GET   /api/admin/alarm-escalation
POST  /api/admin/alarm-escalation/rules
PATCH /api/admin/alarm-escalation/rules/:id
```

## Not

Veritabanı tablosu ilk Alarm SLA ekranı açılışında otomatik oluşturulur. Manuel migration gerekmez.
