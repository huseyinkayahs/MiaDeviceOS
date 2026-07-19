
# MiaDeviceOS / FactoryBox One v4.4 Sprint

## Sprint Adı

v4.4 OpenAI SmartAI Upgrade

---

## Amaç

Bu sprintin amacı, FactoryBox’ın kural bazlı SmartAI raporlarını OpenAI destekli daha doğal, yönetici seviyesinde yorumlara taşımaktır.

---

## Teknik Yaklaşım

Bu sprintte OpenAI entegrasyonu backend tarafına eklendi.

Önemli karar:

```text
OpenAI API key sadece backend .env içinde tutulur.
Frontend / dashboard tarafına key gönderilmez.
```

SDK bağımlılığı eklenmedi. Node.js fetch ile OpenAI Responses API çağrısı yapılır.

---

## Güvenli Fallback

OpenAI API key yoksa sistem hata verip durmaz.

Bunun yerine:

```text
FactoryBox Rules Fallback
```

çalışır.

Yani demo / geliştirme ortamında API key olmadan da sistem kullanılabilir.

---

## Yeni Endpointler

OpenAI durum kontrolü:

```text
GET /api/ai/openai/status
```

OpenAI destekli site raporu:

```text
GET /api/sites/site01/ai/openai-report
```

OpenAI destekli Telegram raporu:

```text
GET /api/sites/site01/ai/openai-report/telegram
```

Kaydederek üretmek:

```text
GET /api/sites/site01/ai/openai-report/telegram?save=1
```

---

## Dashboard Güncellemesi

Dashboard’a yeni bölüm eklendi:

```text
OpenAI SmartAI Upgrade
```

Bu bölümde:

```text
OpenAI Durumu
OpenAI Raporu Oluştur + Kaydet
OpenAI Rapor Önizleme
```

yer alır.

---

## .env Alanları

```text
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
SMARTAI_OPENAI_ENABLED=true
```

---

## Rapor İçeriği

OpenAI destekli raporda şu alanlar üretilebilir:

```text
summary
executive_comment
findings
recommendations
risks
action_items
telegram_text
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/styles.css
platform/backend/.env.openai.example

KURULUM_V4_4.txt
docs/V4_4_OPENAI_SMARTAI_UPGRADE.md
```

---

## Bu Sprintte Yapılmayanlar

```text
ESP32 firmware değiştirilmedi
PDF binary üretimi yapılmadı
E-posta gönderimi yapılmadı
Kullanıcı yetkilendirme yapılmadı
OpenAI maliyet izleme yapılmadı
```

---

## Sonuç

v4.4 ile FactoryBox SmartAI, kural bazlı raporlardan OpenAI destekli yönetici yorumlarına geçiş için hazır hale gelir.
