const express        = require("express");
const cookieParser   = require("cookie-parser");
const cors           = require("cors");
const mongoose       = require("mongoose");
const mongoSanitize  = require("express-mongo-sanitize");
const authRoutes     = require("./routes/auth.routes");
const musicRoutes    = require("./routes/music.routes");
const socialRoutes   = require("./routes/social.routes");

const app = express();

// ── DB connection cached for serverless ───────────────────────
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

// ── Health check ──────────────────────────────────────────────
app.get("/", (req, res) => res.send("NovaBeats Backend working ✅"));
app.get("/api", (req, res) => res.json({ status: "ok", message: "NovaBeats backend is running 🎵" }));

// ── CORS ──────────────────────────────────────────────────────
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const o = origin.replace(/\/$/, "").toLowerCase();
    if (o.endsWith(".vercel.app")) return callback(null, true);
    if (
      o === "http://localhost:5500" ||
      o === "http://127.0.0.1:5500" ||
      o === "http://localhost:3000" ||
      o === "http://localhost:5173"
    ) return callback(null, true);
    return callback(new Error("CORS blocked: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
};
app.use(cors(corsOptions));

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// ── NoSQL Injection Sanitization ──────────────────────────────
// Strips $ and . from req.body, req.params, req.query
// Prevents payloads like { "email": { "$gt": "" } }
app.use(mongoSanitize({
  replaceWith: "_",          // replace forbidden chars with _ instead of removing
  onSanitize: ({ req, key }) => {
    console.warn(`⚠️  Sanitized field [${key}] from ${req.ip}`);
  },
}));

// ── Connect DB on every request ───────────────────────────────
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("DB Error:", err.message);
    res.status(503).json({ message: "Database unavailable: " + err.message });
  }
});

// ── Routes ────────────────────────────────────────────────────
app.use("/api/auth",   authRoutes);
app.use("/api/music",  musicRoutes);
app.use("/api/social", socialRoutes);

module.exports = app;