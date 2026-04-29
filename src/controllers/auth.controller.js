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
      pass: process.env.EMAIL_PASS,
    },
  });
}

// ─── Generate 6-digit OTP ─────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Email template ───────────────────────────────────────────────────
function otpEmailHTML(name, otp, subject) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0b0b18;color:#eeeef8;padding:32px;border-radius:16px;">
      <h1 style="color:#a094ff;margin-bottom:4px;">◉ NovaBeats</h1>
      <p style="color:#8080a0;margin-top:0">Music without limits</p>
      <hr style="border-color:#252540;margin:24px 0"/>
      <h2 style="margin-bottom:8px">Hi ${name}! 👋</h2>
      <p>${subject}</p>
      <div style="background:#1e1e30;border:2px solid #7c6af5;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
        <span style="font-size:2.5rem;font-weight:900;letter-spacing:12px;color:#a094ff;">${otp}</span>
      </div>
      <p style="color:#8080a0;font-size:0.85rem;">
        This OTP expires in <strong>10 minutes</strong>.<br/>
        If you didn't request this, ignore this email.
      </p>
    </div>
  `;
}

// ─── Send OTP ─────────────────────────────────────────────────────────
async function sendOTPEmail(email, name, otp, type = "verify") {
  const subjects = {
    verify:   { sub: "Verify your NovaBeats account",   body: "Enter this OTP to verify your email address:" },
    forgot:   { sub: "Reset your NovaBeats password",   body: "Enter this OTP to reset your password:" },
  };
  const s = subjects[type] || subjects.verify;
  const transporter = getTransporter();
  await transporter.sendMail({
    from:    `"NovaBeats" <${process.env.EMAIL_USER}>`,
    to:      email,
    subject: s.sub,
    html:    otpEmailHTML(name, otp, s.body),
  });
}

// ══════════════════════════════════════════════════════════════════════
// REGISTER — Step 1: save user as UNVERIFIED, send OTP
// ══════════════════════════════════════════════════════════════════════
async function registerUser(req, res) {
  try {
    const { name, username, email, password, role = "user" } = req.body;

    // Validate all fields
    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Username must be alphanumeric + underscore, 3-20 chars
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        message: "Username must be 3-20 characters and only contain letters, numbers, or underscores"
      });
    }

    // Check duplicate username or email
    const existing = await userModel.findOne({
      $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }]
    });

    if (existing) {
      // If the existing account has the same username (verified or not) → reject
      if (existing.username === username.toLowerCase() && existing.isVerified) {
        return res.status(409).json({ message: "Username is already taken. Please choose another." });
      }
      if (existing.email === email.toLowerCase()) {
        if (!existing.isVerified) {
          // Stale unverified account older than 24 h → delete and let registration proceed fresh
          const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
          if (existing.createdAt < staleThreshold) {
            await userModel.findByIdAndDelete(existing._id);
            // fall through to create a fresh account below
          } else {
            // Still within 24 h — just resend OTP
            const otp = generateOTP();
            existing.otp       = otp;
            existing.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
            await existing.save();
            try { await sendOTPEmail(existing.email, existing.name || existing.username, otp, "verify"); } catch {}
            return res.status(200).json({
              message: "Account already exists but not verified. New OTP sent to your email.",
              userId: existing._id,
              email:  existing.email,
            });
          }
        } else {
          return res.status(409).json({ message: "Email is already registered. Please sign in." });
        }
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const otp  = generateOTP();

    // ✅ KEY FIX: isVerified is false — user CANNOT login until OTP verified
    const user = await userModel.create({
      name,
      username: username.toLowerCase(),
      email:    email.toLowerCase(),
      password: hash,
      role,
      isVerified: false,   // ← blocks login
      otp,
      otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
    });

    // Send OTP email
    try {
      await sendOTPEmail(email, name, otp, "verify");
    } catch (emailErr) {
      console.error("Email send failed:", emailErr.message);
      // Don't delete user, just warn
    }

    // ✅ NO cookie set here — must verify OTP first
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

// ══════════════════════════════════════════════════════════════════════
// VERIFY OTP — Step 2: activates account, logs user in
// ══════════════════════════════════════════════════════════════════════
async function verifyOTP(req, res) {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) {
      return res.status(400).json({ message: "userId and OTP are required" });
    }

    const user = await userModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.isVerified) {
      return res.status(400).json({ message: "Account is already verified. Please sign in." });
    }

    if (user.otp !== String(otp).trim()) {
      return res.status(400).json({ message: "Invalid OTP. Please check and try again." });
    }

    if (new Date() > new Date(user.otpExpiry)) {
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }

    // ✅ Activate account
    user.isVerified = true;
    user.otp        = null;
    user.otpExpiry  = null;
    await user.save();

    // ✅ Now issue JWT and log user in
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, cookieOptions);

    res.status(200).json({
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
    console.error("OTP verify error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════
// RESEND OTP (for registration or password reset)
// ══════════════════════════════════════════════════════════════════════
async function resendOTP(req, res) {
  try {
    const { userId } = req.body;
    const user = await userModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isVerified && !user.resetMode) {
      return res.status(400).json({ message: "Account is already verified." });
    }

    const otp = generateOTP();
    user.otp       = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    if (!user.resetMode) user.resetMode = false; // ensure it's explicitly false for registration resends
    await user.save();

    const type = user.resetMode ? "forgot" : "verify";
    await sendOTPEmail(user.email, user.name || user.username, otp, type);

    res.json({ message: "New OTP sent to your email." });

  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════
// FORGOT PASSWORD — Step 1: find account, send OTP
// ══════════════════════════════════════════════════════════════════════
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await userModel.findOne({ email: email.toLowerCase() });

    // Always return success message (security — don't reveal if email exists)
    if (!user) {
      return res.status(200).json({
        message: "If that email is registered, an OTP has been sent.",
      });
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
    user.resetMode = true;   // flag to allow OTP usage for password reset
    await user.save();

    await sendOTPEmail(user.email, user.name || user.username, otp, "forgot");

    res.status(200).json({
      message: "OTP sent to your email.",
      userId:  user._id,
    });

  } catch (err) {
    console.error("forgotPassword error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════
// VERIFY RESET OTP — Step 2
// ══════════════════════════════════════════════════════════════════════
async function verifyResetOTP(req, res) {
  try {
    const { userId, otp } = req.body;
    const user = await userModel.findById(userId);
    if (!user || !user.resetMode) {
      return res.status(400).json({ message: "Invalid request" });
    }
    if (user.otp !== String(otp).trim()) {
      return res.status(400).json({ message: "Invalid OTP. Please try again." });
    }
    if (new Date() > new Date(user.otpExpiry)) {
      return res.status(400).json({ message: "OTP expired. Please request a new one." });
    }

    // OTP is valid — issue a short-lived reset token
    const resetToken = jwt.sign(
      { id: user._id, purpose: "reset" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    user.otp       = null;
    user.otpExpiry = null;
    await user.save();

    res.json({ message: "OTP verified. You can now reset your password.", resetToken });

  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════
// RESET PASSWORD — Step 3
// ══════════════════════════════════════════════════════════════════════
async function resetPassword(req, res) {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: "Reset token and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ message: "Reset link expired. Please start over." });
    }

    if (decoded.purpose !== "reset") {
      return res.status(400).json({ message: "Invalid reset token" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await userModel.findByIdAndUpdate(decoded.id, {
      password:  hash,
      resetMode: false,
      otp:       null,
      otpExpiry: null,
    });

    res.json({ message: "Password reset successfully! You can now sign in." });

  } catch (err) {
    res.status(500).json({ message: "Server error: " + err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════
// LOGIN — blocked if not verified
// ══════════════════════════════════════════════════════════════════════
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

    // ✅ Block unverified users — send them back to OTP screen
    if (!user.isVerified) {
      // Resend OTP automatically
      const otp = generateOTP();
      user.otp       = otp;
      user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      try { await sendOTPEmail(user.email, user.name || user.username, otp, "verify"); } catch {}

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

// ══════════════════════════════════════════════════════════════════════
// LOGOUT
// ══════════════════════════════════════════════════════════════════════
async function logoutUser(req, res) {
  res.clearCookie("token", cookieOptions);
  res.status(200).json({ message: "Logged out successfully" });
}

module.exports = {
  registerUser, verifyOTP, resendOTP,
  forgotPassword, verifyResetOTP, resetPassword,
  loginUser, logoutUser,
};