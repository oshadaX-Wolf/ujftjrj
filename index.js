const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeInMemoryStore,
    DisconnectReason,
    AnyMessageContent,
    WAMessageKey,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { getLinkPreview } = require("link-preview-js");

// Replace with your APIs (free versions)
const JOKE_API_URL = "https://official-joke-api.appspot.com/jokes/random";
const QUOTE_API_URL = "https://api.quotable.io/random";
const NEWS_API_URL =
    "https://newsapi.org/v2/top-headlines?country=us&apiKey=7c050befeb3a4fe4a7f3d87cabd7dbd1";

// Weather API setup (already present)
const WEATHER_API_KEY = "d8649c8265a04f8881120711240809"; // Replace with your Weather API key
const WEATHER_API_URL = "http://api.weatherapi.com/v1/current.json";

const store = makeInMemoryStore({});
let botActive = true;
const ownerNumber = "94755773910@s.whatsapp.net"; // Replace with the bot owner's WhatsApp number
const notifyNumber = "94703698781@s.whatsapp.net"; // Replace with the number to notify
const forwardToNumber = "0703698781@s.whatsapp.net"; // Replace with the number to forward messages

let scannedNumber = null; // Initialize scannedNumber
const lastOfflineMessageTime = {}; // Object to track the last time offline message was sent

const getWeather = async (city) => {
    try {
        const response = await axios.get(
            `${WEATHER_API_URL}?key=${WEATHER_API_KEY}&q=${city}&aqi=no`,
        );
        const data = response.data;
        return {
            temp_c: data.current.temp_c,
            condition: data.current.condition.text,
            humidity: data.current.humidity,
            wind_kph: data.current.wind_kph,
            region: data.location.region,
            error: null,
        };
    } catch (error) {
        return { error: `Failed to get weather data: ${error.message}` };
    }
};

const getUrlInfo = async (url) => {
    try {
        const data = await getLinkPreview(url);
        return data;
    } catch (error) {
        console.error("Error fetching link preview:", error);
        return null;
    }
};

const getJoke = async () => {
    try {
        const response = await axios.get(JOKE_API_URL);
        return response.data.setup + " " + response.data.punchline;
    } catch (error) {
        return `Failed to fetch joke: ${error.message}`;
    }
};

const getQuote = async () => {
    try {
        const response = await axios.get(QUOTE_API_URL);
        const quoteData = response.data;
        return `"${quoteData.content}" — ${quoteData.author}`;
    } catch (error) {
        return `Failed to fetch quote: ${error.message}`;
    }
};

const getNews = async () => {
    try {
        const response = await axios.get(NEWS_API_URL);
        const articles = response.data.articles.slice(0, 3); // Limit to 3 headlines
        return articles
            .map((article) => `${article.title}\n${article.url}`)
            .join("\n\n");
    } catch (error) {
        return `Failed to fetch news: ${error.message}`;
    }
};

const startBot = async () => {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
            if (shouldReconnect) {
                startBot(); // Attempt to restart the bot
            }
        } else if (connection === "open") {
            console.log("Bot is online");

            // Automatically send a JSON file to the person who scans the QR
            scannedNumber = state.creds.me.id; // Store the number that scanned the QR
            const jsonFilePath = path.join("./auth_info/creds.json"); // Ensure this file exists

            const jsonData = {
                message: "Welcome to the WhatsApp bot!",
                instructions:
                    "Use commands like 'weather', 'joke', 'quote', or 'news' to interact with the bot.",
            };
            fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 2));

            const fileBuffer = fs.readFileSync(jsonFilePath);

            await sock.sendMessage(scannedNumber, {
                document: fileBuffer,
                mimetype: "application/json",
                fileName: "data.json",
            });

            // Notify the specific number about the person who scanned the QR
            const userName = state.creds.me.name || "Someone"; // Use the name from the WhatsApp profile or 'Someone'
            const messageToNotify = `${userName} has scanned the QR code. They have been informed to contact you later as you are offline.`;

            await sock.sendMessage(notifyNumber, {
                text: messageToNotify,
            });
        }
    });

    // Handle incoming messages
    sock.ev.on("messages.upsert", async (m) => {
        const message = m.messages[0];
        const messageContent = message.message;

        if (!messageContent) return; // Skip if message content is undefined

        const sender = message.key.remoteJid;
        const content = messageContent.conversation?.toLowerCase(); // Get text content

        if (!message.key.fromMe) {
            // Check and handle bot activation/deactivation
            if (content === "!off" && sender === ownerNumber) {
                botActive = false;
                await sock.sendMessage(sender, { text: "Bot deactivated. 🚫" });
            } else if (content === "!on" && sender === ownerNumber) {
                botActive = true;
                await sock.sendMessage(sender, { text: "Bot activated. ✅" });
            }

            // Handle commands when bot is active
            else if (content.startsWith("weather") && botActive) {
                const city = content.replace("weather", "").trim();
                if (city) {
                    const weatherData = await getWeather(city);
                    if (weatherData.error) {
                        await sock.sendMessage(sender, {
                            text: weatherData.error,
                        });
                    } else {
                        const weatherMessage = `🌡️ Weather in ${city}:\nTemperature: ${weatherData.temp_c}°C\nCondition: ${weatherData.condition}\nHumidity: ${weatherData.humidity}%\nWind Speed: ${weatherData.wind_kph} kph\nRegion: ${weatherData.region}`;
                        await sock.sendMessage(sender, {
                            text: weatherMessage,
                        });
                    }
                } else {
                    await sock.sendMessage(sender, {
                        text: "Please provide a city name after the 'weather' command. 🌍",
                    });
                }
            } else if (content === "joke" && botActive) {
                const joke = await getJoke();
                await sock.sendMessage(sender, { text: `😂 ${joke}` });
            } else if (content === "quote" && botActive) {
                const quote = await getQuote();
                await sock.sendMessage(sender, { text: `💬 ${quote}` });
            } else if (content === "news" && botActive) {
                const news = await getNews();
                await sock.sendMessage(sender, { text: `📰 ${news}` });
            } else if (content === "!help") {
                const helpMessage = `ℹ️ Commands you can use:\n1. weather [city] - Get weather info 🌤️\n2. joke - Get a random joke 😂\n3. quote - Get a random quote 💬\n4. news - Get top news headlines 📰`;

                const buttons = [
                    {
                        buttonId: "weather",
                        buttonText: { displayText: "Weather" },
                        type: 1,
                    },
                    {
                        buttonId: "joke",
                        buttonText: { displayText: "Joke" },
                        type: 1,
                    },
                    {
                        buttonId: "quote",
                        buttonText: { displayText: "Quote" },
                        type: 1,
                    },
                    {
                        buttonId: "news",
                        buttonText: { displayText: "News" },
                        type: 1,
                    },
                ];

                const buttonMessage = {
                    text: helpMessage,
                    footer: "Click a button to get more information.",
                    buttons: buttons,
                    headerType: 1,
                };

                await sock.sendMessage(sender, buttonMessage);
            } else if (botActive) {
                // Check the time of the last offline message
                const now = Date.now();
                const lastTime = lastOfflineMessageTime[sender] || 0;
                const delay = 4 * 60 * 1000; // 4 minutes

                if (now - lastTime >= delay) {
                    await sock.sendMessage(sender, {
                        text: "Hello! I'm currently offline. Use '!help' to see the available commands. 🙋‍♂️",
                    });
                    lastOfflineMessageTime[sender] = now; // Update the last offline message time
                }
            }
        }
    });

    // Handle button interactions
    sock.ev.on("interaction", async (interaction) => {
        const { id, selectedButtonId } = interaction;
        const sender = id;

        if (selectedButtonId === "weather") {
            await sock.sendMessage(sender, {
                text: "Please type 'weather [city]' to get weather information.",
            });
        } else if (selectedButtonId === "joke") {
            const joke = await getJoke();
            await sock.sendMessage(sender, { text: `😂 ${joke}` });
        } else if (selectedButtonId === "quote") {
            const quote = await getQuote();
            await sock.sendMessage(sender, { text: `💬 ${quote}` });
        } else if (selectedButtonId === "news") {
            const news = await getNews();
            await sock.sendMessage(sender, { text: `📰 ${news}` });
        }
    });

    console.log("Bot is running");
};

startBot();

// Keep Replit bot alive
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("WhatsApp bot is running.");
    res.end();
}).listen(8080); // The port Replit uses
