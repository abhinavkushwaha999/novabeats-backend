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

// ── Password strength ─────────────────────────────────────────
// Requires: min 6 chars, at least 1 uppercase letter, at least 1 digit
// Examples that PASS:  "Hello1"  "MyPass9"  "Secure2024"
// Examples that FAIL:  "hello1"  "HELLO1" (no digit)  "hello" (too short)
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{6,}$/;

function validatePassword(password) {
  if (!password || password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  if (!PASSWORD_REGEX.test(password)) {
    return "Password must contain at least one uppercase letter and one number.";
  }
  return null; // null = valid
}

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
    verify: "Enter this OTP to verify your email and activate your account:",
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
          If you did not request this, ignore this email.
        </p>
      </div>
    `,
  });
}

// ══════════════════════════════════════════════════════════════
// REGISTER
// ══════════════════════════════════════════════════════════════
async function registerUser(req, res) {
  try {
    const { name, username, email, password, role = "user" } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ message: "Username: 3-20 chars, letters/numbers/underscores only" });
    }

    // ✅ IMPROVED: full password strength check (was length >= 6 only)
    const pwdError = validatePassword(password);
    if (pwdError) return res.status(400).json({ message: pwdError });

    const existing = await userModel.findOne({
      $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }]
    });

    if (existing) {
      if (existing.email === email.toLowerCase() && !existing.isVerified) {
        const otp = generateOTP();
        existing.otp       = otp;
        existing.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
        await existing.save();
        try { await sendOTPEmail(existing.email, existing.name, otp, "verify"); } catch {}
        return res.status(200).json({
          message: "Account exists but not verified. New OTP sent.",
          userId: existing._id,
          email:  existing.email,
        });
      }
      if (existing.username === username.toLowerCase()) {
        return res.status(409).json({ message: "Username already taken." });
      }
      return res.status(409).json({ message: "Email already registered. Please sign in." });
    }

    const hash = await bcrypt.hash(password, 10);
    const otp  = generateOTP();

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
      console.error("Email failed:", e.message);
    }

    return res.status(201).json({
      message: "OTP sent to your email. Please verify to continue.",
      userId:  user._id,
      email:   user.email,
    });

  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// VERIFY OTP
// ══════════════════════════════════════════════════════════════
async function verifyOTP(req, res) {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ message: "userId and OTP required" });

    const user = await userModel.findById(userId);
    if (!user)           return res.status(404).json({ message: "User not found" });
    if (user.isVerified) return res.status(400).json({ message: "Already verified. Please sign in." });

    if (user.otp !== String(otp).trim()) {
      return res.status(400).json({ message: "Invalid OTP. Please check and try again." });
    }
    if (new Date() > new Date(user.otpExpiry)) {
      return res.status(400).json({ message: "OTP expired. Please request a new one." });
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

    return res.status(200).json({
      message: "Email verified! Welcome to NovaBeats 🎵",
      user: {
        id:       user._id,
        name:     user.name,
        username: user.username,
        email:    user.email,
        role:     user.role,
      },
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

    return res.json({ message: "New OTP sent to your email." });
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
    if (!user) {
      return res.status(200).json({ message: "If that email exists, an OTP has been sent." });
    }
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

    return res.status(200).json({
      message: "OTP sent to your email.",
      userId:  user._id,
    });
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

    return res.json({ message: "OTP verified.", resetToken });
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
    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: "All fields required" });
    }

    // ✅ IMPROVED: full strength check on reset too
    const pwdError = validatePassword(newPassword);
    if (pwdError) return res.status(400).json({ message: pwdError });

    let decoded;
    try { decoded = jwt.verify(resetToken, process.env.JWT_SECRET); }
    catch { return res.status(400).json({ message: "Reset link expired. Please start over." }); }

    if (decoded.purpose !== "reset") {
      return res.status(400).json({ message: "Invalid token" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await userModel.findByIdAndUpdate(decoded.id, {
      password:  hash,
      resetMode: false,
      otp:       null,
      otpExpiry: null,
    });

    return res.json({ message: "Password reset successfully! You can now sign in." });
  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
// LOGIN
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

    if (!user.isVerified) {
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
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, cookieOptions);

    return res.status(200).json({
      message: "Logged in successfully",
      user: {
        id:       user._id,
        name:     user.name,
        username: user.username,
        email:    user.email,
        role:     user.role,
      },
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
  return res.status(200).json({ message: "Logged out successfully" });
}

// ══════════════════════════════════════════════════════════════
// UPDATE PROFILE  (NEW)  PATCH /api/auth/profile
// ══════════════════════════════════════════════════════════════
// Allowed fields: name, bio, avatar (URL string)
// Username and email are intentionally NOT changeable here
// to avoid collisions with unique indexes without extra validation.
async function updateProfile(req, res) {
  try {
    const { name, bio, avatar } = req.body;
    const userId = req.user.id;

    // Build update object — only include fields that were sent
    const updates = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed || trimmed.length < 2 || trimmed.length > 50) {
        return res.status(400).json({ message: "Name must be 2–50 characters." });
      }
      updates.name = trimmed;
    }

    if (bio !== undefined) {
      const trimmed = String(bio).trim();
      if (trimmed.length > 300) {
        return res.status(400).json({ message: "Bio cannot exceed 300 characters." });
      }
      updates.bio = trimmed;
    }

    if (avatar !== undefined) {
      const trimmed = String(avatar).trim();
      // Basic URL check — must start with http/https or be empty string (clear avatar)
      if (trimmed && !/^https?:\/\/.+/.test(trimmed)) {
        return res.status(400).json({ message: "Avatar must be a valid http/https URL." });
      }
      updates.avatar = trimmed;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields provided to update." });
    }

    const user = await userModel.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("id name username email role bio avatar");

    return res.json({
      message: "Profile updated successfully.",
      user,
    });

  } catch (err) {
    console.error("updateProfile error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

module.exports = {
  registerUser,
  verifyOTP,
  resendOTP,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  loginUser,
  logoutUser,
  updateProfile,
};