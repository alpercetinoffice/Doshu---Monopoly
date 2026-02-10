# Monopoly Gold Edition - Multiplayer Oyun

## Düzeltilen Sorunlar

### 1. **Server.js Eksiklikleri**
- ✅ `startGame` fonksiyonu eklendi
- ✅ `rollDice` fonksiyonu eklendi  
- ✅ Oyuncu renkleri sistemi eklendi
- ✅ Tur yönetimi sistemi eklendi
- ✅ Başlangıçtan geçme bonusu eklendi
- ✅ Host kontrolü eklendi (sadece host oyunu başlatabilir)

### 2. **HTML Eksiklikleri**
- ✅ "OYUNU BAŞLAT" butonu eklendi (waiting screen'de)
- ✅ `startGame()` fonksiyonu eklendi
- ✅ `rollDice()` fonksiyonu eklendi
- ✅ `currentRoomId` değişkeni eklendi
- ✅ Host/Guest zone gösterimi düzeltildi
- ✅ Tüm gerekli elementler eklendi (#roll-btn, #d1, #d2, vb.)

### 3. **Oyun Akışı**
1. Kullanıcı isim girer ve avatar seçer
2. Masa kurar veya mevcut masaya katılır
3. Waiting room'da oyuncular toplanır
4. Host "OYUNU BAŞLAT" butonuna basar
5. Oyun tahtası açılır, piyonlar yerleşir
6. Sıra gelen oyuncu zar atar
7. Piyon hareket eder, para güncellenir
8. Başlangıçtan geçilirse +200₺

## Kurulum

```bash
# Bağımlılıkları yükle
npm install

# Sunucuyu başlat
npm start
```

## Kullanım

1. Tarayıcıda `http://localhost:3000` adresini aç
2. İsim ve avatar seç
3. "MASA KUR" veya mevcut bir masaya katıl
4. En az 2 oyuncu olunca host "OYUNU BAŞLAT" desin
5. Oyun başladı! Sıra sende olunca "ZAR AT" butonuna tıkla

## Özellikler

- ✨ Gerçek zamanlı multiplayer (Socket.IO)
- 🎨 Lüks gold tasarım
- 🎲 Zar atma mekaniği
- 💰 Para yönetimi
- 🏠 40 kareli Türkiye temalı tahta
- 👥 6 oyuncuya kadar destek
- 🎯 Tur bazlı oynanış
- 🔄 Başlangıçtan geçme bonusu

## Dosya Yapısı

```
/home/claude/
├── server.js           # Backend sunucu
├── package.json        # NPM bağımlılıkları
└── public/
    ├── index.html      # Ana oyun arayüzü
    ├── board_data.js   # Tahta verileri
    └── style.css       # Ek stiller
```

## Notlar

- Sunucu varsayılan olarak 3000 portunda çalışır
- Socket.IO otomatik olarak reconnect yapar
- Tüm oyuncular ayrılırsa oda otomatik silinir
- Host ayrılırsa ilk oyuncu yeni host olur
