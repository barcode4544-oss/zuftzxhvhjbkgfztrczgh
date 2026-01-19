const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

var bancache = {};
var unbancache = {};

// Improved check function using Instagram's public API
async function check(username) {
    try {
        console.log(`\n=== Checking: @${username} ===`);
        
        // Method 1: Try to fetch user info from Instagram's public endpoint
        const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            }
        });

        console.log(`Response status: ${response.status}`);

        // Check status codes
        if (response.status === 404) {
            console.log(`❌ Account not found or banned`);
            return 'BANNED';
        }

        if (response.status === 429) {
            console.log(`⚠️ Rate limited`);
            return 'BLOCKED';
        }

        if (!response.ok) {
            console.log(`⚠️ Unexpected status: ${response.status}`);
            // Fallback to scraping method
            return await checkFallback(username);
        }

        const data = await response.json();

        if (data.data && data.data.user) {
            const user = data.data.user;
            const followers = user.edge_followed_by?.count || 0;
            console.log(`✅ Account active - ${followers} followers`);
            return followers.toString();
        } else {
            console.log(`⚠️ No user data found`);
            return 'BANNED';
        }

    } catch (error) {
        console.error(`❌ Error checking ${username}:`, error.message);
        // Try fallback method
        return await checkFallback(username);
    }
}

// Fallback method using simple HTML scraping
async function checkFallback(username) {
    try {
        console.log(`Trying fallback method for ${username}...`);
        
        const response = await fetch(`https://www.instagram.com/${username}/`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            redirect: 'manual'
        });

        // Check for redirects to login
        if (response.status === 301 || response.status === 302) {
            const location = response.headers.get('location');
            if (location && location.includes('/accounts/login')) {
                console.log(`⚠️ Redirected to login - may be blocked`);
                return 'BLOCKED';
            }
        }

        if (response.status === 404) {
            console.log(`❌ 404 - Account banned or doesn't exist`);
            return 'BANNED';
        }

        if (!response.ok) {
            console.log(`⚠️ Status ${response.status}`);
            return 'ERROR';
        }

        const html = await response.text();

        // Check for banned/error page
        if (html.includes('Sorry, this page isn\'t available') || 
            html.includes('The link you followed may be broken')) {
            console.log(`❌ Account banned or doesn't exist`);
            return 'BANNED';
        }

        // Check for login requirement
        if (html.includes('Login • Instagram') || html.includes('"require_login":true')) {
            console.log(`⚠️ Login required - blocked`);
            return 'BLOCKED';
        }

        // Try to extract follower count from meta tags
        const metaMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
        if (metaMatch) {
            const description = metaMatch[1];
            const followerMatch = description.match(/(\d+[\d,KkMm]*)\s+Followers?/i);
            if (followerMatch) {
                const followers = followerMatch[1].replace(/,/g, '');
                console.log(`✅ Found ${followers} followers`);
                return followers;
            }
        }

        // Try to extract from JSON data
        const jsonMatch = html.match(/<script type="application\/ld\+json">({[^<]+})<\/script>/);
        if (jsonMatch) {
            try {
                const jsonData = JSON.parse(jsonMatch[1]);
                if (jsonData.mainEntityofPage) {
                    console.log(`✅ Account appears active`);
                    return 'ACTIVE';
                }
            } catch (e) {
                // JSON parsing failed
            }
        }

        // If page loaded and has profile keywords, consider it active
        if (html.includes('"is_private"') || html.includes('"edge_followed_by"')) {
            console.log(`✅ Account appears active (profile data found)`);
            return 'ACTIVE';
        }

        console.log(`⚠️ Could not determine status`);
        return 'UNKNOWN';

    } catch (error) {
        console.error(`Fallback error: ${error.message}`);
        return 'ERROR';
    }
}

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 120000; // 2 minutes default

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

client.once('clientReady', async () => {
    console.log(`We have logged in as ${client.user.tag}`);
    console.log('Bot is ready to monitor Instagram accounts!');
    console.log(`Check interval: ${CHECK_INTERVAL/1000} seconds`);
});

function formatTimestamp(date) {
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function isBanned(info) {
    return info === 'BANNED' || info === 'N/A';
}

function isActive(info) {
    return info !== 'BANNED' && info !== 'N/A' && info !== 'ERROR' && info !== 'BLOCKED' && info !== null && info !== 'UNKNOWN';
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

        const username = args[1].replace('@', '');
        const startTime = new Date();

        const loadingEmbed = new EmbedBuilder()
            .setTitle('🔍 Checking Account Status...')
            .setDescription(`Checking **@${username}**...`)
            .setColor(0x0099FF);
        const loadingMsg = await message.channel.send({ embeds: [loadingEmbed] });

        const info = await check(username);

        await loadingMsg.delete().catch(() => {});

        if (info === 'BLOCKED') {
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Request Blocked')
                .setDescription(`Instagram is blocking requests. Try again in a few minutes.`)
                .setColor(0xFFA500)
                .setFooter({ text: 'Rate limited', iconURL: client.user.displayAvatarURL() });

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
                            .setDescription(`Time Taken: ${timeDifferenceMinutes} minutes\nFollowers: ${infoa}`)
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
                .setDescription(`The Instagram account **@${username}** is not banned.\n\nCurrent status: ${info} followers`)
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

        const loadingEmbed = new EmbedBuilder()
            .setTitle('🔍 Checking Account Status...')
            .setDescription(`Checking **@${username}**...`)
            .setColor(0x0099FF);
        const loadingMsg = await message.channel.send({ embeds: [loadingEmbed] });

        const info = await check(username);

        await loadingMsg.delete().catch(() => {});

        if (info === 'BLOCKED') {
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Request Blocked')
                .setDescription(`Instagram is blocking requests. Try again in a few minutes.`)
                .setColor(0xFFA500)
                .setFooter({ text: 'Rate limited', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        if (isActive(info)) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('👀 Monitoring Initiated')
                .setDescription(`The Instagram account **@${username}** is currently valid. Monitoring for any bans...\n\nCurrent followers: ${info}`)
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
                .setDescription(`The Instagram account **@${username}** is already banned or unavailable.\n\nStatus: ${info}`)
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
        
        const loadingEmbed = new EmbedBuilder()
            .setTitle('🔍 Checking Account...')
            .setDescription(`Checking **@${username}**...`)
            .setColor(0x0099FF);
        const loadingMsg = await message.channel.send({ embeds: [loadingEmbed] });
        
        const info = await check(username);
        
        await loadingMsg.delete().catch(() => {});
        
        let statusColor = 0x0099FF;
        let statusText = info;
        
        if (info === 'BANNED' || info === 'N/A') {
            statusColor = 0xFF0000;
            statusText = 'Banned or Not Found';
        } else if (info === 'BLOCKED') {
            statusColor = 0xFFA500;
            statusText = 'Request Blocked (Rate Limited)';
        } else if (info === 'ERROR') {
            statusColor = 0xFF0000;
            statusText = 'Error Occurred';
        } else if (info === 'ACTIVE') {
            statusColor = 0x00FF00;
            statusText = 'Active (follower count unavailable)';
        } else if (info === 'UNKNOWN') {
            statusColor = 0xFFA500;
            statusText = 'Status Unknown';
        } else if (!isNaN(info)) {
            statusColor = 0x00FF00;
            statusText = `Active - ${parseInt(info).toLocaleString()} followers`;
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`Account Status: @${username}`)
            .setDescription(`Status: ${statusText}`)
            .setColor(statusColor)
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
            
            **Note:** Using Instagram's API for fast, reliable checks. Default check interval is 2 minutes.
            `)
            .setColor(0x000000)
            .setThumbnail('https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExOWtxcTZpa2gyMHE1cDFteWNod2Jjbmt0bmJjamNoYXo3MHB1Mjd0ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/OUy615BJPyrkAxkwTh/giphy.gif')
            .setFooter({ text: 'Requested by ' + message.author.username, iconURL: client.user.displayAvatarURL() });

        await message.channel.send({ embeds: [embed] });
    }
});

client.login(TOKEN);
