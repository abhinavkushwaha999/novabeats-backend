const express        = require("express");
const musicController = require("../controllers/music.controller");
const authMiddleware  = require("../middlewares/auth.middleware");
const multer          = require("multer");
const rateLimit       = require("express-rate-limit");

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// ── Rate limiter for upload endpoints ─────────────────────────
// Artists can upload max 20 tracks per hour (prevents storage abuse)
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { message: "Upload limit reached. Try again in 1 hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── ImageKit direct upload auth ───────────────────────────────
router.get("/imagekit-auth", authMiddleware.authArtist, musicController.getImageKitAuth);

// ── Save track URL after direct ImageKit upload ───────────────
router.post("/save-track", uploadLimiter, authMiddleware.authArtist, musicController.saveTrack);

// ── Server-side upload (fallback) ─────────────────────────────
router.post("/upload", uploadLimiter, authMiddleware.authArtist, upload.single("music"), musicController.createMusic);

// ── Album management ──────────────────────────────────────────
router.post("/album",         authMiddleware.authArtist, musicController.createAlbum);
router.get("/albums",         authMiddleware.authUser,   musicController.getAllAlbums);
router.get("/albums/:albumId",authMiddleware.authUser,   musicController.getAlbumById);

// ── Music listing & search ────────────────────────────────────
// GET /api/music?page=1&limit=10
router.get("/",               authMiddleware.authUser,   musicController.getAllMusics);

// GET /api/music/search?q=keyword&page=1&limit=10
// ⚠️  Must be declared BEFORE /:albumId-style routes to avoid param conflicts
router.get("/search",         authMiddleware.authUser,   musicController.searchMusic);

module.exports = router;