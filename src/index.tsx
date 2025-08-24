import { serve } from "bun";
import { $ } from "bun";
import index from "./index.html";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    "/api/execute": {
      async POST(req) {
        try {
          const { command } = await req.json();
          
          try {
            const result = await $`zsh -c "${command}"`;
            return Response.json({
              stdout: result.stdout.toString(),
              stderr: result.stderr.toString(),
              exitCode: result.exitCode
            });
          } catch (error: any) {
            return Response.json({
              error: error.stderr?.toString() || error.message,
              exitCode: error.exitCode || 1
            });
          }
        } catch (error) {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
      },
    },

    "/api/cancel": {
      async POST(req) {
        // For now, we'll return a cancellation message
        // In a real implementation, you'd track running processes
        return Response.json({ 
          message: "^C", 
          cancelled: true 
        });
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

console.log(`🚀 Server running at ${server.url}`);
