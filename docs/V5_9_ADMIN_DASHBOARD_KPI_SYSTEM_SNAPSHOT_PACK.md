# FactoryBox One v5.9.0 — Admin Dashboard KPI / System Snapshot Pack

## Amaç

Admin panelin Dashboard bölümünü sadece sayısal liste olmaktan çıkarıp hızlı okunabilir KPI kartları, sistem sağlık uyarıları, dağılımlar ve son güvenlik aktiviteleriyle demo hazır hale getirmek.

## Kapsam

- Admin Dashboard KPI kartları
- Tenant, cihaz, kullanıcı, abonelik, güvenlik ve alarm özetleri
- Blocked subscription, offline device, failed login ve active alarm uyarıları
- Subscription/device/user rol dağılımları
- Son güvenlik aktiviteleri paneli
- `/api/admin/dashboard-summary` endpoint'i
- `/api/auth/status` içinde `admin_dashboard_kpi_enabled` bilgisi
- Mevcut backend iş kuralları korunarak UI iyileştirme

## Not

Bu sürüm yeni `.env` satırı gerektirmez. İstenirse ileride `ADMIN_DASHBOARD_KPI_ENABLED=false` ile dashboard KPI bilgisi kapatılabilecek şekilde altyapı hazırdır.
