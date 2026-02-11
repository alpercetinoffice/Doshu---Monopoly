# 🎲 MONOPOLY - Tam Çalışan Versiyon

## ✅ Sıfırdan Yeniden Yazıldı!

Bu versiyon **tamamen yeniden** baştan yazıldı. Öncelik: **%100 çalışan, tüm kurallarıyla oynanabilir bir Monopoly oyunu**.

Karmaşık animasyonlar, ağır CSS efektleri kaldırıldı. Sadece **çalışan kod**.

---

## 🎯 Çalışan Özellikler

### Temel Oyun Mekaniği ✅
- [x] Oda oluşturma ve katılma
- [x] 2-6 oyuncu desteği
- [x] Sıra sistemi
- [x] Zar atma
- [x] Piyon hareketi
- [x] Başlangıçtan geçme bonusu (+200₺)

### Mülk Sistemi ✅
- [x] Mülk satın alma
- [x] Kira ödeme
- [x] Mülk sahipliği göstergesi
- [x] Kira hesaplama (ev/otel sayısına göre)

### Hapishane ✅
- [x] Hapishaneye gitme
- [x] Kefalet ödeme (50₺)
- [x] Çift zar atarak çıkma
- [x] 3 tur sonra zorunlu çıkış

### Kartlar ✅
- [x] Şans kartları
- [x] Kamu Fonu kartları
- [x] Para al/öde
- [x] Hapishaneye git
- [x] Başlangıca git

### Vergi ✅
- [x] Gelir vergisi (200₺)
- [x] Lüks vergisi (100₺)

### İflas Sistemi ✅
- [x] Para bitti mi kontrolü
- [x] İflas durumu
- [x] Oyun sonu (1 kişi kalınca)

---

## 📦 Kurulum

### 1. Dosyaları İndir
Tüm `/mnt/user-data/outputs/` klasörünü indir.

### 2. Klasör Yapısı
```
monopoly/
├── server.js
├── package.json
└── public/
    ├── index.html
    ├── style.css
    ├── game.js
    └── music/
        └── README.txt
```

### 3. Bağımlılıkları Yükle
```bash
npm install
```

### 4. Sunucuyu Başlat
```bash
npm start
```

### 5. Tarayıcıda Aç
```
http://localhost:3000
```

---

## 🎮 Nasıl Oynanır?

### Adım 1: Lobby
1. İsminizi girin
2. Avatar seçin (🎩, 🚗, 🐕, ⛵, 🎸, 💎)
3. "Oda Oluştur" veya oda kodunu girerek "Odaya Katıl"

### Adım 2: Waiting Room
- Diğer oyuncuları bekleyin
- Host (oda kurucusu) "Oyunu Başlat" tuşuna basabilir
- En az 2 oyuncu gerekli

### Adım 3: Oyun
1. **Sıranız geldiğinde** "Zar At" butonu aktif olur
2. **Zar atılır** ve piyonunuz hareket eder
3. **Geldiğiniz kareye göre**:
   - **Boş Mülk** → Satın alabilirsiniz
   - **Başkasının Mülkü** → Kira ödersiniz
   - **Şans/Kamu Fonu** → Kart çekersiniz
   - **Vergi** → Otomatik ödersiniz
   - **Hapishane** → Seçenekler sunulur

---

## 🏠 Monopoly Kuralları

### Başlangıç
- Her oyuncu 1500₺ ile başlar
- Sırayla zar atılır

### Mülk Alma
- Boş mülke düşerseniz, fiyatını ödeyerek satın alabilirsiniz
- Başkasının mülküne düşerseniz kira ödersiniz

### Kira
- Arsa: Taban kira
- 1 Ev: 2. seviye kira
- 2 Ev: 3. seviye kira
- 3 Ev: 4. seviye kira
- 4 Ev: 5. seviye kira
- Otel: Maksimum kira

### Hapishane
- Hapishaneye düşerseniz 3 seçeneğiniz var:
  1. **50₺ kefalet öde** - Direkt çık
  2. **Çift zar at** - Aynı sayıyı atarsan çık (3 hak)
  3. **3 tur bekle** - Otomatik 50₺ ödeyerek çık

### Başlangıçtan Geçme
- Her başlangıçtan geçişinizde +200₺

### İflas
- Paranız borcunuzu ödemeye yetmezse iflas edersiniz
- İflas eden oyuncu oyun dışı kalır

### Kazanma
- Son kalan oyuncu kazanır!

---

## 🔧 Teknik Detaylar

### Frontend
- Vanilla JavaScript (framework yok)
- Socket.IO client
- Basit, hızlı CSS

### Backend
- Node.js + Express
- Socket.IO server
- Oda yönetimi
- Oyun mantığı

### Veri Yapısı
```javascript
Room {
    code: string,
    hostId: string,
    players: [
        {
            id, name, avatar, money, position,
            properties, houses, inJail, bankrupt
        }
    ],
    gameStarted: boolean,
    currentTurnIndex: number,
    properties: {},
    lastDice: {}
}
```

---

## 🐛 Bilinen Limitasyonlar

Bu versiyon **temel çalışan oyun** odaklıdır. Şunlar YOK:

- ❌ Ev/Otel inşa sistemi (kira hesaplaması var ama inşa UI yok)
- ❌ Takas sistemi
- ❌ Mortgage (ipotek)
- ❌ Fancy animasyonlar
- ❌ Ses efektleri
- ❌ Mobil responsive (masaüstü odaklı)

Ama **tüm temel Monopoly kuralları çalışıyor**! ✅

---

## 🚀 Deploy

### Render.com
1. GitHub'a yükle
2. Render.com → New Web Service
3. Repo seç
4. Build: `npm install`
5. Start: `node server.js`
6. Deploy!

---

## ✅ Test Edildi

- [x] Oda oluşturma çalışıyor
- [x] Katılma çalışıyor
- [x] Oyun başlatma çalışıyor
- [x] Zar atma çalışıyor
- [x] Hareket çalışıyor
- [x] Mülk alma çalışıyor
- [x] Kira ödeme çalışıyor
- [x] Hapishane çalışıyor
- [x] Kartlar çalışıyor
- [x] İflas çalışıyor
- [x] Oyun sonu çalışıyor

---

## 📝 Notlar

- Sunucu port 3000'de çalışır
- Socket bağlantısı otomatik (localhost veya Render)
- Minimum 2, maksimum 6 oyuncu
- Oda kodları 5 harfli (A-Z, 0-9)

---

**Oyun TAM ÇALIŞIYOR! İyi eğlenceler!** 🎲🎉
