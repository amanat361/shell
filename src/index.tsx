import { serve } from "bun";
import index from "./index.html";

const OPENCODE_SERVER_URL = "http://127.0.0.1:4096";

// Proxy function to forward requests to OpenCode server
async function proxyToOpenCode(req: Request, path: string) {
  const url = new URL(req.url);
  const targetUrl = `${OPENCODE_SERVER_URL}${path}${url.search}`;
  
  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    
    return response;
  } catch (error) {
    console.error("OpenCode proxy error:", error);
    return Response.json({ 
      error: "OpenCode server not available. Please run 'opencode serve' first." 
    }, { status: 503 });
  }
}

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    // Proxy all /opencode/* requests to OpenCode server
    "/opencode/*": async (req) => {
      const path = new URL(req.url).pathname.replace("/opencode", "");
      return proxyToOpenCode(req, path);
    },

    // Health check for OpenCode server
    "/api/health": {
      async GET() {
        try {
          const response = await fetch(`${OPENCODE_SERVER_URL}/app`);
          if (response.ok) {
            return Response.json({ status: "connected", opencode: true });
          }
          return Response.json({ status: "disconnected", opencode: false }, { status: 503 });
        } catch (error) {
          return Response.json({ 
            status: "disconnected", 
            opencode: false, 
            message: "OpenCode server not running. Run 'opencode serve' to start it." 
          }, { status: 503 });
        }
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 OpenCode Web UI running at ${server.url}`);
console.log(`📡 Expecting OpenCode server at ${OPENCODE_SERVER_URL}`);
console.log(`💡 Run 'opencode serve --port 4096' to start OpenCode server`);
