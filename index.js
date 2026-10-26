const path = require("path");
const express = require("express");
const authRoutes = require("./routes/authRoutes.js");
const blogRoutes = require("./routes/blogRoutes.js");
const userRoutes = require("./routes/userRoutes.js");
const db = require("./db/postgresql.js");
const app = express();

const startApp = async () => {
    app.listen(3000);
    db.connect();
}

app.use(express.json());
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/blogs", blogRoutes);
app.use("/api/v1/users", userRoutes);
app.use(express.static(path.join(__dirname, "./build/")));
app.get("*", (_, res) => { res.sendFile(path.join(__dirname, "./build/index.html"))});
startApp();