const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  // ✅ NEW: Full name + unique username
  name:      { type: String, required: true, trim: true },
  username:  { type: String, required: true, unique: true, lowercase: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: ["user", "artist"], default: "user" },

  // ✅ Email verification — isVerified false = cannot login
  isVerified: { type: Boolean, default: false },
  otp:        { type: String,  default: null },
  otpExpiry:  { type: Date,    default: null },
  resetMode:  { type: Boolean, default: false }, // true = OTP is for password reset

  // ✅ Social
  followers:  [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
  following:  [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
  likedSongs: [{ type: mongoose.Schema.Types.ObjectId, ref: "music" }],

  // ✅ Profile
  bio:    { type: String, default: "" },
  avatar: { type: String, default: "" },

}, { timestamps: true });

module.exports = mongoose.model("user", userSchema);