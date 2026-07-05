# FactoryBox One Pilot Panel Safety Checklist

## Amaç

Pilot saha kurulumu öncesi elektriksel güvenlik ve bağlantı kontrol listesini oluşturmak.

---

## Kurulum Öncesi

```text
Makine modeli not edildi mi?
Pano fotoğrafı çekildi mi?
RUN sinyali kaynağı belirlendi mi?
Sinyalin voltajı ölçüldü mü?
Kuru kontak mı, 24V sinyal mi, başka bir çıkış mı doğrulandı mı?
Akım sensörü gerekiyorsa uygun hat belirlendi mi?
FactoryBox enerji beslemesi nereden alınacak?
Klemens planı hazır mı?
```

---

## Güvenlik Kontrolü

```text
Canlı hatta müdahale edilmeyecek
220V / 380V doğrudan FactoryBox girişine bağlanmayacak
24V sinyal doğrudan ESP32 GPIO’ya bağlanmayacak
İzole giriş / optokuplör / ara röle kullanılacak
Pano içinde gevşek kablo bırakılmayacak
Klemensler etiketlenecek
Gerekirse elektrikçi ile işlem yapılacak
```

---

## DI1 Sinyal Kontrolü

```text
DI1 için kullanılan sinyal güvenli mi?
Kuru kontak ise üzerinde voltaj yok mu?
Ara röle kullanılıyorsa bobin voltajı doğru mu?
Optokuplör kullanılıyorsa giriş voltajı uyumlu mu?
DI1 çıkışı sadece FactoryBox GND’ye mi çekiyor?
```

---

## Kurulum Sonrası Test

MQTT üzerinden kontrol:

```json
{
  "command": "get_digital_inputs",
  "request_id": "pilot-di-check"
}
```

Beklenen:

```text
Makine çalışırken DI1 ACTIVE
Makine dururken DI1 INACTIVE
```

Machine runtime kontrolü:

```json
{
  "command": "get_machine_runtime",
  "request_id": "pilot-runtime-check"
}
```

Beklenen:

```text
Makine çalışırken RUNNING
Makine dururken STOPPED
```

---

## n8n Kontrolü

```text
Günlük rapor workflow aktif mi?
Stop alert request workflow aktif mi?
Stop alert telegram workflow aktif mi?
Anti-spam kilidi çalışıyor mu?
Telegram test mesajı geldi mi?
```

---

## Pilot Kabul Kriterleri

```text
DI1 sinyali doğru okunuyor
Machine runtime doğru state üretiyor
Çalışma / duruş süresi sayılıyor
Günlük rapor Telegram’a geliyor
Uzun duruş uyarısı bir kere geliyor
Restart sonrası input source korunuyor
```

---

## Notlar

Pilot kurulum sonrası her makine için şu bilgiler kaydedilmelidir:

```text
Makine adı
RUN sinyali kaynağı
Input source ayarı
Duruş uyarı limiti
Rapor saati
Kurulum tarihi
Kurulumu yapan kişi
```
