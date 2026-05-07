const musicModel = require("../models/music.model");
const albumModel = require("../models/album.model");
const ImageKit   = require("@imagekit/nodejs");
const crypto     = require("crypto");
require("../models/user.model");

// ── Pagination helper ─────────────────────────────────────────
// Returns { page, limit, skip } from query params.
// Clamps page >= 1, limit between 1 and 50.
function getPagination(query) {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit) || 10));
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
}

function getImageKit() {
  if (!process.env.IMAGEKIT_PRIVATE_KEY) {
    throw new Error("IMAGEKIT_PRIVATE_KEY is not set in environment variables");
  }
  return new ImageKit({
    privateKey:  process.env.IMAGEKIT_PRIVATE_KEY,
    publicKey:   process.env.IMAGEKIT_PUBLIC_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  });
}

// ── ImageKit auth params for browser upload ───────────────────
async function getImageKitAuth(req, res) {
  try {
    const token  = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 2400;

    if (!process.env.IMAGEKIT_PRIVATE_KEY) {
      return res.status(500).json({ message: "ImageKit not configured on server" });
    }

    const signature = crypto
      .createHmac("sha1", process.env.IMAGEKIT_PRIVATE_KEY)
      .update(token + expire)
      .digest("hex");

    res.json({ token, expire, signature });
  } catch (err) {
    console.error("ImageKit auth error:", err);
    res.status(500).json({ message: "Auth failed: " + err.message });
  }
}

// ── Save track URL after browser upload ──────────────────────
async function saveTrack(req, res) {
  try {
    const { title, uri } = req.body;
    if (!title || !uri) {
      return res.status(400).json({ message: "Title and URI are required" });
    }
    const music = await musicModel.create({ uri, title, artist: req.user.id });
    res.status(201).json({ message: "Music saved successfully", music });
  } catch (err) {
    res.status(500).json({ message: "Failed to save track: " + err.message });
  }
}

// ── Server-side upload (fallback) ────────────────────────────
async function createMusic(req, res) {
  try {
    const { title } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No audio file provided" });

    const ik = getImageKit();
    const result = await ik.upload({
      file:     file.buffer.toString("base64"),
      fileName: "music_" + Date.now(),
      folder:   "novabeats/music",
    });

    const music = await musicModel.create({ uri: result.url, title, artist: req.user.id });
    res.status(201).json({ message: "Music Created Successfully", music });
  } catch (err) {
    res.status(500).json({ message: "Upload failed: " + err.message });
  }
}

// ── Create album ──────────────────────────────────────────────
async function createAlbum(req, res) {
  try {
    const { title, musics } = req.body;
    if (!title)          return res.status(400).json({ message: "Album title is required" });
    if (!musics?.length) return res.status(400).json({ message: "Select at least one track" });
    const album = await albumModel.create({ title, artist: req.user.id, musics });
    res.status(201).json({ message: "Album Created Successfully", album });
  } catch (err) {
    res.status(500).json({ message: "Failed to create album: " + err.message });
  }
}

// ── Get all music  (paginated) ────────────────────────────────
// GET /api/music?page=1&limit=10
// Response includes: musics[], total, page, totalPages
async function getAllMusics(req, res) {
  try {
    const { page, limit, skip } = getPagination(req.query);

    const [musics, total] = await Promise.all([
      musicModel
        .find()
        .sort({ createdAt: -1 })  // newest first
        .skip(skip)
        .limit(limit)
        .populate("artist", "username"),
      musicModel.countDocuments(),
    ]);

    res.status(200).json({
      message: "Musics fetched successfully",
      musics,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch music: " + err.message });
  }
}

// ── Search music  (NEW) ───────────────────────────────────────
// GET /api/music/search?q=keyword&page=1&limit=10
// Searches title (text) and artist username via $regex.
// Uses a case-insensitive regex — for production at scale,
// add a MongoDB text index on `title` and switch to $text/$search.
async function searchMusic(req, res) {
  try {
    const q = String(req.query.q || "").trim();

    if (!q || q.length < 1) {
      return res.status(400).json({ message: "Search query (q) is required." });
    }
    if (q.length > 100) {
      return res.status(400).json({ message: "Query too long (max 100 chars)." });
    }

    const { page, limit, skip } = getPagination(req.query);

    // Sanitize for regex (escape special regex characters)
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex   = new RegExp(escaped, "i");

    // First find matching artist IDs by username
    const User = require("../models/user.model");
    const matchingArtists = await User.find({ username: regex }).select("_id");
    const artistIds = matchingArtists.map(a => a._id);

    const filter = {
      $or: [
        { title:  regex },
        { artist: { $in: artistIds } },
      ],
    };

    const [musics, total] = await Promise.all([
      musicModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("artist", "username"),
      musicModel.countDocuments(filter),
    ]);

    res.status(200).json({
      message: "Search results",
      query: q,
      musics,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Search failed: " + err.message });
  }
}

// ── Get all albums ────────────────────────────────────────────
async function getAllAlbums(req, res) {
  try {
    const albums = await albumModel
      .find()
      .select("title artist")
      .populate("artist", "username email");
    res.status(200).json({ message: "Albums fetched successfully", albums });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch albums: " + err.message });
  }
}

// ── Get album by ID ───────────────────────────────────────────
async function getAlbumById(req, res) {
  try {
    const album = await albumModel
      .findById(req.params.albumId)
      .populate("artist", "username email")
      .populate("musics");
    if (!album) return res.status(404).json({ message: "Album not found" });
    res.status(200).json({ message: "Album fetched successfully", album });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch album: " + err.message });
  }
}

module.exports = {
  getImageKitAuth,
  saveTrack,
  createMusic,
  createAlbum,
  getAllMusics,
  searchMusic,
  getAllAlbums,
  getAlbumById,
};