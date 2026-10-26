const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db/postgresql.js");
const auth = require("../utilities/auth.js");
const mailer = require("../utilities/mailer.js");
const path = require("path");
require('dotenv').config({ path: path.join(__dirname, "..", ".env") });
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

router.post("/", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const result = await auth.createNewUser(name, email, password);
        res.json(result);
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            info: "error", 
            title: "Error" 
        });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await auth.authenticateUser(email, password);
        if(result.status === "success") {
            const token = jwt.sign({ 
                data: result.data,
                exp: Math.floor(Date.now() / 1000) + (60 * 60) 
            }, process.env.ACCESS_TOKEN_SECRET);
            result.token = token;
        }
        res.json(result);
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            info: "error", 
            title: "Error" 
        });
    }
});

router.get("/verify/:token", async (req, res) => {
    try {
        const { token } = req.params;
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, decoded) => {
            if(err) {
                if(err.name === "TokenExpiredError") {
                    return res.json({
                        status: "error",
                        title: "Expired link",
                        info: "Verification link expired, request another verfication link from the login page"
                    });
                } else if(err.name === "JsonWebTokenError" || err.name === "SyntaxError") {
                    return res.json({
                        status: "error",
                        title: "Invalid verification link",
                        info: "The verification url is not valid, please request another verfication link from the login page"
                    });
                }
            }
            const result = await auth.verifyUser(decoded.data.userId);
            res.json(result);
        });
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            status: "error", 
            title: "Error" 
        });
    }
});

router.patch("/", requireAuthentication, async (req, res) => {
    try {
        const userId = res.locals.userId;
        const { name, password } = req.body;
        const result = await db.updateUserDetails(userId, name.trim(), password.trim());
        res.json(result);
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            info: "error", 
            title: "Error" 
        });
    }
});

router.get("/resetemail", async (req, res) => {
    try {
        const { email } = req.query;
        const { userId, name } = await db.getUserDetailsFromEmail(email);
        if(userId === null) {
            return res.json({
                info : "User doesn't exist", 
                status: "error", 
                title: "Error"
            })
        }
        await mailer.sendPasswordResetEmail(userId, email, name);
        res.json({ 
            info: "Password reset email sent succesfully", 
            status: "success", 
            title: "Success" 
        }); 
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            info: "error", 
            title: "Error" 
        });
    }
});

router.patch("/aboutme", requireAuthentication, async (req, res) => {
    try {
        const { aboutMe } = req.body;
        const userId = res.locals.userId;
        const result = await db.updateUserAboutMe(userId, aboutMe);
        res.json(result);
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            info: "error", 
            title: "Error" 
        });
    }
});

router.patch("/:token/changepassword", async (req, res) => {
    try {
        const { token } = req.params;
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, decoded) => {
            if(err) {
                if(err.name === "TokenExpiredError") {
                    return res.json({
                        status: "error",
                        title: "Expired link",
                        info: "Verification link expired, request another verfication link from the login page"
                    });
                } else if(err.name === "JsonWebTokenError" || err.name === "SyntaxError") {
                    return res.json({
                        status: "error",
                        title: "Invalid verification link",
                        info: "The verification url is not valid, please request another verfication link from the login page"
                    });
                }
            }
            const { password } = req.query;
            const result = await db.changeUserPassword(decoded.data.userId, password);
            res.json(result);
        });
    } catch(err) {
        res.json({ 
            err:"An unexpected error occured, please try again later", 
            info: "error", 
            title: "Error" 
        });
    }
});

module.exports = router;
