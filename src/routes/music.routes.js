const express = require("express");
const musicController = require("../controllers/music.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// ✅ New route: Get ImageKit auth params for direct browser upload
router.get("/imagekit-auth", authMiddleware.authArtist, musicController.getImageKitAuth);

// ✅ New route: Save track URL to DB after direct ImageKit upload
router.post("/save-track", authMiddleware.authArtist, musicController.saveTrack);

// Old upload route (kept for reference but no longer used)
router.post("/upload", authMiddleware.authArtist, upload.single("music"), musicController.createMusic);

router.post("/album", authMiddleware.authArtist, musicController.createAlbum);
router.get("/", authMiddleware.authUser, musicController.getAllMusics);
router.get("/albums", authMiddleware.authUser, musicController.getAllAlbums);
router.get("/albums/:albumId", authMiddleware.authUser, musicController.getAlbumById);

module.exports = router;