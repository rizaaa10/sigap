const { verifyToken, isAdmin } = require("./middleware/auth");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// ---------- Endpoint tes ----------
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "SIGAP API berjalan" });
});

app.get("/api/categories", async (req, res) => {
  try {
    const categories = await prisma.category.findMany();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- REGISTER ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { nama, email, password } = req.body;

    // Validasi input dasar
    if (!nama || !email || !password) {
      return res
        .status(400)
        .json({ error: "Nama, email, dan password wajib diisi" });
    }

    // Cek apakah email sudah terdaftar
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "Email sudah terdaftar" });
    }

    // Hash password sebelum disimpan
    const passwordHash = await bcrypt.hash(password, 10);

    // Simpan user baru (default role: pelapor)
    const newUser = await prisma.user.create({
      data: { nama, email, passwordHash, role: "pelapor" },
    });

    res.status(201).json({
      message: "Registrasi berhasil",
      user: {
        id: newUser.id,
        nama: newUser.nama,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- LOGIN ----------
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email dan password wajib diisi" });
    }

    // Cari user berdasarkan email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Email atau password salah" });
    }

    // Cek kecocokan password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Email atau password salah" });
    }

    // Generate token JWT (berlaku 1 hari)
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    res.json({
      message: "Login berhasil",
      token,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- BUAT LAPORAN (Pelapor) ----------
app.post("/api/reports", verifyToken, async (req, res) => {
  try {
    const { judul, deskripsi, kategoriId, lokasi, fotoUrl } = req.body;

    if (!judul || !deskripsi || !kategoriId) {
      return res
        .status(400)
        .json({ error: "Judul, deskripsi, dan kategori wajib diisi" });
    }

    const newReport = await prisma.report.create({
      data: {
        userId: req.user.userId,
        judul,
        deskripsi,
        kategoriId: parseInt(kategoriId),
        lokasi: lokasi || null,
        fotoUrl: fotoUrl || null,
        status: "baru",
      },
    });

    res
      .status(201)
      .json({ message: "Laporan berhasil dibuat", report: newReport });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- LIHAT LAPORAN SENDIRI (Pelapor) ----------
app.get("/api/reports/me", verifyToken, async (req, res) => {
  try {
    const myReports = await prisma.report.findMany({
      where: { userId: req.user.userId },
      include: { kategori: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(myReports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- LIHAT DETAIL SATU LAPORAN ----------
app.get("/api/reports/:id", verifyToken, async (req, res) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { kategori: true, history: true },
    });

    if (!report)
      return res.status(404).json({ error: "Laporan tidak ditemukan" });

    // Pelapor hanya boleh lihat laporan miliknya sendiri; admin boleh lihat semua
    if (req.user.role !== "admin" && report.userId !== req.user.userId) {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- KELOLA SEMUA LAPORAN (Admin) ----------
app.get("/api/reports", verifyToken, isAdmin, async (req, res) => {
  try {
    const { status, kategoriId } = req.query; // filter opsional lewat query string

    const reports = await prisma.report.findMany({
      where: {
        ...(status && { status }),
        ...(kategoriId && { kategoriId: parseInt(kategoriId) }),
      },
      include: {
        kategori: true,
        user: { select: { nama: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- UBAH STATUS LAPORAN (Admin) ----------
app.patch("/api/reports/:id/status", verifyToken, isAdmin, async (req, res) => {
  try {
    const { status, catatan } = req.body;
    const reportId = parseInt(req.params.id);

    if (!status) return res.status(400).json({ error: "Status wajib diisi" });

    const updatedReport = await prisma.report.update({
      where: { id: reportId },
      data: { status },
    });

    // Catat riwayat perubahan status
    await prisma.reportStatusHistory.create({
      data: {
        reportId,
        status,
        catatan: catatan || null,
        changedBy: req.user.userId,
      },
    });

    res.json({
      message: "Status laporan berhasil diperbarui",
      report: updatedReport,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));
