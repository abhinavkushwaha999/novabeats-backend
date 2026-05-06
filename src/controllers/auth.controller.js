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

// ── Email ─────────────────────────────────────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email, name, otp, type = "verify") {
  const subjects = {
    verify: "Verify your NovaBeats account",
    forgot: "Reset your NovaBeats password",
  };
  const bodies = {
    verify: "Enter this OTP to verify your email address and activate your account:",
    forgot: "Enter this OTP to reset your password:",
  };
  const transporter = getTransporter();
  await transporter.sendMail({
    from:    `"NovaBeats" <${process.env.EMAIL_USER}>`,
    to:      email,
    subject: subjects[type],
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0b0b18;color:#eeeef8;padding:32px;border-radius:16px;">
        <h1 style="color:#a094ff;margin-bottom:4px;">◉ NovaBeats</h1>
        <p style="color:#8080a0;margin-top:0">Music without limits</p>
        <hr style="border-color:#252540;margin:24px 0"/>
        <h2>Hi ${name}! 👋</h2>
        <p>${bodies[type]}</p>
        <div style="background:#1e1e30;border:2px solid #7c6af5;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <span style="font-size:2.5rem;font-weight:900;letter-spacing:12px;color:#a094ff;">${otp}</span>
        </div>
        <p style="color:#8080a0;font-size:0.85rem;">
          This OTP expires in <strong>10 minutes</strong>.<br/>
          If you didn't request this, ignore this email.
        </p>
      </div>
    `,
  });
}

// ══════════════════════════════════════════════════════════════
// REGISTER — creates UNVERIFIED account, sends OTP
// ✅ NO cookie is set here — login is impossible without OTP
// ══════════════════════════════════════════════════════════════
async function registerUser(req, res) {
  try {
    const { name, username, email, password, role = "user" } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        message: "Username must be 3-20 characters (letters, numbers, underscores only)"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check existing
    const existing = await userModel.findOne({
      $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }]
    });

    if (existing) {
      // If same email but unverified — resend OTP instead of rejecting
      if (existing.email === email.toLowerCase() && !existing.isVerified) {
        const otp = generateOTP();
        existing.otp       = otp;
        existing.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
        await existing.save();
        try { await sendOTPEmail(existing.email, existing.name, otp, "verify"); } catch {}
        return res.status(200).json({
          message: "Account exists but not verified. New OTP sent to your email.",
          userId: existing._id,
          email:  existing.email,
        });
      }
      if (existing.username === username.toLowerCase()) {
        return res.status(409).json({ message: "Username is already taken. Please choose another." });
      }
      return res.status(409).json({ message: "Email is already registered. Please sign in." });
    }

    const hash = await bcrypt.hash(password, 10);
    const otp  = generateOTP();

    // ✅ isVerified: false — this account CANNOT login until OTP is verified
    const user = await userModel.create({
      name,
      username:   username.toLowerCase(),
      email:      email.toLowerCase(),
      password:   hash,
      role,
      isVerified: false,
      otp,
      otpExpiry:  new Date(Date.now() + 10 * 60 * 1000),
    });

    try { await sendOTPEmail(email, name, otp, "verify"); } catch (e) {
      console.error("Email send failed:", e.message);
    }

    // ✅ Return only userId and email — NO token, NO cookie
    res.status(201).json({
      message: "OTP sent to your email. Please verify to activate your account.",
      userId:  user._id,
      email:   user.email,
    });

  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// VERIFY OTP — activates account, ONLY NOW issues cookie
// ══════════════════════════════════════════════════════════════
async function verifyOTP(req, res) {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ message: "userId and OTP required" });

    const user = await userModel.findById(userId);
    if (!user)            return res.status(404).json({ message: "User not found" });
    if (user.isVerified)  return res.status(400).json({ message: "Already verified. Please sign in." });
    if (user.otp !== String(otp).trim()) return res.status(400).json({ message: "Invalid OTP. Try again." });
    if (new Date() > new Date(user.otpExpiry)) return res.status(400).json({ message: "OTP expired. Request a new one." });

    // ✅ Activate account
    user.isVerified = true;
    user.otp        = null;
    user.otpExpiry  = null;
    await user.save();

    // ✅ ONLY NOW issue JWT cookie
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, cookieOptions);

    res.status(200).json({
      message: "Email verified! Welcome to NovaBeats 🎵",
      user: { id: user._id, name: user.name, username: user.username, email: user.email, role: user.role },
    });

  } catch (err) {
    console.error("verifyOTP error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// RESEND OTP
// ══════════════════════════════════════════════════════════════
async function resendOTP(req, res) {
  try {
    const { userId } = req.body;
    const user = await userModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const otp = generateOTP();
    user.otp       = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const type = user.resetMode ? "forgot" : "verify";
    await sendOTPEmail(user.email, user.name, otp, type);

    res.json({ message: "New OTP sent." });
  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// FORGOT PASSWORD — Step 1
// ══════════════════════════════════════════════════════════════
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await userModel.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(200).json({ message: "If that email exists, an OTP has been sent." });

    if (!user.isVerified) {
      return res.status(400).json({
        message: "Account not verified. Please verify your email first.",
        needsVerification: true,
        userId: user._id,
      });
    }

    const otp = generateOTP();
    user.otp       = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.resetMode = true;
    await user.save();

    await sendOTPEmail(user.email, user.name, otp, "forgot");

    res.status(200).json({ message: "OTP sent to your email.", userId: user._id });
  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// VERIFY RESET OTP — Step 2
// ══════════════════════════════════════════════════════════════
async function verifyResetOTP(req, res) {
  try {
    const { userId, otp } = req.body;
    const user = await userModel.findById(userId);
    if (!user || !user.resetMode) return res.status(400).json({ message: "Invalid request" });
    if (user.otp !== String(otp).trim()) return res.status(400).json({ message: "Invalid OTP." });
    if (new Date() > new Date(user.otpExpiry)) return res.status(400).json({ message: "OTP expired." });

    const resetToken = jwt.sign(
      { id: user._id, purpose: "reset" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    user.otp       = null;
    user.otpExpiry = null;
    await user.save();

    res.json({ message: "OTP verified.", resetToken });
  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// RESET PASSWORD — Step 3
// ══════════════════════════════════════════════════════════════
async function resetPassword(req, res) {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) return res.status(400).json({ message: "All fields required" });
    if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    let decoded;
    try { decoded = jwt.verify(resetToken, process.env.JWT_SECRET); }
    catch { return res.status(400).json({ message: "Reset link expired. Please start over." }); }

    if (decoded.purpose !== "reset") return res.status(400).json({ message: "Invalid token" });

    const hash = await bcrypt.hash(newPassword, 10);
    await userModel.findByIdAndUpdate(decoded.id, {
      password: hash, resetMode: false, otp: null, otpExpiry: null,
    });

    res.json({ message: "Password reset successfully! You can now sign in." });
  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// LOGIN — blocks unverified accounts strictly
// ══════════════════════════════════════════════════════════════
async function loginUser(req, res) {
  try {
    const { username, email, password } = req.body;
    if (!password || (!username && !email)) {
      return res.status(400).json({ message: "Credentials are required" });
    }

    const query = email
      ? { email: email.toLowerCase() }
      : { username: username.toLowerCase() };

    const user = await userModel.findOne(query);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    // ✅ Strictly block unverified users
    if (!user.isVerified) {
      // Auto-resend OTP
      const otp = generateOTP();
      user.otp       = otp;
      user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      try { await sendOTPEmail(user.email, user.name, otp, "verify"); } catch {}

      return res.status(403).json({
        message: "Email not verified. A new OTP has been sent to your email.",
        needsVerification: true,
        userId: user._id,
        email:  user.email,
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
      user: { id: user._id, name: user.name, username: user.username, email: user.email, role: user.role },
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// LOGOUT
// ══════════════════════════════════════════════════════════════
async function logoutUser(req, res) {
  res.clearCookie("token", cookieOptions);
  res.status(200).json({ message: "Logged out successfully" });
}

module.exports = {
  registerUser, verifyOTP, resendOTP,
  forgotPassword, verifyResetOTP, resetPassword,
  loginUser, logoutUser,
};