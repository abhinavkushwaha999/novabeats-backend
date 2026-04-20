const musicModel = require("../models/music.model");
const albumModel = require("../models/album.model");
const ImageKit = require("@imagekit/nodejs");
const crypto = require("crypto");
require("../models/user.model");

const imagekit = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// ✅ Manual auth — works with any ImageKit SDK version
async function getImageKitAuth(req, res) {
  try {
    const token = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 2400;
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

async function saveTrack(req, res) {
  try {
    const { title, uri } = req.body;
    if (!title || !uri) return res.status(400).json({ message: "Title and URI are required" });
    const music = await musicModel.create({ uri, title, artist: req.user.id });
    res.status(201).json({ message: "Music saved successfully", music });
  } catch (err) {
    res.status(500).json({ message: "Failed to save track: " + err.message });
  }
}

async function createMusic(req, res) {
  try {
    const { title } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No audio file provided" });
    const result = await imagekit.upload({
      file: file.buffer.toString("base64"),
      fileName: "music_" + Date.now(),
      folder: "sona/music"
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
    if (!title) return res.status(400).json({ message: "Album title is required" });
    if (!musics || !musics.length) return res.status(400).json({ message: "Select at least one track" });
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
    const albums = await albumModel.find().select("title artist").populate("artist", "username email");
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

module.exports = { getImageKitAuth, saveTrack, createMusic, createAlbum, getAllMusics, getAllAlbums, getAlbumById };