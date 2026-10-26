const db = require("../db/postgresql.js");
const express = require("express");
const jwt = require("jsonwebtoken");
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

router.get("/", requireAuthentication, async (req, res) => {
    try {
        const { name } = req.query;
        const keywords = name.split(" ");
        const mainKeywords = [];
        for(let keyword of keywords) {
            if(keyword.trim !== "") {
                mainKeywords.push(keyword.trim());
            }
        }
        if(mainKeywords != []) {
            const result = await db.getUserDetailsForSearch(mainKeywords);
            return res.json(result);
        }
        res.json({ data: [] });
    } catch(err) {
        res.json({
            info: "An unexpected error occured, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.get("/:userId", requireAuthentication, async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await db.getUserDetails(userId);
        res.json(result);
    } catch(err) {
        res.json({ 
            info: "An unexpected error occured, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.get("/:userId/blogs", requireAuthentication, async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await db.fetchBlogs(userId);
        res.json(result);
    } catch(err) {
        res.json({ 
            info: "An unexpected error occured, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
})

module.exports = router;