# My MCP Weather Server

This project is an example of an MCP (Model Context Protocol) server built with the `@modelcontextprotocol/sdk` for TypeScript. It demonstrates how to expose a simple tool that provides dummy weather information for a few predefined cities.

This server is intended to be used as a backend for an MCP-compliant client, such as an LLM-powered agent that can leverage the tools exposed by this server.

## Features

*   **MCP Compliant:** Implements the Model Context Protocol.
*   **Streamable HTTP Transport:** Uses the recommended `StreamableHTTPServerTransport` for communication.
*   **Tool Exposure:** Exposes a `get_city_weather` tool.
    *   **Input:** `city` (string, e.g., "paris", "london", "tokyo") and optional `unit` (enum: "metric" or "imperial", defaults to "metric").
    *   **Output:** Returns dummy weather information including temperature, description, and humidity.
    *   **Structured Output:** Provides `structuredContent` matching a defined `outputSchema` for reliable parsing by clients.
*   **Basic Session Management:** Demonstrates simple in-memory session handling for `StreamableHTTPServerTransport`.

## Prerequisites

*   Node.js (v18 or higher recommended, as per MCP SDK)
*   npm (or yarn/pnpm)

## Setup

1.  **Clone the repository (or create the project files):**
    ```bash
    # If you have it in a git repo:
    # git clone <your-repo-url>
    # cd my-mcp-weather-server

    # Otherwise, ensure you have the project directory with src/server.ts, package.json, tsconfig.json
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Running the Server

### For Development

This command uses `ts-node` to run the TypeScript source directly and `nodemon` to automatically restart the server on file changes.

```bash
npm run build
npm start
```
