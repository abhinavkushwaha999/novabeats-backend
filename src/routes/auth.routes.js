const express        = require("express");
const rateLimit      = require("express-rate-limit");
const authController = require("../controllers/auth.controller");
const { authUser }   = require("../middlewares/auth.middleware");

const router = express.Router();

// ── Rate Limiters ─────────────────────────────────────────────
//
// Why different limits per route?
//   • /register  — 5 per hour stops mass account creation
//   • /login     — 10 per 15 min stops password brute-force
//   • OTP routes — 5 per 15 min stops OTP enumeration attacks
//   • /profile   — 20 per 15 min: normal usage, prevents spam updates

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 5,
  message: { message: "Too many registration attempts. Try again in 1 hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 10,
  message: { message: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 5,
  message: { message: "Too many OTP attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,
  message: { message: "Too many requests. Slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Registration flow ─────────────────────────────────────────
router.post("/register",          registerLimiter, authController.registerUser);
router.post("/verify-otp",        otpLimiter,      authController.verifyOTP);
router.post("/resend-otp",        otpLimiter,      authController.resendOTP);

// ── Forgot password flow ──────────────────────────────────────
router.post("/forgot-password",   otpLimiter,      authController.forgotPassword);
router.post("/verify-reset-otp",  otpLimiter,      authController.verifyResetOTP);
router.post("/reset-password",    otpLimiter,      authController.resetPassword);

// ── Login / Logout ────────────────────────────────────────────
router.post("/login",             loginLimiter,    authController.loginUser);
router.post("/logout",                             authController.logoutUser);

// ── Profile update (NEW) ──────────────────────────────────────
router.patch("/profile",          profileLimiter, authUser, authController.updateProfile);

module.exports = router;