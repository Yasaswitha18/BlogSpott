const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db/postgresql.js");
const auth = require("../utilities/auth.js");
const mailer = require("../utilities/mailer.js");
const path = require("path");
require('dotenv').config({ path: path.join(__dirname, "..", ".env") });
const router = express.Router();

const { requireAuthentication } = auth;

router.post("/", async (req, res) => {
    try {
        const { name, email, password } = req.body || {};
        const result = await auth.createNewUser(name, email, password);
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] POST /auth error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const result = await auth.authenticateUser(email, password);
        if (result.status === "success" && result.data) {
            const token = jwt.sign(
                { 
                    data: result.data,
                    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
                }, 
                process.env.ACCESS_TOKEN_SECRET
            );
            result.token = token;
        }
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] POST /auth/login error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.get("/verify/:token", async (req, res) => {
    try {
        const { token } = req.params;
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        } catch (jwtErr) {
            if (jwtErr.name === "TokenExpiredError") {
                return res.json({
                    status: "error",
                    title: "Expired link",
                    info: "Verification link expired, request another verification link from the login page"
                });
            }
            return res.json({
                status: "error",
                title: "Invalid verification link",
                info: "The verification url is not valid, please request another verification link from the login page"
            });
        }

        if (!decoded || !decoded.data || !decoded.data.userId) {
            return res.json({
                status: "error",
                title: "Invalid verification link",
                info: "The verification token is missing required data"
            });
        }

        const result = await auth.verifyUser(decoded.data.userId);
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] GET /auth/verify error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.patch("/", requireAuthentication, async (req, res) => {
    try {
        const userId = res.locals.userId;
        const { name, password } = req.body || {};
        const trimmedName = name && typeof name === 'string' ? name.trim() : null;
        const trimmedPassword = password && typeof password === 'string' ? password.trim() : null;

        if (!trimmedName && !trimmedPassword) {
            return res.json({
                info: "No details were provided to update",
                status: "info",
                title: "No Changes"
            });
        }

        const result = await db.updateUserDetails(userId, trimmedName, trimmedPassword);
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] PATCH /auth error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.get("/resetemail", async (req, res) => {
    try {
        const { email } = req.query || {};
        if (!email) {
            return res.json({
                info: "Please provide a valid email address",
                status: "error",
                title: "Validation Error"
            });
        }

        const { userId, name } = await db.getUserDetailsFromEmail(email);
        if (!userId) {
            return res.json({
                info: "User doesn't exist", 
                status: "error", 
                title: "Error"
            });
        }

        try {
            await mailer.sendPasswordResetEmail(userId, email, name);
            res.json({ 
                info: "Password reset email sent successfully", 
                status: "success", 
                title: "Success" 
            });
        } catch (mailErr) {
            console.error("[ROUTE] Failed to send password reset email:", mailErr.message);
            res.json({
                info: "Failed to send reset email. Please try again later.",
                status: "error",
                title: "Delivery Failed"
            });
        }
    } catch (err) {
        console.error("[ROUTE] GET /auth/resetemail error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.patch("/aboutme", requireAuthentication, async (req, res) => {
    try {
        const { aboutMe } = req.body || {};
        const userId = res.locals.userId;
        const result = await db.updateUserAboutMe(userId, aboutMe);
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] PATCH /auth/aboutme error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.patch("/:token/changepassword", async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.query || {};

        if (!password || password.length < 6) {
            return res.json({
                info: "Password must be at least 6 characters long",
                status: "error",
                title: "Validation Error"
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        } catch (jwtErr) {
            if (jwtErr.name === "TokenExpiredError") {
                return res.json({
                    status: "error",
                    title: "Expired link",
                    info: "Verification link expired, request another verification link from the login page"
                });
            }
            return res.json({
                status: "error",
                title: "Invalid verification link",
                info: "The verification url is not valid, please request another verification link from the login page"
            });
        }

        if (!decoded || !decoded.data || !decoded.data.userId) {
            return res.json({
                status: "error",
                title: "Invalid link",
                info: "The reset link is missing user information"
            });
        }

        const result = await db.changeUserPassword(decoded.data.userId, password);
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] PATCH /auth/changepassword error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

module.exports = router;
