# FactoryBox One v5.13.0 Alarm Analytics / Response KPI Pack

## Amaç

Alarm Center verilerini operasyonel KPI'lara dönüştürmek.

## Eklenenler

- Son 7 / 14 / 30 / 90 gün alarm analizi
- Aktif ve acknowledge bekleyen alarm sayıları
- Kritik aktif alarm sayısı
- Ortalama acknowledge süresi
- Ortalama alarm çözüm süresi
- Günlük alarm trendi
- Acknowledge hız dağılımı
- En çok alarm üreten alarm tipleri
- En çok alarm üreten makineler

## Yeni API

```text
GET /api/admin/alarm-analytics?days=7&limit=8
```

## Yeni Admin Menüsü

```text
Alarm Analytics
```
