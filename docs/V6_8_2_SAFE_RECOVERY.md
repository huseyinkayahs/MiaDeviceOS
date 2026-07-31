# HukaTech Platform v6.8.2 Safe Recovery

Bu düzeltme, üretim ortam dosyasının yanlışlıkla büyümesi sonucu oluşan `exec /sbin/tini: argument list too long` hatasını güvenli biçimde önler. Ayrıca Quick Tunnel başlatılırken backend yeniden oluşturulduktan sonra Nginx'in eski backend IP adresini tutması nedeniyle oluşan `502 Bad Gateway` sorununu giderir.

Paket hiçbir gizli anahtar veya gerçek `.env` dosyası içermez.
