const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ["user", "artist"], default: "user" },

  // ✅ Email verification
  isVerified:  { type: Boolean, default: false },
  otp:         { type: String, default: null },
  otpExpiry:   { type: Date,   default: null },

  // ✅ Social
  followers:   [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
  following:   [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
  likedSongs:  [{ type: mongoose.Schema.Types.ObjectId, ref: "music" }],

  // ✅ Profile
  bio:         { type: String, default: "" },
  avatar:      { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.model("user", userSchema);