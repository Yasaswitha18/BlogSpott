const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db/postgresql.js");
const router = express.Router();

const requireAuthentication = (req, res, next) => {
    const token = req.headers.authorization;
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if(err) {
            if(err.name === "TokenExpiredError") {
                return res.json({
                    status: "warning",
                    title: "Timeout",
                    info: "Token expired, please login again"
                });
            } else if(err.name === "JsonWebTokenError" || err.name === "SyntaxError") {
                return res.json({
                    status: "error",
                    title: "Authentication error",
                    info: "User is not logged in"
                });
            }
        } else {
            res.locals.userId = decoded.data.userId;
            res.locals.email = decoded.data.email;
            res.locals.name = decoded.data.name;
            next();
        }
    });
}

router.post("/", requireAuthentication, async (req, res) => {
    try {
        const { tags, content } = req.body;
        const result = await db.createNewBlog(tags, content, res.locals.userId);
        return res.json(result);
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            info: "error", 
            title: "Error" 
        });
    }
});

router.get("/", async (req, res) => {
    try {
        const result = await db.fetchBlogs();
        res.json(result);
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            info: "error", 
            title: "Error" 
        });
    }
});

module.exports = router;
