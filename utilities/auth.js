const db = require("../db/postgresql.js");
const mailer = require("./mailer.js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return typeof email === 'string' && emailRegex.test(email.trim());
};

const requireAuthentication = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.json({
            status: "error",
            title: "Authentication error",
            info: "User is not logged in"
        });
    }
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (!token) {
        return res.json({
            status: "error",
            title: "Authentication error",
            info: "User is not logged in"
        });
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            if (err.name === "TokenExpiredError") {
                return res.json({
                    status: "warning",
                    title: "Timeout",
                    info: "Token expired, please login again"
                });
            }
            return res.json({
                status: "error",
                title: "Authentication error",
                info: "User is not logged in"
            });
        }
        if (!decoded || !decoded.data || !decoded.data.userId) {
            return res.json({
                status: "error",
                title: "Authentication error",
                info: "Invalid token payload"
            });
        }
        res.locals.userId = decoded.data.userId;
        res.locals.email = decoded.data.email;
        res.locals.name = decoded.data.name;
        next();
    });
};

module.exports = {
    requireAuthentication,
    createNewUser: async (name, email, password) => {
        try {
            // Field validation
            if (!name || typeof name !== 'string' || name.trim().length < 2) {
                return {
                    status: "error",
                    title: "Validation Error",
                    info: "Name must be at least 2 characters long"
                };
            }
            if (!isValidEmail(email)) {
                return {
                    status: "error",
                    title: "Validation Error",
                    info: "Please provide a valid email address"
                };
            }
            if (!password || typeof password !== 'string' || password.length < 6) {
                return {
                    status: "error",
                    title: "Validation Error",
                    info: "Password must be at least 6 characters long"
                };
            }

            const normalizedEmail = email.trim().toLowerCase();
            const trimmedName = name.trim();

            const [user, isVerified] = await db.checkIfUserExistsAndVerified(normalizedEmail);
            if (user && user.email && isVerified) {
                return { 
                    info: "Account with this email already exists, please try with another email", 
                    status: "info", 
                    title: "Account already exists" 
                };
            } else if (user && user.email) {
                try {
                    await mailer.sendVerificationLink(user.userId, user.email, user.name);
                    return { 
                        info: "Account with this email already exists, please click on the verification link sent to your email to continue login", 
                        status: "info", 
                        title: "Account already exists" 
                    };
                } catch (mailErr) {
                    console.error("[AUTH] Failed to resend verification email:", mailErr.message);
                    return {
                        info: "An unverified account with this email already exists. We were unable to send a verification email right now, please try again shortly.",
                        status: "info",
                        title: "Verification Pending"
                    };
                }
            }

            const hashedPassword = await bcrypt.hash(password, 12);
            let userId;
            try {
                userId = await db.createNewUser(trimmedName, normalizedEmail, hashedPassword);
            } catch (dbErr) {
                // Handle duplicate key race condition (23505 in PostgreSQL)
                if (dbErr.code === '23505') {
                    return {
                        info: "Account with this email already exists, please try with another email",
                        status: "info",
                        title: "Account already exists"
                    };
                }
                throw dbErr;
            }

            // Attempt email delivery; handle failure gracefully without failing registration or deleting user
            try {
                await mailer.sendVerificationLink(userId, normalizedEmail, trimmedName);
                return {
                    info: "Account successfully created, please click on the verification link sent to your email to continue login", 
                    status: "success", 
                    title: "Account successfully created" 
                };
            } catch (mailErr) {
                console.error("[AUTH] Verification email delivery failed:", mailErr.message);
                return {
                    info: "Account successfully created! However, we could not deliver the verification email right now. You can request a verification link from the login page.",
                    status: "success",
                    title: "Account successfully created"
                };
            }
        } catch (err) {
            console.error("[AUTH] Error in createNewUser:", err.message);
            throw err;
        }
    },

    verifyUser: async (userId) => {
        try {
            const userResult = await db.getUserDetails(userId);
            if (userResult.status === "error" || !userResult.details) {
                return {
                    info: "User account could not be found",
                    status: "error",
                    title: "Account Not Found"
                };
            }

            const { isVerified, name } = userResult.details;
            if (isVerified === true) {
                return { 
                    info: `Hi ${name || 'there'}, you can now use your credentials to login`, 
                    status: "info", 
                    title: "Account already verified" 
                };
            }

            await db.activateUserAccount(userId);
            return {
                info: `Hi ${name || 'there'}, your account has been verified! You can now use your credentials to login.`, 
                status: "success", 
                title: "Account verification successful" 
            };
        } catch (err) {
            console.error("[AUTH] Error in verifyUser:", err.message);
            throw err;
        }
    },

    authenticateUser: async (email, password) => {
        try {
            if (!email || !password) {
                return {
                    info: "Invalid credentials", 
                    status: "error", 
                    title: "Error" 
                };
            }

            const normalizedEmail = email.trim().toLowerCase();
            const { userId, name, isVerified, password: passwordInDb } = await db.getUserDetailsFromEmail(normalizedEmail);

            if (!userId || !passwordInDb || !(await bcrypt.compare(password, passwordInDb))) {
                return {
                    info: "Invalid credentials", 
                    status: "error", 
                    title: "Error" 
                };
            }

            if (!isVerified) {
                try {
                    await mailer.sendVerificationLink(userId, normalizedEmail, name);
                    return { 
                        info: "User is not verified, but don't worry we have sent you a verification mail to your email", 
                        status: "warning", 
                        title: "Not verified" 
                    };
                } catch (mailErr) {
                    console.error("[AUTH] Failed to send verification link during login:", mailErr.message);
                    return { 
                        info: "User is not verified. We had trouble sending a verification email right now, please try again shortly.", 
                        status: "warning", 
                        title: "Not verified" 
                    };
                }
            }

            // Return user data WITHOUT password or password hash
            return { 
                info: "Login Successful", 
                status: "success", 
                title: "Login Successful", 
                data: { userId, email: normalizedEmail, name, isVerified }
            };
        } catch (err) {
            console.error("[AUTH] Error in authenticateUser:", err.message);
            throw err;
        }
    }
};