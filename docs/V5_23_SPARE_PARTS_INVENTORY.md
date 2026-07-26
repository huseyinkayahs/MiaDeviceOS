# FactoryBox One v5.23.0 — Spare Parts & Inventory

## Amaç

Bakım ve servis süreçlerinde kullanılan yedek parçaların stok kartlarını, giriş/çıkış hareketlerini, minimum stok seviyelerini ve bakım iş emri tüketimlerini merkezi olarak yönetmek.

## Eklenenler

- Maintenance menüsü altında **Spare Parts & Inventory** ekranı
- Parça numarası ve SKU destekli stok kartları
- Kategori, birim, raf/konum ve tedarikçi bilgileri
- Başlangıç stoku, minimum stok ve sipariş miktarı
- Birim maliyet ve toplam stok değeri
- Purchase, consumption, return ve adjustment hareketleri
- Hareket öncesi ve sonrası stok bakiyesi
- Negatif stok oluşmasını engelleyen transaction kontrolü
- Minimum stok ve stok tükendi uyarıları
- Parça bazlı stok hareketi geçmişi
- Bakım iş emirlerinde **Parça Kullan** işlemi
- İş emri ile stok hareketi arasında izlenebilir bağlantı
- Kullanılan parçaların iş emri geçmişinde gösterilmesi
- Parça tüketimlerinin audit log kaydı

## Yeni API'ler

```text
GET   /api/admin/inventory
POST  /api/admin/inventory/parts
PATCH /api/admin/inventory/parts/:id
POST  /api/admin/inventory/parts/:id/movements
GET   /api/admin/inventory/parts/:id/history
POST  /api/admin/maintenance-work-orders/:id/consume-part
```

## Stok Hareketleri

```text
opening      İlk stok bakiyesi
purchase     Satın alma / stok girişi
consumption  Kullanım / stok çıkışı
return       İade / stok girişi
adjustment   Sayım veya manuel stok farkı
```

## İş Emri Akışı

```text
Yedek Parça Kartı
→ Stok Girişi
→ Maintenance Work Order
→ Parça Kullan
→ Stok Otomatik Düşer
→ İş Emri ve Parça Geçmişine Kaydolur
→ Minimum Stok Uyarısı Güncellenir
```
