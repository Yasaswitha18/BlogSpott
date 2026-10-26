const path = require("path");
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes.js");
const blogRoutes = require("./routes/blogRoutes.js");
const userRoutes = require("./routes/userRoutes.js");
const db = require("./db/postgresql.js");
require('dotenv').config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;

// Validate essential environment variables at startup (without exposing secrets)
const validateEnv = () => {
    const hasDbConn = !!(process.env.CONNECTION_STRING || process.env.DATABASE_URL);
    const hasJwtSecret = !!process.env.ACCESS_TOKEN_SECRET;
    const hasMailUser = !!process.env.MAIL_ID;
    const hasMailPass = !!process.env.MAIL_PASSWORD;
    const hasDomain = !!(process.env.DOMAIN || process.env.APP_URL);

    if (!hasDbConn) {
        console.warn("[STARTUP WARNING] Neither CONNECTION_STRING nor DATABASE_URL is defined. Database queries will fail until configured.");
    }
    if (!hasJwtSecret) {
        console.warn("[STARTUP WARNING] ACCESS_TOKEN_SECRET is not defined. JWT token generation and authentication will fail.");
    }
    if (!hasMailUser || !hasMailPass) {
        console.warn("[STARTUP NOTICE] MAIL_ID or MAIL_PASSWORD is not set. Verification emails will fail to dispatch until configured.");
    }
    if (!hasDomain) {
        console.warn(`[STARTUP NOTICE] DOMAIN is not set. Defaulting email links to localhost:${PORT}.`);
    }
};

validateEnv();

// CORS configuration
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = process.env.CLIENT_ORIGIN 
            ? process.env.CLIENT_ORIGIN.split(',').map(o => o.trim()) 
            : null;

        // Allow requests with no origin (like mobile apps, curl, or same-origin)
        if (!origin || !allowedOrigins || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            callback(null, true); // Fallback permissive for deployment flexibility
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

// Health check endpoint for Render and monitoring
app.get(["/health", "/api/health"], (req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// API Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/blogs", blogRoutes);
app.use("/api/v1/users", userRoutes);

// Static frontend serving
const buildPath = path.join(__dirname, "build");
app.use(express.static(buildPath));

// Catch-all route: API 404s vs React Single Page App fallback
app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({
            status: "error",
            title: "Not Found",
            info: `API endpoint ${req.method} ${req.path} not found`
        });
    }
    res.sendFile(path.join(buildPath, "index.html"));
});

// Global error handling middleware
app.use((err, req, res, next) => {
    console.error("[SERVER ERROR]", err.message);
    res.status(err.status || 500).json({
        status: "error",
        title: "Server Error",
        info: "An unexpected internal server error occurred"
    });
});

let server = null;

const startApp = async () => {
    try {
        console.log("[SERVER] Starting BlogSpot application...");
        if (process.env.CONNECTION_STRING || process.env.DATABASE_URL) {
            try {
                await db.connect();
            } catch (dbErr) {
                console.error("[SERVER WARNING] Initial database connection attempt failed:", dbErr.message);
            }
        }
        server = app.listen(PORT, () => {
            console.log(`[SERVER] BlogSpot application listening on port ${PORT}`);
        });
        return server;
    } catch (err) {
        console.error("[SERVER FATAL] Failed to start application:", err.message);
        throw err;
    }
};

const gracefulShutdown = async (signal) => {
    console.log(`[SERVER] Received ${signal}. Initiating graceful shutdown...`);
    if (server) {
        server.close(async () => {
            await db.close();
            console.log("[SERVER] Server and database pool closed cleanly.");
            process.exit(0);
        });
    } else {
        await db.close();
        process.exit(0);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
    startApp();
}

module.exports = { app, startApp };