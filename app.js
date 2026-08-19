import { auth, db } from "./firebase-config.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

/* =========================
   STATE
========================= */
const state = {
  user: null,
  profile: null,
  settings: {
    schoolName: "SchoolPay",
    address: "",
    phone: "",
    academicYear: "",
    principal: "",
    receiptPrefix: "BYR"
  },
  students: [],
  bills: [],
  payments: [],
  unsubscribers: [],
  reportPayments: []
};

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

const els = {
  loginView: $("#loginView"),
  appView: $("#appView"),
  loginForm: $("#loginForm"),
  loginEmail: $("#loginEmail"),
  loginPassword: $("#loginPassword"),
  loginBtn: $("#loginBtn"),
  loginMessage: $("#loginMessage"),
  togglePassword: $("#togglePassword"),
  logoutBtn: $("#logoutBtn"),
  sidebar: $("#sidebar"),
  sidebarBackdrop: $("#sidebarBackdrop"),
  openSidebar: $("#openSidebar"),
  closeSidebar: $("#closeSidebar"),
  pageTitle: $("#pageTitle"),
  todayText: $("#todayText"),
  modalRoot: $("#modalRoot"),
  modalTitle: $("#modalTitle"),
  modalSubtitle: $("#modalSubtitle"),
  modalBody: $("#modalBody"),
  toastRoot: $("#toastRoot")
};

const pageTitles = {
  dashboard: ["Dashboard", "Ringkasan kondisi pembayaran sekolah"],
  students: ["Data Siswa", "Kelola data siswa dan kelas"],
  bills: ["Tagihan", "Kelola tagihan dan status pembayaran"],
  payments: ["Pembayaran", "Catat transaksi pembayaran siswa"],
  reports: ["Laporan", "Rekap transaksi dan tunggakan"],
  settings: ["Pengaturan", "Identitas dan konfigurasi sekolah"]
};

/* =========================
   HELPERS
========================= */
function formatRupiah(value = 0) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "short", year: "numeric"
  }).format(d);
}

function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function monthStartISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function normalize(value = "") {
  return String(value).toLowerCase().trim();
}

function toast(message, type = "success") {
  const div = document.createElement("div");
  div.className = `toast ${type}`;
  div.textContent = message;
  els.toastRoot.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

function setButtonLoading(button, loading, text = "Memproses...") {
  if (!button) return;
  if (loading) {
    button.dataset.oldText = button.textContent;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.oldText || button.textContent;
  }
}

function roleIsAdmin() {
  return state.profile?.role === "admin";
}

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function receiptNumber(payment) {
  const prefix = state.settings.receiptPrefix || "BYR";
  const compactDate = (payment.date || todayISO()).replaceAll("-", "");
  return payment.receiptNo || `${prefix}-${compactDate}-${(payment.id || "000000").slice(0, 6).toUpperCase()}`;
}

function billStatus(bill) {
  const amount = cleanNumber(bill.amount);
  const paid = cleanNumber(bill.paid);
  if (paid >= amount && amount > 0) return "lunas";
  if (paid > 0) return "sebagian";
  return "belum";
}

function statusBadge(status) {
  const map = {
    lunas: ["success", "Lunas"],
    sebagian: ["warning", "Sebagian"],
    belum: ["danger", "Belum bayar"],
    aktif: ["success", "Aktif"],
    nonaktif: ["neutral", "Nonaktif"]
  };
  const [cls, label] = map[status] || ["neutral", status || "-"];
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function emptyRow(colspan, text = "Belum ada data.") {
  return `<tr class="empty-row"><td colspan="${colspan}">${escapeHtml(text)}</td></tr>`;
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarBackdrop.classList.remove("show");
}

function closeModal() {
  els.modalRoot.classList.add("hidden");
  els.modalBody.innerHTML = "";
}

function openModal(title, subtitle, html) {
  els.modalTitle.textContent = title;
  els.modalSubtitle.textContent = subtitle || "";
  els.modalBody.innerHTML = html;
  els.modalRoot.classList.remove("hidden");
  const first = els.modalBody.querySelector("input,select,textarea");
  setTimeout(() => first?.focus(), 60);
}

function setPage(page) {
  if (page === "settings" && !roleIsAdmin()) return;
  $$(".page").forEach(p => p.classList.remove("active"));
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === page));
  $(`#page-${page}`)?.classList.add("active");
  const [title, desc] = pageTitles[page] || ["SchoolPay", ""];
  els.pageTitle.textContent = title;
  els.todayText.textContent = desc;
  closeSidebar();
  if (page === "reports") renderReports();
}

function currentStudent(id) {
  return state.students.find(s => s.id === id);
}

function currentBill(id) {
  return state.bills.find(b => b.id === id);
}

function sortByName(a, b) {
  return (a.name || "").localeCompare(b.name || "", "id", { sensitivity: "base" });
}

/* =========================
   AUTH
========================= */
els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginMessage.textContent = "";
  setButtonLoading(els.loginBtn, true, "Masuk...");
  try {
    await signInWithEmailAndPassword(auth, els.loginEmail.value.trim(), els.loginPassword.value);
  } catch (err) {
    console.error(err);
    const friendly = {
      "auth/invalid-credential": "Email atau password salah.",
      "auth/user-disabled": "Akun ini dinonaktifkan.",
      "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi beberapa saat."
    };
    els.loginMessage.textContent = friendly[err.code] || `Login gagal: ${err.message}`;
  } finally {
    setButtonLoading(els.loginBtn, false);
  }
});

els.togglePassword.addEventListener("click", () => {
  const isPassword = els.loginPassword.type === "password";
  els.loginPassword.type = isPassword ? "text" : "password";
  els.togglePassword.textContent = isPassword ? "🙈" : "👁";
});

els.logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  cleanupListeners();
  state.user = user;

  if (!user) {
    state.profile = null;
    els.appView.classList.add("hidden");
    els.loginView.classList.remove("hidden");
    return;
  }

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (!profileSnap.exists()) {
      throw new Error(
        `Akun berhasil login, tetapi dokumen users/${user.uid} belum dibuat di Firestore. ` +
        `Buat dokumen tersebut dengan field name dan role (admin/petugas).`
      );
    }

    state.profile = { id: profileSnap.id, ...profileSnap.data() };
    if (!["admin", "petugas"].includes(state.profile.role)) {
      throw new Error("Role akun harus 'admin' atau 'petugas'.");
    }

    els.loginView.classList.add("hidden");
    els.appView.classList.remove("hidden");
    applyProfileToUI();
    startRealtimeData();
    setPage("dashboard");
  } catch (err) {
    console.error(err);
    els.loginMessage.textContent = err.message;
    toast(err.message, "error");
    await signOut(auth);
  }
});

function applyProfileToUI() {
  const name = state.profile?.name || state.user?.email || "Pengguna";
  const role = state.profile?.role || "-";
  const initial = name.charAt(0).toUpperCase();

  $("#sidebarUserName").textContent = name;
  $("#sidebarUserRole").textContent = role;
  $("#topUserName").textContent = name;
  $("#topUserRole").textContent = role;
  $("#userAvatar").textContent = initial;
  $("#topAvatar").textContent = initial;

  $$(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !roleIsAdmin());
  });
}

/* =========================
   REALTIME DATA
========================= */
function cleanupListeners() {
  state.unsubscribers.forEach(fn => {
    try { fn(); } catch {}
  });
  state.unsubscribers = [];
}

function startRealtimeData() {
  const settingsUnsub = onSnapshot(doc(db, "settings", "school"), snap => {
    if (snap.exists()) state.settings = { ...state.settings, ...snap.data() };
    applySettingsToUI();
    renderAll();
  }, handleSnapshotError);

  const studentsUnsub = onSnapshot(
    query(collection(db, "students"), orderBy("name")),
    snap => {
      state.students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAll();
    },
    handleSnapshotError
  );

  const billsUnsub = onSnapshot(
    collection(db, "bills"),
    snap => {
      state.bills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAll();
    },
    handleSnapshotError
  );

  const paymentsUnsub = onSnapshot(
    collection(db, "payments"),
    snap => {
      state.payments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      renderAll();
    },
    handleSnapshotError
  );

  state.unsubscribers.push(settingsUnsub, studentsUnsub, billsUnsub, paymentsUnsub);
}

function handleSnapshotError(err) {
  console.error(err);
  toast(`Gagal membaca Firestore: ${err.message}`, "error");
}

function applySettingsToUI() {
  const name = state.settings.schoolName || "SchoolPay";
  $("#sideSchoolName").textContent = name;
  document.title = `${name} - Pembayaran Sekolah`;

  if ($("#settingSchoolName")) {
    $("#settingSchoolName").value = state.settings.schoolName || "";
    $("#settingAddress").value = state.settings.address || "";
    $("#settingPhone").value = state.settings.phone || "";
    $("#settingAcademicYear").value = state.settings.academicYear || "";
    $("#settingPrincipal").value = state.settings.principal || "";
    $("#settingReceiptPrefix").value = state.settings.receiptPrefix || "BYR";
  }
}

function renderAll() {
  renderDashboard();
  renderStudents();
  renderBills();
  renderPaymentSelectors();
  renderPayments();
  renderReports();
}

/* =========================
   DASHBOARD
========================= */
function renderDashboard() {
  const activeStudents = state.students.filter(s => s.status !== "nonaktif");
  const currentMonth = todayISO().slice(0, 7);

  const monthIncome = state.payments
    .filter(p => (p.date || "").startsWith(currentMonth))
    .reduce((sum, p) => sum + cleanNumber(p.amount), 0);

  const arrears = state.bills.reduce((sum, b) => {
    const remaining = Math.max(0, cleanNumber(b.amount) - cleanNumber(b.paid));
    return sum + remaining;
  }, 0);

  const openBills = state.bills.filter(b => billStatus(b) !== "lunas").length;

  $("#statStudents").textContent = activeStudents.length;
  $("#statIncome").textContent = formatRupiah(monthIncome);
  $("#statArrears").textContent = formatRupiah(arrears);
  $("#statOpenBills").textContent = openBills;

  const latest = state.payments.slice(0, 7);
  $("#dashboardPaymentRows").innerHTML = latest.length ? latest.map(p => `
    <tr>
      <td>${formatDate(p.date)}</td>
      <td><span class="cell-main">${escapeHtml(p.studentName || "-")}</span><span class="cell-sub">${escapeHtml(p.className || "")}</span></td>
      <td>${escapeHtml(p.billType || "-")}</td>
      <td class="amount">${formatRupiah(p.amount)}</td>
      <td>${escapeHtml(p.method || "-")}</td>
    </tr>
  `).join("") : emptyRow(5, "Belum ada pembayaran.");

  const studentArrears = new Map();
  state.bills.forEach(b => {
    const rem = Math.max(0, cleanNumber(b.amount) - cleanNumber(b.paid));
    if (rem <= 0) return;
    const item = studentArrears.get(b.studentId) || {
      name: b.studentName || currentStudent(b.studentId)?.name || "-",
      className: b.className || currentStudent(b.studentId)?.className || "",
      amount: 0
    };
    item.amount += rem;
    studentArrears.set(b.studentId, item);
  });

  const top = [...studentArrears.values()].sort((a, b) => b.amount - a.amount).slice(0, 6);
  $("#arrearsList").innerHTML = top.length ? top.map(item => `
    <div class="arrears-item">
      <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.className)}</span></div>
      <div class="arrears-value">${formatRupiah(item.amount)}</div>
    </div>
  `).join("") : `<div class="empty-row" style="padding:30px;text-align:center">Tidak ada tunggakan.</div>`;
}

/* =========================
   STUDENTS
========================= */
function renderStudents() {
  const search = normalize($("#studentSearch")?.value);
  const classFilter = $("#studentClassFilter")?.value || "";

  const classes = [...new Set(state.students.map(s => s.className).filter(Boolean))].sort();
  const filterEl = $("#studentClassFilter");
  if (filterEl) {
    const current = filterEl.value;
    filterEl.innerHTML = `<option value="">Semua kelas</option>` + classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    filterEl.value = classes.includes(current) ? current : "";
  }

  let rows = state.students.filter(s => {
    const hay = normalize([s.nis, s.nisn, s.name, s.className, s.parentName, s.phone].join(" "));
    return (!search || hay.includes(search)) && (!classFilter || s.className === classFilter);
  });

  $("#studentCountText").textContent = `${rows.length} siswa`;

  $("#studentRows").innerHTML = rows.length ? rows.map(s => `
    <tr>
      <td><span class="cell-main">${escapeHtml(s.nis || s.nisn || "-")}</span><span class="cell-sub">${s.nis && s.nisn ? `NISN ${escapeHtml(s.nisn)}` : ""}</span></td>
      <td class="cell-main">${escapeHtml(s.name || "-")}</td>
      <td>${escapeHtml(s.className || "-")}</td>
      <td>${escapeHtml(s.parentName || "-")}</td>
      <td>${escapeHtml(s.phone || "-")}</td>
      <td>${statusBadge(s.status || "aktif")}</td>
      <td>
        <div class="action-group">
          ${roleIsAdmin() ? `<button class="action-btn" data-edit-student="${s.id}">Edit</button><button class="action-btn danger" data-delete-student="${s.id}">Hapus</button>` : `<span class="cell-sub">Lihat saja</span>`}
        </div>
      </td>
    </tr>
  `).join("") : emptyRow(7, "Data siswa tidak ditemukan.");

  refreshPaymentStudentOptions();
}

function studentFormHtml(student = {}) {
  return `
    <form id="studentForm" class="form-grid">
      <input type="hidden" id="studentId" value="${escapeHtml(student.id || "")}">
      <label><span>NIS</span><input id="studentNis" value="${escapeHtml(student.nis || "")}" placeholder="Nomor induk siswa" required></label>
      <label><span>NISN</span><input id="studentNisn" value="${escapeHtml(student.nisn || "")}" placeholder="Opsional"></label>
      <label class="span-2"><span>Nama Siswa</span><input id="studentName" value="${escapeHtml(student.name || "")}" required></label>
      <label><span>Kelas</span><input id="studentClass" value="${escapeHtml(student.className || "")}" placeholder="Contoh: 7A" required></label>
      <label><span>Status</span>
        <select id="studentStatus">
          <option value="aktif" ${student.status !== "nonaktif" ? "selected" : ""}>Aktif</option>
          <option value="nonaktif" ${student.status === "nonaktif" ? "selected" : ""}>Nonaktif</option>
        </select>
      </label>
      <label><span>Nama Orang Tua/Wali</span><input id="studentParent" value="${escapeHtml(student.parentName || "")}"></label>
      <label><span>No. HP/WhatsApp</span><input id="studentPhone" value="${escapeHtml(student.phone || "")}" placeholder="08..."></label>
      <label class="span-2"><span>Alamat</span><textarea id="studentAddress" rows="3">${escapeHtml(student.address || "")}</textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-soft" data-close-modal>Batal</button>
        <button id="saveStudentBtn" type="submit" class="btn btn-primary">Simpan</button>
      </div>
    </form>
  `;
}

$("#addStudentBtn").addEventListener("click", () => {
  openModal("Tambah Siswa", "Masukkan data siswa baru.", studentFormHtml());
});

document.addEventListener("click", async (e) => {
  const editId = e.target.closest("[data-edit-student]")?.dataset.editStudent;
  if (editId) {
    const s = currentStudent(editId);
    if (s) openModal("Edit Siswa", "Perbarui informasi siswa.", studentFormHtml(s));
  }

  const deleteId = e.target.closest("[data-delete-student]")?.dataset.deleteStudent;
  if (deleteId && roleIsAdmin()) {
    const hasBills = state.bills.some(b => b.studentId === deleteId);
    if (hasBills) {
      toast("Siswa masih memiliki riwayat/tagihan. Ubah status menjadi nonaktif agar riwayat tetap aman.", "error");
      return;
    }
    if (confirm("Hapus data siswa ini? Tindakan ini tidak dapat dibatalkan.")) {
      try {
        await deleteDoc(doc(db, "students", deleteId));
        toast("Data siswa dihapus.");
      } catch (err) {
        toast(err.message, "error");
      }
    }
  }
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "studentForm") return;
  e.preventDefault();
  if (!roleIsAdmin()) return;

  const btn = $("#saveStudentBtn");
  setButtonLoading(btn, true);
  const id = $("#studentId").value;
  const data = {
    nis: $("#studentNis").value.trim(),
    nisn: $("#studentNisn").value.trim(),
    name: $("#studentName").value.trim().toUpperCase(),
    className: $("#studentClass").value.trim().toUpperCase(),
    status: $("#studentStatus").value,
    parentName: $("#studentParent").value.trim(),
    phone: $("#studentPhone").value.trim(),
    address: $("#studentAddress").value.trim(),
    updatedAt: serverTimestamp()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "students", id), data);
      toast("Data siswa diperbarui.");
    } else {
      await addDoc(collection(db, "students"), { ...data, createdAt: serverTimestamp() });
      toast("Siswa berhasil ditambahkan.");
    }
    closeModal();
  } catch (err) {
    console.error(err);
    toast(err.message, "error");
  } finally {
    setButtonLoading(btn, false);
  }
});

$("#studentSearch").addEventListener("input", renderStudents);
$("#studentClassFilter").addEventListener("change", renderStudents);

/* =========================
   BILLS
========================= */
function renderBills() {
  const search = normalize($("#billSearch")?.value);
  const statusFilter = $("#billStatusFilter")?.value || "";

  const rows = [...state.bills]
    .sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || ""))
    .filter(b => {
      const status = billStatus(b);
      const hay = normalize([b.studentName, b.className, b.type, b.period].join(" "));
      return (!search || hay.includes(search)) && (!statusFilter || status === statusFilter);
    });

  $("#billCountText").textContent = `${rows.length} tagihan`;

  $("#billRows").innerHTML = rows.length ? rows.map(b => {
    const remaining = Math.max(0, cleanNumber(b.amount) - cleanNumber(b.paid));
    const status = billStatus(b);
    return `
      <tr>
        <td><span class="cell-main">${escapeHtml(b.studentName || "-")}</span><span class="cell-sub">${escapeHtml(b.className || "")}</span></td>
        <td>${escapeHtml(b.type || "-")}</td>
        <td>${escapeHtml(b.period || "-")}</td>
        <td>${formatDate(b.dueDate)}</td>
        <td class="amount">${formatRupiah(b.amount)}</td>
        <td>${formatRupiah(b.paid)}</td>
        <td class="amount">${formatRupiah(remaining)}</td>
        <td>${statusBadge(status)}</td>
        <td>
          <div class="action-group">
            ${status !== "lunas" ? `<button class="action-btn" data-pay-bill="${b.id}">Bayar</button>` : ""}
            ${roleIsAdmin() ? `<button class="action-btn" data-edit-bill="${b.id}">Edit</button><button class="action-btn danger" data-delete-bill="${b.id}">Hapus</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("") : emptyRow(9, "Tagihan tidak ditemukan.");
}

function billFormHtml(bill = {}) {
  const students = [...state.students].filter(s => s.status !== "nonaktif").sort(sortByName);
  return `
    <form id="billForm" class="form-grid">
      <input type="hidden" id="billId" value="${escapeHtml(bill.id || "")}">
      <label class="span-2"><span>Siswa</span>
        <select id="billStudent" required ${bill.id ? "disabled" : ""}>
          <option value="">Pilih siswa</option>
          ${students.map(s => `<option value="${s.id}" ${bill.studentId === s.id ? "selected" : ""}>${escapeHtml(s.name)} — ${escapeHtml(s.className || "-")}</option>`).join("")}
        </select>
      </label>
      <label><span>Jenis Tagihan</span><input id="billType" value="${escapeHtml(bill.type || "")}" placeholder="SPP / Seragam / Buku..." required></label>
      <label><span>Periode</span><input id="billPeriod" value="${escapeHtml(bill.period || "")}" placeholder="Agustus 2026" required></label>
      <label><span>Nominal</span><input id="billAmount" type="number" min="1" step="1" value="${escapeHtml(bill.amount || "")}" required></label>
      <label><span>Jatuh Tempo</span><input id="billDueDate" type="date" value="${escapeHtml(bill.dueDate || todayISO())}" required></label>
      <label class="span-2"><span>Keterangan</span><input id="billNote" value="${escapeHtml(bill.note || "")}" maxlength="120" placeholder="Opsional"></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-soft" data-close-modal>Batal</button>
        <button id="saveBillBtn" type="submit" class="btn btn-primary">Simpan Tagihan</button>
      </div>
    </form>
  `;
}

function bulkBillFormHtml() {
  const classes = [...new Set(state.students.filter(s => s.status !== "nonaktif").map(s => s.className).filter(Boolean))].sort();
  return `
    <form id="bulkBillForm" class="form-grid">
      <label class="span-2"><span>Target Siswa</span>
        <select id="bulkBillClass" required>
          <option value="__ALL__">Semua siswa aktif</option>
          ${classes.map(c => `<option value="${escapeHtml(c)}">Kelas ${escapeHtml(c)}</option>`).join("")}
        </select>
      </label>
      <label><span>Jenis Tagihan</span><input id="bulkBillType" placeholder="SPP" required></label>
      <label><span>Periode</span><input id="bulkBillPeriod" placeholder="Agustus 2026" required></label>
      <label><span>Nominal per Siswa</span><input id="bulkBillAmount" type="number" min="1" step="1" required></label>
      <label><span>Jatuh Tempo</span><input id="bulkBillDueDate" type="date" value="${todayISO()}" required></label>
      <label class="span-2"><span>Keterangan</span><input id="bulkBillNote" maxlength="120"></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-soft" data-close-modal>Batal</button>
        <button id="saveBulkBillBtn" type="submit" class="btn btn-primary">Buat Tagihan Massal</button>
      </div>
    </form>
  `;
}

$("#addBillBtn").addEventListener("click", () => {
  if (!state.students.length) return toast("Tambahkan data siswa terlebih dahulu.", "error");
  openModal("Buat Tagihan", "Buat tagihan untuk satu siswa.", billFormHtml());
});
$("#bulkBillBtn").addEventListener("click", () => {
  if (!state.students.length) return toast("Tambahkan data siswa terlebih dahulu.", "error");
  openModal("Tagihan Massal", "Buat tagihan yang sama untuk banyak siswa.", bulkBillFormHtml());
});

document.addEventListener("submit", async (e) => {
  if (e.target.id === "billForm") {
    e.preventDefault();
    if (!roleIsAdmin()) return;
    const btn = $("#saveBillBtn");
    setButtonLoading(btn, true);

    const id = $("#billId").value;
    const studentId = id ? currentBill(id)?.studentId : $("#billStudent").value;
    const student = currentStudent(studentId);
    if (!student) {
      setButtonLoading(btn, false);
      return toast("Siswa tidak ditemukan.", "error");
    }

    const amount = cleanNumber($("#billAmount").value);
    const old = id ? currentBill(id) : null;
    const paid = cleanNumber(old?.paid);
    if (amount < paid) {
      setButtonLoading(btn, false);
      return toast("Nominal tagihan tidak boleh lebih kecil dari jumlah yang sudah dibayar.", "error");
    }

    const data = {
      studentId,
      studentName: student.name,
      className: student.className || "",
      nis: student.nis || student.nisn || "",
      type: $("#billType").value.trim(),
      period: $("#billPeriod").value.trim(),
      amount,
      dueDate: $("#billDueDate").value,
      note: $("#billNote").value.trim(),
      paid,
      remaining: Math.max(0, amount - paid),
      status: paid >= amount ? "lunas" : paid > 0 ? "sebagian" : "belum",
      updatedAt: serverTimestamp()
    };

    try {
      if (id) {
        await updateDoc(doc(db, "bills", id), data);
        toast("Tagihan diperbarui.");
      } else {
        await addDoc(collection(db, "bills"), { ...data, createdAt: serverTimestamp() });
        toast("Tagihan berhasil dibuat.");
      }
      closeModal();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setButtonLoading(btn, false);
    }
  }

  if (e.target.id === "bulkBillForm") {
    e.preventDefault();
    if (!roleIsAdmin()) return;
    const btn = $("#saveBulkBillBtn");
    setButtonLoading(btn, true, "Membuat...");

    const targetClass = $("#bulkBillClass").value;
    const targets = state.students.filter(s =>
      s.status !== "nonaktif" && (targetClass === "__ALL__" || s.className === targetClass)
    );

    if (!targets.length) {
      setButtonLoading(btn, false);
      return toast("Tidak ada siswa pada target tersebut.", "error");
    }

    const type = $("#bulkBillType").value.trim();
    const period = $("#bulkBillPeriod").value.trim();
    const amount = cleanNumber($("#bulkBillAmount").value);
    const dueDate = $("#bulkBillDueDate").value;
    const note = $("#bulkBillNote").value.trim();

    try {
      // Dibuat satu per satu agar tetap sederhana tanpa backend.
      for (const student of targets) {
        await addDoc(collection(db, "bills"), {
          studentId: student.id,
          studentName: student.name,
          className: student.className || "",
          nis: student.nis || student.nisn || "",
          type, period, amount, dueDate, note,
          paid: 0,
          remaining: amount,
          status: "belum",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      toast(`${targets.length} tagihan berhasil dibuat.`);
      closeModal();
    } catch (err) {
      console.error(err);
      toast(err.message, "error");
    } finally {
      setButtonLoading(btn, false);
    }
  }
});

document.addEventListener("click", async (e) => {
  const editId = e.target.closest("[data-edit-bill]")?.dataset.editBill;
  if (editId && roleIsAdmin()) {
    const b = currentBill(editId);
    if (b) openModal("Edit Tagihan", "Perubahan tidak menghapus riwayat pembayaran.", billFormHtml(b));
  }

  const deleteId = e.target.closest("[data-delete-bill]")?.dataset.deleteBill;
  if (deleteId && roleIsAdmin()) {
    const bill = currentBill(deleteId);
    if (cleanNumber(bill?.paid) > 0) {
      return toast("Tagihan yang sudah memiliki pembayaran tidak boleh dihapus.", "error");
    }
    if (confirm("Hapus tagihan ini?")) {
      try {
        await deleteDoc(doc(db, "bills", deleteId));
        toast("Tagihan dihapus.");
      } catch (err) {
        toast(err.message, "error");
      }
    }
  }

  const payId = e.target.closest("[data-pay-bill]")?.dataset.payBill;
  if (payId) {
    const bill = currentBill(payId);
    if (!bill) return;
    setPage("payments");
    $("#paymentStudent").value = bill.studentId;
    populatePaymentBills(bill.studentId);
    $("#paymentBill").value = bill.id;
    updatePaymentBillInfo();
    $("#paymentAmount").focus();
  }
});

$("#billSearch").addEventListener("input", renderBills);
$("#billStatusFilter").addEventListener("change", renderBills);

/* =========================
   PAYMENTS
========================= */
function refreshPaymentStudentOptions() {
  const select = $("#paymentStudent");
  if (!select) return;
  const current = select.value;
  const students = [...state.students].filter(s => s.status !== "nonaktif").sort(sortByName);
  select.innerHTML = `<option value="">Pilih siswa</option>` + students.map(s =>
    `<option value="${s.id}">${escapeHtml(s.name)} — ${escapeHtml(s.className || "-")}</option>`
  ).join("");
  if (students.some(s => s.id === current)) select.value = current;
}

function renderPaymentSelectors() {
  refreshPaymentStudentOptions();
  if ($("#paymentDate") && !$("#paymentDate").value) $("#paymentDate").value = todayISO();
}

function populatePaymentBills(studentId) {
  const select = $("#paymentBill");
  const bills = state.bills
    .filter(b => b.studentId === studentId && billStatus(b) !== "lunas")
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  select.disabled = !studentId;
  select.innerHTML = `<option value="">${bills.length ? "Pilih tagihan" : "Tidak ada tagihan aktif"}</option>` +
    bills.map(b => {
      const remaining = Math.max(0, cleanNumber(b.amount) - cleanNumber(b.paid));
      return `<option value="${b.id}">${escapeHtml(b.type)} — ${escapeHtml(b.period)} — sisa ${escapeHtml(formatRupiah(remaining))}</option>`;
    }).join("");
  $("#paymentBillInfo").classList.add("hidden");
}

function updatePaymentBillInfo() {
  const bill = currentBill($("#paymentBill").value);
  if (!bill) {
    $("#paymentBillInfo").classList.add("hidden");
    return;
  }
  const remaining = Math.max(0, cleanNumber(bill.amount) - cleanNumber(bill.paid));
  $("#payInfoTotal").textContent = formatRupiah(bill.amount);
  $("#payInfoPaid").textContent = formatRupiah(bill.paid);
  $("#payInfoRemaining").textContent = formatRupiah(remaining);
  $("#paymentAmount").value = remaining;
  $("#paymentAmount").max = remaining;
  $("#paymentBillInfo").classList.remove("hidden");
}

$("#paymentStudent").addEventListener("change", e => populatePaymentBills(e.target.value));
$("#paymentBill").addEventListener("change", updatePaymentBillInfo);

$("#paymentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#savePaymentBtn");
  const studentId = $("#paymentStudent").value;
  const billId = $("#paymentBill").value;
  const amount = cleanNumber($("#paymentAmount").value);
  const paymentDate = $("#paymentDate").value;
  const method = $("#paymentMethod").value;
  const note = $("#paymentNote").value.trim();

  if (!studentId || !billId || amount <= 0) return toast("Lengkapi data pembayaran.", "error");

  const student = currentStudent(studentId);
  const bill = currentBill(billId);
  if (!student || !bill) return toast("Siswa atau tagihan tidak ditemukan.", "error");

  const initialRemaining = Math.max(0, cleanNumber(bill.amount) - cleanNumber(bill.paid));
  if (amount > initialRemaining) return toast("Nominal pembayaran melebihi sisa tagihan.", "error");

  setButtonLoading(btn, true, "Menyimpan...");

  try {
    const billRef = doc(db, "bills", billId);
    const paymentRef = doc(collection(db, "payments"));

    await runTransaction(db, async tx => {
      const billSnap = await tx.get(billRef);
      if (!billSnap.exists()) throw new Error("Tagihan tidak ditemukan.");

      const liveBill = billSnap.data();
      const total = cleanNumber(liveBill.amount);
      const currentPaid = cleanNumber(liveBill.paid);
      const remaining = Math.max(0, total - currentPaid);

      if (amount > remaining) throw new Error("Nominal pembayaran melebihi sisa tagihan terbaru.");

      const newPaid = currentPaid + amount;
      const newRemaining = Math.max(0, total - newPaid);
      const newStatus = newRemaining === 0 ? "lunas" : "sebagian";

      tx.update(billRef, {
        paid: newPaid,
        remaining: newRemaining,
        status: newStatus,
        updatedAt: serverTimestamp()
      });

      tx.set(paymentRef, {
        studentId,
        studentName: student.name,
        nis: student.nis || student.nisn || "",
        className: student.className || "",
        billId,
        billType: liveBill.type || bill.type || "",
        period: liveBill.period || bill.period || "",
        amount,
        date: paymentDate,
        method,
        note,
        cashierId: state.user.uid,
        cashierName: state.profile?.name || state.user.email || "Petugas",
        receiptNo: `${state.settings.receiptPrefix || "BYR"}-${paymentDate.replaceAll("-", "")}-${paymentRef.id.slice(0, 6).toUpperCase()}`,
        createdAt: serverTimestamp()
      });
    });

    toast("Pembayaran berhasil disimpan.");
    $("#paymentForm").reset();
    $("#paymentDate").value = todayISO();
    $("#paymentBill").disabled = true;
    $("#paymentBill").innerHTML = `<option value="">Pilih tagihan</option>`;
    $("#paymentBillInfo").classList.add("hidden");
  } catch (err) {
    console.error(err);
    toast(err.message, "error");
  } finally {
    setButtonLoading(btn, false);
  }
});

function renderPayments() {
  const search = normalize($("#paymentSearch")?.value);
  const rows = state.payments.filter(p => {
    const hay = normalize([p.receiptNo, p.studentName, p.nis, p.className, p.billType, p.period, p.method].join(" "));
    return !search || hay.includes(search);
  });

  $("#paymentRows").innerHTML = rows.length ? rows.map(p => `
    <tr>
      <td>${formatDate(p.date)}</td>
      <td><span class="cell-main">${escapeHtml(receiptNumber(p))}</span></td>
      <td><span class="cell-main">${escapeHtml(p.studentName || "-")}</span><span class="cell-sub">${escapeHtml(p.className || "")}</span></td>
      <td>${escapeHtml(p.billType || "-")}<span class="cell-sub">${escapeHtml(p.period || "")}</span></td>
      <td class="amount">${formatRupiah(p.amount)}</td>
      <td>${escapeHtml(p.method || "-")}</td>
      <td><button class="action-btn" data-print-payment="${p.id}">Cetak</button></td>
    </tr>
  `).join("") : emptyRow(7, "Belum ada riwayat pembayaran.");
}

$("#paymentSearch").addEventListener("input", renderPayments);

document.addEventListener("click", (e) => {
  const paymentId = e.target.closest("[data-print-payment]")?.dataset.printPayment;
  if (paymentId) {
    const payment = state.payments.find(p => p.id === paymentId);
    if (payment) printReceipt(payment);
  }
});

function printReceipt(payment) {
  const school = state.settings.schoolName || "SEKOLAH";
  const address = state.settings.address || "";
  const phone = state.settings.phone || "";
  const html = `
  <!doctype html>
  <html><head><meta charset="utf-8"><title>Kwitansi ${escapeHtml(receiptNumber(payment))}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111;margin:0;padding:24px}
    .wrap{max-width:700px;margin:auto}.head{text-align:center;border-bottom:2px solid #111;padding-bottom:12px}
    .head h1{font-size:20px;margin:0}.head p{font-size:11px;margin:4px 0}.title{text-align:center;font-weight:700;font-size:16px;margin:18px 0}
    table{width:100%;border-collapse:collapse}td{padding:7px 2px;font-size:12px;vertical-align:top}.label{width:150px;color:#444}
    .total{display:flex;justify-content:space-between;border:1px solid #111;padding:12px;margin-top:16px;font-weight:700}
    .foot{display:flex;justify-content:flex-end;margin-top:45px;text-align:center}.sign{width:220px}.line{margin-top:60px;border-top:1px solid #111;padding-top:5px}
    .note{font-size:10px;color:#666;margin-top:18px}
    @media print{body{padding:0}.no-print{display:none}}
  </style></head><body>
    <div class="wrap">
      <div class="head">
        <h1>${escapeHtml(school)}</h1>
        <p>${escapeHtml(address)}</p>
        <p>${escapeHtml(phone)}</p>
      </div>
      <div class="title">BUKTI PEMBAYARAN</div>
      <table>
        <tr><td class="label">No. Kwitansi</td><td>: <strong>${escapeHtml(receiptNumber(payment))}</strong></td></tr>
        <tr><td class="label">Tanggal</td><td>: ${escapeHtml(formatDate(payment.date))}</td></tr>
        <tr><td class="label">NIS/NISN</td><td>: ${escapeHtml(payment.nis || "-")}</td></tr>
        <tr><td class="label">Nama Siswa</td><td>: ${escapeHtml(payment.studentName || "-")}</td></tr>
        <tr><td class="label">Kelas</td><td>: ${escapeHtml(payment.className || "-")}</td></tr>
        <tr><td class="label">Pembayaran</td><td>: ${escapeHtml(payment.billType || "-")} ${escapeHtml(payment.period || "")}</td></tr>
        <tr><td class="label">Metode</td><td>: ${escapeHtml(payment.method || "-")}</td></tr>
        <tr><td class="label">Keterangan</td><td>: ${escapeHtml(payment.note || "-")}</td></tr>
      </table>
      <div class="total"><span>JUMLAH DIBAYAR</span><span>${escapeHtml(formatRupiah(payment.amount))}</span></div>
      <div class="foot"><div class="sign"><div>Petugas,</div><div class="line">${escapeHtml(payment.cashierName || "-")}</div></div></div>
      <div class="note">Kwitansi ini dicetak dari sistem SchoolPay.</div>
    </div>
    <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`;

  const win = window.open("", "_blank", "width=820,height=700");
  if (!win) return toast("Popup diblokir browser. Izinkan popup untuk mencetak kwitansi.", "error");
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/* =========================
   REPORTS
========================= */
function renderReports() {
  if (!$("#reportStart").value) $("#reportStart").value = monthStartISO();
  if (!$("#reportEnd").value) $("#reportEnd").value = todayISO();

  const start = $("#reportStart").value;
  const end = $("#reportEnd").value;

  state.reportPayments = state.payments.filter(p => {
    const date = p.date || "";
    return (!start || date >= start) && (!end || date <= end);
  });

  const income = state.reportPayments.reduce((sum, p) => sum + cleanNumber(p.amount), 0);
  const arrears = state.bills.reduce((sum, b) => sum + Math.max(0, cleanNumber(b.amount) - cleanNumber(b.paid)), 0);

  $("#reportTxCount").textContent = state.reportPayments.length;
  $("#reportIncome").textContent = formatRupiah(income);
  $("#reportArrears").textContent = formatRupiah(arrears);

  $("#reportRows").innerHTML = state.reportPayments.length ? state.reportPayments.map(p => `
    <tr>
      <td>${formatDate(p.date)}</td>
      <td>${escapeHtml(receiptNumber(p))}</td>
      <td>${escapeHtml(p.nis || "-")}</td>
      <td class="cell-main">${escapeHtml(p.studentName || "-")}</td>
      <td>${escapeHtml(p.className || "-")}</td>
      <td>${escapeHtml(p.billType || "-")}<span class="cell-sub">${escapeHtml(p.period || "")}</span></td>
      <td>${escapeHtml(p.method || "-")}</td>
      <td class="amount">${formatRupiah(p.amount)}</td>
      <td>${escapeHtml(p.cashierName || "-")}</td>
    </tr>
  `).join("") : emptyRow(9, "Tidak ada transaksi pada periode ini.");
}

$("#applyReportFilter").addEventListener("click", renderReports);
$("#reportStart").addEventListener("change", renderReports);
$("#reportEnd").addEventListener("change", renderReports);

$("#exportReportBtn").addEventListener("click", () => {
  renderReports();
  if (!state.reportPayments.length) return toast("Tidak ada data untuk diekspor.", "error");

  const rows = [
    ["Tanggal","No Kwitansi","NIS/NISN","Nama Siswa","Kelas","Tagihan","Periode","Metode","Nominal","Petugas"],
    ...state.reportPayments.map(p => [
      p.date || "", receiptNumber(p), p.nis || "", p.studentName || "", p.className || "",
      p.billType || "", p.period || "", p.method || "", cleanNumber(p.amount), p.cashierName || ""
    ])
  ];

  const csv = rows.map(row =>
    row.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")
  ).join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `laporan-pembayaran-${$("#reportStart").value || "awal"}-${$("#reportEnd").value || "akhir"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* =========================
   SETTINGS
========================= */
$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!roleIsAdmin()) return;
  const btn = e.submitter;
  setButtonLoading(btn, true);

  const data = {
    schoolName: $("#settingSchoolName").value.trim(),
    address: $("#settingAddress").value.trim(),
    phone: $("#settingPhone").value.trim(),
    academicYear: $("#settingAcademicYear").value.trim(),
    principal: $("#settingPrincipal").value.trim(),
    receiptPrefix: ($("#settingReceiptPrefix").value.trim() || "BYR").toUpperCase(),
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, "settings", "school"), data, { merge: true });
    toast("Pengaturan sekolah disimpan.");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(btn, false);
  }
});

/* =========================
   NAV + UI EVENTS
========================= */
$$(".nav-item").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.page)));
$$("[data-go]").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.go)));
els.openSidebar.addEventListener("click", () => {
  els.sidebar.classList.add("open");
  els.sidebarBackdrop.classList.add("show");
});
els.closeSidebar.addEventListener("click", closeSidebar);
els.sidebarBackdrop.addEventListener("click", closeSidebar);

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-modal]")) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !els.modalRoot.classList.contains("hidden")) closeModal();
});

$("#paymentDate").value = todayISO();

/* Initial friendly date */
els.todayText.textContent = new Intl.DateTimeFormat("id-ID", {
  weekday: "long", day: "2-digit", month: "long", year: "numeric"
}).format(new Date());
