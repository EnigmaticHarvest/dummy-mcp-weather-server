// src/server.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { CallToolResult, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
// Optional: If you want resumability for SSE streams (not strictly necessary for this simple example)
// import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js'; // Adjust path if you copy it

// --- Dummy Weather Data ---
interface WeatherData {
    temperature: number;
    description: string;
    humidity: number;
    unit: 'metric' | 'imperial';
}

const dummyWeatherData: Record<string, WeatherData> = {
    "paris": { temperature: 15, description: "Cloudy", humidity: 70, unit: 'metric' },
    "london": { temperature: 12, description: "Rainy", humidity: 85, unit: 'metric' },
    "tokyo": { temperature: 22, description: "Sunny", humidity: 60, unit: 'metric' },
};

// --- MCP Server Setup ---
const getServerInstance = () => {
    const mcpApiServer = new McpServer(
        {
            name: "MyWeatherMCPServer",
            version: "1.0.0",
        },
        { // Server Capabilities
            capabilities: {
                tools: {}, // We are exposing tools
                logging: {}, // Optional: if you want the server to send logs to client
            },
            instructions: "This server provides weather information.",
        }
    );

    // Define the get_city_weather tool
    mcpApiServer.registerTool(
        "get_city_weather", // Tool name
        { // Tool Configuration
            description: "Fetches the current weather forecast for a specified city.",
            inputSchema: {
                city: z.string().toLowerCase().describe("The name of the city (e.g., Paris, London, Tokyo)."),
                unit: z.enum(["metric", "imperial"]).optional().default("metric").describe("The unit for temperature (metric for Celsius, imperial for Fahrenheit)."),
            },
            // Optional: Define outputSchema if you want structured content validation on client
            outputSchema: {
                city: z.string(),
                temperature: z.number(),
                unit: z.enum(["metric", "imperial"]),
                description: z.string(),
                humidity: z.number(),
            },
            annotations: {
                title: "Get City Weather",
                readOnlyHint: true,
            }
        },
        async (
            { city, unit }, // Destructured input arguments (validated by Zod)
            { sendNotification } // RequestHandlerExtra - for sending notifications if needed
        ): Promise<CallToolResult> => {
            console.log(`[WeatherTool] Received request for city: ${city}, unit: ${unit}`);
            await sendNotification({ // Example of sending a log notification
                method: "notifications/message",
                params: { level: "info", data: `Processing weather request for ${city}` }
            });

            const weather = dummyWeatherData[city.toLowerCase()];

            if (!weather) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Sorry, I don't have weather data for ${city}.` }],
                };
            }

            let displayTemperature = weather.temperature;
            let displayUnit = weather.unit;

            if (unit === 'imperial' && weather.unit === 'metric') {
                displayTemperature = (weather.temperature * 9 / 5) + 32;
                displayUnit = 'imperial';
            } else if (unit === 'metric' && weather.unit === 'imperial') {
                displayTemperature = (weather.temperature - 32) * 5 / 9;
                displayUnit = 'metric';
            }
            displayTemperature = parseFloat(displayTemperature.toFixed(1));


            const responseText = `The weather in ${city} is ${displayTemperature}°${displayUnit === 'metric' ? 'C' : 'F'}, ${weather.description} with ${weather.humidity}% humidity.`;

            // If you have outputSchema, you MUST provide structuredContent
            const structuredOutput = {
                city: city,
                temperature: displayTemperature,
                unit: displayUnit,
                description: weather.description,
                humidity: weather.humidity,
            };

            return {
                content: [{ type: "text", text: responseText }],
                structuredContent: structuredOutput, // Matches outputSchema
            };
        }
    );

    // You could add more tools here
    // mcpApiServer.tool("another_tool", ...);

    return mcpApiServer;
};


// --- Express App Setup ---
const app = express();
app.use(cors({ exposedHeaders: 'mcp-session-id' })); // Enabled CORS for all origins and exposed mcp-session-id
app.use(express.json()); // Middleware to parse JSON bodies

const PORT = process.env.PORT || 8000; // Use port 8000 for the MCP server

// This will store active transports by session ID if you use sessionful server
const activeTransports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Main MCP endpoint
app.all('/mcp', async (req: Request, res: Response) => { // .all handles GET, POST, DELETE
    console.log(`[Express] Received ${req.method} request to /mcp`);
    if (req.method === 'POST' && req.body) console.log(`[Express] Body:`, JSON.stringify(req.body).substring(0, 200) + "...");


    // Check for existing session ID from header
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && activeTransports[sessionId]) {
        console.log(`[Express] Reusing transport for session: ${sessionId}`);
        transport = activeTransports[sessionId];
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        console.log("[Express] New client initialization request.");
        // const eventStore = new InMemoryEventStore(); // Optional: for resumability
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(), // Generates session IDs
            // eventStore, // Enable resumability if you uncomment InMemoryEventStore
            onsessioninitialized: (newSessionId) => {
                console.log(`[Transport] Session initialized: ${newSessionId}`);
                activeTransports[newSessionId] = transport; // Store for reuse
            }
        });

        transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && activeTransports[sid]) {
                console.log(`[Transport] Session ${sid} closed. Removing from active transports.`);
                delete activeTransports[sid];
            }
        };

        const mcpInstance = getServerInstance(); // Get a fresh server instance for a new transport
        await mcpInstance.connect(transport);
        console.log("[Express] McpServer connected to new transport.");

    } else if (sessionId && !activeTransports[sessionId]) {
        console.warn(`[Express] Session ID ${sessionId} provided, but no active transport found. Client might need to re-initialize.`);
        res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found. Please re-initialize." }, id: (req.body as any)?.id || null });
        return;
    }
    else {
        console.warn(`[Express] Invalid request: Method ${req.method} without session ID or non-initialize POST.`);
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Bad Request: Session ID required or invalid initialization." }, id: (req.body as any)?.id || null });
        return;
    }

    try {
        await transport.handleRequest(req, res, req.body); // Pass req.body for POST
    } catch (error) {
        console.error("[Express] Error handling MCP request:", error);
        if (!res.headersSent) {
            res.status(500).json({ jsonrpc: "2.0", error: { code: -32000, message: "Internal Server Error" }, id: (req.body as any)?.id || null });
        }
    }
});

app.listen(PORT, () => {
    console.log(`MCP Weather Server (Streamable HTTP) listening on http://localhost:${PORT}/mcp`);
    console.log("Available cities for weather: Paris, London, Tokyo");
});

process.on('SIGINT', () => {
    console.log('Shutting down MCP server...');
    // Optionally close active transports if needed, though StreamableHTTP handles client disconnects
    process.exit(0);
});

