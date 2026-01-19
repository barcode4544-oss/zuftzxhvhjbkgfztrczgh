const { IgApiClient } = require('instagram-private-api');
const fs = require('fs');

const ig = new IgApiClient();
ig.state.generateDevice(process.env.IG_USERNAME); // uses your username from .env

// Log in and save session
async function igLogin() {
    if (fs.existsSync('./ig_session.json')) {
        const session = JSON.parse(fs.readFileSync('./ig_session.json'));
        await ig.state.deserialize(session);
        console.log("✅ Instagram session restored");
        return;
    }

    await ig.account.login(
        process.env.IG_USERNAME,
        process.env.IG_PASSWORD
    );

    const state = await ig.state.serialize();
    fs.writeFileSync('./ig_session.json', JSON.stringify(state));
    console.log("✅ Instagram logged in & session saved");
}

// This replaces your old `check(username)` function
async function check(username) {
    try {
        const user = await ig.user.searchExact(username);
        return {
            status: "valid",
            followers: user.follower_count
        };
    } catch (err) {
        if (
            err.message.includes("User not found") ||
            err.message.includes("Requested resource does not exist")
        ) {
            return { status: "banned" };
        }
        throw err;
    }
}

module.exports = { igLogin, check };
