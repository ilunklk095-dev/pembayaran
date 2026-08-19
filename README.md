# SchoolPay — Aplikasi Pembayaran Sekolah

Aplikasi pembayaran sekolah berbasis HTML, CSS, dan JavaScript murni.
Frontend di-host di GitHub Pages, sedangkan login dan database memakai Firebase Authentication + Cloud Firestore.

## Fitur

- Login admin/petugas dengan Firebase Authentication.
- Role `admin` dan `petugas`.
- Dashboard total siswa, pemasukan bulan berjalan, tunggakan, dan tagihan belum lunas.
- Data siswa: tambah, edit, cari, filter kelas, aktif/nonaktif.
- Tagihan per siswa dan tagihan massal per kelas/semua siswa.
- Pembayaran penuh atau sebagian.
- Update status tagihan otomatis: belum bayar / sebagian / lunas.
- Riwayat transaksi.
- Nomor kwitansi otomatis dan cetak bukti pembayaran.
- Laporan per rentang tanggal.
- Export laporan ke CSV (bisa dibuka di Excel).
- Pengaturan identitas sekolah.
- Desain responsif desktop/tablet/HP.
- Firestore Security Rules berbasis role.

---

## Struktur Folder

```text
aplikasi-pembayaran-sekolah/
├── index.html
├── .nojekyll
├── firestore.rules
├── README.md
├── css/
│   └── style.css
└── js/
    ├── firebase-config.js
    └── app.js
```

---

# A. Membuat Firebase

## 1. Buat Project
1. Masuk ke Firebase Console.
2. Klik **Create a project**.
3. Buat project baru.

## 2. Tambahkan Web App
1. Project settings.
2. Pada **Your apps**, pilih ikon Web `</>`.
3. Register app.
4. Salin `firebaseConfig`.
5. Buka `js/firebase-config.js`.
6. Ganti semua nilai `GANTI_DENGAN_...` dengan config milik Anda.

Contoh bentuknya:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "project-anda.firebaseapp.com",
  projectId: "project-anda",
  storageBucket: "project-anda.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

> Firebase web config boleh berada di frontend. Keamanan database tidak bergantung pada menyembunyikan config, tetapi pada Authentication dan Security Rules.

---

# B. Aktifkan Authentication

1. Firebase Console → **Authentication**.
2. Klik **Get started**.
3. Buka **Sign-in method**.
4. Aktifkan **Email/Password**.

## Buat akun admin pertama
1. Authentication → **Users** → **Add user**.
2. Masukkan email dan password.
3. Setelah akun dibuat, salin **User UID**.

Contoh:
```text
UID: abc123xyz
Email: admin@sekolah.sch.id
```

---

# C. Buat Cloud Firestore

1. Firebase Console → **Firestore Database**.
2. Klik **Create database**.
3. Pilih lokasi database.
4. Setelah database aktif, buka tab **Rules**.
5. Copy seluruh isi file `firestore.rules`.
6. Paste ke Rules.
7. Klik **Publish**.

JANGAN menggunakan rule produksi seperti:
```text
allow read, write: if true;
```

---

# D. Membuat Role Admin Pertama

Ini langkah yang paling penting.

Karena aplikasi memeriksa role dari Firestore, Anda harus membuat dokumen profil untuk akun admin.

1. Firestore → tab **Data**.
2. Start collection.
3. Collection ID:
```text
users
```
4. Document ID = UID akun admin yang sudah Anda copy.

Contoh:
```text
abc123xyz
```

5. Tambahkan field:

| Field | Type | Value |
|---|---|---|
| name | string | Administrator |
| role | string | admin |
| email | string | admin@sekolah.sch.id |

Simpan.

Untuk petugas/kasir, buat akun lain di Authentication lalu dokumen `users/{UID}`:

```text
name: Petugas TU
role: petugas
email: petugas@sekolah.sch.id
```

Role harus ditulis persis:
```text
admin
```
atau
```text
petugas
```

---

# E. Authorized Domain untuk GitHub Pages

Jika URL GitHub Pages Anda misalnya:

```text
https://namagithub.github.io/pembayaran-sekolah/
```

Buka:
**Firebase Console → Authentication → Settings → Authorized domains**

Tambahkan:

```text
namagithub.github.io
```

Jangan menambahkan `/pembayaran-sekolah/`, cukup domainnya.

---

# F. Upload ke GitHub

Buat repository, misalnya:

```text
pembayaran-sekolah
```

Upload semua file/folder **dengan susunan yang sama**:

```text
index.html
.nojekyll
firestore.rules
README.md
css/style.css
js/firebase-config.js
js/app.js
```

Jangan meletakkan `index.html` di folder lain jika Pages menggunakan root repository.

---

# G. Aktifkan GitHub Pages

1. Buka repository GitHub.
2. **Settings**.
3. **Pages**.
4. Pada **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
5. Klik **Save**.

Alamat biasanya menjadi:

```text
https://USERNAME.github.io/NAMA-REPOSITORY/
```

---

# H. Urutan Penggunaan Aplikasi

1. Login sebagai admin.
2. Buka **Pengaturan** → isi identitas sekolah.
3. Buka **Data Siswa** → tambah siswa.
4. Buka **Tagihan**.
5. Buat tagihan satu siswa atau **Tagihan Massal**.
6. Masuk ke **Pembayaran**.
7. Pilih siswa.
8. Pilih tagihan.
9. Masukkan nominal.
10. Simpan.
11. Cetak kwitansi jika diperlukan.
12. Buka **Laporan** untuk rekap dan export CSV.

---

# Koleksi Firestore yang Dibuat

```text
users/
students/
bills/
payments/
settings/
```

Dokumen pengaturan sekolah:

```text
settings/school
```

---

# Catatan Keamanan

- Jangan simpan password admin di file JavaScript.
- Jangan membuat login dengan password hard-coded.
- Jangan gunakan Firestore `allow read, write: if true` untuk aplikasi nyata.
- Akun petugas tidak diberi izin menghapus siswa atau tagihan.
- Pembayaran dari petugas hanya boleh membuat transaksi dan mengubah field status pembayaran pada tagihan.
- Untuk sekolah besar / transaksi finansial yang sangat sensitif, arsitektur ideal berikutnya adalah backend terpercaya (Cloud Functions/server) untuk audit yang lebih ketat.

---

# Jika Login Berhasil Tetapi Langsung Keluar Lagi

Biasanya penyebabnya adalah dokumen role belum dibuat.

Pastikan ada:

```text
Firestore
└── users
    └── UID_AKUN
        ├── name: "Administrator"
        ├── role: "admin"
        └── email: "admin@sekolah.sch.id"
```

Document ID harus sama persis dengan UID dari Firebase Authentication.

---

# Jika Muncul "Missing or insufficient permissions"

Periksa:
1. `firestore.rules` sudah di-publish.
2. Akun sedang login.
3. Dokumen `users/{UID}` ada.
4. Field `role` bernilai `admin` atau `petugas`.
5. UID dokumen sama dengan UID Authentication.

---

# Jika GitHub Pages 404

Pastikan:
- `index.html` ada di root.
- Branch Pages = `main`.
- Folder Pages = `/(root)`.
- File sudah di-commit/push.
- Repository Pages sudah selesai deploy.

