const express        = require("express");
const socialController = require("../controllers/social.controller");
const { authUser, authArtist } = require("../middlewares/auth.middleware");

const router = express.Router();

// ── Follow / Artist profile ──────────────────────────────────────────
router.post("/follow/:artistId",    authUser, socialController.followArtist);
router.get("/artist/:artistId",     authUser, socialController.getArtistProfile);

// ── Likes ────────────────────────────────────────────────────────────
router.post("/like/:musicId",       authUser, socialController.likeMusic);
router.get("/liked",                authUser, socialController.getLikedSongs);

// ── Comments ─────────────────────────────────────────────────────────
router.post("/comment/:musicId",    authUser, socialController.addComment);
router.get("/comment/:musicId",     authUser, socialController.getComments);
router.delete("/comment/:commentId",authUser, socialController.deleteComment);

// ── Feed ─────────────────────────────────────────────────────────────
router.get("/feed",                 authUser, socialController.getFeed);

module.exports = router;