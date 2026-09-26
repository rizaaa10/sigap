const jwt = require("jsonwebtoken");

// Middleware: cek apakah user sudah login (token valid)
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // format: "Bearer <token>"

  if (!token) {
    return res
      .status(401)
      .json({ error: "Token tidak ditemukan, silakan login" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(403)
        .json({ error: "Token tidak valid atau kadaluarsa" });
    }
    req.user = decoded; // { userId, role }
    next();
  });
}

// Middleware: cek apakah role-nya admin
function isAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Akses ditolak, khusus admin" });
  }
  next();
}

module.exports = { verifyToken, isAdmin };
