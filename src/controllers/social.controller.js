const userModel    = require("../models/user.model");
const musicModel   = require("../models/music.model");
const commentModel = require("../models/comment.model");

// ── Pagination helper (same pattern as music.controller) ──────
function getPagination(query) {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit) || 20));
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
}

// ═══════════════════════════════════════════════════════════════════════
// FOLLOW / UNFOLLOW ARTIST
// ═══════════════════════════════════════════════════════════════════════
async function followArtist(req, res) {
  try {
    const { artistId } = req.params;
    const userId = req.user.id;

    if (userId === artistId) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    const artist = await userModel.findById(artistId);
    if (!artist) return res.status(404).json({ message: "Artist not found" });

    const user = await userModel.findById(userId);
    const isFollowing = user.following.includes(artistId);

    if (isFollowing) {
      await userModel.findByIdAndUpdate(userId,   { $pull: { following: artistId } });
      await userModel.findByIdAndUpdate(artistId, { $pull: { followers: userId } });
      return res.json({ message: "Unfollowed", following: false, followers: artist.followers.length - 1 });
    } else {
      await userModel.findByIdAndUpdate(userId,   { $addToSet: { following: artistId } });
      await userModel.findByIdAndUpdate(artistId, { $addToSet: { followers: userId } });
      return res.json({ message: "Followed", following: true, followers: artist.followers.length + 1 });
    }

  } catch (err) {
    console.error("followArtist error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// GET ARTIST PROFILE
// ═══════════════════════════════════════════════════════════════════════
async function getArtistProfile(req, res) {
  try {
    const { artistId } = req.params;
    const userId = req.user.id;

    const artist = await userModel
      .findById(artistId)
      .select("username email bio avatar followers following role");

    if (!artist) return res.status(404).json({ message: "Artist not found" });

    const tracks = await musicModel
      .find({ artist: artistId })
      .populate("artist", "username");

    const isFollowing = artist.followers.some(f => f.toString() === userId);

    res.json({
      artist: {
        id:          artist._id,
        username:    artist.username,
        email:       artist.email,
        bio:         artist.bio,
        avatar:      artist.avatar,
        role:        artist.role,
        followers:   artist.followers.length,
        following:   artist.following.length,
        isFollowing,
      },
      tracks,
    });

  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LIKE / UNLIKE SONG
// ═══════════════════════════════════════════════════════════════════════
async function likeMusic(req, res) {
  try {
    const { musicId } = req.params;
    const userId = req.user.id;

    const music = await musicModel.findById(musicId);
    if (!music) return res.status(404).json({ message: "Track not found" });

    const isLiked = music.likes.includes(userId);

    if (isLiked) {
      await musicModel.findByIdAndUpdate(musicId, { $pull:     { likes: userId } });
      await userModel.findByIdAndUpdate(userId,   { $pull:     { likedSongs: musicId } });
      return res.json({ liked: false, likes: music.likes.length - 1 });
    } else {
      await musicModel.findByIdAndUpdate(musicId, { $addToSet: { likes: userId } });
      await userModel.findByIdAndUpdate(userId,   { $addToSet: { likedSongs: musicId } });
      return res.json({ liked: true, likes: music.likes.length + 1 });
    }

  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// GET MY LIKED SONGS
// ═══════════════════════════════════════════════════════════════════════
async function getLikedSongs(req, res) {
  try {
    const user = await userModel
      .findById(req.user.id)
      .populate({ path: "likedSongs", populate: { path: "artist", select: "username" } });

    res.json({ likedSongs: user.likedSongs || [] });
  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ADD COMMENT
// ═══════════════════════════════════════════════════════════════════════
async function addComment(req, res) {
  try {
    const { musicId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ message: "Comment text is required" });
    }
    if (text.length > 500) {
      return res.status(400).json({ message: "Comment too long (max 500 chars)" });
    }

    const music = await musicModel.findById(musicId);
    if (!music) return res.status(404).json({ message: "Track not found" });

    const comment = await commentModel.create({
      music:  musicId,
      user:   req.user.id,
      text:   text.trim(),
    });

    await comment.populate("user", "username avatar role");

    res.status(201).json({ message: "Comment added", comment });

  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// GET COMMENTS FOR A TRACK  (paginated)
// GET /api/social/comment/:musicId?page=1&limit=20
// ═══════════════════════════════════════════════════════════════════════
async function getComments(req, res) {
  try {
    const { musicId } = req.params;
    const { page, limit, skip } = getPagination(req.query);

    const [comments, total] = await Promise.all([
      commentModel
        .find({ music: musicId })
        .populate("user", "username avatar role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      commentModel.countDocuments({ music: musicId }),
    ]);

    res.json({
      comments,
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
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DELETE COMMENT (only own comments)
// ═══════════════════════════════════════════════════════════════════════
async function deleteComment(req, res) {
  try {
    const { commentId } = req.params;
    const comment = await commentModel.findById(commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    if (comment.user.toString() !== req.user.id) {
      return res.status(403).json({ message: "You can only delete your own comments" });
    }
    await commentModel.findByIdAndDelete(commentId);
    res.json({ message: "Comment deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// GET MY FOLLOWING FEED  (paginated)
// GET /api/social/feed?page=1&limit=20
// ═══════════════════════════════════════════════════════════════════════
async function getFeed(req, res) {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const user = await userModel.findById(req.user.id).select("following");

    const filter = { artist: { $in: user.following } };

    const [feed, total] = await Promise.all([
      musicModel
        .find(filter)
        .populate("artist", "username")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      musicModel.countDocuments(filter),
    ]);

    res.json({
      feed,
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
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

module.exports = {
  followArtist, getArtistProfile,
  likeMusic, getLikedSongs,
  addComment, getComments, deleteComment,
  getFeed,
};