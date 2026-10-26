const db = require("../db/postgresql.js");
const express = require("express");
const { requireAuthentication } = require("../utilities/auth.js");
const router = express.Router();

router.get("/", requireAuthentication, async (req, res) => {
    try {
        const { name } = req.query || {};
        if (!name || typeof name !== 'string') {
            return res.json({ data: [] });
        }
        const keywords = name
            .split(" ")
            .map(k => k.trim())
            .filter(k => k.length > 0);

        if (keywords.length > 0) {
            const result = await db.getUserDetailsForSearch(keywords);
            return res.json(result);
        }
        res.json({ data: [] });
    } catch (err) {
        console.error("[ROUTE] GET /users error:", err.message);
        res.json({
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.get("/:userId", requireAuthentication, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (isNaN(userId)) {
            return res.json({
                info: "Invalid user ID provided",
                status: "error",
                title: "Validation Error"
            });
        }
        const result = await db.getUserDetails(userId);
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] GET /users/:userId error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.get("/:userId/blogs", requireAuthentication, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (isNaN(userId)) {
            return res.json({
                info: "Invalid user ID provided",
                status: "error",
                title: "Validation Error"
            });
        }
        const result = await db.fetchBlogs(userId);
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] GET /users/:userId/blogs error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

module.exports = router;