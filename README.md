# yshare

Kirim file dari HP/laptop ke folder tertentu di PC lewat browser, di Wi-Fi/LAN yang sama. Tanpa kabel, tanpa aplikasi tambahan, tanpa cloud.

Spesifikasi lengkap ada di [prd.md](prd.md).

## Menjalankan

Butuh Node.js 20.9 atau lebih baru.

```bash
npm install
```

Atur folder tujuan di [yshare.config.yaml](yshare.config.yaml) (bagian `roots`), lalu:

```bash
# Pemakaian sehari-hari (hemat RAM)
npm run build
npm start

# Saat mengembangkan kode (hot reload)
npm run dev
```

### Perintah `yshare` dari folder mana saja

Daftarkan sekali (dari folder proyek):

```bash
npm link
```

Setelah itu cukup ketik `yshare` di terminal mana pun. Perintah ini menjalankan mode production dan otomatis build ulang jika kode di `src/`, `public/`, `next.config.ts`, atau `package.json` berubah sejak build terakhir. `yshare --rebuild` memaksa build ulang. Untuk menghapus perintahnya: `npm unlink -g yshare`.

Terminal akan menampilkan alamat, **QR code**, dan **PIN**:

1. Scan QR code dari HP, atau ketik alamatnya lalu masukkan PIN.
2. Pilih folder tujuan (bisa buat folder baru).
3. Pilih atau tarik file. Progress tampil per file.

Jika layar HP terkunci atau Wi-Fi putus, upload **dijeda** lalu **otomatis lanjut dari posisi terakhir** begitu layar dibuka lagi. Browser HP tidak bisa mengirim data saat layar terkunci, jadi biarkan layar menyala supaya cepat selesai. Kalau halaman sempat tertutup, pilih file yang sama ke folder yang sama dan upload akan melanjutkan (berlaku sampai 24 jam, selama server tidak di-restart).

Saat pertama dijalankan, Windows akan menanyakan izin firewall untuk Node.js. **Centang hanya "Private networks"**, jangan "Public".

## Upload lambat?

Cek dulu jaringannya, bukan aplikasinya. Dari PC, jalankan `ping <IP HP>` (IP HP tampil di log server). Wi-Fi yang sehat: di bawah ~10 ms dan 0% loss. Kalau ping ratusan ms atau ada packet loss, upload akan sangat lambat apa pun aplikasinya.

Yang biasanya membantu:
- Pakai Wi-Fi **5 GHz** (bukan 2,4 GHz) dan dekatkan perangkat ke router.
- Hindari Wi-Fi umum/ramai.
- Hubungkan HP dan PC langsung: nyalakan **Mobile hotspot di Windows** (Settings → Network & internet → Mobile hotspot), sambungkan HP ke hotspot itu, lalu restart yshare dan pakai alamat `192.168.137.1` yang muncul di terminal.

## Keamanan

- Hanya melayani IP jaringan lokal (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`). Request dari luar ditolak.
- Login lewat token di QR atau PIN 6 digit. Keduanya dibuat ulang setiap server start.
- Header `Host` dan `Origin` dicek, supaya website lain tidak bisa memakai browser kamu untuk mengirim file ke yshare (CSRF / DNS rebinding).
- Upload hanya bisa masuk ke folder di `roots` dan subfoldernya. `..`, path absolut, drive lain, dan symlink/junction ke luar root ditolak.
- Nama file dibersihkan dari karakter yang dilarang Windows dan nama khusus (`CON`, `NUL`, …).
- File ditulis dulu sebagai `.yshare-*.part`, lalu di-rename setelah selesai. Upload yang terputus tidak meninggalkan file rusak.

## Skrip

| Perintah | Fungsi |
|---|---|
| `yshare` | Build jika perlu, lalu jalankan production (setelah `npm link`) |
| `npm run dev` | Server development dengan hot reload |
| `npm run build` | Build production |
| `npm start` | Jalankan hasil build |
| `npm test` | Unit test (validasi path, filter jaringan) |
| `npm run typecheck` | Cek TypeScript |
| `npm run lint` | ESLint |

## Struktur

```
server.ts                 Custom server: filter IP/Host/Origin, QR + PIN di terminal
bin/yshare.mjs            Perintah global `yshare` (build jika perlu, lalu start)
yshare.config.yaml        Konfigurasi (port, root folder, batas ukuran, dll.)
src/lib/paths.ts          Validasi path & nama file  ← bagian paling kritis, ada test-nya
src/lib/network.ts        Cek IP lokal, Host, Origin
src/lib/upload.ts         Streaming ke .part → rename, kebijakan nama bentrok
src/lib/auth.ts           Sesi, PIN, rate limit
src/lib/client/queue.ts   Antrean upload di browser (XHR + progress)
src/app/api/…             Route handler: session, auth, roots, folders, upload
src/components/…          UI
```

## Catatan untuk pengembang

- **Selalu jalankan lewat `npm run dev` / `npm start`**, bukan `next dev` atau `next start`. Filter keamanan dan state (token, PIN, sesi) ada di `server.ts`.
- **Jangan menambah `proxy.ts` (middleware).** Jika ada proxy, Next.js menahan body request di memori dan memotongnya di 10 MB tanpa error, sehingga upload besar rusak.
- Upload memakai protokol resumable sederhana: `POST /api/uploads` membuat sesi, `PATCH /api/uploads/{id}` mengirim byte mulai dari header `Upload-Offset`, dan `GET` mengembalikan offset terakhir. Body mentah, bukan multipart, langsung ditulis ke disk.
- Di mode development, RAM proses bisa naik sekitar 1 GB selama upload berlangsung (perilaku Turbopack dev). Di mode production RAM tetap sekitar 150 MB, sudah diuji dengan upload 1 GB.

## Belum ada (rencana berikutnya)

Upload satu folder utuh, riwayat upload di web, akun tamu. Lihat bagian 7 dan 15 di [prd.md](prd.md).
