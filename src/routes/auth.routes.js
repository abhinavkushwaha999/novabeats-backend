const express = require("express");
const authController = require("../controllers/auth.controller");

const router = express.Router();

router.post("/register", authController.registerUser);
router.post("/verify-otp", authController.verifyOTP);
router.post("/resend-otp", authController.resendOTP);
router.post("/login",    authController.loginUser);
router.post("/logout",   authController.logoutUser);

module.exports = router;