# FactoryBox One v5.16.0

## Alarm Escalation Email / Telegram Delivery Worker

- Pending escalation events can be delivered manually from Admin Panel.
- Email channel uses the existing SMTP configuration.
- Telegram channel uses TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
- Delivery results, provider message ID, attempt count and last error are stored.
- The worker claims events using a processing state to reduce duplicate delivery risk.
- Automatic delivery is disabled by default. Enable it with ALARM_ESCALATION_AUTO_DELIVERY_ENABLED=true.
- Failed events can be returned to pending state and retried.
