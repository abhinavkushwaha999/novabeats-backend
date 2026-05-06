const musicModel = require("../models/music.model");
const albumModel = require("../models/album.model");
const ImageKit   = require("@imagekit/nodejs");
const crypto     = require("crypto");
require("../models/user.model");

// ✅ ImageKit is initialized INSIDE functions — not at module load time
// This prevents a server crash if env vars are missing on startup
function getImageKit() {
  if (!process.env.IMAGEKIT_PRIVATE_KEY) {
    throw new Error("IMAGEKIT_PRIVATE_KEY is not set in environment variables");
  }
  return new ImageKit({
    privateKey:   process.env.IMAGEKIT_PRIVATE_KEY,
    publicKey:    process.env.IMAGEKIT_PUBLIC_KEY,
    urlEndpoint:  process.env.IMAGEKIT_URL_ENDPOINT,
  });
}

// ✅ Get ImageKit auth params for direct browser upload
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

// ✅ Save track URL to DB after direct ImageKit upload
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

// ✅ Old upload route (fallback — uses server-side ImageKit upload)
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

async function createAlbum(req, res) {
  try {
    const { title, musics } = req.body;
    if (!title)              return res.status(400).json({ message: "Album title is required" });
    if (!musics?.length)     return res.status(400).json({ message: "Select at least one track" });
    const album = await albumModel.create({ title, artist: req.user.id, musics });
    res.status(201).json({ message: "Album Created Successfully", album });
  } catch (err) {
    res.status(500).json({ message: "Failed to create album: " + err.message });
  }
}

async function getAllMusics(req, res) {
  try {
    const musics = await musicModel.find().limit(20).populate("artist", "username");
    res.status(200).json({ message: "Musics fetched Successfully", musics });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch music: " + err.message });
  }
}

async function getAllAlbums(req, res) {
  try {
    const albums = await albumModel
      .find()
      .select("title artist")
      .populate("artist", "username email");
    res.status(200).json({ message: "Albums fetched Successfully", albums });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch albums: " + err.message });
  }
}

async function getAlbumById(req, res) {
  try {
    const album = await albumModel
      .findById(req.params.albumId)
      .populate("artist", "username email")
      .populate("musics");
    if (!album) return res.status(404).json({ message: "Album not found" });
    res.status(200).json({ message: "Album fetched Successfully", album });
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
  getAllAlbums,
  getAlbumById,
};