const pg = require("pg");
const path = require("path");
const bcrypt = require("bcryptjs");
const dateTime = require("../utilities/dateTime.js");
require('dotenv').config({ path: path.join(__dirname, "..", ".env") });
const client = new pg.Client(process.env.CONNECTION_STRING);

module.exports = {
    connect: () => {
        client.connect(err => {
            if(err) {
                return ;
            }
        })
    },
    query: async query => {
        try {
            const result = await client.query(query);
            return result;
        } catch(err) {
            console.log(err);
        }
    },
    droptagstable: async()  => {
        const query = `DROP TABLE tags`;
        await client.query(query);
    },
    dropblogstable: async() => {
        const query = `DROP TABLE blogs`;
        await client.query(query);
    },
    dropusertable: async()  => {
        const query = `DROP TABLE users`;
        await client.query(query);
    },
    createusertable: async () => {
        const query = `
            CREATE TABLE users (
                userId bigserial primary key,
                email varchar(64) not null unique,
                name varchar(64) not null,
                password varchar(64) not null,
                isverified boolean not null,
                dateJoined DATE not null,
                aboutMe text not null
            );
        `;
        await client.query(query);
    },
    createtagstable: async () => {
        const query = `
            CREATE TABLE TAGS (
                blogId integer not null,
                tag varchar(16) not null,
                constraint fk_blog_id FOREIGN KEY(blogId) REFERENCES blogs(blogId)
            );
        `;
        await client.query(query);
    },
    createblogstable: async () => {
        const query =   `
            CREATE TABLE blogs (
                blogId bigserial primary key,
                blogDate DATE not null,
                content text not null,
                userId integer not null,
                constraint fk_user_id FOREIGN KEY(userId) REFERENCES users(userId)
            )
        `;
        await client.query(query);
    },
    createNewBlog: async (tags, content, userId) => {
        try {
            await client.query("BEGIN");
            const blogDate = new Date().toISOString();
            const { rows: [{ blogid: blogId }] } = await client.query(`INSERT INTO blogs(blogDate, content, userId) VALUES ('${blogDate}', '${content}', ${userId}) RETURNING blogId`);
            if(tags.length > 0) {
                await client.query(`INSERT INTO tags(blogId, tag) VALUES ${tags.map(tag => `(${blogId}, '${tag}')`).join(", ")}`);
            }
            await client.query("COMMIT");
            return { 
                info: "Blog created successfully", 
                status: "success", 
                title: "Success" 
            };
        } catch(err) {
            await client.query("ROLLBACK");
            throw err;
        }
    },
    fetchBlogs: async userId => {
        try {
            const tempResult = await client.query(`
                SELECT 
                    blogs.blogId blogId,
                    blogs.blogDate blogDate,
                    blogs.content blogContent,
                    blogs.userId userId,
                    users.email email,
                    users.name userName,
                    COALESCE(blogIdToTags.tags, ARRAY[]::text[]) AS tags
                FROM
                    blogs 
                INNER JOIN users ON 
                    blogs.userId = users.userId
                LEFT JOIN (
                    SELECT 
                        blogId, 
                        ARRAY_AGG(tag) tags
                    FROM
                        tags
                    GROUP BY
                        blogId
                ) blogIdToTags ON
                    blogs.blogId = blogIdToTags.blogId
                ${userId ? `WHERE users.userId = ${userId}` : ""}
                ORDER BY blogDate DESC
            `);
            const result = tempResult.rows.map(row => ({
                blogId: row.blogid,
                blogDate: dateTime.convertDateTimeFormat(row.blogdate),
                content: row.blogcontent,
                userId: row.userid,
                email: row.email,
                name: row.username,
                tags: row.tags
            }));
            return { 
                data: result, 
                info: "Blogs Fetched Successfully", 
                status: "success", 
                title: "Success" 
            };
        } catch(err) {
            throw err;
        }
    },
    activateUserAccount: async userId => {
        try {
            await client.query(`UPDATE users SET isVerified = true WHERE userId = ${userId}`);
        } catch(err) {
            throw err;
        }
    },
    checkIfUserExistsAndVerified: async email => {
        const { rows } = await client.query(`SELECT * FROM users WHERE email = '${email}'`);
        if(rows.length === 0) {
            return [{}, false];
        }
        const { userid: userId, name: name, isverified: isVerified } = rows[0];
        return [{ userId, email, name }, isVerified];
    },
    createNewUser: async (name, email, hashedPassword) => {
        try {
            const dateJoined = new Date().toISOString();
            const { rows: [{ userid: userId }] } = await client.query(`INSERT INTO users(name, email, password, isVerified, dateJoined, aboutMe) VALUES('${name}', '${email}', '${hashedPassword}', false, '${dateJoined}', 'About Me section is incomplete') RETURNING userId`);
            return userId;
        } catch(err) {
            throw err;
        }
    },
    getUserDetailsFromEmail: async email => {
        try {
            const query = `SELECT userId, name, password, isVerified FROM users WHERE email = '${email}'`;
            const result = await client.query(query);
            if(result.rows[0] == undefined) {
                return { userId: null, name: null, password: null, isVerified: null };
            }
            return {
                userId: result.rows[0].userid,
                name: result.rows[0].name,
                email: result.rows[0].email,
                password: result.rows[0].password,
                isVerified: result.rows[0].isverified
            };
        } catch(err) {
            throw err;
        }
    },
    changeUserPassword: async (userId, password) => {
        const hashedPassword = await bcrypt.hash(password, 12);
        const query = `UPDATE users SET password = '${hashedPassword}' WHERE userId = ${userId}`;
        await client.query(query);
        return { 
            info: "Password reset successful", 
            status: "success", 
            title: "Success"
        };
    },
    getUserDetailsForSearch: async keywords => {
        let result = [];
        for(let keyword of keywords) {
            const query = `SELECT userId, name, email FROM users WHERE UPPER(name) LIKE UPPER('%${keyword}%') AND isVerified = true`;
            const tempResult = await client.query(query);
            for(let newItem of tempResult.rows) {
                let flag = true;
                for(let res of result) {
                    if(newItem.userid === res.userId) {
                        flag = false;
                    }
                }
                if(flag === true) {
                    result.push({
                        userId: newItem.userid,
                        name: newItem.name,
                        email: newItem.email
                    });
                }
            }
        }
        const mainResult = { 
            data: result, 
            info: "Fetch Successful", 
            status: "success", 
            title: "Success" 
        };
        return mainResult;
    },
    updateUserDetails: async (userId, name, password) => {
        let query, hashedPassword;
        if(password) {
            hashedPassword = await bcrypt.hash(password, 12);
        }
        if(name && password) {
            query = `UPDATE users SET name = '${name}', password = '${hashedPassword}' WHERE userId = ${userId}`;
        } else if(name && !password) {
            query = `UPDATE users SET name = '${name}' WHERE userId = ${userId}`;
        } else if(!name && password) {
            query = `UPDATE users SET password = '${hashedPassword}' WHERE userId = ${userId}`;
        }
        const result = client.query(query);
        return { 
            info: "User details successfully updated", 
            status: "success", 
            title: "Success" 
        };
    },
    getUserDetails: async userId => {
        try {
            const result1 = await client.query(`
                SELECT
                    name,
                    email,
                    aboutMe,
                    dateJoined,
                    isVerified,
                    (SELECT COUNT(*) FROM blogs WHERE userId = ${userId}) count
                FROM
                    users
                WHERE
                    users.userId = ${userId}
            `);
            const result2 = await client.query(`
                SELECT
                    EXTRACT(MONTH FROM blogDate) theMonth,
                    COUNT(*) count
                FROM
                    blogs
                WHERE
                    EXTRACT(YEAR FROM blogDate) = EXTRACT(YEAR FROM CURRENT_DATE)
                GROUP BY
                    EXTRACT(MONTH FROM blogDate)
                ORDER BY
                    EXTRACT(MONTH FROM blogDate)
            `);
            for(let month = 1; month <= 12; month++) {
                let flag = true;
                for(let { themonth, count } of result2.rows) {
                    if(themonth == month) {
                        flag = false;
                        break;
                    }
                }
                if(flag) {
                    result2.rows.push({ themonth: month, count: 0 });
                }
            }
            result2.rows = result2.rows.sort((a, b) => a.themonth - b.themonth);
            return { details: result1.rows.length > 0 ? {
                name: result1.rows[0].name,
                aboutMe: result1.rows[0].aboutme,
                email: result1.rows[0].email,
                dateJoined: dateTime.convertDateTimeFormat(result1.rows[0].datejoined),
                count: result1.rows[0].count,
                isVerified: result1.rows[0].isverified,
                countForEachMonth: result2.rows.map(({themonth, count}) => ({ month: themonth, count: parseInt(count) }))
            } : {
                name: "",
                aboutMe: "",
                email: "",
                dateJoined: "",
                count: 0,
                isVerified: false,
                countForEachMonth: dateTime.getMonthsVsBlogCount()
            }, info: "Fetch Successful", status: "success", title: "Success" }
        } catch(err) {
            throw err;
        }
    },
    updateUserAboutMe: async (userId, aboutMe) => {
        try {
            await client.query(`UPDATE users SET aboutMe = '${aboutMe}' WHERE userId = ${userId}`);
            return { 
                info: "About me successfully updated", 
                status: "success", 
                title: "Success" 
            };
        } catch(err) {
            throw err;
        }
    }
};
