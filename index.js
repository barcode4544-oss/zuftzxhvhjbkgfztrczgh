const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 120000;

const allowedUserIds = [...ALLOWED_USER_IDS];
const banWatchList = [];
const unbanWatchList = [];
const watchedAccounts = {};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
});

// ---------------------- Puppeteer Instagram Check ----------------------
async function check(username) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle2' });

        const metaDescription = await page.$eval(
            'meta[property="og:description"]',
            el => el.getAttribute('content')
        ).catch(() => null);

        await browser.close();

        if (!metaDescription) return 'BANNED_OR_PRIVATE';
        return metaDescription.split('-')[0].trim();
    } catch (err) {
        if (browser) await browser.close();
        console.error('Error fetching Instagram info:', err);
        return 'ERROR';
    }
}

// ---------------------- Utility Functions ----------------------
function formatTimestamp(date) {
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

async function sendErrorDM(userId, errorMessage) {
    try {
        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Requested by @${user.username} ${formatTimestamp(new Date())}` })
            .setTitle('❌ Error')
            .setDescription(`An error occurred: **${errorMessage}**`)
            .setColor(0xFF0000)
            .setFooter({ text: 'Please try again later', iconURL: client.user.displayAvatarURL() })
            .setImage('https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExazhxZGV5bWwyb2NmZzdkOTJnanpieHJ4eXkzZWRkaHV6bzgzZmlrMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/qfEc3uhiSjKLu/giphy.gif');

        await user.send({ embeds: [embed] });
    } catch (dmError) {
        console.error('Failed to send error DM:', dmError);
    }
}

// ---------------------- Monitoring Logic ----------------------
async function monitorAccount(message, username, watchType) {
    const startTime = Date.now();
    watchedAccounts[username] = true;

    while (watchedAccounts[username]) {
        try {
            const info = await check(username);
            const minutesPassed = Math.floor((Date.now() - startTime) / 60000);

            if (watchType === 'banwatch' && info === 'BANNED_OR_PRIVATE') {
                const embed = new EmbedBuilder()
                    .setTitle(`Account Has Been Smoked! | ${username} ✅`)
                    .setDescription(`Time Taken: ${minutesPassed} minutes`)
                    .setColor(0x000000)
                    .setFooter({ text: 'Monitor Bot v2', iconURL: client.user.displayAvatarURL() });

                await message.channel.send({ embeds: [embed] });
                const index = banWatchList.indexOf(username);
                if (index > -1) banWatchList.splice(index, 1);
                delete watchedAccounts[username];
                break;
            }

            if (watchType === 'unbanwatch' && info !== 'BANNED_OR_PRIVATE' && info !== 'ERROR') {
                const embed = new EmbedBuilder()
                    .setTitle(`Account has been reactivated! | ${username} ✅`)
                    .setDescription(`Time Taken: ${minutesPassed} minutes\n${info}`)
                    .setColor(0x000000)
                    .setFooter({ text: 'Monitor Bot v2', iconURL: client.user.displayAvatarURL() });

                await message.channel.send({ embeds: [embed] });
                const index = unbanWatchList.indexOf(username);
                if (index > -1) unbanWatchList.splice(index, 1);
                delete watchedAccounts[username];
                break;
            }
        } catch (error) {
            console.error(`Error monitoring ${username}:`, error);
            sendErrorDM(message.author.id, error.message);
        }

        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    }
}

// ---------------------- Discord Bot Event ----------------------
client.once('ready', () => {
    console.log(`We have logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.split(' ');

    // ---------------------- Give Access ----------------------
    if (message.content.startsWith('!giveaccess')) {
        if (!allowedUserIds.includes(message.author.id)) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Access Denied')
                .setDescription('You do not have permission to use this command.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Permission required', iconURL: client.user.displayAvatarURL() });
            return message.channel.send({ embeds: [embed] });
        }

        const userIdToAdd = args[1];
        if (!userIdToAdd) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Missing User ID')
                .setDescription('Usage: `!giveaccess <user id>`')
                .setColor(0xFF0000);
            return message.channel.send({ embeds: [embed] });
        }

        if (allowedUserIds.includes(userIdToAdd)) {
            const embed = new EmbedBuilder()
                .setTitle('👀 Already Has Access')
                .setDescription(`User with ID **${userIdToAdd}** already has access.`)
                .setColor(0xFFC107);
            return message.channel.send({ embeds: [embed] });
        }

        allowedUserIds.push(userIdToAdd);
        const embed = new EmbedBuilder()
            .setTitle('✅ Access Granted')
            .setDescription(`User with ID **${userIdToAdd}** has been granted access.`)
            .setColor(0x28A745);
        return message.channel.send({ embeds: [embed] });
    }

    // ---------------------- Ban Watch ----------------------
    else if (message.content.startsWith('!banwatch')) {
        const username = args[1];
        if (!username) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Missing Username')
                .setDescription('Usage: `!banwatch <username>`')
                .setColor(0xFF0000);
            return message.channel.send({ embeds: [embed] });
        }

        const info = await check(username);
        if (info === 'BANNED_OR_PRIVATE') {
            const embed = new EmbedBuilder()
                .setTitle('❌ Invalid for Ban Watch')
                .setDescription(`The Instagram account **@${username}** is already banned.`)
                .setColor(0xFF0000);
            return message.channel.send({ embeds: [embed] });
        }

        banWatchList.push(username);
        monitorAccount(message, username, 'banwatch');

        const embed = new EmbedBuilder()
            .setTitle('👀 Monitoring Initiated')
            .setDescription(`Monitoring **@${username}** for bans...`)
            .setColor(0x000000)
            .setImage('https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExazhxZGV5bWwyb2NmZzdkOTJnanpieHJ4eXkzZWRkaHV6bzgzZmlrMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/qfEc3uhiSjKLu/giphy.gif');
        return message.channel.send({ embeds: [embed] });
    }

    // ---------------------- Unban Watch ----------------------
    else if (message.content.startsWith('!unbanwatch')) {
        const username = args[1];
        if (!username) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Missing Username')
                .setDescription('Usage: `!unbanwatch <username>`')
                .setColor(0xFF0000);
            return message.channel.send({ embeds: [embed] });
        }

        const info = await check(username);
        if (info !== 'BANNED_OR_PRIVATE') {
            const embed = new EmbedBuilder()
                .setTitle('❌ Invalid for Unban Watch')
                .setDescription(`The Instagram account **@${username}** is not banned.`)
                .setColor(0xFF0000);
            return message.channel.send({ embeds: [embed] });
        }

        unbanWatchList.push(username);
        monitorAccount(message, username, 'unbanwatch');

        const embed = new EmbedBuilder()
            .setTitle('👀 Monitoring Initiated')
            .setDescription(`Monitoring **@${username}** for unbans...`)
            .setColor(0x000000)
            .setImage('https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExazhxZGV5bWwyb2NmZzdkOTJnanpieHJ4eXkzZWRkaHV6bzgzZmlrMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/qfEc3uhiSjKLu/giphy.gif');
        return message.channel.send({ embeds: [embed] });
    }

    // ---------------------- Ban/Unban Lists ----------------------
    else if (message.content.startsWith('!banlist')) {
        const embed = new EmbedBuilder()
            .setTitle('📜 Ban Watch List')
            .setDescription(banWatchList.length ? banWatchList.map(u => `• **@${u}**`).join('\n') : 'No accounts currently monitored.')
            .setColor(0x000000);
        return message.channel.send({ embeds: [embed] });
    }

    else if (message.content.startsWith('!unbanlist')) {
        const embed = new EmbedBuilder()
            .setTitle('📜 Unban Watch List')
            .setDescription(unbanWatchList.length ? unbanWatchList.map(u => `• **@${u}**`).join('\n') : 'No accounts currently monitored.')
            .setColor(0x000000);
        return message.channel.send({ embeds: [embed] });
    }

    // ---------------------- Help ----------------------
    else if (message.content.startsWith('!help')) {
        const embed = new EmbedBuilder()
            .setTitle('📖 Help - Available Commands')
            .setDescription(`
**!banwatch <username>** - Monitor account for bans
**!unbanwatch <username>** - Monitor account for unbans
**!banlist** - Show ban watch list
**!unbanlist** - Show unban watch list
**!giveaccess <user id>** - Grant bot access
**!help** - Show this message
            `)
            .setColor(0x000000)
            .setThumbnail('https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExOWtxcTZpa2gyMHE1cDFteWNod2Jjbmt0bmJjamNoYXo3MHB1Mjd0ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/OUy615BJPyrkAxkwTh/giphy.gif');
        return message.channel.send({ embeds: [embed] });
    }

    // ---------------------- Fake Command ----------------------
    else if (message.content.startsWith('!fake')) {
        const embed = new EmbedBuilder()
            .setTitle('Account has been smoked! ✅ | example_username')
            .setDescription(`Time Taken: 0hr 2m 53s | Followers: 65`)
            .setColor(0x000000)
            .setFooter({ text: 'Monitor Bot v2' })
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }
});

// ---------------------- Login ----------------------
client.login(TOKEN);
