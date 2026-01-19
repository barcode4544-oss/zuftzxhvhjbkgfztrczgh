const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { chromium } = require('playwright');
require('dotenv').config();

var bancache = {};
var unbancache = {};

// Browser instance that will be reused
let browser = null;
let browserContext = null;

// Initialize browser
async function initBrowser() {
    if (!browser) {
        browser = await chromium.launch({
            headless: true, // Set to false for debugging
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list'
            ]
        });
        
        browserContext = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            locale: 'en-US',
            timezoneId: 'America/New_York',
            ignoreHTTPSErrors: true, // Ignore SSL errors
            bypassCSP: true // Bypass Content Security Policy
        });
        
        console.log('Browser initialized successfully');
    }
    return browserContext;
}

// Improved check function using Playwright
async function check(username) {
    let page = null;
    try {
        const context = await initBrowser();
        page = await context.newPage();
        
        // Set extra headers to appear more human-like
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });
        
        const url = `https://www.instagram.com/${username}/`;
        console.log(`\n=== Checking: ${url} ===`);
        
        // Navigate to the profile with more lenient settings
        let response;
        try {
            response = await page.goto(url, { 
                waitUntil: 'domcontentloaded', // Changed from networkidle to be more lenient
                timeout: 30000 
            });
        } catch (gotoError) {
            // If goto fails, try to still analyze the page
            console.log(`⚠️ Navigation warning: ${gotoError.message}`);
            // Continue anyway, the page might have loaded partially
        }
        
        // Wait a bit more for dynamic content to load
        await page.waitForTimeout(3000);
        
        // Check if we're on login page
        const currentUrl = page.url();
        console.log(`Current URL: ${currentUrl}`);
        
        if (currentUrl.includes('/accounts/login')) {
            console.log(`❌ Redirected to login for ${username}`);
            await page.close();
            return 'BLOCKED';
        }
        
        // Get page title for debugging
        const pageTitle = await page.title();
        console.log(`Page title: ${pageTitle}`);
        
        // Method 1: Check for "Sorry, this page isn't available" message
        const pageNotAvailableText = await page.locator('text=/Sorry, this page isn.*t available/i').count();
        const userNotFoundText = await page.locator('text=/The link you followed may be broken/i').count();
        
        if (pageNotAvailableText > 0 || userNotFoundText > 0) {
            console.log(`❌ Account ${username} is not available (banned or doesn't exist)`);
            await page.close();
            return 'BANNED';
        }
        
        // Method 2: Try to find follower count from meta tags
        const metaContent = await page.locator('meta[property="og:description"]').getAttribute('content').catch(() => null);
        if (metaContent) {
            console.log(`✅ Meta description found: ${metaContent}`);
            
            // Extract follower count
            const followerMatch = metaContent.match(/(\d+[\d,]*)\s+Followers?/i);
            if (followerMatch) {
                const followers = followerMatch[1].replace(/,/g, '');
                console.log(`✅ Found ${followers} followers for ${username}`);
                await page.close();
                return followers;
            }
            
            // Check if meta contains post/following info (means account is active)
            if (metaContent.match(/\d+\s+(Posts?|Following|Followers?)/i)) {
                console.log(`✅ Account appears active from meta`);
                await page.close();
                return 'ACTIVE';
            }
        }
        
        // Method 3: Look for profile picture (strong indicator account exists)
        const profilePicExists = await page.locator('img[alt*="profile picture"]').count();
        if (profilePicExists > 0) {
            console.log(`✅ Profile picture found - account is active`);
            await page.close();
            return 'ACTIVE';
        }
        
        // Method 4: Try to find follower count from page elements
        try {
            await page.waitForSelector('header', { timeout: 5000 });
            
            // Look for any span/link that contains follower info
            const statsElements = await page.locator('ul li span').allTextContents();
            console.log(`Stats elements found: ${JSON.stringify(statsElements)}`);
            
            for (const stat of statsElements) {
                const followerMatch = stat.match(/(\d+[\d,KkMm]*)/);
                if (followerMatch && stat.toLowerCase().includes('follower')) {
                    console.log(`✅ Found follower stat: ${followerMatch[1]}`);
                    await page.close();
                    return followerMatch[1].replace(/,/g, '');
                }
            }
            
            // If we found header but no stats, account still exists
            if (statsElements.length > 0) {
                console.log(`✅ Account exists (header found)`);
                await page.close();
                return 'ACTIVE';
            }
        } catch (e) {
            console.log(`⚠️ Could not find header/stats: ${e.message}`);
        }
        
        // Method 5: Check page content for any signs of a valid profile
        const bodyText = await page.locator('body').textContent();
        
        // If page contains profile-specific elements
        if (bodyText.includes('posts') || bodyText.includes('followers') || bodyText.includes('following')) {
            console.log(`✅ Account appears valid (contains profile keywords)`);
            await page.close();
            return 'ACTIVE';
        }
        
        // Method 6: Check if response was successful (if we got a response)
        if (response) {
            console.log(`Response status: ${response.status()}`);
            if (response.ok() && response.status() === 200) {
                console.log(`✅ Page loaded successfully (200 OK) - account likely exists`);
                await page.close();
                return 'ACTIVE';
            }
            // Handle specific status codes
            if (response.status() === 404) {
                console.log(`❌ 404 Not Found - account doesn't exist or is banned`);
                await page.close();
                return 'BANNED';
            }
        }
        
        console.log(`⚠️ Could not determine account status definitively`);
        await page.close();
        return 'UNKNOWN';
        
    } catch (error) {
        console.error(`❌ Error checking ${username}:`, error.message);
        if (page) {
            try {
                // Try to check if page loaded despite error
                const currentUrl = await page.url().catch(() => null);
                if (currentUrl && !currentUrl.includes('/accounts/login')) {
                    console.log(`⚠️ Error occurred but page might have loaded, attempting to analyze...`);
                    
                    // Try to check for error message
                    const pageNotAvailable = await page.locator('text=/Sorry, this page isn.*t available/i').count().catch(() => 0);
                    if (pageNotAvailable > 0) {
                        console.log(`❌ Account is banned despite navigation error`);
                        await page.close();
                        return 'BANNED';
                    }
                    
                    // Try to find any sign of account
                    const bodyText = await page.locator('body').textContent().catch(() => '');
                    if (bodyText.includes('followers') || bodyText.includes('posts')) {
                        console.log(`✅ Account appears active despite navigation error`);
                        await page.close();
                        return 'ACTIVE';
                    }
                }
            } catch (analysisError) {
                console.log(`Could not analyze page after error: ${analysisError.message}`);
            }
            await page.close().catch(() => {});
        }
        return 'ERROR';
    }
}

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 180000; // Increased to 3 minutes

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
    console.log('Initializing browser...');
    await initBrowser();
    console.log('Bot is ready to monitor Instagram accounts!');
});

function formatTimestamp(date) {
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function isBanned(info) {
    return info === 'BANNED' || info === 'N/A';
}

function isActive(info) {
    // Consider ACTIVE, UNKNOWN, and any follower count as "active"
    return info !== 'BANNED' && info !== 'N/A' && info !== 'ERROR' && info !== 'BLOCKED' && info !== null;
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

        // Show loading message
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
                .setDescription(`Instagram is blocking automated requests. Try again in a few minutes.`)
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

        // Show loading message
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
                .setDescription(`Instagram is blocking automated requests. Try again in a few minutes.`)
                .setColor(0xFFA500)
                .setFooter({ text: 'Rate limited', iconURL: client.user.displayAvatarURL() });

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
        } else if (info === 'ACTIVE' || info === 'UNKNOWN') {
            statusColor = 0x00FF00;
            statusText = info === 'UNKNOWN' ? 'Active (Status Uncertain)' : 'Active (No follower count available)';
        } else if (!isNaN(info)) {
            statusColor = 0x00FF00;
            statusText = `Active - ${info} followers`;
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
            
            **Note:** Using Playwright for better reliability. Check interval is 3 minutes.
            `)
            .setColor(0x000000)
            .setThumbnail('https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExOWtxcTZpa2gyMHE1cDFteWNod2Jjbmt0bmJjamNoYXo3MHB1Mjd0ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/OUy615BJPyrkAxkwTh/giphy.gif')
            .setFooter({ text: 'Requested by ' + message.author.username, iconURL: client.user.displayAvatarURL() });

        await message.channel.send({ embeds: [embed] });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (browser) {
        await browser.close();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    if (browser) {
        await browser.close();
    }
    process.exit(0);
});

client.login(TOKEN);
