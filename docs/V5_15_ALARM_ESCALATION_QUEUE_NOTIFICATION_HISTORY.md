# FactoryBox One v5.15.0

## Alarm Escalation Queue / Notification History Pack

Bu sprint, v5.14 SLA kurallarının ürettiği gecikme durumlarını kalıcı olay kuyruğuna dönüştürür.

```text
Acknowledge SLA aşımı → ack_overdue olayı
Resolve SLA aşımı → resolve_overdue olayı
Aynı alarm + aşama + kural için tekrar kayıt engeli
Dashboard kanalı için otomatik delivered durumu
Email / Telegram kanalları için pending kuyruğu
Gönderim durumu ve olay geçmişi
Manuel teslim edildi / tekrar kuyruğa al işlemleri
Audit log kaydı
```

Not: Bu sürüm gerçek e-posta veya Telegram gönderimini yapmaz. Teslimat adaptörleri sonraki sprintte kuyruğu tüketebilir.
