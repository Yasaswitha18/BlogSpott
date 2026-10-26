const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db/postgresql.js");
const auth = require("../utilities/auth.js");
const MockDb = require("./mockDb.js");

describe("Authentication, Verification, and Security", () => {
    let mockDb;

    beforeEach(async () => {
        process.env.ACCESS_TOKEN_SECRET = "test_jwt_secret_key_1234567890";
        mockDb = new MockDb();
        db.setPool(mockDb);

        const passwordHash = await bcrypt.hash("CorrectPassword123", 12);
        mockDb.users.push({
            userid: 1,
            name: "Verified User",
            email: "verified@example.com",
            password: passwordHash,
            isverified: true,
            datejoined: "2026-01-01",
            aboutme: "About me"
        });

        mockDb.users.push({
            userid: 2,
            name: "Unverified User",
            email: "unverified@example.com",
            password: passwordHash,
            isverified: false,
            datejoined: "2026-01-01",
            aboutme: "About me"
        });
    });

    test("1. Login succeeds with valid credentials and does NOT leak password or password hash", async () => {
        const result = await auth.authenticateUser("verified@example.com", "CorrectPassword123");

        assert.strictEqual(result.status, "success");
        assert.strictEqual(result.title, "Login Successful");
        assert(result.data);
        assert.strictEqual(result.data.userId, 1);
        assert.strictEqual(result.data.email, "verified@example.com");

        // CRITICAL SECURITY CHECK: password and password hash must never be in returned data
        assert.strictEqual(result.data.password, undefined);
        assert.strictEqual(result.data.passwordHash, undefined);

        // Sign token as done in authRoutes
        const token = jwt.sign({ data: result.data }, process.env.ACCESS_TOKEN_SECRET);
        const decoded = jwt.decode(token);
        assert.strictEqual(decoded.data.password, undefined);
    });

    test("2. Login fails on invalid credentials", async () => {
        // Wrong password
        const res1 = await auth.authenticateUser("verified@example.com", "WrongPassword");
        assert.strictEqual(res1.status, "error");
        assert.strictEqual(res1.info, "Invalid credentials");

        // Non-existent email
        const res2 = await auth.authenticateUser("nonexistent@example.com", "CorrectPassword123");
        assert.strictEqual(res2.status, "error");
        assert.strictEqual(res2.info, "Invalid credentials");
    });

    test("3. Login identifies unverified accounts and refuses login while resending link", async () => {
        const result = await auth.authenticateUser("unverified@example.com", "CorrectPassword123");

        assert.strictEqual(result.status, "warning");
        assert.strictEqual(result.title, "Not verified");
        assert(result.info.includes("not verified"));
        assert.strictEqual(result.data, undefined);
    });

    test("4. Account verification activates user account when token is valid", async () => {
        assert.strictEqual(mockDb.users.find(u => u.userid === 2).isverified, false);

        const result = await auth.verifyUser(2);
        assert.strictEqual(result.status, "success");
        assert.strictEqual(result.title, "Account verification successful");

        // Database updated
        assert.strictEqual(mockDb.users.find(u => u.userid === 2).isverified, true);

        // Verifying again informs that user is already verified
        const secondAttempt = await auth.verifyUser(2);
        assert.strictEqual(secondAttempt.status, "info");
        assert.strictEqual(secondAttempt.title, "Account already verified");
    });

    test("5. requireAuthentication middleware blocks unauthorized access and allows valid tokens", () => {
        const middleware = auth.requireAuthentication;

        // No token provided
        let responseJson = null;
        let nextCalled = false;
        middleware(
            { headers: {} },
            { json: (data) => { responseJson = data; } },
            () => { nextCalled = true; }
        );
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(responseJson.status, "error");
        assert.strictEqual(responseJson.title, "Authentication error");

        // Expired token
        const expiredToken = jwt.sign(
            { data: { userId: 1, email: "user@example.com", name: "User" } },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: -10 }
        );
        responseJson = null;
        nextCalled = false;
        middleware(
            { headers: { authorization: expiredToken } },
            { json: (data) => { responseJson = data; } },
            () => { nextCalled = true; }
        );
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(responseJson.status, "warning");
        assert.strictEqual(responseJson.title, "Timeout");

        // Valid token
        const validToken = jwt.sign(
            { data: { userId: 1, email: "verified@example.com", name: "Verified User" } },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "1h" }
        );
        const resMock = { locals: {} };
        nextCalled = false;
        middleware(
            { headers: { authorization: `Bearer ${validToken}` } },
            resMock,
            () => { nextCalled = true; }
        );
        assert.strictEqual(nextCalled, true);
        assert.strictEqual(resMock.locals.userId, 1);
        assert.strictEqual(resMock.locals.email, "verified@example.com");
    });
});
