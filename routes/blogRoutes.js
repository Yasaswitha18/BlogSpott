const express = require("express");
const db = require("../db/postgresql.js");
const { requireAuthentication } = require("../utilities/auth.js");
const router = express.Router();

router.post("/", requireAuthentication, async (req, res) => {
    try {
        const { tags, content } = req.body || {};
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            return res.json({
                status: "error",
                title: "Validation Error",
                info: "Blog content cannot be empty"
            });
        }
        const cleanTags = Array.isArray(tags) ? tags : [];
        const result = await db.createNewBlog(cleanTags, content, res.locals.userId);
        return res.json(result);
    } catch (err) {
        console.error("[ROUTE] POST /blogs error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.get("/", async (req, res) => {
    try {
        const result = await db.fetchBlogs();
        res.json(result);
    } catch (err) {
        console.error("[ROUTE] GET /blogs error:", err.message);
        res.json({ 
            info: "An unexpected error occurred, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

module.exports = router;
