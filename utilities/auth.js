const db = require("../db/postgresql.js");
const mailer = require("./mailer.js");
const bcrypt = require("bcryptjs");

module.exports = {
    createNewUser: async (name, email, password) => {
        try {
            const [user, isVerified] = await db.checkIfUserExistsAndVerified(email);
            if(user.email && isVerified) {
                return { 
                    info: "Account with this email already exists, please try with another email", 
                    status: "info", 
                    title: "Account already exists" 
                };
            } else if(user.email) {
                await mailer.sendVerificationLink(user.userId, user.email, user.name);
                return { 
                    info: "Account with this email already exists, please click on the verification link sent to your email to continue login", 
                    status: "info", 
                    title: "Account already exists" 
                };
            }
            const hashedPassword = await bcrypt.hash(password, 12);
            const userId = await db.createNewUser(name, email, hashedPassword);
            await mailer.sendVerificationLink(userId, email, name);
            return {
                info: "Account successfully created, please click on the verification link sent to your email to continue login", 
                status: "success", 
                title: "Account successfully created" 
            };
        } catch(err) {
            throw err;
        }
    },
    verifyUser: async userId => {
        try {
            const { details: { isVerified, name }} = await db.getUserDetails(userId);
            if(isVerified === true) {
                return { 
                    info: `Hi ${name}, you can now use your credentials to login`, 
                    status: "info", 
                    title: "Account already verified" 
                };
            }
            await db.activateUserAccount(userId);
            return {
                info: `Hi ${name}, you can now use your credentials to login`, 
                status: "info", 
                title: "Account verification successful" 
            };
        } catch(err) {
            throw err;
        }
    },
    authenticateUser: async (email, password) => {
        try {
            const { userId, name, isVerified, password: passwordInDb } = await db.getUserDetailsFromEmail(email);
            if(!userId || !await bcrypt.compare(password, passwordInDb)) {
                return {
                    info: "Invalid credentials", 
                    status: "error", 
                    title: "Error" 
                };
            } else if(!isVerified) {
                await mailer.sendVerificationLink(userId, email, name);
                return { 
                    info: "User is not verified, but dont worry we have sent you a verification mail to your email", 
                    status: "warning", 
                    title: "Not verified" 
                };
            }
            return { 
                info: "Login Successful", 
                status: "success", 
                title: "Login Successful", 
                data: { userId, email, name, isVerified, password }
            };
        } catch(err) {
            throw err;
        }
    }
}