const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { app } = require("../index.js");
const db = require("../db/postgresql.js");
const mailer = require("../utilities/mailer.js");
const MockDb = require("./mockDb.js");

describe("Express HTTP API End-to-End Tests", () => {
    let server;
    let baseUrl;
    let mockDb;
    let sentEmails = [];

    before(async () => {
        process.env.ACCESS_TOKEN_SECRET = "test_jwt_secret_key_1234567890";
        process.env.DOMAIN = "test.blogspot.com";

        mockDb = new MockDb();
        db.setPool(mockDb);

        mailer.setTransporter({
            sendMail: async (options) => {
                sentEmails.push(options);
                return { messageId: "mock-123" };
            }
        });

        await new Promise((resolve) => {
            server = http.createServer(app);
            server.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    });

    test("1. GET /health returns status ok", async () => {
        const res = await fetch(`${baseUrl}/health`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.status, "ok");
        assert(data.uptime >= 0);
    });

    test("2. POST /api/v1/auth handles valid signup and formats JSON response for frontend toast", async () => {
        const res = await fetch(`${baseUrl}/api/v1/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Alex Johnson",
                email: "alex@example.com",
                password: "MySecurePassword123"
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.status, "success");
        assert.strictEqual(data.title, "Account successfully created");
        assert(typeof data.info === "string");
        assert(data.info.length > 0);
    });

    test("3. POST /api/v1/auth/login handles login and returns JWT without leaking password", async () => {
        // First verify the user in mockDb so they can log in
        const user = mockDb.users.find(u => u.email === "alex@example.com");
        assert(user);
        user.isverified = true;

        const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "alex@example.com",
                password: "MySecurePassword123"
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.status, "success");
        assert.strictEqual(data.title, "Login Successful");
        assert(data.token);
        assert.strictEqual(data.data.email, "alex@example.com");
        assert.strictEqual(data.data.password, undefined);
    });

    test("4. Unknown API route returns JSON 404 instead of HTML", async () => {
        const res = await fetch(`${baseUrl}/api/v1/does_not_exist`);
        assert.strictEqual(res.status, 404);
        const data = await res.json();
        assert.strictEqual(data.status, "error");
        assert.strictEqual(data.title, "Not Found");
    });

    test("5. GET / serves static React index.html", async () => {
        const res = await fetch(`${baseUrl}/`);
        assert.strictEqual(res.status, 200);
        const text = await res.text();
        assert(text.includes("<div id=\"root\"></div>"));
    });
});
