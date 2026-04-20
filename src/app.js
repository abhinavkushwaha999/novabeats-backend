const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth.routes");
const musicRoutes = require("./routes/music.routes");

const app = express();

// ✅ DB connection cached for serverless — no separate db.js file needed
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  isConnected = true;
  console.log("DB connected ✅");
}

app.get("/", (req, res) => {
  res.send("Backend working ✅");
});

app.get("/api", (req, res) => {
  res.json({ status: "ok", message: "Sona backend is running 🎵" });
});

// ✅ CORS
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.replace(/\/$/, "");
    const allowedOrigins = [
      "https://music-sona-frontend.vercel.app",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "http://localhost:3000",
    ];
    if (allowedOrigins.includes(cleanOrigin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS: " + origin));
  },
  credentials: true,
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// ✅ Connect DB on every request (safe for Vercel serverless)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("DB Error:", err.message);
    res.status(503).json({ message: "Database unavailable: " + err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/music', musicRoutes);

module.exports = app;