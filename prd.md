# PRD — yshare: Web Upload File ke Server dengan Pilihan Folder Tujuan

| | |
|---|---|
| **Status** | v0.4 — MVP + upload yang bisa dilanjutkan, cakupan: LAN saja |
| **Tanggal** | 9 November 2026 |
| **Pemilik** | Yoga |
| **Nama kerja** | yshare |

---

## 1. Ringkasan

**yshare** adalah aplikasi web ringan yang berjalan di sebuah mesin (PC/laptop/server). Pengguna membuka web tersebut dari perangkat lain (HP, laptop, tablet) lewat browser, memilih **folder tujuan di mesin server**, lalu mengunggah satu atau banyak file ke folder itu. Tidak perlu kabel, flashdisk, aplikasi tambahan, atau akun cloud.

yshare **hanya dipakai di jaringan lokal**: perangkat pengirim harus terhubung ke Wi-Fi/LAN yang sama dengan mesin server. Akses dari internet bukan bagian dari produk ini.

Satu kalimat: *"Buka browser → pilih folder → tarik file → selesai, file langsung ada di folder itu di komputer saya."*

---

## 2. Latar Belakang & Masalah

- Memindahkan file dari HP ke PC (atau antar-laptop) masih ribet: kabel USB, aplikasi chat yang mengompres foto/video, atau upload ke cloud lalu download lagi.
- Cara lewat cloud lambat (dua kali transfer lewat internet), memakan kuota, dan menaruh file pribadi di pihak ketiga.
- Share folder Windows (SMB) sulit dipakai dari HP dan rawan salah konfigurasi.
- Banyak tool transfer hanya menaruh file di **satu folder default** (mis. `Downloads`), sehingga pengguna masih harus memindahkan file secara manual ke folder yang benar.

**Inti masalah:** belum ada cara cepat, lewat browser, untuk mengirim file langsung **ke folder yang tepat** di komputer sendiri.

---

## 3. Tujuan & Non-Tujuan

### 3.1 Tujuan

1. Upload file dari perangkat mana pun yang punya browser, tanpa install aplikasi di perangkat pengirim.
2. Pengguna bisa **menjelajah dan memilih folder tujuan** di server, termasuk membuat folder baru.
3. Mendukung file besar (hingga puluhan GB) dengan stabil dan cepat di jaringan lokal.
4. **Aman secara default untuk pemakaian di LAN**: hanya perangkat di jaringan lokal yang dilayani, hanya folder yang diizinkan yang bisa diakses, dan tidak mungkin menulis di luar folder tersebut.
5. Mudah dijalankan: `npm start` (atau satu file executable di tahap berikutnya), konfigurasi minimal.

### 3.2 Non-Tujuan (untuk versi awal)

- Bukan file manager lengkap: **tidak ada hapus, rename, pindah, atau edit file** di MVP.
- Tidak ada sinkronisasi otomatis (bukan pengganti Syncthing/Google Drive).
- Tidak ada multi-user dengan hak akses berbeda-beda (MVP = satu pemilik).
- **Tidak ada akses dari internet.** Tidak ada port forwarding, tunnel, atau reverse proxy publik. HTTPS tidak diwajibkan.
- Tidak ada preview/galeri media.

---

## 4. Pengguna

| Persona | Kebutuhan |
|---|---|
| **Pemilik server** (utama) | Mengirim foto/video/dokumen dari HP ke folder tertentu di PC sendiri. |
| **Tamu terpercaya** (sekunder) | Teman/rekan di jaringan yang sama ingin mengirim file ke PC pemilik, tanpa diberi akses ke seluruh isi komputer. |

---

## 5. User Stories

| ID | Sebagai… | Saya ingin… | Supaya… |
|---|---|---|---|
| US-1 | pemilik | membuka web dari HP dengan scan QR code | tidak perlu mengetik alamat IP |
| US-2 | pemilik | langsung masuk saat scan QR, atau pakai PIN jika mengetik alamat manual | orang lain di Wi-Fi yang sama tidak bisa sembarang upload |
| US-3 | pemilik | melihat daftar folder yang diizinkan dan menjelajah subfoldernya | bisa memilih tujuan yang tepat |
| US-4 | pemilik | membuat folder baru di lokasi yang sedang dibuka | tidak perlu ke PC dulu hanya untuk bikin folder |
| US-5 | pemilik | memilih banyak file sekaligus atau drag & drop | cepat mengirim banyak file |
| US-6 | pemilik | melihat progress, kecepatan, dan sisa waktu tiap file | tahu kapan selesai |
| US-7 | pemilik | memilih apa yang terjadi jika nama file sudah ada (rename/timpa/lewati) | tidak kehilangan file lama tanpa sengaja |
| US-8 | pemilik | membatalkan upload yang sedang berjalan | bisa berhenti kalau salah pilih file |
| US-9 | pemilik | upload file besar yang bisa dilanjutkan jika koneksi putus | tidak mengulang dari nol |
| US-10 | pemilik | upload satu folder utuh beserta strukturnya | struktur folder tetap terjaga |
| US-11 | pemilik | menyimpan folder favorit / tujuan terakhir | tidak perlu menjelajah ulang tiap kali |
| US-12 | pemilik | melihat riwayat upload | tahu file apa masuk ke mana dan kapan |

---

## 6. Alur Utama

```
[Jalankan yshare di PC]
        │  terminal menampilkan: URL LAN + QR code
        ▼
[Buka URL / scan QR dari HP]
        │
        ▼
[Scan QR → otomatis masuk]  atau  [Masukkan PIN] ──gagal──▶ [Pesan error + rate limit]
        │
        ▼
[Pilih root folder]  (mis. "Dokumen", "Foto", "Proyek")
        │
        ▼
[Jelajah subfolder]  ── opsional ──▶ [Buat folder baru]
        │
        ▼
[Pilih/drag file]  ──▶  [Antrean upload + progress per file]
        │
        ▼
[Konflik nama?] ──ya──▶ [Sesuai kebijakan: rename / timpa / lewati]
        │
        ▼
[Selesai → ringkasan: X berhasil, Y gagal, lokasi tujuan]
```

---

## 7. Kebutuhan Fungsional

Prioritas: **P0** = wajib di MVP, **P1** = rilis berikutnya, **P2** = nanti/opsional.

### 7.1 Akses & Autentikasi

Karena hanya di LAN, login dibuat seringan mungkin: **scan QR = langsung masuk**. Tapi tetap ada, supaya tidak semua orang yang tersambung ke Wi-Fi yang sama bisa upload (lihat bagian 9).

| ID | Kebutuhan | Prioritas |
|---|---|---|
| FR-1 | Saat dijalankan, server menampilkan URL akses (IP LAN) dan **QR code** di terminal. | P0 |
| FR-2 | QR/URL berisi **token akses** acak (dibuat ulang setiap server start). Membuka URL itu langsung membuat sesi, tanpa mengetik apa pun. | P0 |
| FR-3 | **PIN 6 digit** yang tampil di terminal sebagai cara masuk alternatif jika mengetik URL manual. | P0 |
| FR-4 | Sesi memakai cookie `HttpOnly`, `SameSite=Strict`, berlaku sampai server di-restart atau batas waktu yang bisa diatur. | P0 |
| FR-5 | Rate limit percobaan PIN (mis. 5 percobaan/menit per IP). | P0 |
| FR-6 | Opsi `auth: off` di konfigurasi untuk jaringan rumah yang sepenuhnya dipercaya (default: **on**). Saat off, terminal menampilkan peringatan. | P1 |
| FR-7 | Daftar perangkat yang sedang terhubung + tombol cabut sesi (di terminal atau halaman admin di localhost). | P2 |
| FR-8 | Akun tamu dengan hak "upload saja" ke folder tertentu. | P2 |

### 7.2 Pemilihan Folder Tujuan

| ID | Kebutuhan | Prioritas |
|---|---|---|
| FR-10 | Admin mendefinisikan daftar **root folder yang diizinkan** di file konfigurasi; masing-masing punya nama tampilan. | P0 |
| FR-11 | Pengguna hanya melihat root yang diizinkan, **tidak pernah** melihat path asli di luar root. | P0 |
| FR-12 | Menjelajah subfolder (breadcrumb + daftar folder), hanya folder yang ditampilkan (file opsional/tidak ditampilkan). | P0 |
| FR-13 | Membuat folder baru di lokasi saat ini, dengan validasi nama. | P0 |
| FR-14 | Menampilkan sisa ruang disk pada root yang dipilih. | P1 |
| FR-15 | Folder favorit dan "tujuan terakhir" (disimpan per perangkat). | P1 |
| FR-16 | Pencarian nama folder dalam root. | P2 |
| FR-17 | Root bisa ditandai *read-only browse* atau disembunyikan sementara tanpa restart. | P2 |

### 7.3 Upload

| ID | Kebutuhan | Prioritas |
|---|---|---|
| FR-20 | Pilih banyak file via tombol dan **drag & drop**. | P0 |
| FR-21 | Upload di-*stream* langsung ke disk (tidak ditampung di RAM). | P0 |
| FR-22 | Progress per file + total: persen, kecepatan, estimasi sisa waktu. | P0 |
| FR-23 | Batalkan per file / batalkan semua. | P0 |
| FR-24 | File ditulis dulu sebagai file sementara (`.part`) di folder tujuan, lalu di-*rename* saat selesai, sehingga tidak ada file setengah jadi dengan nama asli. | P0 |
| FR-25 | Kebijakan konflik nama: **rename otomatis** `nama (1).ext` (default), timpa, atau lewati. Dipilih per sesi upload. | P0 |
| FR-26 | Batas ukuran file maksimal (bisa diatur), ditolak dengan pesan jelas. | P0 |
| FR-27 | Cek ruang disk sebelum mulai; tolak jika tidak cukup. | P0 |
| FR-28 | Upload paralel terbatas (default 3 file bersamaan). | P1 |
| FR-29 | **Upload yang bisa dilanjutkan** untuk file besar atau koneksi tidak stabil. Jika layar HP terkunci atau Wi-Fi putus, upload dijeda dan otomatis lanjut dari posisi terakhir. ✅ Sudah dibuat (v0.4). | P0 |
| FR-30 | Upload satu folder utuh dengan mempertahankan struktur subfolder. | P1 |
| FR-31 | Blokir ekstensi tertentu (mis. `.exe`, `.bat`, `.ps1`) jika diaktifkan di konfigurasi. | P1 |
| FR-32 | Verifikasi integritas (checksum SHA-256) opsional setelah upload. | P2 |
| FR-33 | Paste dari clipboard (gambar/teks) langsung jadi file. | P2 |

### 7.4 Riwayat & Log

| ID | Kebutuhan | Prioritas |
|---|---|---|
| FR-40 | Log server: waktu, IP, nama file, ukuran, path tujuan, status. | P0 |
| FR-41 | Halaman riwayat upload di web (50 terakhir). | P1 |
| FR-42 | Notifikasi desktop di PC server saat ada file masuk. | P2 |

---

## 8. Kebutuhan Non-Fungsional

| Kategori | Target |
|---|---|
| **Performa** | Kecepatan upload di LAN ≥ 80% kecepatan jaringan. Pemakaian RAM server tetap rendah (< 150 MB) berapa pun ukuran file. |
| **Ukuran file** | Mendukung file minimal 20 GB per file. |
| **Keandalan** | Koneksi putus tidak meninggalkan file rusak dengan nama asli. File `.part` yang terbengkalai dibersihkan otomatis (mis. > 24 jam). |
| **Kompatibilitas browser** | Chrome, Edge, Firefox, Safari (iOS & macOS) — 2 versi terbaru. |
| **Responsif** | Nyaman dipakai di layar HP (≥ 360 px) sampai desktop. |
| **OS server** | Windows 10/11 (utama), Linux, macOS. |
| **Runtime** | Node.js LTS (minimal v20, disarankan LTS terbaru). |
| **Instalasi** | `npm install` + `npm start` + satu file konfigurasi. Paket satu file `.exe` menyusul. |
| **Aksesibilitas** | Bisa dipakai dengan keyboard; kontras warna memadai; teks status dibaca screen reader. |
| **Bahasa** | Antarmuka Bahasa Indonesia (Inggris opsional). |

---

## 9. Keamanan (Wajib)

Aplikasi ini pada dasarnya memberi **akses tulis ke filesystem komputer lewat jaringan**. Bagian ini adalah yang paling kritis.

### 9.1 Model Jaringan & Asumsi

- yshare berjalan di PC pemilik dan **hanya melayani perangkat di Wi-Fi/LAN yang sama**.
- Server tidak bisa di-*bind* hanya ke `localhost`/`127.0.0.1`, karena dengan begitu HP tidak bisa mengakses. Server *listen* di IP LAN (atau `0.0.0.0`), lalu **membatasi siapa yang dilayani** lewat pengecekan di bawah.
- "Satu jaringan" **tidak sama dengan "semua perangkat terpercaya"**: tamu yang tahu password Wi-Fi, Wi-Fi kos/kampus/kafe, perangkat IoT, atau website jahat yang dibuka di browser perangkat yang tersambung bisa ikut mengakses. Karena itu tetap ada token/PIN dan pengecekan `Origin`/`Host`, tapi dibuat seringan mungkin.

### 9.2 Ancaman & Mitigasi

| # | Ancaman | Mitigasi | Prioritas |
|---|---|---|---|
| S-1 | **Path traversal** (`../../Windows/System32`) — bisa terjadi karena bug, bukan karena jaringan | Klien hanya mengirim `rootId` + path relatif. Server menggabungkan, menormalkan, me-*resolve* path asli (termasuk symlink/junction), lalu **menolak jika hasilnya tidak berada di dalam root**. Ditolak juga: path absolut, `..`, drive letter (`C:`), UNC (`\\server\share`), dan *alternate data stream* (`file.txt:stream`). | P0 |
| S-2 | Nama file berbahaya | **Jangan pernah memakai `filename` dari klien langsung sebagai path.** Sanitasi: buang karakter `< > : " / \ | ? *` dan karakter kontrol, tolak nama khusus Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`), buang spasi/titik di akhir, batasi panjang nama (255) dan path total. | P0 |
| S-3 | Akses dari luar LAN | Server **menolak request dari IP non-privat**: hanya `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`. Terminal memberi peringatan jika mendeteksi IP publik di interface. | P0 |
| S-4 | Orang lain di Wi-Fi yang sama | Token di QR + PIN (FR-2, FR-3). Token dibuat ulang setiap start. | P0 |
| S-5 | **Website jahat menyerang server lokal** lewat browser korban (CSRF, *DNS rebinding*) | Tolak request jika header `Host` bukan IP LAN/`localhost` server ini. Tolak request yang mengubah data jika `Origin` tidak sama dengan origin yang diizinkan. Cookie `SameSite=Strict`. Tanpa CORS. | P0 |
| S-6 | Brute force PIN | Rate limit + jeda bertahap + log percobaan gagal. | P0 |
| S-7 | Disk penuh / DoS | Batas ukuran per file, cek ruang disk, batas upload bersamaan. | P0 |
| S-8 | Windows Firewall | Saat pertama dijalankan, izinkan Node.js **hanya untuk jaringan *Private***, bukan *Public*. Dicantumkan di README dan diingatkan di terminal. | P0 |
| S-9 | Informasi bocor | Pesan error ke klien tidak menampilkan path asli server atau stack trace. | P0 |
| S-10 | File yang bisa dieksekusi | Blokir ekstensi opsional; file yang diupload tidak pernah dieksekusi atau disajikan kembali oleh server di MVP. | P1 |
| S-11 | Penyadapan di Wi-Fi | HTTP biasa diterima untuk LAN rumah. HTTPS dengan sertifikat lokal opsional untuk jaringan yang kurang terpercaya. | P2 |

---

## 10. Konfigurasi (contoh)

```yaml
# yshare.config.yaml
server:
  host: 0.0.0.0        # listen di interface LAN (bukan hanya localhost, agar HP bisa akses)
  port: 8080
  lan_only: true       # tolak request dari IP non-privat
  https: false         # opsional (P2)

auth:
  enabled: true        # false hanya untuk jaringan rumah yang dipercaya (P1)
  session_ttl: 12h     # token & PIN dibuat otomatis setiap server start

roots:
  - id: dokumen
    name: "Dokumen"
    path: "D:\\Dokumen"
  - id: foto
    name: "Foto HP"
    path: "D:\\Foto"
  - id: proyek
    name: "Proyek"
    path: "E:\\Proyek"

upload:
  max_file_size: 20GB
  conflict_default: rename     # rename | overwrite | skip
  parallel: 3
  blocked_extensions: []       # contoh: [".exe", ".bat", ".ps1"]
  stale_part_cleanup: 24h
```

---

## 11. Rancangan API (draft)

Semua endpoint di bawah `/api`, wajib sesi kecuali endpoint masuk. Semua request melewati pengecekan IP LAN, `Host`, dan `Origin` (bagian 9).

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/t/{token}` | Masuk lewat link QR: buat sesi lalu redirect ke `/` |
| `POST` | `/api/auth/pin` | Masuk dengan PIN, set cookie sesi |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/roots` | Daftar root yang diizinkan (`id`, `name`, sisa ruang) |
| `GET` | `/api/folders?root={id}&path={rel}` | Daftar subfolder di path relatif |
| `POST` | `/api/folders` | Buat folder baru `{ root, path, name }` |
| `POST` | `/api/uploads` | Mulai upload `{ root, path, name, size, lastModified, conflict }`. File yang sama ke folder yang sama → melanjutkan sesi lama. `skip` diputuskan di sini, sebelum data dikirim |
| `PATCH` | `/api/uploads/{id}` | Kirim byte mulai dari header `Upload-Offset`. Byte yang sudah diterima tetap disimpan walau koneksi putus |
| `GET` | `/api/uploads/{id}` | Offset saat ini (untuk melanjutkan). Menghentikan request lama yang masih menggantung |
| `DELETE` | `/api/uploads/{id}` | Batalkan dan hapus file `.part` |
| `GET` | `/api/history` | Riwayat upload — P1 |

Contoh respons sukses upload:

```json
{
  "saved": [
    { "original": "IMG_001.jpg", "storedAs": "IMG_001 (1).jpg", "size": 3481920 }
  ],
  "skipped": [],
  "failed": []
}
```

---

## 12. Rancangan UI (wireframe kasar)

```
┌───────────────────────────────────────────────┐
│ yshare                              [Keluar]  │
├───────────────────────────────────────────────┤
│ Tujuan:  Foto HP › 2026 › Liburan Bali        │
│ ┌─────────────────────────────────────────┐   │
│ │ 📁 ..                                    │   │
│ │ 📁 Hari-1                                │   │
│ │ 📁 Hari-2                                │   │
│ │ [+ Folder baru]          Sisa: 412 GB    │   │
│ └─────────────────────────────────────────┘   │
│                                               │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │
│   Tarik file ke sini atau [Pilih file]        │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │
│ Jika nama sama: (•) Ganti nama ( ) Timpa ( ) Lewati │
│                                               │
│ Antrean (3/12)                 [Batal semua]  │
│ VID_0012.mp4  ███████░░░  72%  48 MB/s  [x]   │
│ IMG_0201.jpg  ██████████  ✓ selesai           │
│ IMG_0202.jpg  ░░░░░░░░░░  menunggu       [x]  │
└───────────────────────────────────────────────┘
```

Prinsip UI:
- **Folder tujuan selalu terlihat jelas** sebelum dan selama upload, supaya tidak salah tempat.
- Tombol besar dan area drop luas untuk layar sentuh.
- Status akhir jelas: berapa berhasil, gagal, dan disimpan dengan nama apa.

---

## 13. Arsitektur & Teknologi

```
          Wi-Fi / LAN yang sama
[Browser HP/Laptop] ──HTTP──▶ [server.ts (Node http)] ──▶ [Next.js: UI + route handler] ──▶ [Filesystem: root yang diizinkan]
   UI (React)                    1. cek IP LAN, Host, Origin      3. cek sesi (token/PIN)
   XHR PUT + progress            2. tampilkan QR + PIN            4. validasi path & nama file
                                                                  5. stream ke .part → rename
```

**Stack: Next.js 16 (App Router) + TypeScript + custom server.**

| Kebutuhan | Pilihan | Catatan |
|---|---|---|
| Runtime | Node.js ≥ 20.9 | Diuji di Node 22 |
| Framework | Next.js 16 + React 19, Tailwind CSS 4 | UI dan API dalam satu project |
| Custom server | `server.ts` dijalankan dengan `tsx` | Filter IP/`Host`/`Origin` sebelum request masuk ke Next.js, QR + PIN di terminal, `requestTimeout` dimatikan agar upload panjang tidak terputus |
| Upload | Protokol resumable sendiri (mirip tus, lebih sederhana): `POST` buat sesi, `PATCH` kirim byte dari offset | `request.body` → `Readable.fromWeb` → tulis ke `.part` di posisi offset → `rename` saat lengkap. Sesi bertahan 24 jam; hilang saat server restart |
| Ketahanan koneksi | Browser: deteksi macet 30 dtk, coba ulang bertahap (1–30 dtk), lanjut segera saat layar dibuka (`visibilitychange`) / online lagi. Server: request tanpa data 60 dtk dianggap putus | Layar HP yang terkunci menghentikan request; upload lanjut dari posisi terakhir saat layar dibuka |
| Layar tetap menyala | Screen Wake Lock API | Hanya tersedia di HTTPS/localhost, jadi di HP lewat HTTP LAN biasanya tidak aktif |
| Sesi | Cookie `HttpOnly` + `SameSite=Strict`, disimpan di memori | Hilang saat server restart (disengaja) |
| Konfigurasi | `yaml` + `zod` | Divalidasi saat start, pesan error berbahasa Indonesia |
| QR di terminal | `qrcode` | |
| Sisa ruang disk | `fs.statfs` (bawaan Node) | |
| Test | `vitest` | Validasi path (termasuk junction ke luar root) dan filter jaringan |

Keputusan penting:
- **Tanpa `proxy.ts` (middleware).** Jika ada proxy, Next.js menahan body request di memori dan memotongnya di 10 MB tanpa error. Semua pengecekan keamanan dilakukan di `server.ts`.
- **Body mentah per file, bukan multipart.** Tidak perlu parser, byte langsung ditulis ke disk, dan progress per file jadi sederhana.
- **State bersama lewat `globalThis`.** `server.ts` (dijalankan tsx) dan route handler (dibundel Next.js) memuat salinan modul yang berbeda, jadi token, PIN, sesi, dan reservasi nama file disimpan di `globalThis`.
- **IP klien dari socket.** `server.ts` menimpa header `x-yshare-ip` dengan alamat socket asli, jadi klien tidak bisa memalsukannya.

Hasil uji (9 Nov 2026, Windows 11, localhost):
- Upload 1 GB di mode production: 140 MB/dtk, RAM server tetap ±150 MB, isi file identik.
- Upload dibatalkan di tengah: file `.part` terhapus dalam ±2 detik.
- Di mode development, RAM naik sekitar 1 GB selama upload (perilaku Turbopack dev, tidak terjadi di production).

Catatan Windows:
- Windows Firewall: izinkan Node.js hanya untuk jaringan *Private*.
- `rename` yang menimpa file yang sedang dibuka program lain gagal dengan `EPERM`/`EBUSY`, dan dilaporkan ke pengguna sebagai "file sedang dipakai".
- Agar jalan otomatis saat Windows menyala (opsional): Task Scheduler atau `pm2`.

---

## 14. Metrik Keberhasilan

| Metrik | Target |
|---|---|
| Waktu dari buka web sampai upload mulai | < 15 detik (dengan QR + sesi tersimpan) |
| Tingkat keberhasilan upload di LAN | ≥ 99% |
| File yang tertulis di luar root yang diizinkan | **0** (diuji dengan test path traversal) |
| Kecepatan upload di Wi-Fi 5/6 | ≥ 80% kecepatan jaringan |

---

## 15. Rencana Rilis

| Milestone | Isi | Perkiraan |
|---|---|---|
| **M1 — MVP** | Semua P0: QR + token/PIN, filter LAN/`Host`/`Origin`, root whitelist, jelajah & buat folder, upload multi-file streaming, progress, konflik nama, log. | 1–2 minggu |
| **M2** | P1: resumable upload, upload folder, paralel, sisa ruang disk, favorit, riwayat, opsi `auth: off`, blokir ekstensi. | +1–2 minggu |
| **M3** | P2: akun tamu, checksum, paste clipboard, notifikasi desktop, pencarian folder. | sesuai kebutuhan |

---

## 16. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Celah path traversal / salah validasi | Kritis — file bisa ditulis ke folder sistem | Satu fungsi validasi terpusat + unit test kasus jahat (`..`, `C:\`, UNC, symlink/junction, ADS, nama reserved). |
| PC tersambung ke Wi-Fi umum (kos, kampus, kafe) | Tinggi — orang asing satu jaringan | Token/PIN tetap wajib secara default; firewall hanya mengizinkan profil jaringan *Private*. |
| Website jahat menembak server lokal lewat browser | Tinggi | Cek `Host` + `Origin`, cookie `SameSite=Strict`, tanpa CORS. |
| Port tidak sengaja terbuka ke internet (port forwarding/UPnP router) | Kritis | Server tetap menolak IP non-privat (`lan_only: true`). |
| Upload besar dari HP sering putus (layar mati/pindah aplikasi) | Sedang | ✅ Resumable upload + lanjut otomatis saat layar dibuka. Browser tidak bisa upload saat layar terkunci, jadi upload hanya berjalan saat layar menyala. |
| Wi-Fi buruk (latency ratusan ms, packet loss) membuat upload sangat lambat | Tinggi | Bukan masalah aplikasi. Pakai 5 GHz / dekat router, atau hotspot langsung PC↔HP. Lihat README bagian "Upload lambat?". |
| Safari iOS punya batasan (mis. upload di background) | Sedang | Uji khusus di iOS, tampilkan peringatan yang jelas. |
| Disk penuh di tengah upload | Sedang | Cek ruang di awal, hapus `.part` saat gagal. |
| Timpa file penting tanpa sengaja | Sedang | Default **rename**, opsi timpa butuh pilihan eksplisit. |

---

## 17. Pertanyaan Terbuka

**Sudah diputuskan:**
- ✅ Cakupan jaringan: **hanya LAN / Wi-Fi yang sama**, tanpa akses internet.
- ✅ Stack: **Next.js 16** + TypeScript, dengan custom server.

**Masih terbuka:**
1. Satu pengguna saja, atau perlu akun tamu sejak awal?
2. Perlu fitur **download / lihat isi folder** juga, atau murni upload?
3. Ukuran file terbesar yang realistis dipakai (foto, video 4K, backup)?
4. Apakah server perlu jalan otomatis saat Windows menyala (service / startup)?
5. Folder mana saja yang akan dijadikan root awal?

---

## 18. Catatan & Pendapat

1. **Keamanan adalah fitur utama, bukan tambahan.** Web yang bisa menulis ke folder komputer itu setara dengan memberi orang akses tulis ke PC. Tiga hal yang tidak boleh ditawar sejak MVP: **whitelist root folder** (bukan bebas memilih seluruh drive), validasi path terpusat yang diuji, dan token/PIN ringan.
   - **Membatasi ke LAN itu keputusan tepat** dan membuat banyak hal lebih sederhana (tanpa HTTPS, tanpa password panjang, tanpa reverse proxy). Tapi "satu Wi-Fi" bukan jaminan aman: Wi-Fi bisa dipakai tamu atau orang asing (kos, kampus, kafe), dan website jahat yang dibuka di browser bisa mengirim request ke server lokal. Karena itu login tetap ada, tapi cukup scan QR, dan server mengecek IP, `Host`, serta `Origin`. Path traversal juga tetap harus dicegah, karena itu soal bug di kode, bukan soal siapa yang terhubung.
2. **Batasi pilihan folder ke root yang ditentukan admin.** Memberi pengguna akses menjelajah seluruh `C:\` memang terlihat praktis, tapi berisiko dan membingungkan. Whitelist root + bebas menjelajah di dalamnya sudah cukup fleksibel.
3. **Streaming ke disk + file `.part` + rename** sejak hari pertama. Ini murah dibuat di awal tapi mahal kalau ditambahkan belakangan, dan langsung mencegah dua masalah terbesar: RAM habis untuk file besar dan file rusak saat koneksi putus.
4. **Default kebijakan konflik = rename otomatis.** Kehilangan file lama karena tertimpa jauh lebih buruk daripada punya file `(1)`.
5. **Tahan diri dari fitur file manager** (hapus, rename, pindah) di versi awal. Fitur hapus lewat web menambah risiko besar dengan manfaat kecil untuk kasus "kirim file ke PC".
6. **QR code di terminal** adalah fitur kecil dengan dampak besar untuk pemakaian dari HP — layak masuk MVP.
7. **Pertimbangkan alternatif yang sudah ada** sebelum membangun: *File Browser*, *copyparty*, *LocalSend*, *PairDrop*. Jika kebutuhannya hanya pribadi, salah satunya mungkin sudah cukup. Membangun sendiri tetap masuk akal jika ingin UI yang fokus (pilih folder → upload), kontrol penuh atas keamanan, atau sebagai proyek belajar — dan scope MVP di atas cukup kecil untuk diselesaikan dalam 1–2 minggu.
