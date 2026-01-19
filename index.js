const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

var bancache = {};
var unbancache = {};

// Improved check function with better error handling and rate limiting
async function check(username) {
    try {
        // Add random delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
        
        const req = await fetch(`https://www.instagram.com/${username}/`, {
            "headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Cache-Control": "max-age=0",
                "DNT": "1"
            },
            "method": "GET",
            "redirect": "manual" // Don't follow redirects
        });

        // Check if we got redirected to login (status 301/302)
        if (req.status === 301 || req.status === 302) {
            console.log(`Redirected - Instagram may be blocking requests for ${username}`);
            return 'BLOCKED'; // Return special status
        }

        if (req.status !== 200) {
            console.log(`Status ${req.status} for ${username}`);
            return 'ERROR';
        }

        const res = await req.text();
        
        // Check if we're on the login page
        if (res.includes('Login • Instagram') || res.includes('accounts/login')) {
            console.log(`Login page detected for ${username} - requests are being blocked`);
            return 'BLOCKED';
        }

        // Multiple ways to check account status
        // Method 1: Check for specific error messages
        if (res.includes('Sorry, this page') || res.includes('isn\'t available')) {
            return 'N/A'; // Banned or doesn't exist
        }

        // Method 2: Try to find follower data
        const sp = res.split('<meta property="og:description" content="');
        if (sp.length > 1) {
            const description = sp[1].split('"')[0];
            const followerMatch = description.match(/(\d+[\d,]*)\s+Followers?/i);
            if (followerMatch) {
                return followerMatch[1].replace(/,/g, '');
            }
            return description.split('-')[0].trim();
        }

        // Method 3: Check JSON data in page
        const jsonMatch = res.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
        if (jsonMatch) {
            try {
                const data = JSON.parse(jsonMatch[1]);
                if (data && data.mainEntityofPage) {
                    return 'ACTIVE'; // Account exists and is accessible
                }
            } catch (e) {
                // JSON parsing failed, continue
            }
        }

        return 'N/A';
    } catch (error) {
        console.error(`Error checking ${username}:`, error.message);
        return 'ERROR';
    }
}

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 120000;

let watchedAccounts = {}; 
let storedFollowerData = {};  

const allowedUserIds = [...ALLOWED_USER_IDS];
const banWatchList = [];
const unbanWatchList = [];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
});

// Fix the deprecation warning
client.once('clientReady', () => {
    console.log(`We have logged in as ${client.user.tag}`);
    console.log('Bot is ready to monitor Instagram accounts!');
});

function formatTimestamp(date) {
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function isBanned(info) {
    return info === 'N/A' || (typeof info === 'string' && info.length <= 3);
}

function isActive(info) {
    return info !== 'N/A' && info !== 'ERROR' && info !== 'BLOCKED' && info !== null;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!giveaccess')) {
        const args = message.content.split(' ');

        if (!allowedUserIds.includes(message.author.id)) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Access Denied')
                .setDescription('You do not have permission to use this command.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Permission required', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        if (args.length < 2 || !args[1]) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username}` })
                .setTitle('❌ Missing User ID')
                .setDescription('You need to specify a user ID to give access.\n\n**Usage:** `!giveaccess <user id>`')
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        const userIdToAdd = args[1];

        if (allowedUserIds.includes(userIdToAdd)) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username}` })
                .setTitle('👀 Already Has Access')
                .setDescription(`User with ID **${userIdToAdd}** already has access.`)
                .setColor(0xFFC107)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Access already granted', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        allowedUserIds.push(userIdToAdd);

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Requested by @${message.author.username}` })
            .setTitle('✅ Access Granted')
            .setDescription(`User with ID **${userIdToAdd}** has been granted access.`)
            .setColor(0x28A745)
            .setThumbnail(message.author.displayAvatarURL())
            .setFooter({ text: 'Access granted successfully', iconURL: client.user.displayAvatarURL() });

        await message.channel.send({ embeds: [embed] });
    } else if (message.content.startsWith('!unbanwatch')) {
        const args = message.content.split(' ');
        if (args.length < 2 || !args[1]) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username}` })
                .setTitle('❌ Missing Username')
                .setDescription('You need to specify a username to unbanwatch.\n\n**Usage:** `!unbanwatch <username>`')
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        const username = args[1].replace('@', ''); // Remove @ if present
        const startTime = new Date();

        const info = await check(username);

        if (info === 'BLOCKED') {
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Request Blocked')
                .setDescription(`Instagram is blocking automated requests. The bot may need to use proxies or reduce request frequency.`)
                .setColor(0xFFA500)
                .setFooter({ text: 'Try again later', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        if (isBanned(info)) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('👀 Account Banned')
                .setDescription(`The Instagram account **@${username}** is currently banned. Monitoring for reactivation...`)
                .setColor(0x000000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Monitoring in progress', iconURL: client.user.displayAvatarURL() })
                .setImage('https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExazhxZGV5bWwyb2NmZzdkOTJnanpieHJ4eXkzZWRkaHV6bzgzZmlrMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/qfEc3uhiSjKLu/giphy.gif');

            await message.channel.send({ embeds: [embed] });
            unbancache[username] = info;
            watchedAccounts[username] = true;
            unbanWatchList.push(username);

            let hasSentEmbed = false;

            const intv = setInterval(async function() {
                try {
                    const infoa = await check(username);
                    const currentTime = Date.now();
                    const timeDifference = Math.abs(currentTime - startTime) / 1000;
                    const timeDifferenceMinutes = Math.floor(timeDifference / 60);

                    if (infoa === 'BLOCKED') {
                        console.log(`Monitoring ${username} - requests blocked, will retry...`);
                        return;
                    }

                    if (isActive(infoa) && !hasSentEmbed) {
                        const embed = new EmbedBuilder()
                            .setTitle(`Account has been reactivated Successfully! | ${username} ✅`)
                            .setDescription(`Time Taken: ${timeDifferenceMinutes} minutes\nStatus: ${infoa}`)
                            .setColor(0x00FF00)
                            .setFooter({ text: 'Monitor Bot v1', iconURL: client.user.displayAvatarURL() });

                        await message.channel.send({ embeds: [embed] });
                        hasSentEmbed = true;
                        clearInterval(intv);

                        delete watchedAccounts[username];
                        const indexUnban = unbanWatchList.indexOf(username);
                        if (indexUnban > -1) {
                            unbanWatchList.splice(indexUnban, 1);
                        }
                    }
                } catch (error) {
                    console.error(`Error during monitoring for ${username}:`, error);
                }
            }, CHECK_INTERVAL);
        } else {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('❌ Invalid for Unban Watch')
                .setDescription(`The Instagram account **@${username}** is not banned and cannot be watched for reactivation.\n\nCurrent status: ${info}`)
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        }
    } else if (message.content.startsWith('!banwatch')) {
        const args = message.content.split(' ');
        if (args.length < 2 || !args[1]) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username}` })
                .setTitle('❌ Missing Username')
                .setDescription('You need to specify a username to banwatch.\n\n**Usage:** `!banwatch <username>`')
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        const username = args[1].replace('@', '');
        const startTime = new Date();

        const info = await check(username);

        if (info === 'BLOCKED') {
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Request Blocked')
                .setDescription(`Instagram is blocking automated requests. The bot may need to use proxies or reduce request frequency.`)
                .setColor(0xFFA500)
                .setFooter({ text: 'Try again later', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        if (isActive(info)) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('👀 Monitoring Initiated')
                .setDescription(`The Instagram account **@${username}** is currently valid. Monitoring for any bans...\n\nCurrent info: ${info}`)
                .setColor(0x000000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Monitoring in progress', iconURL: client.user.displayAvatarURL() })
                .setImage('https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExazhxZGV5bWwyb2NmZzdkOTJnanpieHJ4eXkzZWRkaHV6bzgzZmlrMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/qfEc3uhiSjKLu/giphy.gif');

            await message.channel.send({ embeds: [embed] });
            watchedAccounts[username] = true;
            banWatchList.push(username);
            
            const intv = setInterval(async function() {
                const infoa = await check(username);
                
                if (infoa === 'BLOCKED') {
                    console.log(`Monitoring ${username} - requests blocked, will retry...`);
                    return;
                }
                
                if (isBanned(infoa)) {
                    const currentTime = Date.now();
                    const timeDifference = Math.abs(currentTime - startTime) / 1000;
                    const timeDifferenceMinutes = Math.floor(timeDifference / 60);
                    
                    const embed = new EmbedBuilder()
                        .setTitle(`Account Has Been Smoked! | ${username} ✅`)
                        .setDescription(`Time Taken: ${timeDifferenceMinutes} minutes`)
                        .setColor(0xFF0000)
                        .setFooter({ text: 'Monitor Bot v1', iconURL: client.user.displayAvatarURL() });
                    
                    delete watchedAccounts[username];
                    const index = banWatchList.indexOf(username);
                    if (index > -1) {
                        banWatchList.splice(index, 1);
                    }
                    
                    await message.channel.send({ embeds: [embed] });
                    clearInterval(intv);
                }
            }, CHECK_INTERVAL);
        } else {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('❌ Invalid for Ban Watch')
                .setDescription(`The Instagram account **@${username}** is already banned or unavailable and cannot be watched for bans.\n\nStatus: ${info}`)
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        }
    } else if (message.content.startsWith('!check')) {
        const args = message.content.split(' ');
        if (args.length < 2) {
            await message.channel.send('Usage: !check <username>');
            return;
        }
        
        const username = args[1].replace('@', '');
        const info = await check(username);
        
        const embed = new EmbedBuilder()
            .setTitle(`Account Status: @${username}`)
            .setDescription(`Status: ${info}`)
            .setColor(0x0099FF)
            .setFooter({ text: 'Account check', iconURL: client.user.displayAvatarURL() });

        await message.channel.send({ embeds: [embed] });
    } else if (message.content.startsWith('!banlist')) {
        if (banWatchList.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('📜 Ban Watch List')
                .setDescription('No accounts are currently being monitored for bans.')
                .setColor(0x000000)
                .setFooter({ text: 'Ban watch list is empty', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setTitle('📜 Ban Watch List')
                .setDescription(banWatchList.map(username => `• **@${username}**`).join('\n'))
                .setColor(0x000000)
                .setFooter({ text: 'Current ban watch list', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        }
    } else if (message.content.startsWith('!unbanlist')) {
        if (unbanWatchList.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('📜 Unban Watch List')
                .setDescription('No accounts are currently being monitored for unbans.')
                .setColor(0x000000)
                .setFooter({ text: 'Unban watch list is empty', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setTitle('📜 Unban Watch List')
                .setDescription(unbanWatchList.map(username => `• **@${username}**`).join('\n'))
                .setColor(0x000000)
                .setFooter({ text: 'Current unban watch list', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        }
    } else if (message.content.startsWith('!help')) {
        const embed = new EmbedBuilder()
            .setTitle('📖 Help - Available Commands')
            .setDescription(`
            **!banwatch <username>** - Starts monitoring an Instagram account for being banned.
            **!unbanwatch <username>** - Starts monitoring an Instagram account for being unbanned.
            **!check <username>** - Check the current status of an Instagram account.
            **!banlist** - Displays a list of all accounts currently being monitored for bans.
            **!unbanlist** - Displays a list of all accounts currently being monitored for unbans.
            **!giveaccess <user id>** - Grants access to a user by adding them to the allowed list.
            **!help** - Displays this help message.
            `)
            .setColor(0x000000)
            .setThumbnail('https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExOWtxcTZpa2gyMHE1cDFteWNod2Jjbmt0bmJjamNoYXo3MHB1Mjd0ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/OUy615BJPyrkAxkwTh/giphy.gif')
            .setFooter({ text: 'Requested by ' + message.author.username, iconURL: client.user.displayAvatarURL() });

        await message.channel.send({ embeds: [embed] });
    }
});

client.login(TOKEN);
