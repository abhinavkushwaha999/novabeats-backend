const express      = require("express");
const cookieParser = require("cookie-parser");
const cors         = require("cors");
const mongoose     = require("mongoose");
const authRoutes   = require("./routes/auth.routes");
const musicRoutes  = require("./routes/music.routes");
const socialRoutes = require("./routes/social.routes");

const app = express();

// ✅ DB connection cached for serverless
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

app.get("/", (req, res) => res.send("NovaBeats Backend working ✅"));
app.get("/api", (req, res) => res.json({ status: "ok", message: "NovaBeats backend is running 🎵" }));

// ✅ CORS — fixed to handle all cases including preflight
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.replace(/\/$/, "").toLowerCase();

    // ✅ Allow any vercel.app subdomain (covers preview URLs too)
    if (cleanOrigin.endsWith(".vercel.app")) return callback(null, true);

    // ✅ Allow localhost for development
    if (
      cleanOrigin === "http://localhost:5500" ||
      cleanOrigin === "http://127.0.0.1:5500" ||
      cleanOrigin === "http://localhost:3000" ||
      cleanOrigin === "http://localhost:5173"
    ) return callback(null, true);

    console.warn("CORS blocked:", origin);
    return callback(new Error("Not allowed by CORS: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  exposedHeaders: ["Set-Cookie"],
}));

// ✅ Handle preflight OPTIONS requests explicitly
// Note: "*" breaks in newer path-to-regexp versions — use "(.*)" instead
app.options("(.*)", cors());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// ✅ Connect DB on every request (safe for Vercel serverless)
app.use(async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (err) {
    console.error("DB Error:", err.message);
    res.status(503).json({ message: "Database unavailable: " + err.message });
  }
});

app.use("/api/auth",   authRoutes);
app.use("/api/music",  musicRoutes);
app.use("/api/social", socialRoutes);

module.exports = app;