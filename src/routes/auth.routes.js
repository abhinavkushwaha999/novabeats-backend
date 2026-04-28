const express        = require("express");
const authController = require("../controllers/auth.controller");

const router = express.Router();

// Registration flow
router.post("/register",     authController.registerUser);
router.post("/verify-otp",   authController.verifyOTP);
router.post("/resend-otp",   authController.resendOTP);

// Forgot password flow
router.post("/forgot-password",    authController.forgotPassword);
router.post("/verify-reset-otp",   authController.verifyResetOTP);
router.post("/reset-password",     authController.resetPassword);

// Login / Logout
router.post("/login",  authController.loginUser);
router.post("/logout", authController.logoutUser);

module.exports = router;