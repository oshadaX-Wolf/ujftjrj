const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeInMemoryStore,
    DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const fs = require("fs");
const http = require("http");

const store = makeInMemoryStore({});
let botActive = true;
const ownerNumber = "94755773910@s.whatsapp.net"; // Replace with the bot owner's WhatsApp number

// Weather API setup
const WEATHER_API_KEY = "d8649c8265a04f8881120711240809"; // Replace with your Weather API key
const WEATHER_API_URL = "http://api.weatherapi.com/v1/current.json";

const getWeather = async (city) => {
    try {
        const response = await axios.get(
            `${WEATHER_API_URL}?key=${WEATHER_API_KEY}&q=${city}&aqi=no`,
        );
        return response.data;
    } catch (error) {
        return { error: `Failed to get weather data: ${error.message}` };
    }
};

const startBot = async () => {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
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
            if (content === "!off" && sender === ownerNumber) {
                botActive = false;
                await sock.sendMessage(sender, { text: "Bot deactivated." });
            } else if (content === "!on" && sender === ownerNumber) {
                botActive = true;
                await sock.sendMessage(sender, { text: "Bot activated." });
            } else if (content.startsWith("weather") && botActive) {
                const city = content.replace("weather", "").trim();
                if (city) {
                    const weatherData = await getWeather(city);
                    if (weatherData.error) {
                        await sock.sendMessage(sender, {
                            text: weatherData.error,
                        });
                    } else {
                        const { current } = weatherData;
                        if (current) {
                            const weatherMessage = `Weather in ${city}:\nTemperature: ${current.temp_c}°C\nCondition: ${current.condition.text}\nRegion : ${current.region}\nIcon\n`;
                            await sock.sendMessage(sender, {
                                text: weatherMessage,
                            });
                        } else {
                            await sock.sendMessage(sender, {
                                text: `Weather data not available for ${city}.`,
                            });
                        }
                    }
                } else {
                    await sock.sendMessage(sender, {
                        text: "Please provide a city name after the 'weather' command.",
                    });
                }
            } else if (content === "!getid") {
                await sock.sendMessage(sender, {
                    text: `Your chat ID is: ${sender}`,
                });
            } else if (botActive) {
                await sock.sendMessage(sender, {
                    text: "Hello! I'm currently offline and will get back to you as soon as possible. \n\n\n 😵‍💫😵‍💫Send 'weather [city]' to get the current weather or ",
                });
            }
        }
    });

    return sock;
};

startBot();

// Keep Replit bot alive
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("WhatsApp bot is running.");
    res.end();
}).listen(8080); // The port Replit uses
