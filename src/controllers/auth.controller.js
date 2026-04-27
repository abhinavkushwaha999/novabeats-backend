const userModel = require("../models/user.model");
const jwt        = require("jsonwebtoken");
const bcrypt     = require("bcryptjs");
const nodemailer = require("nodemailer");

const cookieOptions = {
  httpOnly: true,
  secure:   true,
  sameSite: "none",
  maxAge:   7 * 24 * 60 * 60 * 1000,
};

// ─── Email transporter ────────────────────────────────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,  // Gmail App Password (not your login password)
    },
  });
}

// ─── Generate 6-digit OTP ─────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Send OTP email ───────────────────────────────────────────────────
async function sendOTPEmail(email, username, otp) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"NovaBeats" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify your NovaBeats account",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0b0b18;color:#eeeef8;padding:32px;border-radius:16px;">
        <h1 style="color:#a094ff;margin-bottom:4px;">◉ NovaBeats</h1>
        <p style="color:#8080a0;margin-top:0">Music without limits</p>
        <hr style="border-color:#252540;margin:24px 0"/>
        <h2 style="margin-bottom:8px">Hi ${username}! 👋</h2>
        <p>Thanks for signing up. Enter this OTP to verify your email:</p>
        <div style="background:#1e1e30;border:2px solid #7c6af5;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <span style="font-size:2.5rem;font-weight:900;letter-spacing:12px;color:#a094ff;">${otp}</span>
        </div>
        <p style="color:#8080a0;font-size:0.85rem;">This OTP expires in <strong>10 minutes</strong>. If you didn't sign up, ignore this email.</p>
      </div>
    `,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// REGISTER — sends OTP, does not log in yet
// ═══════════════════════════════════════════════════════════════════════
async function registerUser(req, res) {
  try {
    const { username, email, password, role = "user" } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const exists = await userModel.findOne({ $or: [{ username }, { email }] });
    if (exists) return res.status(409).json({ message: "User already exists" });

    const hash = await bcrypt.hash(password, 10);
    const otp  = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    const user = await userModel.create({
      username, email, password: hash, role,
      otp, otpExpiry, isVerified: false,
    });

    // Send OTP email
    try {
      await sendOTPEmail(email, username, otp);
    } catch (emailErr) {
      console.error("Email send error:", emailErr.message);
      // Don't fail registration if email fails — just warn
    }

    res.status(201).json({
      message: "OTP sent to your email. Please verify to continue.",
      userId: user._id,
      email: user.email,
    });

  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// VERIFY OTP — completes registration, logs user in
// ═══════════════════════════════════════════════════════════════════════
async function verifyOTP(req, res) {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ message: "userId and otp are required" });

    const user = await userModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.isVerified) return res.status(400).json({ message: "Already verified" });

    if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });

    if (new Date() > new Date(user.otpExpiry)) {
      return res.status(400).json({ message: "OTP expired. Please register again." });
    }

    user.isVerified = true;
    user.otp        = null;
    user.otpExpiry  = null;
    await user.save();

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, cookieOptions);

    res.status(200).json({
      message: "Email verified! Welcome to NovaBeats 🎵",
      user: { id: user._id, username: user.username, email: user.email, role: user.role },
    });

  } catch (err) {
    console.error("OTP verify error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// RESEND OTP
// ═══════════════════════════════════════════════════════════════════════
async function resendOTP(req, res) {
  try {
    const { userId } = req.body;
    const user = await userModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isVerified) return res.status(400).json({ message: "Already verified" });

    const otp = generateOTP();
    user.otp       = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendOTPEmail(user.email, user.username, otp);
    res.json({ message: "New OTP sent to your email" });

  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════════
async function loginUser(req, res) {
  try {
    const { username, email, password } = req.body;
    if (!password || (!username && !email)) {
      return res.status(400).json({ message: "Credentials are required" });
    }

    const user = await userModel.findOne({
      $or: [{ username: username || "" }, { email: email || "" }],
    });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    if (!user.isVerified) {
      return res.status(403).json({
        message: "Email not verified. Please check your inbox for the OTP.",
        userId: user._id,
        needsVerification: true,
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, cookieOptions);

    res.status(200).json({
      message: "Logged in successfully",
      user: { id: user._id, username: user.username, email: user.email, role: user.role },
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════════════════
async function logoutUser(req, res) {
  res.clearCookie("token", cookieOptions);
  res.status(200).json({ message: "Logged out successfully" });
}

module.exports = { registerUser, verifyOTP, resendOTP, loginUser, logoutUser };