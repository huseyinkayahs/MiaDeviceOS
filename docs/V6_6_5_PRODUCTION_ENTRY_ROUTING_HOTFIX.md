# FactoryBox One v6.6.5 Production Entry Routing Hotfix

Production ana adresinde eski `index.html` sayfasının açılması düzeltildi.

- `/` doğrudan `/admin.html` adresine yönlendirilir.
- `/index.html` doğrudan `/admin.html` adresine yönlendirilir.
- Yönlendirme hem Backend hem Nginx katmanında uygulanır.
- Local HTTPS, bootstrap HTTP ve domain HTTPS şablonları güncellendi.
- PostgreSQL ve MQTT volume'larına dokunulmaz.
