# FactoryBox One v5.25.0 — Mobile Operator Panel

Bu sürüm, telefon ve tablet ekranlarına uygun bağımsız bir operatör paneli ekler.

## Panel Adresi

```text
http://SUNUCU_ADRESI:3100/operator.html
```

Aynı bilgisayarda test için:

```text
http://localhost:3100/operator.html
```

## Özellikler

- Mobil uyumlu makine durum kartları
- 15 saniyede otomatik yenileme
- Aktif alarm listesi ve alarm onayı
- Alarmdan bakım ticketı açma
- Makine için hızlı bakım bildirimi oluşturma
- Aktif bakım ticketlarını izleme, başlatma, çözme ve not ekleme
- Planlı bakım iş emirlerini izleme, başlatma, tamamlama ve not ekleme
- Tenant ve site erişimine göre veri filtreleme
- Admin, owner, operator ve yetkili kullanıcı desteği
- Admin panelinden Operator bağlantısı

## Güvenlik

Panel mevcut FactoryBox oturum tokenını kullanır. Kullanıcı yalnızca yetkili olduğu customer/site makinelerini görür. Bakım işlemleri için `MANAGE_MAINTENANCE`, alarm görünümü için `VIEW_DASHBOARD` yetkisi gerekir.
