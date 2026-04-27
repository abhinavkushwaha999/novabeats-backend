const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  music:   { type: mongoose.Schema.Types.ObjectId, ref: "music", required: true },
  user:    { type: mongoose.Schema.Types.ObjectId, ref: "user",  required: true },
  text:    { type: String, required: true, maxlength: 500 },
}, { timestamps: true });

module.exports = mongoose.model("comment", commentSchema);